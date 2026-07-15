/** Shared C-style shader lexer for the GLSL and HLSL front ends. */

export interface Tok {
  kind: "num" | "ident" | "op" | "eof";
  text: string;
  pos: number;
  line: number;
}

const OPS3 = ["<<=", ">>="];
const OPS2 = [
  "==", "!=", "<=", ">=", "&&", "||", "+=", "-=", "*=", "/=", "%=",
  "++", "--", "<<", ">>", "&=", "|=", "^=",
];

export function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === "\n") { line++; i++; continue; }
    if (ch === " " || ch === "\t" || ch === "\r") { i++; continue; }
    if (ch === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const skipped = src.slice(i, end < 0 ? n : end);
      line += (skipped.match(/\n/g) ?? []).length;
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(0x[0-9a-fA-F]+|[0-9]+\.[0-9]*(e[+-]?[0-9]+)?|\.[0-9]+(e[+-]?[0-9]+)?|[0-9]+(e[+-]?[0-9]+)?)[fFuUlL]?/.exec(src.slice(i));
      if (!m) throw err("bad number", line);
      toks.push({ kind: "num", text: m[0], pos: i, line });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      const m = /^[a-zA-Z_]\w*/.exec(src.slice(i));
      if (!m) throw err("bad identifier", line);
      toks.push({ kind: "ident", text: m[0], pos: i, line });
      i += m[0].length;
      continue;
    }
    const three = src.slice(i, i + 3);
    if (OPS3.includes(three)) { toks.push({ kind: "op", text: three, pos: i, line }); i += 3; continue; }
    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) { toks.push({ kind: "op", text: two, pos: i, line }); i += 2; continue; }
    if ("+-*/%<>=!&|^~?:;,.(){}[]".includes(ch)) {
      toks.push({ kind: "op", text: ch, pos: i, line });
      i++;
      continue;
    }
    throw err(`unexpected character '${ch}'`, line);
  }
  toks.push({ kind: "eof", text: "", pos: n, line });
  return toks;
}

export function err(msg: string, line: number): Error {
  return new Error(`${msg} (line ${line})`);
}
