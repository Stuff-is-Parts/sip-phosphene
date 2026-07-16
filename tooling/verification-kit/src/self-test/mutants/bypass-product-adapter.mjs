// Deliberate defect artifact for the product-path semantic-negative control
// (framework spec §14.5): an adapter that carries the 'product' role label but
// computes its output DIRECTLY through the expression evaluator, bypassing the
// native graph and executor entirely. Any verifier that accepts the role label
// as proof of product-path execution accepts this bypass; the removal
// intervention exposes it because deleting the executor no longer changes the
// output. Never wire this adapter into real verification records.

import { parseProgram, runPass } from '../../../../../phosphene/src/expr/eel-evaluate.mjs';

/**
 * @param {{ program: string, initialPool: Record<string, number>, steps: number }} input
 * @returns {{ pools: Array<Record<string, number>> }}
 */
export function executeMilkExprBypassingGraph(input) {
  const statements = parseProgram(input.program);
  const pool = { ...input.initialPool };
  /** @type {Array<Record<string, number>>} */
  const pools = [];
  for (let i = 0; i < input.steps; i++) {
    runPass(statements, pool);
    pools.push({ ...pool });
  }
  return { pools };
}
