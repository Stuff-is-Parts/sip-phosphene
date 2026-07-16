// Plausible-alternative evaluators for the operator-only EEL evaluation claim.
// Each models a grounded defect as a transformation around the REFERENCE
// execution (never the subject), so discrimination is judged against the
// oracle's semantics rather than the implementation under test.

import { compileEelViaReference } from './adapter.mjs';

/** @typedef {{ program: string, initialPool: Record<string, number>, steps: number }} EelInput */

/**
 * copy-or-identity-instead-of-computation (stateless): returns the input pool
 * unchanged for every step — the operation never actually computes.
 * @param {EelInput} input @returns {{ pools: Array<Record<string, number>> }}
 */
export function identityCopy(input) {
  return { pools: Array.from({ length: input.steps }, () => ({ ...input.initialPool })) };
}

/**
 * wrong-default-or-substituted-constant (stateless): initial pool values of 0
 * silently become 1 before evaluation — a substituted-initial-value defect.
 * @param {EelInput} input @returns {{ pools: Array<Record<string, number>> }}
 */
export function wrongInitialValue(input) {
  const pass = compileEelViaReference(input.program);
  /** @type {Record<string, number>} */
  const pool = {};
  for (const [k, v] of Object.entries(input.initialPool)) pool[k] = v === 0 ? 1 : v;
  /** @type {Array<Record<string, number>>} */
  const pools = [];
  for (let i = 0; i < input.steps; i++) {
    pass(pool);
    pools.push({ ...pool });
  }
  return { pools };
}

/**
 * execution-or-pass-reordering (stateless): statements execute in reverse
 * order, so later statements read variables their sources have not yet written.
 * @param {EelInput} input @returns {{ pools: Array<Record<string, number>> }}
 */
export function statementReorder(input) {
  const reversed = input.program
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .reverse()
    .join('; ') + ';';
  const pass = compileEelViaReference(reversed);
  const pool = { ...input.initialPool };
  /** @type {Array<Record<string, number>>} */
  const pools = [];
  for (let i = 0; i < input.steps; i++) {
    pass(pool);
    pools.push({ ...pool });
  }
  return { pools };
}

/**
 * sign-or-direction-reversal (stateless): the unary negation's result carries
 * the opposite sign — the flip/copy class of defect on variable c.
 * @param {EelInput} input @returns {{ pools: Array<Record<string, number>> }}
 */
export function signReversal(input) {
  const pass = compileEelViaReference(input.program);
  const pool = { ...input.initialPool };
  /** @type {Array<Record<string, number>>} */
  const pools = [];
  for (let i = 0; i < input.steps; i++) {
    pass(pool);
    const out = { ...pool };
    if ('c' in out) out.c = -out.c;
    pools.push(out);
  }
  return { pools };
}

/**
 * omitted-step-or-field (stateless): the final statement of the program is
 * silently dropped — the omission class of defect.
 * @param {EelInput} input @returns {{ pools: Array<Record<string, number>> }}
 */
export function statementOmission(input) {
  const statements = input.program.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
  const truncated = statements.slice(0, -1).join('; ') + ';';
  const pass = compileEelViaReference(truncated);
  const pool = { ...input.initialPool };
  /** @type {Array<Record<string, number>>} */
  const pools = [];
  for (let i = 0; i < input.steps; i++) {
    pass(pool);
    pools.push({ ...pool });
  }
  return { pools };
}

/**
 * stale-state-reuse-or-persistence-leakage (STATEFUL): every step evaluates
 * from the initial pool instead of the threaded pool, so accumulation across
 * steps is lost — persistence omission across the lifecycle boundary.
 * @param {EelInput} input @returns {{ pools: Array<Record<string, number>> }}
 */
export function staleStateReuse(input) {
  const pass = compileEelViaReference(input.program);
  /** @type {Array<Record<string, number>>} */
  const pools = [];
  for (let i = 0; i < input.steps; i++) {
    const pool = { ...input.initialPool };
    pass(pool);
    pools.push({ ...pool });
  }
  return { pools };
}
