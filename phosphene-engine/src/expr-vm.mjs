// EEL expression compiler: real recursive-descent parser -> JS, with every
// operation routed through the source-derived semantics in eel.mjs.
// Grammar authority: projectm-eval @ da885dc Compiler.y:55-75 (precedence,
// lowest->highest: '=' right; then + - left; then * / left; then % left;
// then ^ LEFT-associative; unary -/+ binds TIGHTEST — so -2^2 = (-2)^2 = 4).
// Comparison operators map to the epsilon-compare functions (TreeFunctions.c:41-49);
// ternary c?a:b follows if()'s condition!=0 lazy-branch semantics (:305-319).
// Identifiers read as 0 when unset and auto-register on write (EEL pools).
// REFUSED loudly (not yet witnessed/supported): && || | & operators,
// $-constants, compound assignment, megabuf indexing — a parse error names them.
import { eelSubject } from './eel.mjs';

/** @typedef {{type:string, value:string}} Token */

const OPS = ['<=', '>=', '==', '!=', '+', '-', '*', '/', '%', '^', '(', ')', ',', '=', ';', '<', '>', '!', '?', ':'];
const REFUSED2 = ['&&', '||', '+=', '-=', '*=', '/=', '%=', '^='];
const REFUSED1 = ['&', '|', '$', '[', ']'];

function tokenize(/** @type {string} */ src) {
  /** @type {Token[]} */
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = /** @type {string} */ (src[i]);
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith('//', i)) break; // trailing comment
    const refused = REFUSED2.find((r) => src.startsWith(r, i)) ?? REFUSED1.find((r) => c === r);
    if (refused) throw new Error(`EEL: unsupported construct "${refused}" — not yet derived from source, refusing`);
    const op2 = OPS.find((o) => o.length === 2 && src.startsWith(o, i));
    if (op2) { out.push({ type: 'op', value: op2 }); i += 2; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/.exec(src.slice(i));
      if (!m) throw new Error(`EEL: bad number at "${src.slice(i, i + 8)}"`);
      out.push({ type: 'num', value: m[0] }); i += m[0].length; continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i));
      out.push({ type: 'ident', value: /** @type {RegExpExecArray} */ (m)[0] }); i += /** @type {RegExpExecArray} */ (m)[0].length; continue;
    }
    if (OPS.includes(c)) { out.push({ type: 'op', value: c }); i++; continue; }
    throw new Error(`EEL: unsupported character "${c}"`);
  }
  return out;
}

