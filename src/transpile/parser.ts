import { lex, err, type Tok } from "./lexer";
import {
  F32, I32, BOOL, VOID, vec, mat,
  type Expr, type FnDecl, type GlobalDecl, type Program, type Stmt, type Ty,
} from "./ast";

/**
 * Recursive-descent parser for the C-like shader subset GLSL and HLSL share.
 * Dialect differences (type names, intrinsics, entry conventions) live in
 * the front ends; the grammar here is common.
 */

const TYPE_NAMES: Record<string, Ty> = {
  float: F32, int: I32, uint: I32, bool: BOOL, void: VOID, half: F32, double: F32,
  vec2: vec(2), vec3: vec(3), vec4: vec(4),
  ivec2: vec(2), ivec3: vec(3), ivec4: vec(4), // int vectors flow as float vecs; visual code tolerance
  bvec2: vec(2), bvec3: vec(3), bvec4: vec(4),
  mat2: mat(2), mat3: mat(3), mat4: mat(4),
  float2: vec(2), float3: vec(3), float4: vec(4),
  half2: vec(2), half3: vec(3), half4: vec(4),
  int2: vec(2), int3: vec(3), int4: vec(4),
  float2x2: mat(2), float3x3: mat(3), float4x4: mat(4),
};

const QUALIFIERS = new Set([
  "const", "in", "out", "inout", "uniform", "varying", "highp", "mediump",
  "lowp", "precise", "static", "flat",
]);

export class Parser {
  private toks: Tok[];
  private p = 0;

  constructor(src: string) {
    this.toks = lex(src);
  }

  private peek(o = 0): Tok { return this.toks[Math.min(this.p + o, this.toks.length - 1)]; }
  private next(): Tok { return this.toks[this.p++]; }
  private isOp(text: string, o = 0): boolean {
    const t = this.peek(o);
    return t.kind === "op" && t.text === text;
  }
  private takeOp(text: string): boolean {
    if (this.isOp(text)) { this.p++; return true; }
    return false;
  }
  private expectOp(text: string): void {
    const t = this.peek();
    if (!this.takeOp(text)) throw err(`expected '${text}', found '${t.text}'`, t.line);
  }
  private isType(o = 0): boolean {
    const t = this.peek(o);
    return t.kind === "ident" && t.text in TYPE_NAMES;
  }
  private skipQualifiers(): boolean {
    let isConst = false;
    while (this.peek().kind === "ident" && QUALIFIERS.has(this.peek().text)) {
      if (this.peek().text === "const" || this.peek().text === "static") isConst = true;
      this.p++;
    }
    return isConst;
  }

  parseProgram(): Program {
    const globals: GlobalDecl[] = [];
    const fns: FnDecl[] = [];
    while (this.peek().kind !== "eof") {
      if (this.takeOp(";")) continue;
      const isConst = this.skipQualifiers();
      const t = this.peek();
      if (!this.isType()) throw err(`expected declaration, found '${t.text}'`, t.line);
      const ty = TYPE_NAMES[this.next().text];
      const name = this.next();
      if (name.kind !== "ident") throw err(`expected name, found '${name.text}'`, name.line);
      if (this.isOp("(")) {
        fns.push(this.parseFn(ty, name.text, name.line));
      } else {
        let init: Expr | null = null;
        if (this.takeOp("=")) init = this.parseExpr();
        globals.push({ ty, name: name.text, init, isConst: isConst || init !== null, line: name.line });
        while (this.takeOp(",")) {
          const extra = this.next();
          let einit: Expr | null = null;
          if (this.takeOp("=")) einit = this.parseExpr();
          globals.push({ ty, name: extra.text, init: einit, isConst: isConst || einit !== null, line: extra.line });
        }
        this.expectOp(";");
      }
    }
    return { globals, fns };
  }

  private parseFn(ret: Ty, name: string, line: number): FnDecl {
    this.expectOp("(");
    const params: { name: string; ty: Ty }[] = [];
    if (!this.takeOp(")")) {
      do {
        this.skipQualifiers();
        const t = this.peek();
        if (t.kind === "ident" && t.text === "void" && this.peek(1).kind === "op") { this.p++; break; }
        if (!this.isType()) throw err(`expected parameter type, found '${t.text}'`, t.line);
        const pty = TYPE_NAMES[this.next().text];
        const pname = this.next();
        params.push({ name: pname.text, ty: pty });
      } while (this.takeOp(","));
      this.expectOp(")");
    }
    const body = this.parseBlock();
    return { name, ret, params, body, line };
  }

