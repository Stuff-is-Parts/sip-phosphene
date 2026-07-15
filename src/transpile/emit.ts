import {
  BOOL, F32, I32, VOID, mat, tyEq, vec, wgslTy,
  type Expr, type FnDecl, type Program, type Stmt, type Ty,
} from "./ast";
import { err } from "./lexer";

/**
 * Typed WGSL emitter. Inference drives the differences a text substitution
 * can never get right: int-to-float promotion, scalar-to-vector splats,
 * bool coercion in conditions, swizzle-store rewrites, constructor
 * flattening, and per-signature builtin mapping.
 */

export interface Val { code: string; ty: Ty }

export type Builtin = (args: Val[], line: number, e: Emitter) => Val;

export interface Dialect {
  /** Externally-provided identifiers (engine inputs) with their types. */
  externals: Record<string, Ty>;
  /** Intrinsics: name -> handler producing WGSL. */
  builtins: Record<string, Builtin>;
  /** Identifier rename (collisions with the assembled WGSL's own names). */
  rename(name: string): string;
}

/** WGSL keywords and builtin names that scenes legally use as variables. */
export const WGSL_RESERVED = new Set([
  "mod", "min", "max", "floor", "ceil", "fract", "pow", "exp", "log", "sqrt",
  "abs", "sign", "sin", "cos", "tan", "step", "mix", "clamp", "length",
  "normalize", "dot", "cross", "reflect", "select", "all", "any", "array",
  "let", "var", "const", "fn", "loop", "while", "for", "if", "else", "switch",
  "case", "default", "break", "continue", "return", "discard", "struct",
  "texture", "sampler", "uniform", "bitcast", "enable", "override", "ptr",
  "ref", "type", "alias", "smoothstep", "distance", "noise",
]);

const CTOR: Record<string, Ty> = {
  float: F32, int: I32, bool: BOOL,
  vec2: vec(2), vec3: vec(3), vec4: vec(4),
  ivec2: vec(2), ivec3: vec(3), ivec4: vec(4),
  float2: vec(2), float3: vec(3), float4: vec(4),
  half2: vec(2), half3: vec(3), half4: vec(4),
  mat2: mat(2), mat3: mat(3), mat4: mat(4),
  float2x2: mat(2), float3x3: mat(3), float4x4: mat(4),
};

interface FnSig { params: Ty[]; ret: Ty; mangled: string }

export class Emitter {
  private scopes: Record<string, Ty>[] = [];
  private fnSigs = new Map<string, FnSig[]>();
  private currentRet: Ty = VOID;
  /** Entry-body mode: bare `return;` becomes this expression. */
  entryReturn: string | null = null;
  /** Entry-body mode: value returns assign this output variable first. */
  entryOutVar = "p9out";
  entryOutTy: Ty = vec(4);

  constructor(private dialect: Dialect) {}

  /* ------------------------------ helpers ------------------------------ */

