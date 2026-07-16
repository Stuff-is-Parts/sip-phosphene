// Plausible-alternative evaluator: stale-state reuse (STATEFUL defect).
// Correct CRC-32 core that fails to reset its running state between operations,
// so every operation after the first inherits the previous operation's state.
// Models persistence leakage across lifecycle boundaries — a defect class a
// trivial no-op control cannot expose (framework spec §14.1 stateful discrimination).

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
export function staleStateReuse(input) {
  /** @type {number[]} */
  const results = [];
  let c = 0xffffffff;
  for (const op of input.operations) {
    for (const b64 of op.chunksBase64) {
      const bytes = Buffer.from(b64, 'base64');
      for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    results.push((c ^ 0xffffffff) >>> 0);
    // state deliberately NOT reset here — that is the defect being modeled
  }
  return { results };
}
