import { createGraph } from '../src/graph/graph.mjs';
import { executeGraph } from '../src/exec/executor.mjs';

/**
 * Subject adapter capability 'phosphene-execute-graph-step': runs the claim's
 * input through the ACTUAL native product path — graph construction plus the
 * native executor — never through a direct evaluator shortcut (framework spec
 * §10.3: a test-only path does not prove the product uses the implementation).
 * @param {{ program: string, initialPool: Record<string, number>, steps: number }} input
 * @returns {{ pools: Array<Record<string, number>> }}
 */
export function executeMilkExprThroughGraph(input) {
  const graph = createGraph({
    nodes: [
      { id: 'per-frame', type: 'milk-per-frame-expr', params: { program: input.program, initialPool: input.initialPool } }
    ]
  });
  const result = executeGraph(graph, { steps: input.steps });
  return { pools: result.outputs['per-frame'].pools };
}

/**
 * Subject adapter capability 'phosphene-inspect-state': exposes the executor's
 * final state snapshot — instrumentation is product architecture (framework
 * spec §10.4).
 * @param {{ program: string, initialPool: Record<string, number>, steps: number }} input
 * @returns {{ state: Record<string, Record<string, number>> }}
 */
export function inspectMilkExprState(input) {
  const graph = createGraph({
    nodes: [
      { id: 'per-frame', type: 'milk-per-frame-expr', params: { program: input.program, initialPool: input.initialPool } }
    ]
  });
  const result = executeGraph(graph, { steps: input.steps });
  return { state: result.state };
}
