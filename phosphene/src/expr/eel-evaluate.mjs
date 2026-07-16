// PHOSPHENE native EEL-subset expression evaluator.
// Supported surface: assignment statements terminated by ';', identifiers,
// decimal number literals, binary + - *, unary -, and parentheses.
// Everything else throws — unsupported behavior is refused, never approximated
// (PHOSPHENE-GOAL.md Implementation Rule). Division and the EEL function
// library are outside this claim until their oracle and authority are
// registered (see CLAIM-MILK-EXPR-OPERATORS).

/** @typedef {{ kind: 'num', value: number } | { kind: 'ident', name: string } | { kind: 'op', op: string }} Token */

/** @param {string} src @returns {Token[]} */
function tokenize(src) {
  /** @type {Token[]} */
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const text = src.slice(i, j);
      if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) throw new Error(`invalid number literal '${text}'`);
      tokens.push({ kind: 'num', value: Number(text) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      tokens.push({ kind: 'ident', name: src.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*()='.includes(ch)) {
      tokens.push({ kind: 'op', op: ch });
      i++;
      continue;
    }
    throw new Error(`unsupported character '${ch}' — outside the operator-only EEL subset this claim covers`);
  }
  return tokens;
}

/**
 * @typedef {{ type: 'num', value: number } | { type: 'var', name: string } | { type: 'neg', operand: Expr } | { type: 'bin', op: string, left: Expr, right: Expr }} Expr
 */

/** Recursive-descent parser: expr := term (('+'|'-') term)* ; term := factor ('*' factor)* ; factor := '-' factor | '(' expr ')' | num | ident */
class Parser {
  /** @param {Token[]} tokens */
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  /** @returns {Token | undefined} */
  peek() { return this.tokens[this.pos]; }

  /** @returns {Token} */
  next() {
    const t = this.tokens[this.pos++];
    if (!t) throw new Error('unexpected end of expression');
    return t;
  }

  /** @returns {Expr} */
  parseExpr() {
    let left = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t && t.kind === 'op' && (t.op === '+' || t.op === '-')) {
        this.next();
        left = { type: 'bin', op: t.op, left, right: this.parseTerm() };
      } else {
        return left;
      }
    }
  }

  /** @returns {Expr} */
  parseTerm() {
    let left = this.parseFactor();
    for (;;) {
      const t = this.peek();
      if (t && t.kind === 'op' && t.op === '*') {
        this.next();
        left = { type: 'bin', op: '*', left, right: this.parseFactor() };
      } else {
        return left;
      }
    }
  }

  /** @returns {Expr} */
  parseFactor() {
    const t = this.next();
    if (t.kind === 'op' && t.op === '-') return { type: 'neg', operand: this.parseFactor() };
    if (t.kind === 'op' && t.op === '(') {
      const inner = this.parseExpr();
      const close = this.next();
      if (close.kind !== 'op' || close.op !== ')') throw new Error("expected ')'");
      return inner;
    }
    if (t.kind === 'num') return { type: 'num', value: t.value };
    if (t.kind === 'ident') return { type: 'var', name: t.name };
    throw new Error(`unexpected token in expression: ${JSON.stringify(t)}`);
  }
}

/** @typedef {{ target: string, expr: Expr }} Statement */

/**
 * Parse an operator-only EEL program into assignment statements.
 * @param {string} program
 * @returns {Statement[]}
 */
export function parseProgram(program) {
  /** @type {Statement[]} */
  const statements = [];
  for (const raw of program.split(';')) {
    const src = raw.trim();
    if (src.length === 0) continue;
    const tokens = tokenize(src);
    if (tokens.length < 3 || tokens[0].kind !== 'ident' || tokens[1].kind !== 'op' || tokens[1].op !== '=') {
      throw new Error(`statement is not an assignment: '${src}'`);
    }
    const parser = new Parser(tokens.slice(2));
    const expr = parser.parseExpr();
    if (parser.pos !== tokens.length - 2) throw new Error(`trailing tokens in statement: '${src}'`);
    statements.push({ target: tokens[0].name, expr });
  }
  return statements;
}

/** @param {Expr} expr @param {Record<string, number>} pool @returns {number} */
function evaluate(expr, pool) {
  switch (expr.type) {
    case 'num': return expr.value;
    case 'var': {
      if (!(expr.name in pool)) throw new Error(`variable '${expr.name}' is not in the explicit pool — uninitialized-read semantics are a separate claim`);
      return pool[expr.name];
    }
    case 'neg': return -evaluate(expr.operand, pool);
    case 'bin': {
      const l = evaluate(expr.left, pool);
      const r = evaluate(expr.right, pool);
      if (expr.op === '+') return l + r;
      if (expr.op === '-') return l - r;
      return l * r;
    }
  }
}

/**
 * Apply one evaluation pass of the parsed program to a variable pool, mutating it.
 * @param {Statement[]} statements @param {Record<string, number>} pool
 */
export function runPass(statements, pool) {
  for (const s of statements) {
    pool[s.target] = evaluate(s.expr, pool);
  }
}