// Parser producing a JS expression string over pool P and function table F.
class Parser {
  constructor(/** @type {Token[]} */ tokens) { this.t = tokens; this.p = 0; }
  peek() { return this.t[this.p]; }
  next() { return this.t[this.p++]; }
  expect(/** @type {string} */ v) {
    const tk = this.next();
    if (!tk || tk.value !== v) throw new Error(`EEL: expected "${v}", got "${tk ? tk.value : 'end'}"`);
  }
  // statement: ident '=' ternary
  /** @returns {string} */
  statement() {
    const id = this.next();
    if (!id || id.type !== 'ident') throw new Error(`EEL: statement must start with a variable name, got "${id ? id.value : 'end'}"`);
    this.expect('=');
    const rhs = this.ternary();
    return `P[${JSON.stringify(id.value)}] = ${rhs};`;
  }
  // ternary (Compiler.y:61; condition semantics per TreeFunctions.c:305-319)
  /** @returns {string} */
  ternary() {
    const c = this.compare();
    if (this.peek()?.value === '?') {
      this.next();
      const a = this.ternary();
      this.expect(':');
      const b = this.ternary();
      return `((${c}) !== 0 ? (${a}) : (${b}))`;
    }
    return c;
  }
  // comparisons (left-assoc; epsilon semantics via F.equal etc., TreeFunctions.c:41-49,430-530)
  /** @returns {string} */
  compare() {
    let left = this.additive();
    const map = /** @type {Record<string,string>} */ ({ '==': 'equal', '!=': 'noteq', '<': 'below', '>': 'above', '<=': 'beleq', '>=': 'aboeq' });
    while (this.peek() && map[/** @type {string} */ (this.peek()?.value)]) {
      const fn = map[/** @type {string} */ (this.next()?.value)];
      left = `F.${fn}(${left}, ${this.additive()})`;
    }
    return left;
  }
  /** @returns {string} */
  additive() { // + - left-assoc (Compiler.y:70); plain IEEE ops match TreeFunctions.c:531-575
    let left = this.multiplicative();
    while (this.peek()?.value === '+' || this.peek()?.value === '-') {
      const op = this.next()?.value;
      left = `(${left} ${op} ${this.multiplicative()})`;
    }
    return left;
  }
  /** @returns {string} */
  multiplicative() { // * / left-assoc (Compiler.y:71); / has the near-zero-divisor guard (:576-595)
    let left = this.modulo();
    while (this.peek()?.value === '*' || this.peek()?.value === '/') {
      const op = this.next()?.value;
      left = op === '*' ? `(${left} * ${this.modulo()})` : `F.div(${left}, ${this.modulo()})`;
    }
    return left;
  }
  /** @returns {string} */
  modulo() { // % its own tier (Compiler.y:72); int64 mod semantics (:597-616)
    let left = this.notOp();
    while (this.peek()?.value === '%') { this.next(); left = `F.mod(${left}, ${this.notOp()})`; }
    return left;
  }
  /** @returns {string} */
  notOp() { // ! right-assoc (Compiler.y:73) -> bnot (:430-440)
    if (this.peek()?.value === '!') { this.next(); return `F.bnot(${this.notOp()})`; }
    return this.power();
  }
  /** @returns {string} */
  power() { // ^ LEFT-assoc (Compiler.y:74) -> pow with source guards (:983-1004)
    let left = this.unary();
    while (this.peek()?.value === '^') { this.next(); left = `F.pow(${left}, ${this.unary()})`; }
    return left;
  }
  /** @returns {string} */
  unary() { // unary -/+ binds tightest (Compiler.y:75 NEG POS); neg is plain negate (:704-715)
    if (this.peek()?.value === '-') { this.next(); return `(-${this.unary()})`; }
    if (this.peek()?.value === '+') { this.next(); return this.unary(); }
    return this.primary();
  }
  /** @returns {string} */
  primary() {
    const tk = this.next();
    if (!tk) throw new Error('EEL: unexpected end of expression');
    if (tk.type === 'num') return `(${tk.value})`;
    if (tk.value === '(') { const e = this.ternary(); this.expect(')'); return `(${e})`; }
    if (tk.type === 'ident') {
      if (this.peek()?.value === '(') {
        this.next();
        /** @type {string[]} */
        const args = [];
        if (this.peek()?.value !== ')') {
          args.push(this.ternary());
          while (this.peek()?.value === ',') { this.next(); args.push(this.ternary()); }
        }
        this.expect(')');
        if (tk.value === 'if') { // lazy special form per TreeFunctions.c:305-319
          if (args.length !== 3) throw new Error('EEL: if() takes 3 arguments');
          return `((${args[0]}) !== 0 ? (${args[1]}) : (${args[2]}))`;
        }
        if (!(tk.value in eelSubject)) throw new Error(`unknown function in expression: ${tk.value}()`);
        return `F.${tk.value}(${args.join(', ')})`;
      }
      return `(P[${JSON.stringify(tk.value)}] ?? 0)`; // unset EEL vars read as 0
    }
    throw new Error(`EEL: unexpected "${tk.value}"`);
  }
}

export function compileEEL(/** @type {string[]} */ statements) {
  /** @type {string[]} */
  const compiled = [];
  for (const s of statements) {
    for (const piece of s.split(';')) {
      const t = piece.trim();
      if (!t) continue;
      const tokens = tokenize(t);
      if (tokens.length === 0) continue;
      const parser = new Parser(tokens);
      compiled.push(parser.statement());
      if (parser.p < parser.t.length) throw new Error(`EEL: trailing content after statement: "${t}"`);
    }
  }
  const body = compiled.join('\n');
  const fn = new Function('P', 'F', body);
  return (/** @type {Record<string,number>} */ pool) => { fn(pool, eelSubject); };
}