  parseBlock(): Stmt[] {
    this.expectOp("{");
    const out: Stmt[] = [];
    while (!this.takeOp("}")) {
      const t = this.peek();
      if (t.kind === "eof") throw err("unexpected end of block", t.line);
      out.push(this.parseStmt());
    }
    return out;
  }

  private parseBody(): Stmt[] {
    if (this.isOp("{")) return this.parseBlock();
    return [this.parseStmt()];
  }

  parseStmt(): Stmt {
    const t = this.peek();
    if (this.takeOp(";")) return { s: "expr", v: { e: "num", text: "0", isInt: true, line: t.line }, line: t.line };
    if (t.kind === "ident") {
      switch (t.text) {
        case "if": {
          this.p++;
          this.expectOp("(");
          const c = this.parseExpr();
          this.expectOp(")");
          const then = this.parseBody();
          let f: Stmt[] | null = null;
          if (this.peek().kind === "ident" && this.peek().text === "else") {
            this.p++;
            f = this.parseBody();
          }
          return { s: "if", c, t: then, f, line: t.line };
        }
        case "for": {
          this.p++;
          this.expectOp("(");
          const init = this.isOp(";") ? (this.p++, null) : this.parseSimpleStmt(true);
          const cond = this.isOp(";") ? null : this.parseExpr();
          this.expectOp(";");
          const step = this.isOp(")") ? null : this.parseStep();
          this.expectOp(")");
          return { s: "for", init, cond, step, body: this.parseBody(), line: t.line };
        }
        case "while": {
          this.p++;
          this.expectOp("(");
          const c = this.parseExpr();
          this.expectOp(")");
          return { s: "while", c, body: this.parseBody(), line: t.line };
        }
        case "return": {
          this.p++;
          const v = this.isOp(";") ? null : this.parseExpr();
          this.expectOp(";");
          return { s: "ret", v, line: t.line };
        }
        case "break": this.p++; this.expectOp(";"); return { s: "break", line: t.line };
        case "continue": this.p++; this.expectOp(";"); return { s: "continue", line: t.line };
      }
    }
    const st = this.parseSimpleStmt(true);
    return st ?? { s: "expr", v: { e: "num", text: "0", isInt: true, line: t.line }, line: t.line };
  }

  /** Declaration or expression statement; consumes the trailing ';'. */
  private parseSimpleStmt(consumeSemi: boolean): Stmt {
    const isConst = this.skipQualifiers();
    const t = this.peek();
    if (this.isType() && this.peek(1).kind === "ident") {
      let ty = TYPE_NAMES[this.next().text];
      const names: { name: string; init: Expr | null }[] = [];
      do {
        const n = this.next();
        if (n.kind !== "ident") throw err(`expected name, found '${n.text}'`, n.line);
        if (this.takeOp("[")) {
          // size may be any const expression: capture its raw token text
          const parts: string[] = [];
          while (!this.isOp("]")) {
            const st = this.next();
            if (st.kind === "eof") throw err("unterminated array size", n.line);
            parts.push(st.text);
          }
          this.expectOp("]");
          const raw = parts.join(" ");
          ty = { k: "arr", of: ty, n: /^\d+$/.test(raw) ? parseInt(raw, 10) : raw };
        }
        let init: Expr | null = null;
        if (this.takeOp("=")) init = this.parseExpr();
        names.push({ name: n.text, init });
      } while (this.takeOp(","));
      if (consumeSemi) this.expectOp(";");
      return { s: "decl", ty, names, isConst, line: t.line };
    }
    // ++x / x++ statements
    if (this.isOp("++") || this.isOp("--")) {
      const op = this.next().text;
      const target = this.parseUnary();
      if (consumeSemi) this.expectOp(";");
      return { s: "incdec", op, target, line: t.line };
    }
    const v = this.parseExpr();
    if (this.isOp("++") || this.isOp("--")) {
      const op = this.next().text;
      if (consumeSemi) this.expectOp(";");
      return { s: "incdec", op, target: v, line: t.line };
    }
    if (consumeSemi) this.expectOp(";");
    return { s: "expr", v, line: t.line };
  }

