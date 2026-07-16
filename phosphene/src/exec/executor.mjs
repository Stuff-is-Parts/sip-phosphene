// PHOSPHENE native executor — seed. Owns node execution and all cross-step
// state threading: node implementations receive state, they never own the
// step loop. This is the actual product path that verification claims must
// exercise (framework spec §10.3).

import { parseProgram, runPass } from '../expr/eel-evaluate.mjs';

/**
 * Execute a native graph for a number of steps, threading each node's state
 * across steps. Returns per-step outputs and the final state snapshot.
 * @param {{ nodes: Array<{ id: string, type: string, params: Record<string, any> }> }} graph
 * @param {{ steps: number }} run
 * @returns {{ outputs: Record<string, { pools: Array<Record<string, number>> }>, state: Record<string, Record<string, number>> }}
 */
export function executeGraph(graph, run) {
  if (!Number.isInteger(run.steps) || run.steps < 1) throw new Error('run.steps must be a positive integer');
  /** @type {Record<string, { pools: Array<Record<string, number>> }>} */
  const outputs = {};
  /** @type {Record<string, Record<string, number>>} */
  const state = {};
  /** @type {Map<string, ReturnType<typeof parseProgram>>} */
  const programs = new Map();

  for (const node of graph.nodes) {
    if (node.type === 'milk-per-frame-expr') {
      programs.set(node.id, parseProgram(String(node.params.program)));
      state[node.id] = { .../** @type {Record<string, number>} */ (node.params.initialPool) };
      outputs[node.id] = { pools: [] };
    }
  }

  for (let step = 0; step < run.steps; step++) {
    for (const node of graph.nodes) {
      if (node.type === 'milk-per-frame-expr') {
        runPass(/** @type {ReturnType<typeof parseProgram>} */ (programs.get(node.id)), state[node.id]);
        outputs[node.id].pools.push({ ...state[node.id] });
      }
    }
  }
  return { outputs, state };
}
