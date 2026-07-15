/**
 * Per-frame expression language: the MilkDrop/EEL dialect of C-like math.
 * Programs are statement lists (`name = expr;`, `megabuf(i) = expr;`,
 * `loop(n, …)`, or bare expressions). Compile once, run per frame against a
 * persistent variable environment; unknown identifiers read as 0.
 *
 * Intrinsic and operator semantics follow the witnessed authoritative
 * MilkDrop reimplementation (butterchurn presetBase.js runtime functions
 * + milkdrop-preset-converter operator emissions — evidence at
 * docs/evidence/butterchurn/presetBase.js and the converter output):
 * EPSILON = 0.00001 for equal/==/bnot/!/if-condition; sqrt takes |x|;
 * `%` and mod() floor both operands and guard 0; `&`/`|` are BITWISE
 * (floor + int or/and) while `&&`/`||` are logical; int() floors;
 * rand(x) floors its arg (x<1 -> [0,1)); pow returns 0 on non-finite;
 * div guards 0; assignments store raw doubles (no sanitization).
 */

export interface Program {
  run(env: Record<string, number>): void;
  /** Variables the program assigns (for routing outputs). */
  assigns: string[];
  /** Install a dedicated RNG stream for rand()/randint(). Programs that
   *  do not call setRng use Math.random. Runners committing a
   *  deterministic seed (aligned to an instrumented oracle) install the
   *  seeded stream once; every call to rand()/randint() during any
   *  subsequent run() draws from that stream in program-source order. */
  setRng(fn: () => number): void;
  /** Install the shared 1M-cell gmegabuf storage (witnessed butterchurn
   *  presetEquationRunner.js: `this.gmegabuf = new Array(1048576).fill(0);
   *  mdVSBase.gmegabuf = this.gmegabuf`). Every gmegabuf(i) read/write
   *  in this Program flows through the shared array; passing null (the
   *  default) falls back to per-pool storage which does not cross
   *  context boundaries. Every program in one preset execution
   *  (preset init/frame/pixel + each wave/shape init/frame/point)
   *  receives the same Float64Array so the sharing is real. */
  setGmegabuf(arr: Float64Array | null): void;
  /** True when the program's source references gmegabuf (compile-time
   *  detection). Runners consult this to decide whether the shared
   *  array must be installed before run(). */
  readonly usesGmegabuf: boolean;
}

type Node = (env: Record<string, number>) => number;

const LOOP_CAP = 65536;
const EPSILON = 0.00001;

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sqrt: (x) => Math.sqrt(Math.abs(x)),
  invsqrt: (x) => 1 / Math.sqrt(Math.abs(x)),
  pow: (a, b) => {
    const r = Math.pow(a, b);
    return Number.isFinite(r) ? r : 0;
  },
  exp: Math.exp, log: Math.log, log10: (x) => Math.log(x) * Math.LOG10E,
  abs: Math.abs,
  sign: (x) => (x > 0 ? 1 : x < 0 ? -1 : 0),
  floor: Math.floor, ceil: Math.ceil,
  int: Math.floor, frac: (x) => x - Math.floor(x),
  min: Math.min, max: Math.max,
  sqr: (x) => x * x,
  // rand/randint are overridden by compile()'s per-Program closure so
  // each Program can carry its own deterministic RNG stream. The FUNCS
  // entries here are fallbacks (Math.random) used only before compile
  // wires up the per-Program rand — never reached in practice.
  rand: (x) => {
    const xf = Math.floor(x);
    return xf < 1 ? Math.random() : Math.random() * xf;
  },
  randint: (x) => Math.floor(FUNCS.rand(x)),
  sigmoid: (x, y) => {
    const t = 1 + Math.exp(-x * y);
    return Math.abs(t) > EPSILON ? 1.0 / t : 0;
  },
  above: (a, b) => (a > b ? 1 : 0),
  below: (a, b) => (a < b ? 1 : 0),
  equal: (a, b) => (Math.abs(a - b) < EPSILON ? 1 : 0),
  band: (a, b) => (Math.abs(a) > EPSILON && Math.abs(b) > EPSILON ? 1 : 0),
  bor: (a, b) => (Math.abs(a) > EPSILON || Math.abs(b) > EPSILON ? 1 : 0),
  bnot: (a) => (Math.abs(a) < EPSILON ? 1 : 0),
  bitand: (a, b) => Math.floor(a) & Math.floor(b),
  bitor: (a, b) => Math.floor(a) | Math.floor(b),
  if: (c, t, f) => (Math.abs(c) > EPSILON ? t : f),
  exec2: (_a, b) => b,
  exec3: (_a, _b, c) => c,
};

