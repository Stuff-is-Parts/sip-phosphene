/** @typedef {(...args: number[]) => number} NumFn */
// PHOSPHENE's independent EEL function implementations.
// Written against the SPEC (what each function computes), sharing no code with
// reference.mjs. This is the code that would ship in the visualizer's evaluator.
function invsqrtImpl(/** @type {number} */ x) {
  const buf = new ArrayBuffer(4);
  const fv = new Float32Array(buf), iv = new Int32Array(buf);
  const half = x * 0.5;
  fv[0] = x;
  iv[0] = 0x5f3759df - ((iv[0] ?? 0) >> 1);
  let y = fv[0];
  y = y * (1.5 - half * y * y);
  return y;
}
const CLOSE = 1e-5;
export const eelSubject = /** @type {Record<string, NumFn>} */ ({
  sin: (a) => Math.sin(a), cos: (a) => Math.cos(a), tan: (a) => Math.tan(a),
  asin: (a) => Math.asin(a), acos: (a) => Math.acos(a), atan: (a) => Math.atan(a),
  atan2: (a, b) => Math.atan2(a, b),
  sqrt: (a) => Math.sqrt(a), pow: (a, b) => Math.pow(a, b), exp: (a) => Math.exp(a),
  log: (a) => Math.log(a), log10: (a) => Math.log10(a),
  abs: (a) => Math.abs(a), floor: (a) => Math.floor(a), ceil: (a) => Math.ceil(a),
  min: (a, b) => a < b ? a : b, max: (a, b) => a > b ? a : b,
  sqr: (a) => a * a,
  sign: (a) => a > 0 ? 1 : a < 0 ? -1 : 0,
  invsqrt: invsqrtImpl,
  sigmoid: (x, k) => { const t = 1 + Math.exp(-x * k); return Math.abs(t) > CLOSE ? 1 / t : 0; },
  add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b, div: (a, b) => a / b,
  mod: (a, b) => { const bi = b | 0; return bi === 0 ? 0 : (a | 0) % bi; },
  band: (a, b) => (a !== 0 && b !== 0) ? 1 : 0,
  bor: (a, b) => (a !== 0 || b !== 0) ? 1 : 0,
  bnot: (a) => a !== 0 ? 0 : 1,
  equal: (a, b) => Math.abs(a - b) < CLOSE ? 1 : 0,
  noteq: (a, b) => Math.abs(a - b) < CLOSE ? 0 : 1,
  below: (a, b) => a < b ? 1 : 0, above: (a, b) => a > b ? 1 : 0,
  beleq: (a, b) => a <= b ? 1 : 0, aboeq: (a, b) => a >= b ? 1 : 0,
});
