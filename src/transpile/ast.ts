/** AST + type model for the shader transpiler. */

export type Ty =
  | { k: "f32" } | { k: "i32" } | { k: "bool" } | { k: "void" }
  | { k: "vec"; n: 2 | 3 | 4 }
  | { k: "mat"; n: 2 | 3 | 4 }
  | { k: "arr"; of: Ty; n: number | string }; // string: named constant size

export const F32: Ty = { k: "f32" };
export const I32: Ty = { k: "i32" };
export const BOOL: Ty = { k: "bool" };
export const VOID: Ty = { k: "void" };
export const vec = (n: 2 | 3 | 4): Ty => ({ k: "vec", n });
export const mat = (n: 2 | 3 | 4): Ty => ({ k: "mat", n });

export function tyEq(a: Ty, b: Ty): boolean {
  if (a.k !== b.k) return false;
  if (a.k === "vec" || a.k === "mat") return a.n === (b as { n: number }).n;
  if (a.k === "arr") {
    const bb = b as { of: Ty; n: number };
    return a.n === bb.n && tyEq(a.of, bb.of);
  }
  return true;
}

export function wgslTy(t: Ty): string {
  switch (t.k) {
    case "f32": return "f32";
    case "i32": return "i32";
    case "bool": return "bool";
    case "void": return "";
    case "vec": return `vec${t.n}f`;
    case "mat": return `mat${t.n}x${t.n}f`;
    case "arr": return `array<${wgslTy(t.of)}, ${t.n}>`;
  }
}

export type Expr =
  | { e: "num"; text: string; isInt: boolean; line: number }
  | { e: "ident"; name: string; line: number }
  | { e: "member"; obj: Expr; name: string; line: number }
  | { e: "index"; obj: Expr; idx: Expr; line: number }
  | { e: "call"; name: string; args: Expr[]; line: number }
  | { e: "unary"; op: string; v: Expr; line: number }
  | { e: "bin"; op: string; l: Expr; r: Expr; line: number }
  | { e: "cond"; c: Expr; t: Expr; f: Expr; line: number }
  | { e: "assign"; op: string; target: Expr; value: Expr; line: number };

export type Stmt =
  | { s: "decl"; ty: Ty; names: { name: string; init: Expr | null }[]; isConst: boolean; line: number }
  | { s: "expr"; v: Expr; line: number }
  | { s: "if"; c: Expr; t: Stmt[]; f: Stmt[] | null; line: number }
  | { s: "for"; init: Stmt | null; cond: Expr | null; step: Expr | null; body: Stmt[]; line: number }
  | { s: "while"; c: Expr; body: Stmt[]; line: number }
  | { s: "ret"; v: Expr | null; line: number }
  | { s: "break"; line: number }
  | { s: "continue"; line: number }
  | { s: "incdec"; op: string; target: Expr; line: number }
  | { s: "block"; body: Stmt[]; line: number };

export interface FnDecl {
  name: string;
  ret: Ty;
  params: { name: string; ty: Ty }[];
  body: Stmt[];
  line: number;
}

export interface GlobalDecl {
  ty: Ty;
  name: string;
  init: Expr | null;
  isConst: boolean;
  line: number;
}

export interface Program {
  globals: GlobalDecl[];
  fns: FnDecl[];
}