/** megabuf/gmegabuf cells live in the env under a store prefix. */
const BUF_PREFIX: Record<string, string> = { megabuf: "@mb", gmegabuf: "@gmb" };

/** Module-scope holder for the currently active shared gmegabuf array.
 *  Programs sharing storage (preset+pixel+wave+shape within one frame)
 *  install the same Float64Array via setGmegabuf(); Program.run()
 *  swaps this holder to the Program's array on entry and restores on
 *  exit, so nested run() calls (which do not happen today but could
 *  in the future) do not corrupt each other. Only one Program runs at
 *  a time in the current architecture, so the swap-and-restore is
 *  correct and cheap. */
const GMEGABUF_HOLDER: { current: Float64Array | null } = { current: null };

interface Token { kind: "num" | "ident" | "op"; text: string; pos: number }

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") { i++; continue; }
    if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (ch === "$") {
      const m = /^\$(pi|e|phi)/i.exec(src.slice(i));
      if (!m) throw new Error(`unexpected character '$' at ${i}`);
      const v = { pi: Math.PI, e: Math.E, phi: (1 + Math.sqrt(5)) / 2 }[m[1].toLowerCase()] as number;
      out.push({ kind: "num", text: String(v), pos: i });
      i += m[0].length;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^([0-9]+\.[0-9]*|[0-9]*\.[0-9]+|[0-9]+)(e[+-]?[0-9]+)?/i.exec(src.slice(i));
      if (!m || m[0] === ".") throw new Error(`bad number at ${i}`);
      out.push({ kind: "num", text: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      const m = /^[a-zA-Z_]\w*/.exec(src.slice(i));
      if (!m) throw new Error(`bad identifier at ${i}`);
      out.push({ kind: "ident", text: m[0].toLowerCase(), pos: i });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "==", "!=", "&&", "||", "+=", "-=", "*=", "/=", "%="].includes(two)) {
      out.push({ kind: "op", text: two, pos: i });
      i += 2;
      continue;
    }
    if ("+-*/%^()<>,;=&|!".includes(ch)) {
      out.push({ kind: "op", text: ch, pos: i });
      i++;
      continue;
    }
    throw new Error(`unexpected character '${ch}' at ${i}`);
  }
  return out;
}

class Parser {
  private p = 0;
  readonly assigns = new Set<string>();
  /** Set when the parser emits at least one gmegabuf read or write.
   *  Programs that touch gmegabuf require a shared Float64Array installed
   *  via Program.setGmegabuf(...) before run(); the runner uses this
   *  flag to decide whether to install the preset-wide shared array. */
  usesGmegabuf = false;
  constructor(private toks: Token[]) {}

  private peek(o = 0): Token | undefined { return this.toks[this.p + o]; }
  private takeOp(text: string): boolean {
    const t = this.peek();
    if (t && t.kind === "op" && t.text === text) { this.p++; return true; }
    return false;
  }
  private expectOp(text: string): void {
    if (!this.takeOp(text)) {
      const t = this.peek();
      throw new Error(`expected '${text}' at ${t ? t.pos : "end"}`);
    }
  }
  atEnd(): boolean { return this.p >= this.toks.length; }

  /** Statements until end of input or a closing paren (loop bodies). */
  parseStmts(stopAtParen: boolean): Node[] {
    const stmts: Node[] = [];
    for (;;) {
      while (this.takeOp(";")) { /* empty statements */ }
      const t = this.peek();
      if (!t || (stopAtParen && t.kind === "op" && t.text === ")")) return stmts;
      stmts.push(this.parseStmt());
      const nxt = this.peek();
      if (nxt && !(stopAtParen && nxt.kind === "op" && nxt.text === ")")) this.expectOp(";");
    }
  }

