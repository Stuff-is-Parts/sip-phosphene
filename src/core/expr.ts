/**
 * Per-frame expression language: the MilkDrop/EEL dialect of C-like math.
 * Programs are `name = expr;` statements. Compile once, run per frame against
 * a persistent variable environment; unknown identifiers read as 0.
 */

export interface Program {
  run(env: Record<string, number>): void;
  /** Variables the program assigns (for routing outputs). */
  assigns: string[];
}

type Node = (env: Record<string, number>) => number;

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sqrt: (x) => Math.sqrt(Math.max(0, x)), invsqrt: (x) => 1 / Math.sqrt(Math.max(1e-12, x)),
  pow: (a, b) => {
    const r = Math.pow(a, b);
    return Number.isFinite(r) ? r : 0;
  },
  exp: Math.exp, log: (x) => Math.log(Math.max(1e-12, x)), log10: (x) => Math.log10(Math.max(1e-12, x)),
  abs: Math.abs, sign: Math.sign, floor: Math.floor, ceil: Math.ceil,
  int: Math.trunc, frac: (x) => x - Math.floor(x),
  min: Math.min, max: Math.max,
  sqr: (x) => x * x,
  rand: (x) => Math.random() * x,
  sigmoid: (x, c) => 1 / (1 + Math.exp(-x * c)),
  above: (a, b) => (a > b ? 1 : 0),
  below: (a, b) => (a < b ? 1 : 0),
  equal: (a, b) => (a === b ? 1 : 0),
  band: (a, b) => (a !== 0 && b !== 0 ? 1 : 0),
  bor: (a, b) => (a !== 0 || b !== 0 ? 1 : 0),
  bnot: (a) => (a === 0 ? 1 : 0),
  if: (c, t, f) => (c !== 0 ? t : f),
};

interface Token { kind: "num" | "ident" | "op"; text: string; pos: number }

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") { i++; continue; }
    if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (/[0-9.]/.test(ch)) {
      const m = /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?/i.exec(src.slice(i));
      if (!m) throw new Error(`bad number at ${i}`);
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
    if (["<=", ">=", "==", "!=", "&&", "||"].includes(two)) {
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
  constructor(private toks: Token[]) {}

  private peek(): Token | undefined { return this.toks[this.p]; }
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

  parseProgram(): { stmts: { name: string; value: Node }[] } {
    const stmts: { name: string; value: Node }[] = [];
    while (this.peek()) {
      if (this.takeOp(";")) continue;
      const t = this.peek();
      if (!t || t.kind !== "ident") throw new Error(`expected assignment at ${t ? t.pos : "end"}`);
      this.p++;
      this.expectOp("=");
      const value = this.parseExpr();
      stmts.push({ name: t.text, value });
      if (this.peek()) this.expectOp(";");
    }
    return { stmts };
  }

  parseExpr(): Node { return this.parseOr(); }

  private parseOr(): Node {
    let l = this.parseAnd();
    while (this.takeOp("||") || this.takeOp("|")) {
      const r = this.parseAnd();
      const a = l;
      l = (e) => (a(e) !== 0 || r(e) !== 0 ? 1 : 0);
    }
    return l;
  }
  private parseAnd(): Node {
    let l = this.parseCmp();
    while (this.takeOp("&&") || this.takeOp("&")) {
      const r = this.parseCmp();
      const a = l;
      l = (e) => (a(e) !== 0 && r(e) !== 0 ? 1 : 0);
    }
    return l;
  }
  private parseCmp(): Node {
    let l = this.parseAdd();
    for (;;) {
      const ops: [string, (a: number, b: number) => number][] = [
        ["<=", (a, b) => (a <= b ? 1 : 0)], [">=", (a, b) => (a >= b ? 1 : 0)],
        ["==", (a, b) => (a === b ? 1 : 0)], ["!=", (a, b) => (a !== b ? 1 : 0)],
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
        const r = this.parsePow(); const a = l;
        l = (e) => { const d = Math.trunc(r(e)); return d === 0 ? 0 : Math.trunc(a(e)) % d; };
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
    if (this.takeOp("!")) { const v = this.parseUnary(); return (e) => (v(e) === 0 ? 1 : 0); }
    return this.parsePrimary();
  }
  private parsePrimary(): Node {
    const t = this.peek();
    if (!t) throw new Error("unexpected end of expression");
    if (t.kind === "num") { this.p++; const v = parseFloat(t.text); return () => v; }
    if (t.kind === "ident") {
      this.p++;
      if (this.takeOp("(")) {
        const fn = FUNCS[t.text];
        if (!fn) throw new Error(`unknown function '${t.text}' at ${t.pos}`);
        const args: Node[] = [];
        if (!this.takeOp(")")) {
          do { args.push(this.parseExpr()); } while (this.takeOp(","));
          this.expectOp(")");
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
}

/** Compile a statement program. Throws Error with position info on bad syntax. */
export function compile(src: string): Program {
  const parser = new Parser(tokenize(src));
  const { stmts } = parser.parseProgram();
  return {
    assigns: [...new Set(stmts.map((s) => s.name))],
    run(env) {
      for (const s of stmts) {
        const v = s.value(env);
        env[s.name] = Number.isFinite(v) ? v : 0;
      }
    },
  };
}
