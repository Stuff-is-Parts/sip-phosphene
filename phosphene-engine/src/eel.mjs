/** @typedef {(...args: number[]) => number} NumFn */
// PHOSPHENE's EEL function implementations, derived from projectm-eval
// (github.com/projectM-visualizer/projectm-eval @ da885dcdf33620ef26aa04cac9e215378b80252e,
// projectm-eval/TreeFunctions.c) — the per-function derivation table with
// citations is sources/EEL-FUNCTIONS.md; source locations per
// sources/SOURCE-LOCATIONS.md. Checks: per-function cases in check.mjs.
//
// Two epsilon constants, both from TreeFunctions.c:116-125 (double build):
const CLOSE = 1e-5;        // COMPARE_CLOSEFACTOR — used by sigmoid, band, bor
const CLOSE_LOW = 1e-300;  // close_factor_low — used by equal, noteq, bnot, div, pow

// Fast inverse square root, float32 variant (magic 0x5f3759df, one Newton
// step) — TreeFunctions.c:1183-1220. The source comment states MilkDrop itself
// used this float path; projectm-eval's double build uses a 64-bit magic
// (0x5fe6eb50c7b537a9) instead. We keep the MilkDrop float path and add the
// source's NaN->0 guard.
function invsqrtImpl(/** @type {number} */ x) {
  const buf = new ArrayBuffer(4);
  const fv = new Float32Array(buf), iv = new Uint32Array(buf);
  const half = x * 0.5;
  fv[0] = x;
  iv[0] = 0x5f3759df - ((iv[0] ?? 0) >> 1);
  let y = fv[0] ?? 0;
  y = y * (1.5 - half * y * y);
  return Number.isNaN(y) ? 0 : y;
}

// MilkDrop's original rand(): MT19937 with the FIXED seed 0x4141f00d, so the
// stream is fully deterministic — transcribed from projectm-eval
// TreeFunctions.c:150-224 ("This is Milkdrop's original rand() implementation").
// rand(x) returns a float in [0, max] where max = max(1, floor(x)) (:1165-1181).
const MT_N = 624, MT_M = 397, MT_MATRIX_A = 0x9908b0df;
const mt = new Uint32Array(MT_N);
let mti = 0; // 0 = uninitialized, matching the source's !mti check
function genrandInt32() {
  if (!mti) {
    mt[0] = 0x4141f00d;
    for (mti = 1; mti < MT_N; mti++) {
      const prev = /** @type {number} */ (mt[mti - 1]);
      mt[mti] = (Math.imul(1812433253, prev ^ (prev >>> 30)) + mti) >>> 0;
    }
  }
  if (mti >= MT_N) {
    for (let kk = 0; kk < MT_N; kk++) {
      const y = ((/** @type {number} */ (mt[kk]) & 0x80000000) | (/** @type {number} */ (mt[(kk + 1) % MT_N]) & 0x7fffffff)) >>> 0;
      mt[kk] = (/** @type {number} */ (mt[(kk + MT_M) % MT_N]) ^ (y >>> 1) ^ ((y & 1) ? MT_MATRIX_A : 0)) >>> 0;
    }
    mti = 0;
  }
  let y = /** @type {number} */ (mt[mti++]);
  y ^= y >>> 11;
  y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
  y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
  y ^= y >>> 18;
  return y >>> 0;
}

export const eelSubject = /** @type {Record<string, NumFn>} */ ({
  rand: (x) => { const m = Math.max(1, Math.floor(x)); return genrandInt32() * (1.0 / 0xFFFFFFFF) * m; },
  // plain libc delegates (TreeFunctions.c:872-906, 944-981, 1006-1016, 1054-1076, 1106-1116)
  sin: (a) => Math.sin(a), cos: (a) => Math.cos(a), tan: (a) => Math.tan(a),
  atan: (a) => Math.atan(a), atan2: (a, b) => Math.atan2(a, b),
  sqrt: (a) => Math.sqrt(a), exp: (a) => Math.exp(a),
  abs: (a) => Math.abs(a), floor: (a) => Math.floor(a), ceil: (a) => Math.ceil(a),
  // domain-guarded: outside [-1,1] -> 0 (asin :908-924, acos :926-942)
  asin: (a) => (a < -1 || a > 1) ? 0 : Math.asin(a),
  acos: (a) => (a < -1 || a > 1) ? 0 : Math.acos(a),
  // pow: |base|<CLOSE_LOW with negative exponent -> 0; NaN result -> 0 (:983-1004)
  pow: (a, b) => {
    if (Math.abs(a) < CLOSE_LOW && b < 0) return 0;
    const r = Math.pow(a, b);
    return Number.isNaN(r) ? 0 : r;
  },
  // log/log10: input <= 0 -> 0 (:1018-1052)
  log: (a) => a <= 0 ? 0 : Math.log(a),
  log10: (a) => a <= 0 ? 0 : Math.log10(a),
  min: (a, b) => a < b ? a : b, max: (a, b) => a > b ? a : b,   // :1118-1146
  sqr: (a) => a * a,                                            // :1094-1104
  sign: (a) => a === 0 ? 0 : (a < 0 ? -1 : 1),                  // :1148-1163
  invsqrt: invsqrtImpl,
  // sigmoid: t = 1+exp(-x*k); |t| > CLOSE ? 1/t : 0 (:1078-1092)
  sigmoid: (x, k) => { const t = 1 + Math.exp(-x * k); return Math.abs(t) > CLOSE ? 1 / t : 0; },
  // arithmetic (:531-575); div refuses near-zero divisor -> 0 (:576-595)
  add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b,
  div: (a, b) => Math.abs(b) < CLOSE_LOW ? 0 : a / b,
  // mod: 64-bit integer mod, divisor 0 -> 0 (:597-616; PRJM_EVAL_I is int64_t
  // in the double build, :14-16). Math.trunc keeps integer semantics exact to
  // 2^53, unlike the 32-bit |0 truncation.
  mod: (a, b) => { const bi = Math.trunc(b); return bi === 0 ? 0 : Math.trunc(a) % bi; },
  // band/bor use the LARGER epsilon CLOSE per the source's own comment (:672-702)
  band: (a, b) => (Math.abs(a) > CLOSE && Math.abs(b) > CLOSE) ? 1 : 0,
  bor: (a, b) => (Math.abs(a) > CLOSE || Math.abs(b) > CLOSE) ? 1 : 0,
  // bnot/equal/noteq use the near-zero epsilon CLOSE_LOW (:430-469);
  // noteq is strictly > per the source
  bnot: (a) => Math.abs(a) < CLOSE_LOW ? 1 : 0,
  equal: (a, b) => Math.abs(a - b) < CLOSE_LOW ? 1 : 0,
  noteq: (a, b) => Math.abs(a - b) > CLOSE_LOW ? 1 : 0,
  below: (a, b) => a < b ? 1 : 0, above: (a, b) => a > b ? 1 : 0,
  beleq: (a, b) => a <= b ? 1 : 0, aboeq: (a, b) => a >= b ? 1 : 0,  // :471-530
});