  private static readonly COMPOUND: Record<string, (a: number, b: number) => number> = {
    "+=": (a, b) => a + b, "-=": (a, b) => a - b, "*=": (a, b) => a * b,
    "/=": (a, b) => (b === 0 ? 0 : a / b),
    "%=": (a, b) => (Math.floor(b) === 0 ? 0 : Math.floor(a) % Math.floor(b)),
  };

  private parseStmt(): Node {
    // every statement form — assignments (simple and compound), buffer
    // stores, bare expressions — parses as an expression in EEL
    return this.parseExpr();
  }

  parseExpr(): Node { return this.parseOr(); }

  private parseOr(): Node {
    let l = this.parseAnd();
    for (;;) {
      // `||` is logical (JS truthiness -> 1/0); bare `|` is BITWISE
      // (witnessed: the authoritative converter emits bitor for `|`).
      if (this.takeOp("||")) {
        const r = this.parseAnd();
        const a = l;
        l = (e) => (a(e) || r(e) ? 1 : 0);
      } else if (this.takeOp("|")) {
        const r = this.parseAnd();
        const a = l;
        l = (e) => FUNCS.bitor(a(e), r(e));
      } else return l;
    }
  }
  private parseAnd(): Node {
    let l = this.parseCmp();
    for (;;) {
      if (this.takeOp("&&")) {
        const r = this.parseCmp();
        const a = l;
        l = (e) => (a(e) && r(e) ? 1 : 0);
      } else if (this.takeOp("&")) {
        const r = this.parseCmp();
        const a = l;
        l = (e) => FUNCS.bitand(a(e), r(e));
      } else return l;
    }
  }
  private parseCmp(): Node {
    let l = this.parseAdd();
    for (;;) {
      const ops: [string, (a: number, b: number) => number][] = [
        ["<=", (a, b) => (a <= b ? 1 : 0)], [">=", (a, b) => (a >= b ? 1 : 0)],
        // ==/!= are EPSILON comparisons (witnessed converter emission)
        ["==", (a, b) => (Math.abs(a - b) < EPSILON ? 1 : 0)],
        ["!=", (a, b) => (Math.abs(a - b) < EPSILON ? 0 : 1)],
        ["<", (a, b) => (a < b ? 1 : 0)], [">", (a, b) => (a > b ? 1 : 0)],
      ];
      const hit = ops.find(([t]) => this.takeOp(t));
      if (!hit) return l;
      const r = this.parseAdd();
      const a = l;
      const f = hit[1];
      l = (e) => f(a(e), r(e));
    }
  }
  private parseAdd(): Node {
    let l = this.parseMul();
    for (;;) {
      if (this.takeOp("+")) { const r = this.parseMul(); const a = l; l = (e) => a(e) + r(e); }
      else if (this.takeOp("-")) { const r = this.parseMul(); const a = l; l = (e) => a(e) - r(e); }
      else return l;
    }
  }
  private parseMul(): Node {
    let l = this.parsePow();
    for (;;) {
      if (this.takeOp("*")) { const r = this.parsePow(); const a = l; l = (e) => a(e) * r(e); }
      else if (this.takeOp("/")) {
        const r = this.parsePow(); const a = l;
        l = (e) => { const d = r(e); return d === 0 ? 0 : a(e) / d; };
      } else if (this.takeOp("%")) {
        // floor-mod with zero guard (witnessed presetBase mod())
        const r = this.parsePow(); const a = l;
        l = (e) => { const d = Math.floor(r(e)); return d === 0 ? 0 : Math.floor(a(e)) % d; };
      } else return l;
    }
  }
  private parsePow(): Node {
    const l = this.parseUnary();
    if (this.takeOp("^")) {
      const r = this.parsePow(); // right-assoc
      return (e) => FUNCS.pow(l(e), r(e));
    }
    return l;
  }
  private parseUnary(): Node {
    if (this.takeOp("-")) { const v = this.parseUnary(); return (e) => -v(e); }
    if (this.takeOp("+")) return this.parseUnary();
    if (this.takeOp("!")) { const v = this.parseUnary(); return (e) => FUNCS.bnot(v(e)); }
    return this.parsePrimary();
  }
  private parsePrimary(): Node {
    const t = this.peek();
    if (!t) throw new Error("unexpected end of expression");
    if (t.kind === "num") { this.p++; const v = parseFloat(t.text); return () => v; }
    if (t.kind === "ident") {
      this.p++;
      // assignment as expression: `a = expr` / `a += expr` yields the
      // assigned value, so it composes inside if()/exec2() arguments
      const opTok = this.peek();
      const compound = opTok?.kind === "op" ? Parser.COMPOUND[opTok.text] : undefined;
      if (compound || (opTok?.kind === "op" && opTok.text === "=")) {
        this.p++;
        const value = this.parseExpr();
        const name = t.text;
        this.assigns.add(name);
        // Raw assignment (witnessed converter output stores unsanitized
        // doubles; NaN propagation matches the oracle).
        return (e) => {
          const v = compound ? compound(e[name] ?? 0, value(e)) : value(e);
          e[name] = v;
          return v;
        };
      }
      if (this.takeOp("(")) {
        if (t.text === "loop") return this.parseLoop();
        if (t.text === "while") return this.parseWhile();
        if (BUF_PREFIX[t.text]) {
          const isG = t.text === "gmegabuf";
          if (isG) this.usesGmegabuf = true;
          const prefix = BUF_PREFIX[t.text];
          const idx = this.parseExpr();
          this.expectOp(")");
          // floor indexing (witnessed converter: megabuf[Math.floor(i)]);
          // store form composes inside if()/exec2() args like assignment.
          //
          // For gmegabuf: read/write flows through the shared 1M-cell
          // Float64Array owned by the runner and installed via
          // Program.setGmegabuf(). Every program in a preset execution
          // (preset init/frame/pixel + waves + shapes) receives the same
          // array so writes made in one context are visible to reads
          // made in another within the same frame — witnessed oracle
          // behavior (presetEquationRunner.js mdVSBase.gmegabuf shared
          // across all runtime instances). Indexes floored and clamped to
          // [0, 1048575]; out-of-range indexes silently discard writes
          // and return 0 on read (matches oracle behavior).
          //
          // For megabuf: stays per-pool via string-keyed cells.
          const opTok = this.peek();
          const compound = opTok && Parser.COMPOUND[opTok.text];
          const write = compound || (opTok?.kind === "op" && opTok.text === "=");
          if (write) {
            this.p++;
            const value = this.parseExpr();
            if (isG) {
              return (e) => {
                const arr = GMEGABUF_HOLDER.current;
                const i = Math.floor(idx(e));
                if (arr && i >= 0 && i < arr.length) {
                  const v = compound ? compound(arr[i], value(e)) : value(e);
                  arr[i] = v;
                  return v;
                }
                // Fallback path when no shared array is installed —
                // per-pool store, matching pre-shared behavior.
                const key = prefix + i;
                const v = compound ? compound(e[key] ?? 0, value(e)) : value(e);
                e[key] = v;
                return v;
              };
            }
            return (e) => {
              const key = prefix + Math.floor(idx(e));
              const v = compound ? compound(e[key] ?? 0, value(e)) : value(e);
              e[key] = v;
              return v;
            };
          }
          if (isG) {
            return (e) => {
              const arr = GMEGABUF_HOLDER.current;
              const i = Math.floor(idx(e));
              if (arr && i >= 0 && i < arr.length) return arr[i];
              return e[prefix + i] ?? 0;
            };
          }
          return (e) => e[prefix + Math.floor(idx(e))] ?? 0;
        }
        const fn = FUNCS[t.text];
        if (!fn) throw new Error(`unknown function '${t.text}' at ${t.pos}`);
        const args: Node[] = [];
        if (!this.takeOp(")")) {
          do { args.push(this.parseArgBlock()); } while (this.takeOp(","));
          this.expectOp(")");
        }
        // EEL if() executes only the taken branch (branches carry
        // assignments); condition is EPSILON-tested (witnessed converter:
        // Math.abs(cond) > 0.00001 ? then : else).
        if (t.text === "if") {
          const [c, th, el] = [args[0], args[1], args[2]];
          return (e) => (Math.abs(c(e)) > EPSILON ? (th ? th(e) : 0) : (el ? el(e) : 0));
        }
        // rand / randint look up FUNCS at run time — not parse time —
        // because Program.run() patches FUNCS.rand and FUNCS.randint with
        // the closure's seeded stream, and a value captured at parse time
        // would still point at the original Math.random-based version. A
        // direct semantic test at tests/milk-runner.test.ts pins that the
        // seeded stream reaches EEL rand() from Program.setRng().
        if (t.text === "rand" || t.text === "randint") {
          const name = t.text;
          return (e) => FUNCS[name](...args.map((a) => a(e)));
        }
        return (e) => fn(...args.map((a) => a(e)));
      }
      const name = t.text;
      return (e) => e[name] ?? 0;
    }
    if (this.takeOp("(")) {
      const v = this.parseExpr();
      this.expectOp(")");
      return v;
    }
    throw new Error(`unexpected '${t.text}' at ${t.pos}`);
  }

