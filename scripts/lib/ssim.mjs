// Grayscale SSIM between two same-size PNG buffers (pngjs-decoded).
// Standard SSIM: 8x8 windows, stride 8, C1/C2 for 8-bit dynamic range
// (Wang et al. 2004). Used by the fidelity harness; the tolerance that
// consumes this metric is committed in the validation script per
// COMPATIBILITY-GOAL.md (defined before implementation, not tuned to pass).

export function ssim(pngA, pngB) {
  if (pngA.width !== pngB.width || pngA.height !== pngB.height) {
    throw new Error(`size mismatch: ${pngA.width}x${pngA.height} vs ${pngB.width}x${pngB.height}`);
  }
  const w = pngA.width, h = pngA.height;
  const grayA = new Float64Array(w * h);
  const grayB = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    grayA[i] = 0.299 * pngA.data[o] + 0.587 * pngA.data[o + 1] + 0.114 * pngA.data[o + 2];
    grayB[i] = 0.299 * pngB.data[o] + 0.587 * pngB.data[o + 1] + 0.114 * pngB.data[o + 2];
  }
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  const WIN = 8;
  let sum = 0, count = 0;
  for (let by = 0; by + WIN <= h; by += WIN) {
    for (let bx = 0; bx + WIN <= w; bx += WIN) {
      let muA = 0, muB = 0;
      for (let y = 0; y < WIN; y++) for (let x = 0; x < WIN; x++) {
        muA += grayA[(by + y) * w + bx + x];
        muB += grayB[(by + y) * w + bx + x];
      }
      const n = WIN * WIN;
      muA /= n; muB /= n;
      let vA = 0, vB = 0, cov = 0;
      for (let y = 0; y < WIN; y++) for (let x = 0; x < WIN; x++) {
        const da = grayA[(by + y) * w + bx + x] - muA;
        const db = grayB[(by + y) * w + bx + x] - muB;
        vA += da * da; vB += db * db; cov += da * db;
      }
      vA /= n - 1; vB /= n - 1; cov /= n - 1;
      sum += ((2 * muA * muB + C1) * (2 * cov + C2)) /
             ((muA * muA + muB * muB + C1) * (vA + vB + C2));
      count++;
    }
  }
  return sum / count;
}

/** Per-RGB-channel SSIM: returns { r, g, b, mean, min }. Color-aware
 *  comparison per the continuation assignment (grayscale SSIM alone can
 *  score hue-inverted images as similar). */
export function ssimColor(pngA, pngB) {
  const channel = (offset) => {
    const w = pngA.width, h = pngA.height;
    const a = new Float64Array(w * h), b = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) {
      a[i] = pngA.data[i * 4 + offset];
      b[i] = pngB.data[i * 4 + offset];
    }
    return ssimPlane(a, b, w, h);
  };
  const r = channel(0), g = channel(1), b = channel(2);
  return { r, g, b, mean: (r + g + b) / 3, min: Math.min(r, g, b) };
}

function ssimPlane(grayA, grayB, w, h) {
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  const WIN = 8;
  let sum = 0, count = 0;
  for (let by = 0; by + WIN <= h; by += WIN) {
    for (let bx = 0; bx + WIN <= w; bx += WIN) {
      let muA = 0, muB = 0;
      const n = WIN * WIN;
      for (let y = 0; y < WIN; y++) for (let x = 0; x < WIN; x++) {
        muA += grayA[(by + y) * w + bx + x];
        muB += grayB[(by + y) * w + bx + x];
      }
      muA /= n; muB /= n;
      let vA = 0, vB = 0, cov = 0;
      for (let y = 0; y < WIN; y++) for (let x = 0; x < WIN; x++) {
        const da = grayA[(by + y) * w + bx + x] - muA;
        const db = grayB[(by + y) * w + bx + x] - muB;
        vA += da * da; vB += db * db; cov += da * db;
      }
      vA /= n - 1; vB /= n - 1; cov /= n - 1;
      sum += ((2 * muA * muB + C1) * (2 * cov + C2)) /
             ((muA * muA + muB * muB + C1) * (vA + vB + C2));
      count++;
    }
  }
  return sum / count;
}

/** Mean absolute pixel error (0..255 scale) as a secondary signal. */
export function meanAbsError(pngA, pngB) {
  const n = pngA.width * pngA.height;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    for (let ch = 0; ch < 3; ch++) sum += Math.abs(pngA.data[o + ch] - pngB.data[o + ch]);
  }
  return sum / (n * 3);
}
