import { crcInit, crcUpdate, crcFinalize } from './crc32.mjs';

/**
 * Subject adapter capability 'crc-operations': executes the actual self-test
 * subject on a sequence of independent chunked CRC-32 operations.
 * @param {{ operations: Array<{ chunksBase64: string[] }> }} input
 * @returns {{ results: number[] }}
 */
export function runCrcOperations(input) {
  /** @type {number[]} */
  const results = [];
  for (const op of input.operations) {
    let state = crcInit();
    for (const b64 of op.chunksBase64) {
      state = crcUpdate(state, Buffer.from(b64, 'base64'));
    }
    results.push(crcFinalize(state));
  }
  return { results };
}