  /** Argument = statement block: expr (';' expr)* with optional trailing ';';
   *  the block's value is its last expression (EEL allows blocks as args). */
  private parseArgBlock(): Node {
    const stmts: Node[] = [this.parseExpr()];
    while (this.takeOp(";")) {
      while (this.takeOp(";")) { /* tolerate doubled semicolons */ }
      const nxt = this.peek();
      if (!nxt || (nxt.kind === "op" && (nxt.text === "," || nxt.text === ")"))) break;
      stmts.push(this.parseExpr());
    }
    if (stmts.length === 1) return stmts[0];
    return (e) => {
      let last = 0;
      for (const s of stmts) last = s(e);
      return last;
    };
  }

  /** loop(count, stmt; stmt; …) — runs the body floor(count) times, capped. */
  private parseLoop(): Node {
    const count = this.parseExpr();
    this.expectOp(",");
    const body = this.parseStmts(true);
    this.expectOp(")");
    return (e) => {
      const n = Math.min(LOOP_CAP, Math.max(0, Math.trunc(count(e))));
      for (let k = 0; k < n; k++) for (const s of body) s(e);
      return 0;
    };
  }

  /** while(stmt; stmt; …) — runs until the last statement evaluates 0, capped. */
  private parseWhile(): Node {
    const body = this.parseStmts(true);
    this.expectOp(")");
    return (e) => {
      for (let k = 0; k < LOOP_CAP; k++) {
        let last = 0;
        for (const s of body) last = s(e);
        if (last === 0) break;
      }
      return 0;
    };
  }
}

