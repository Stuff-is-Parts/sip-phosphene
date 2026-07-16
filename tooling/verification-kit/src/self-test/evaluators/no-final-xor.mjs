// Plausible-alternative evaluator: omitted finalization (stateless wrong-default).
// A correct CRC-32 core that skips the final XOR — the classic
// omission-of-a-required-step defect. Self-contained; does not import the subject.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/**
 * @param {{ operations: Array<{ chunksBase64: string[] }> }} input
 * @returns {{ results: number[] }}
 */
export function noFinalXor(input) {
  /** @type {number[]} */
  const results = [];
  for (const op of input.operations) {
    let c = 0xffffffff;
    for (const b64 of op.chunksBase64) {
      const bytes = Buffer.from(b64, 'base64');
      for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    results.push(c >>> 0);
  }
  return { results };
}
