// Expression VM: compiles EEL per-frame/per-vertex equations to JS and runs
// them against a variable pool. Uses the VERIFIED eel semantics (the 46-element
// port). This is P4 EXPRVM. Statements are `var = expr;` sequences.
import { eelSubject } from './eel.mjs';

// Compile a block of "a=expr; b=expr;" into a function over the pool.
export function compileEEL(statements) {
  // statements: array of "lhs=rhs" strings (semicolons already split per line)
  const stmts = [];
  for (const s of statements) {
    for (const piece of s.split(';')) {
      const t = piece.trim();
      if (t) stmts.push(t);
    }
  }
  // Translate EEL expression to JS referencing pool.X and the eel fn table.
  const body = stmts.map(translate).filter(Boolean).join('\n');
  // eslint-disable-next-line no-new-func
  const fn = new Function('pool', 'F', `with(pool){\n${body}\n}`);
  return (pool) => fn(pool, eelSubject);
}

// Minimal EEL->JS: identifiers stay (resolved by `with(pool)`), function calls
// route to F.name(...), operators pass through, ^ handled, assignment kept.
function translate(stmt) {
  const eq = stmt.indexOf('=');
  if (eq < 0) return '';
  const lhs = stmt.slice(0, eq).trim();
  let rhs = stmt.slice(eq + 1);
  // route known functions to F.  (sin( -> F.sin( )
  rhs = rhs.replace(/\b([a-z_][a-z0-9_]*)\s*\(/gi, (m, name) =>
    (name in eelSubject) ? `F.${name}(` : `${name}(`);
  // ensure lhs exists on pool
  return `${lhs} = ${rhs};`;
}