/** Compile a statement program. Throws Error with position info on bad syntax. */
export function compile(src: string): Program {
  const parser = new Parser(tokenize(src));
  const stmts = parser.parseStmts(false);
  // Per-Program RNG closure: rand/randint draw from this function so
  // every Program can be given its own seeded stream. Default is
  // Math.random until setRng installs a committed stream.
  let rng: () => number = Math.random;
  // The parser generated nodes that call FUNCS.rand / FUNCS.randint on
  // this shared module-scope table. To bind them per-Program without
  // rewriting the parser, we temporarily patch FUNCS during run(). The
  // patch is scoped to synchronous execution: nested run() calls on
  // different programs restore the outer's rand on exit.
  // Per-Program shared gmegabuf pointer. Programs sharing storage
  // (preset init/frame/pixel + waves + shapes) receive the same array;
  // Programs run in isolation stay null. Run() swaps GMEGABUF_HOLDER
  // for the duration of execution so gmegabuf reads/writes hit the
  // installed array.
  let sharedGmegabuf: Float64Array | null = null;
  const program: Program = {
    assigns: [...parser.assigns],
    usesGmegabuf: parser.usesGmegabuf,
    setRng(fn) { rng = fn; },
    setGmegabuf(arr) { sharedGmegabuf = arr; },
    run(env) {
      const prevRand = FUNCS.rand;
      const prevRandInt = FUNCS.randint;
      const prevGmegabuf = GMEGABUF_HOLDER.current;
      FUNCS.rand = (x) => {
        const xf = Math.floor(x);
        return xf < 1 ? rng() : rng() * xf;
      };
      FUNCS.randint = (x) => Math.floor(FUNCS.rand(x));
      GMEGABUF_HOLDER.current = sharedGmegabuf;
      try {
        for (const s of stmts) s(env);
      } finally {
        FUNCS.rand = prevRand;
        FUNCS.randint = prevRandInt;
        GMEGABUF_HOLDER.current = prevGmegabuf;
      }
    },
  };
  return program;
}
