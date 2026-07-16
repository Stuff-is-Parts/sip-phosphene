import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parser = require('milkdrop-eel-parser');

/**
 * Convert an EEL program to executable JS through butterchurn's converter and
 * return a function that applies one evaluation pass to a variable pool.
 * The converter's output is the oracle; this shell only applies it.
 * Programs whose conversion emits helper calls (div, if, rand, …) are refused:
 * the helper implementations belong to butterchurn's runtime and are a separate
 * claim with their own retained authority.
 * @param {string} program
 * @returns {(pool: Record<string, number>) => void}
 */
export function compileEelViaReference(program) {
  const converted = parser.convert_basic_preset('', program);
  const js = converted.perFrameInitEQs;
  if (typeof js !== 'string' || js.trim().length === 0) {
    throw new Error('reference conversion produced no equation code');
  }
  const helperCall = js.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)?.filter((m) => !m.startsWith('a['));
  if (helperCall && helperCall.length > 0) {
    throw new Error(`program requires runtime helper functions (${[...new Set(helperCall)].join(', ')}) — outside the operator-only claim; register the function-library claim with butterchurn's helper implementations as retained authority first`);
  }
  return /** @type {(pool: Record<string, number>) => void} */ (new Function('a', js));
}

/**
 * Reference adapter capability 'reference-execute-milkdrop-behavior' for the
 * operator-only EEL evaluation claim: N sequential evaluation passes over an
 * explicit variable pool, state threaded between passes by composition.
 * @param {{ program: string, initialPool: Record<string, number>, steps: number }} input
 * @returns {{ pools: Array<Record<string, number>> }}
 */
export function referenceEelOperators(input) {
  const pass = compileEelViaReference(input.program);
  const pool = { ...input.initialPool };
  /** @type {Array<Record<string, number>>} */
  const pools = [];
  for (let i = 0; i < input.steps; i++) {
    pass(pool);
    pools.push({ ...pool });
  }
  return { pools };
}
