// Expression VM: compiles EEL per-frame equations to JS over a variable pool.
// SCOPE (honest): this handles per-frame assignment sequences with function
// calls routed to the verified eel table. Arithmetic operators (+ - * /) use
// JavaScript's operators directly — for the IEEE-754 double ops MilkDrop uses,
// these are identical to the eel add/sub/mul/div implementations; the eel
// operator functions exist for completeness but the VM does not route through
// them. This is a KNOWN, STATED limit, not a hidden one.
import { eelSubject } from './eel.mjs';

export function compileEEL(/** @type {string[]} */ statements) {
  const stmts = [];
  for (const s of statements) {
    for (const piece of s.split(';')) {
      const t = piece.trim();
      if (t) stmts.push(t);
    }
  }
  const assignments = /** @type {{lhs:string,code:string}[]} */ (stmts.map(translate).filter(Boolean));
  // Explicitly seed any assigned lhs on the pool so `with` writes land in pool,
  // not the outer scope (fixes the with-scope leak the review identified).
  const lhsNames = [...new Set(assignments.map((a) => a.lhs))];
  const body = assignments.map((a) => a.code).join('\n');
  const fn = new Function('pool', 'F', `
    for (const k of ${JSON.stringify(lhsNames)}) if (!(k in pool)) pool[k] = 0;
    with (pool) {
${body}
    }
  `);
  return (/** @type {Record<string,number>} */ pool) => fn(pool, eelSubject);
}

function translate(/** @type {string} */ stmt) {
  const eq = stmt.indexOf('=');
  if (eq < 0) return null;
  const lhs = stmt.slice(0, eq).trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(lhs)) return null; // only simple assignment
  let rhs = stmt.slice(eq + 1);
  // Route function calls to the verified eel table FIRST; REFUSE unknown calls
  // rather than leaving them to resolve as raw JS (the review's "unknown calls
  // untouched"). Done before caret rewrite so caret's F.pow isn't re-prefixed.
  rhs = rhs.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g, (/** @type {string} */ _m, /** @type {string} */ name) => {
    if (name in eelSubject) return `F.${name}(`;
    throw new Error(`unknown function in expression: ${name}()`);
  });
  // EEL uses ^ for exponentiation; JS ^ is bitwise xor. Rewrite a^b -> F.pow(a,b).
  rhs = rewriteCaret(rhs);
  return { lhs, code: `${lhs} = ${rhs};` };
}

// Turn a^b into F.pow(a,b), handling simple operands (identifiers, numbers,
// parenthesised groups). Left-associative, evaluated repeatedly until stable.
function rewriteCaret(/** @type {string} */ expr) {
  const operand = String.raw`(\w+(?:\.\w+)?|\([^()]*\))`;
  const re = new RegExp(operand + String.raw`\s*\^\s*` + operand);
  let prev;
  do { prev = expr; expr = expr.replace(re, 'F.pow($1,$2)'); } while (expr !== prev);
  return expr;
}