  private lookup(name: string): Ty | null {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (name in this.scopes[i]) return this.scopes[i][name];
    }
    return this.dialect.externals[name] ?? null;
  }

  private declare(name: string, ty: Ty): void {
    this.scopes[this.scopes.length - 1][name] = ty;
  }

  /** Coerce a value to a target type, inserting casts/splats. */
  coerce(v: Val, want: Ty, line: number): Val {
    if (tyEq(v.ty, want)) return v;
    if (want.k === "f32" && v.ty.k === "i32") return { code: `f32(${v.code})`, ty: F32 };
    if (want.k === "i32" && v.ty.k === "f32") return { code: `i32(${v.code})`, ty: I32 };
    if (want.k === "f32" && v.ty.k === "bool") return { code: `select(0.0, 1.0, ${v.code})`, ty: F32 };
    if (want.k === "bool" && (v.ty.k === "f32" || v.ty.k === "i32")) {
      return { code: `(${v.code} != ${v.ty.k === "f32" ? "0.0" : "0"})`, ty: BOOL };
    }
    if (want.k === "vec" && (v.ty.k === "f32" || v.ty.k === "i32")) {
      const s = v.ty.k === "i32" ? `f32(${v.code})` : v.code;
      return { code: `vec${want.n}f(${s})`, ty: want };
    }
    if (want.k === "vec" && v.ty.k === "vec" && v.ty.n > want.n) {
      const sw = "xyzw".slice(0, want.n);
      return { code: `(${v.code}).${sw}`, ty: want };
    }
    if (want.k === "vec" && v.ty.k === "vec" && v.ty.n < want.n) {
      // widen: pad with 0, alpha pads with 1 (visual-code tolerance)
      const pad = Array.from({ length: want.n - v.ty.n }, (_, i) =>
        want.n === 4 && v.ty.k === "vec" && v.ty.n + i === 3 ? "1.0" : "0.0");
      return { code: `vec${want.n}f(${v.code}, ${pad.join(", ")})`, ty: want };
    }
    throw err(`cannot convert ${wgslTy(v.ty)} to ${wgslTy(want)}`, line);
  }

  private toBool(v: Val, line: number): Val { return this.coerce(v, BOOL, line); }
  private toF32(v: Val, line: number): Val {
    return v.ty.k === "i32" || v.ty.k === "bool" ? this.coerce(v, F32, line) : v;
  }

  /* ----------------------------- expressions --------------------------- */

  expr(x: Expr): Val {
    switch (x.e) {
      case "num":
        return x.isInt
          ? { code: String(parseInt(x.text, 10)), ty: I32 } // strips leading zeros
          : { code: /^\./.test(x.text) ? "0" + x.text : x.text.replace(/\.$/, ".0"), ty: F32 };
      case "ident": {
        if (x.name === "true" || x.name === "false") return { code: x.name, ty: BOOL };
        const ty = this.lookup(x.name);
        if (!ty) throw err(`unknown identifier '${x.name}'`, x.line);
        return { code: this.dialect.rename(x.name), ty };
      }
      case "member": {
        const obj = this.expr(x.obj);
        if (obj.ty.k !== "vec") throw err(`'.${x.name}' on non-vector ${wgslTy(obj.ty)}`, x.line);
        const len = x.name.length;
        if (!/^[xyzwrgbastpq]+$/.test(x.name) || len > 4) throw err(`bad swizzle '.${x.name}'`, x.line);
        const norm = x.name.replace(/[rs]/g, "x").replace(/[gt]/g, "y").replace(/[bp]/g, "z").replace(/[aq]/g, "w");
        return { code: `${paren(obj.code)}.${norm}`, ty: len === 1 ? F32 : vec(len as 2 | 3 | 4) };
      }
      case "index": {
        const obj = this.expr(x.obj);
        const idx = this.coerce(this.expr(x.idx), I32, x.line);
        if (obj.ty.k === "vec") return { code: `${paren(obj.code)}[${idx.code}]`, ty: F32 };
        if (obj.ty.k === "mat") return { code: `${paren(obj.code)}[${idx.code}]`, ty: vec(obj.ty.n) };
        if (obj.ty.k === "arr") return { code: `${paren(obj.code)}[${idx.code}]`, ty: obj.ty.of };
        throw err(`indexing non-vector ${wgslTy(obj.ty)}`, x.line);
      }
      case "unary": {
        let v = this.expr(x.v);
        if (x.op === "!") return { code: `!${paren(this.toBool(v, x.line).code)}`, ty: BOOL };
        if (v.ty.k === "bool") v = this.coerce(v, F32, x.line); // HLSL bools are numeric
        return { code: `${x.op}${paren(v.code)}`, ty: v.ty };
      }
      case "bin": return this.binary(x.op, this.expr(x.l), this.expr(x.r), x.line);
      case "cond": {
        const c = this.toBool(this.expr(x.c), x.line);
        let t = this.expr(x.t);
        let f = this.expr(x.f);
        if (!tyEq(t.ty, f.ty)) {
          if (t.ty.k === "vec") f = this.coerce(this.toF32(f, x.line), t.ty, x.line);
          else if (f.ty.k === "vec") t = this.coerce(this.toF32(t, x.line), f.ty, x.line);
          else { t = this.toF32(t, x.line); f = this.toF32(f, x.line); }
        }
        return { code: `select(${f.code}, ${t.code}, ${c.code})`, ty: t.ty };
      }
      case "call": return this.call(x.name, x.args, x.line);
      case "assign": {
        // assignment as expression appears only in for-steps; emit-with-value
        throw err("assignment used as a value", x.line);
      }
    }
  }

  private binary(op: string, l: Val, r: Val, line: number): Val {
    if (op === "&&" || op === "||") {
      return { code: `(${this.toBool(l, line).code} ${op} ${this.toBool(r, line).code})`, ty: BOOL };
    }
    if (["==", "!=", "<", ">", "<=", ">="].includes(op)) {
      if (l.ty.k === "vec" || r.ty.k === "vec") throw err("vector comparison needs all()/any()", line);
      if (!tyEq(l.ty, r.ty)) { l = this.toF32(l, line); r = this.toF32(r, line); }
      return { code: `(${l.code} ${op} ${r.code})`, ty: BOOL };
    }
    // arithmetic
    if (l.ty.k === "mat" || r.ty.k === "mat") {
      let ty: Ty;
      if (l.ty.k === "mat" && r.ty.k === "vec") ty = r.ty;
      else if (r.ty.k === "mat" && l.ty.k === "vec") ty = l.ty;
      else if (l.ty.k === "mat") ty = l.ty;
      else ty = r.ty;
      return { code: `(${l.code} ${op} ${r.code})`, ty };
    }
    if (l.ty.k === "vec" && r.ty.k === "vec") {
      if (l.ty.n !== r.ty.n) {
        // GLSL rejects this too, but shipped scenes carry it: harmonize down
        const n = Math.min(l.ty.n, r.ty.n) as 2 | 3 | 4;
        l = this.coerce(l, vec(n), line);
        r = this.coerce(r, vec(n), line);
      }
      return { code: `(${l.code} ${op} ${r.code})`, ty: l.ty };
    }
    if (l.ty.k === "vec" || r.ty.k === "vec") {
      const v = l.ty.k === "vec" ? l : r;
      const s = this.toF32(l.ty.k === "vec" ? r : l, line);
      if (op === "+" || op === "-" || op === "%") {
        const splat = { code: `vec${(v.ty as { n: number }).n}f(${s.code})`, ty: v.ty };
        const [a, b] = l.ty.k === "vec" ? [v, splat] : [splat, v];
        return { code: `(${a.code} ${op} ${b.code})`, ty: v.ty };
      }
      const [a, b] = l.ty.k === "vec" ? [v, s] : [s, v];
      return { code: `(${a.code} ${op} ${b.code})`, ty: v.ty };
    }
    if (l.ty.k === "bool") l = this.coerce(l, F32, line); // HLSL bool arithmetic
    if (r.ty.k === "bool") r = this.coerce(r, F32, line);
    if (l.ty.k === "i32" && r.ty.k === "i32") return { code: `(${l.code} ${op} ${r.code})`, ty: I32 };
    l = this.toF32(l, line);
    r = this.toF32(r, line);
    return { code: `(${l.code} ${op} ${r.code})`, ty: F32 };
  }

  private call(name: string, argExprs: Expr[], line: number): Val {
    // constructors
    if (name in CTOR) {
      const want = CTOR[name];
      const args = argExprs.map((a) => this.expr(a));
      if (want.k === "f32" || want.k === "i32" || want.k === "bool") {
        return this.coerce(args[0], want, line);
      }
      if (want.k === "vec") {
        if (args.length === 1) return this.coerce(this.toF32(args[0], line), want, line);
        let total = 0;
        const parts = args.map((a) => {
          if (a.ty.k === "vec") { total += a.ty.n; return a.code; }
          total += 1;
          return this.toF32(a, line).code;
        });
        if (total !== want.n) throw err(`vec${want.n} constructor got ${total} components`, line);
        return { code: `vec${want.n}f(${parts.join(", ")})`, ty: want };
      }
      // matrices: columns or scalars
      const mn = (want as { n: 2 | 3 | 4 }).n;
      const parts = args.map((a) => (a.ty.k === "vec" ? a.code : this.toF32(a, line).code));
      return { code: `mat${mn}x${mn}f(${parts.join(", ")})`, ty: want };
    }
    // user functions first: a scene redefining noise() wins over the intrinsic
    const sigs = this.fnSigs.get(name);
    if (!sigs) {
      const b = this.dialect.builtins[name];
      if (b) return b(argExprs.map((a) => this.expr(a)), line, this);
      throw err(`unknown function '${name}'`, line);
    }
    const args = argExprs.map((a) => this.expr(a));
    const byArity = sigs.filter((s) => s.params.length === args.length);
    if (!byArity.length) throw err(`'${name}' has no ${args.length}-arg overload`, line);
    // exact-type overload wins; otherwise first coercible one
    const exact = byArity.find((s) => s.params.every((p, i) => tyEq(p, args[i].ty)));
    const pick = exact ?? byArity.find((s) => {
      try { s.params.forEach((p, i) => this.coerce(args[i], p, line)); return true; }
      catch { return false; }
    });
    if (!pick) throw err(`no matching overload for '${name}'`, line);
    const coerced = args.map((a, i) => this.coerce(a, pick.params[i], line).code);
    return { code: `${pick.mangled}(${coerced.join(", ")})`, ty: pick.ret };
  }

  /* ----------------------------- statements ---------------------------- */

  private stmt(x: Stmt, ind: string): string {
    switch (x.s) {
      case "decl":
        return x.names.map(({ name, init }) => {
          this.declare(name, x.ty);
          const n = this.dialect.rename(name);
          if (init) {
            const v = this.coerce(this.expr(init), x.ty, x.line);
            return `${ind}var ${n} : ${wgslTy(x.ty)} = ${v.code};`;
          }
          return `${ind}var ${n} : ${wgslTy(x.ty)};`;
        }).join("\n");
      case "expr": {
        if (x.v.e === "assign") return this.assign(x.v, ind);
        if (x.v.e === "call") {
          const v = this.expr(x.v);
          return v.ty.k === "void" ? `${ind}${v.code};` : `${ind}var _ = ${v.code};`.replace("var _", `let _u${x.line}`);
        }
        return `${ind}// expression statement with no effect (line ${x.line})`;
      }
      case "if": {
        this.scopes.push({});
        const c = this.toBool(this.expr(x.c), x.line);
        const t = x.t.map((s) => this.stmt(s, ind + "  ")).join("\n");
        let out = `${ind}if (${c.code}) {\n${t}\n${ind}}`;
        if (x.f) {
          const f = x.f.map((s) => this.stmt(s, ind + "  ")).join("\n");
          out += ` else {\n${f}\n${ind}}`;
        }
        this.scopes.pop();
        return out;
      }
      case "for": {
        this.scopes.push({});
        const init = x.init ? this.stmt(x.init, "").trim().replace(/;$/, "") : "";
        const cond = x.cond ? this.toBool(this.expr(x.cond), x.line).code : "true";
        const step = x.step ? this.stepCode(x.step, x.line) : "";
        const body = x.body.map((s) => this.stmt(s, ind + "  ")).join("\n");
        this.scopes.pop();
        return `${ind}for (${init}; ${cond}; ${step}) {\n${body}\n${ind}}`;
      }
      case "while": {
        this.scopes.push({});
        const c = this.toBool(this.expr(x.c), x.line);
        const body = x.body.map((s) => this.stmt(s, ind + "  ")).join("\n");
        this.scopes.pop();
        return `${ind}while (${c.code}) {\n${body}\n${ind}}`;
      }
      case "ret": {
        if (!x.v) {
          return this.entryReturn ? `${ind}return ${this.entryReturn};` : `${ind}return;`;
        }
        if (this.entryReturn) {
          // GLSL mains that return a color: route it through the output var
          const v = this.coerce(this.expr(x.v), this.entryOutTy, x.line);
          return `${ind}{ ${this.entryOutVar} = ${v.code}; return ${this.entryReturn}; }`;
        }
        const v = this.coerce(this.expr(x.v), this.currentRet, x.line);
        return `${ind}return ${v.code};`;
      }
      case "break": return `${ind}break;`;
      case "continue": return `${ind}continue;`;
      case "incdec": {
        const t = this.expr(x.target);
        const one = t.ty.k === "i32" ? "1" : "1.0";
        return `${ind}${t.code} = ${t.code} ${x.op === "++" ? "+" : "-"} ${one};`;
      }
    }
  }

  private stepCode(x: Expr, line: number): string {
    if (x.e === "assign") {
      const inner = this.assign(x, "").trim();
      return inner.replace(/;$/, "");
    }
    const v = this.expr(x);
    void v;
    void line;
    return v.code;
  }

  private assign(x: Extract<Expr, { e: "assign" }>, ind: string): string {
    const target = x.target;
    // swizzle store: v.xyz = e  — WGSL forbids multi-component swizzle writes
    if (target.e === "member" && target.name.length > 1) {
      const obj = this.expr(target.obj);
      if (obj.ty.k !== "vec") throw err("swizzle store on non-vector", x.line);
      const norm = target.name.replace(/[rs]/g, "x").replace(/[gt]/g, "y").replace(/[bp]/g, "z").replace(/[aq]/g, "w");
      const want = vec(norm.length as 2 | 3 | 4);
      let value = this.coerce(this.toF32(this.expr(x.value), x.line), want, x.line);
      if (x.op !== "=") {
        const cur: Val = { code: `${paren(obj.code)}.${norm}`, ty: want };
        value = this.binary(x.op.slice(0, 1), cur, value, x.line);
      }
      const comps = "xyzw".slice(0, obj.ty.n).split("");
      const tmp = `_sw${x.line}`;
      const rebuilt = comps.map((cmp) => {
        const at = norm.indexOf(cmp);
        return at >= 0 ? `${tmp}${norm.length > 1 ? "." + "xyzw"[at] : ""}` : `${paren(obj.code)}.${cmp}`;
      });
      return `${ind}{ let ${tmp} = ${value.code}; ${obj.code} = vec${obj.ty.n}f(${rebuilt.join(", ")}); }`;
    }
    const t = this.expr(target);
    let value = this.coerce(this.expr(x.value), t.ty, x.line);
    if (x.op !== "=") value = this.coerce(this.binary(x.op.slice(0, 1), t, value, x.line), t.ty, x.line);
    return `${ind}${t.code} = ${value.code};`;
  }

  /* ------------------------------ program ------------------------------ */

  /** Emit globals + functions; the entry function is emitted by the frontend.
   *  Globals with non-literal initializers become privates initialized at
   *  entry start (WGSL const/private initializers must be const-expressions). */
  emitProgram(prog: Program, entryName: string): { helpers: string; entry: FnDecl; globalInits: string } {
    this.scopes = [{}];
    const globalLines: string[] = [];
    const initLines: string[] = [];
    for (const g of prog.globals) {
      this.declare(g.name, g.ty);
      const n = this.dialect.rename(g.name);
      if (g.init) {
        const v = this.coerce(this.expr(g.init), g.ty, g.line);
        if (/^-?[\d.]+$/.test(v.code)) {
          globalLines.push(`const ${n} : ${wgslTy(g.ty)} = ${v.code};`);
        } else {
          globalLines.push(`var<private> ${n} : ${wgslTy(g.ty)};`);
          initLines.push(`  ${n} = ${v.code};`);
        }
      } else {
        globalLines.push(`var<private> ${n} : ${wgslTy(g.ty)};`);
      }
    }
    let entry: FnDecl | null = null;
    const fnLines: string[] = [];
    for (const fn of prog.fns) {
      if (fn.name === entryName) { entry = fn; continue; }
      const list = this.fnSigs.get(fn.name) ?? [];
      const mangled = this.dialect.rename(fn.name) + (list.length ? `__o${list.length + 1}` : "");
      list.push({ params: fn.params.map((p) => p.ty), ret: fn.ret, mangled });
      this.fnSigs.set(fn.name, list);
      fnLines.push(this.emitFn(fn, mangled));
    }
    if (!entry) throw err(`no ${entryName}() found`, 1);
    return {
      helpers: [...globalLines, ...fnLines].join("\n"),
      entry,
      globalInits: initLines.join("\n"),
    };
  }

  private defaultReturn(t: Ty): string {
    switch (t.k) {
      case "f32": return "0.0";
      case "i32": return "0";
      case "bool": return "false";
      case "vec": return `vec${t.n}f(0.0)`;
      case "mat": return `mat${t.n}x${t.n}f()`;
      default: return "";
    }
  }

  private emitFn(fn: FnDecl, mangled: string): string {
    this.scopes.push({});
    for (const p of fn.params) this.declare(p.name, p.ty);
    this.currentRet = fn.ret;
    const params = fn.params.map((p) => `${this.dialect.rename(p.name)} : ${wgslTy(p.ty)}`).join(", ");
    const ret = fn.ret.k === "void" ? "" : ` -> ${wgslTy(fn.ret)}`;
    // WGSL params are immutable; shadow them as vars so GLSL-style mutation works
    const shadows = fn.params
      .map((p) => `  var ${this.dialect.rename(p.name)}_m : ${wgslTy(p.ty)} = ${this.dialect.rename(p.name)};`);
    const renames = new Map(fn.params.map((p) => [p.name, this.dialect.rename(p.name) + "_m"]));
    const saved = this.dialect.rename;
    this.dialect.rename = (n: string) => renames.get(n) ?? saved(n);
    const body = fn.body.map((s) => this.stmt(s, "  ")).join("\n");
    this.dialect.rename = saved;
    this.scopes.pop();
    // WGSL requires all paths to return; GLSL lets control fall off the end
    const tail = fn.ret.k !== "void" && fn.body[fn.body.length - 1]?.s !== "ret"
      ? `\n  return ${this.defaultReturn(fn.ret)};` : "";
    return `fn ${mangled}(${params})${ret} {\n${shadows.join("\n")}\n${body}${tail}\n}`;
  }

  /** Emit the entry function's body statements against provided locals. */
  emitEntryBody(entry: FnDecl, locals: Record<string, Ty>, retExpr: string, retTy: Ty): string {
    this.scopes.push({ ...locals });
    this.currentRet = retTy;
    this.entryReturn = retExpr;
    const out = entry.body.map((s) => this.stmt(s, "  ")).join("\n");
    this.entryReturn = null;
    return out;
  }
}

function paren(code: string): string {
  return /^[\w.]+$/.test(code) || /^\w+\(.*\)$/.test(code) || /^\(.*\)$/.test(code) ? code : `(${code})`;
}
