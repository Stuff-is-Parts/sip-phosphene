// Plausible-alternative evaluator: copy-instead-of-compute (stateless).
// Models the witnessed failure where an operation returned a transformation of
// its input under the name of a computation (WITNESSED-FAILURE-MODES.md #1:
// a "flip" that was algebraically a copy). Returns the input's leading bytes
// re-encoded as a uint32 instead of any checksum.

/**
 * @param {{ operations: Array<{ chunksBase64: string[] }> }} input
 * @returns {{ results: number[] }}
 */
export function identityCopy(input) {
  /** @type {number[]} */
  const results = [];
  for (const op of input.operations) {
    const all = Buffer.concat(op.chunksBase64.map((b64) => Buffer.from(b64, 'base64')));
    const padded = Buffer.concat([all, Buffer.alloc(4)]);
    results.push(padded.readUInt32LE(0));
  }
  return { results };
}