  /** for-loop step: expression, assignment, or ++/-- in either position. */
  private parseStep(): Expr {
    const t = this.peek();
    if (this.isOp("++") || this.isOp("--")) {
      const op = this.next().text;
      const target = this.parseUnary();
      return { e: "assign", op: op === "++" ? "+=" : "-=", target, value: { e: "num", text: "1", isInt: true, line: t.line }, line: t.line };
    }
    const v = this.parseExpr();
    if (this.isOp("++") || this.isOp("--")) {
      const op = this.next().text;
      return { e: "assign", op: op === "++" ? "+=" : "-=", target: v, value: { e: "num", text: "1", isInt: true, line: t.line }, line: t.line };
    }
    return v;
  }

  parseExpr(): Expr { return this.parseAssign(); }

  private parseAssign(): Expr {
    const l = this.parseCond();
    const t = this.peek();
    if (t.kind === "op" && ["=", "+=", "-=", "*=", "/=", "%="].includes(t.text)) {
      this.p++;
      const value = this.parseAssign();
      return { e: "assign", op: t.text, target: l, value, line: t.line };
    }
    return l;
  }

  private parseCond(): Expr {
    const c = this.parseOr();
    if (this.takeOp("?")) {
      const tv = this.parseAssign();
      this.expectOp(":");
      const fv = this.parseAssign();
      return { e: "cond", c, t: tv, f: fv, line: (c as { line: number }).line };
    }
    return c;
  }

  private binLevel(ops: string[], sub: () => Expr): Expr {
    let l = sub.call(this);
    for (;;) {
      const t = this.peek();
      if (t.kind === "op" && ops.includes(t.text)) {
        this.p++;
        const r = sub.call(this);
        l = { e: "bin", op: t.text, l, r, line: t.line };
      } else return l;
    }
  }

  private parseOr(): Expr { return this.binLevel(["||"], this.parseAnd); }
  private parseAnd(): Expr { return this.binLevel(["&&"], this.parseCmpEq); }
  private parseCmpEq(): Expr { return this.binLevel(["==", "!="], this.parseCmpRel); }
  private parseCmpRel(): Expr { return this.binLevel(["<", ">", "<=", ">="], this.parseAdd); }
  private parseAdd(): Expr { return this.binLevel(["+", "-"], this.parseMul); }
  private parseMul(): Expr { return this.binLevel(["*", "/", "%"], this.parseUnary); }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.kind === "op" && ["-", "+", "!"].includes(t.text)) {
      this.p++;
      return { e: "unary", op: t.text, v: this.parseUnary(), line: t.line };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let v = this.parsePrimary();
    for (;;) {
      if (this.takeOp(".")) {
        const n = this.next();
        v = { e: "member", obj: v, name: n.text, line: n.line };
      } else if (this.takeOp("[")) {
        const idx = this.parseExpr();
        this.expectOp("]");
        v = { e: "index", obj: v, idx, line: (v as { line: number }).line };
      } else return v;
    }
  }

  private parsePrimary(): Expr {
    const t = this.next();
    if (t.kind === "num") {
      const clean = t.text.replace(/[fFuUlL]$/, "");
      const isInt = !/[.e]/i.test(clean) && !t.text.startsWith("0x");
      return { e: "num", text: t.text.startsWith("0x") ? String(parseInt(t.text, 16)) : clean, isInt, line: t.line };
    }
    if (t.kind === "ident") {
      if (t.text === "true" || t.text === "false") {
        return { e: "ident", name: t.text, line: t.line };
      }
      if (this.takeOp("(")) {
        const args: Expr[] = [];
        if (!this.takeOp(")")) {
          do { args.push(this.parseAssign()); } while (this.takeOp(","));
          this.expectOp(")");
        }
        return { e: "call", name: t.text, args, line: t.line };
      }
      return { e: "ident", name: t.text, line: t.line };
    }
    if (t.kind === "op" && t.text === "(") {
      const v = this.parseExpr();
      this.expectOp(")");
      return v;
    }
    throw err(`unexpected '${t.text}'`, t.line);
  }
}

export function parseShader(src: string): Program {
  return new Parser(src).parseProgram();
}
