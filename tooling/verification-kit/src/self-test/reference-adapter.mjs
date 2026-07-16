import zlib from 'node:zlib';

/**
 * Reference adapter capability 'reference-crc-operations': obtains independently
 * established CRC-32 results from node:zlib (a maintained implementation the
 * producer did not author). This is the reference-execution oracle for the
 * framework self-test subject; it must not fabricate expected behavior.
 * @param {{ operations: Array<{ chunksBase64: string[] }> }} input
 * @returns {{ results: number[] }}
 */
export function referenceCrcOperations(input) {
  /** @type {number[]} */
  const results = [];
  for (const op of input.operations) {
    let crc = 0;
    for (const b64 of op.chunksBase64) {
      crc = zlib.crc32(Buffer.from(b64, 'base64'), crc);
    }
    results.push(crc >>> 0);
  }
  return { results };
}
