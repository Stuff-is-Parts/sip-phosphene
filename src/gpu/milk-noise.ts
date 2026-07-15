/**
 * MilkDrop noise-texture generators — port of butterchurn's Noise
 * class (docs/evidence/butterchurn/noise_noise.js). Presets that
 * reference sampler_noise_lq/mq/hq/lq_lite or sampler_noisevol_lq/hq
 * read from these fixed-content textures. Butterchurn constructs
 * them once per Renderer with `Math.random()`; PHOSPHENE accepts an
 * explicit RNG so the generated content is committed and reproducible.
 *
 * Two shapes:
 *
 * - 2D noise: `createNoiseTex(size, zoom, rng)` → Uint8Array of
 *   `size * size * 4` bytes. At zoom=1 the array is uniform random
 *   bytes; at higher zoom the base random values are placed at every
 *   `zoom`-th lattice point and cubic interpolation fills the
 *   intermediate texels.
 *
 * - 3D volumetric noise: `createNoiseVolTex(size, zoom, rng)` →
 *   Uint8Array of `size * size * size * 4` bytes. Same lattice
 *   pattern but interpolated along X, Y, and Z in sequence.
 *
 * Value range: at zoom=1 texRange is 256 (uniform 0..255); at zoom>1
 * texRange is 216 with an offset of `halfTexRange` so the base
 * lattice values sit around 108..324 → 108..255 mapped. Ported
 * verbatim from noise_noise.js:114-115, :237-238.
 *
 * Sizes/zoom pairs the four 2D + two 3D textures use (from
 * noise_noise.js:31-36):
 *
 *   sampler_noise_lq      → createNoiseTex(256, 1)
 *   sampler_noise_lq_lite → createNoiseTex(32, 1)
 *   sampler_noise_mq      → createNoiseTex(256, 4)
 *   sampler_noise_hq      → createNoiseTex(256, 8)
 *   sampler_noisevol_lq   → createNoiseVolTex(32, 1)
 *   sampler_noisevol_hq   → createNoiseVolTex(32, 4)
 */

import { type MilkRng } from "../core/milk-runner";

/** Cubic interpolation across 4 sample points at parameter t ∈ [0, 1].
 *  Verbatim from noise_noise.js:86-95. */
export function fCubicInterpolate(
  y0: number, y1: number, y2: number, y3: number, t: number,
): number {
  const t2 = t * t;
  const t3 = t * t2;
  const a0 = y3 - y2 - y0 + y1;
  const a1 = y0 - y1 - a0;
  const a2 = y2 - y0;
  const a3 = y1;
  return a0 * t3 + a1 * t2 + a2 * t + a3;
}

/** Per-channel cubic interpolation for a 4-channel RGBA byte pixel.
 *  Verbatim from noise_noise.js:97-108. Each channel is normalized to
 *  [0, 1] before interpolation, clamped, and re-scaled to 0..255. */
export function dwCubicInterpolate(
  y0: readonly number[], y1: readonly number[],
  y2: readonly number[], y3: readonly number[], t: number,
): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    let f = fCubicInterpolate(y0[i] / 255, y1[i] / 255, y2[i] / 255, y3[i] / 255, t);
    if (f < 0) f = 0; else if (f > 1) f = 1;
    out[i] = f * 255;
  }
  return out;
}

/** Fill a Uint8Array with 4-channel bytes drawn from `rng.next()`
 *  using the source's value-range math:
 *    texRange = zoom > 1 ? 216 : 256
 *    v = floor(rng.next() * texRange + halfTexRange)
 *  Ported from noise_noise.js:117-121 and :240-244. */
function fillLattice(texArr: Uint8Array, rng: MilkRng, zoom: number): void {
  const texRange = zoom > 1 ? 216 : 256;
  const halfTexRange = texRange * 0.5;
  for (let i = 0; i < texArr.length; i++) {
    texArr[i] = Math.floor(rng.next() * texRange + halfTexRange);
  }
}

/** Ported verbatim from noise_noise.js `createNoiseTex(noiseSize, zoom)`
 *  — the 2D noise texture data producer. Returns a `size*size*4` byte
 *  array. When `zoom > 1`, only every `zoom`-th lattice point on X and
 *  Y is a fresh random byte; intermediate texels are cubically
 *  interpolated between the four surrounding lattice points (with wrap
 *  around size using `% noiseSize`). */
export function createNoiseTex(
  noiseSize: number, zoom: number, rng: MilkRng,
): Uint8Array {
  const nsize = noiseSize * noiseSize;
  const texArr = new Uint8Array(nsize * 4);
  fillLattice(texArr, rng, zoom);
  if (zoom > 1) {
    // X-axis interpolation.
    for (let y = 0; y < noiseSize; y += zoom) {
      for (let x = 0; x < noiseSize; x++) {
        if (x % zoom !== 0) {
          const baseX = Math.floor(x / zoom) * zoom + noiseSize;
          const baseY = y * noiseSize;
          const y0 = [0, 0, 0, 0]; const y1 = [0, 0, 0, 0];
          const y2 = [0, 0, 0, 0]; const y3 = [0, 0, 0, 0];
          for (let i = 0; i < 4; i++) {
            y0[i] = texArr[baseY * 4 + ((baseX - zoom) % noiseSize) * 4 + i];
            y1[i] = texArr[baseY * 4 + (baseX % noiseSize) * 4 + i];
            y2[i] = texArr[baseY * 4 + ((baseX + zoom) % noiseSize) * 4 + i];
            y3[i] = texArr[baseY * 4 + ((baseX + zoom * 2) % noiseSize) * 4 + i];
          }
          const t = (x % zoom) / zoom;
          const result = dwCubicInterpolate(y0, y1, y2, y3, t);
          for (let i = 0; i < 4; i++) {
            texArr[baseY * 4 + x * 4 + i] = result[i];
          }
        }
      }
    }
    // Y-axis interpolation.
    for (let x = 0; x < noiseSize; x++) {
      for (let y = 0; y < noiseSize; y++) {
        if (y % zoom !== 0) {
          const baseY = Math.floor(y / zoom) * zoom + noiseSize;
          const y0 = [0, 0, 0, 0]; const y1 = [0, 0, 0, 0];
          const y2 = [0, 0, 0, 0]; const y3 = [0, 0, 0, 0];
          for (let i = 0; i < 4; i++) {
            y0[i] = texArr[((baseY - zoom) % noiseSize) * noiseSize * 4 + x * 4 + i];
            y1[i] = texArr[(baseY % noiseSize) * noiseSize * 4 + x * 4 + i];
            y2[i] = texArr[((baseY + zoom) % noiseSize) * noiseSize * 4 + x * 4 + i];
            y3[i] = texArr[((baseY + zoom * 2) % noiseSize) * noiseSize * 4 + x * 4 + i];
          }
          const t = (y % zoom) / zoom;
          const result = dwCubicInterpolate(y0, y1, y2, y3, t);
          for (let i = 0; i < 4; i++) {
            texArr[y * noiseSize * 4 + x * 4 + i] = result[i];
          }
        }
      }
    }
  }
  return texArr;
}

/** Ported verbatim from noise_noise.js `createNoiseVolTex(noiseSize,
 *  zoom)` — the 3D volumetric noise texture data producer. Returns a
 *  `size*size*size*4` byte array. Cubic-interpolates along X, Y, then
 *  Z in sequence when `zoom > 1`. */
export function createNoiseVolTex(
  noiseSize: number, zoom: number, rng: MilkRng,
): Uint8Array {
  const nsize = noiseSize * noiseSize * noiseSize;
  const texArr = new Uint8Array(nsize * 4);
  fillLattice(texArr, rng, zoom);
  if (zoom > 1) {
    const wordsPerSlice = noiseSize * noiseSize;
    const wordsPerLine = noiseSize;
    // X-axis pass (noise_noise.js:128-157).
    for (let z = 0; z < noiseSize; z += zoom) {
      for (let y = 0; y < noiseSize; y += zoom) {
        for (let x = 0; x < noiseSize; x++) {
          if (x % zoom !== 0) {
            const baseX = Math.floor(x / zoom) * zoom + noiseSize;
            const baseY = z * wordsPerSlice + y * wordsPerLine;
            const y0 = [0, 0, 0, 0]; const y1 = [0, 0, 0, 0];
            const y2 = [0, 0, 0, 0]; const y3 = [0, 0, 0, 0];
            for (let i = 0; i < 4; i++) {
              y0[i] = texArr[baseY * 4 + ((baseX - zoom) % noiseSize) * 4 + i];
              y1[i] = texArr[baseY * 4 + (baseX % noiseSize) * 4 + i];
              y2[i] = texArr[baseY * 4 + ((baseX + zoom) % noiseSize) * 4 + i];
              y3[i] = texArr[baseY * 4 + ((baseX + zoom * 2) % noiseSize) * 4 + i];
            }
            const t = (x % zoom) / zoom;
            const result = dwCubicInterpolate(y0, y1, y2, y3, t);
            for (let i = 0; i < 4; i++) {
              texArr[z * wordsPerSlice * 4 + y * wordsPerLine * 4 + x * 4 + i] = result[i];
            }
          }
        }
      }
    }
    // Y-axis pass (noise_noise.js:158-191).
    for (let z = 0; z < noiseSize; z += zoom) {
      for (let x = 0; x < noiseSize; x++) {
        for (let y = 0; y < noiseSize; y++) {
          if (y % zoom !== 0) {
            const baseY = Math.floor(y / zoom) * zoom + noiseSize;
            const baseZ = z * wordsPerSlice;
            const y0 = [0, 0, 0, 0]; const y1 = [0, 0, 0, 0];
            const y2 = [0, 0, 0, 0]; const y3 = [0, 0, 0, 0];
            for (let i = 0; i < 4; i++) {
              const offset = x * 4 + baseZ * 4 + i;
              y0[i] = texArr[((baseY - zoom) % noiseSize) * wordsPerLine * 4 + offset];
              y1[i] = texArr[(baseY % noiseSize) * wordsPerLine * 4 + offset];
              y2[i] = texArr[((baseY + zoom) % noiseSize) * wordsPerLine * 4 + offset];
              y3[i] = texArr[((baseY + zoom * 2) % noiseSize) * wordsPerLine * 4 + offset];
            }
            const t = (y % zoom) / zoom;
            const result = dwCubicInterpolate(y0, y1, y2, y3, t);
            for (let i = 0; i < 4; i++) {
              texArr[y * wordsPerLine * 4 + x * 4 + baseZ * 4 + i] = result[i];
            }
          }
        }
      }
    }
    // Z-axis pass (noise_noise.js:193-227).
    for (let x = 0; x < noiseSize; x++) {
      for (let y = 0; y < noiseSize; y++) {
        for (let z = 0; z < noiseSize; z++) {
          if (z % zoom !== 0) {
            const baseY = y * wordsPerLine;
            const baseZ = Math.floor(z / zoom) * zoom + noiseSize;
            const y0 = [0, 0, 0, 0]; const y1 = [0, 0, 0, 0];
            const y2 = [0, 0, 0, 0]; const y3 = [0, 0, 0, 0];
            for (let i = 0; i < 4; i++) {
              const offset = x * 4 + baseY * 4 + i;
              y0[i] = texArr[((baseZ - zoom) % noiseSize) * wordsPerSlice * 4 + offset];
              y1[i] = texArr[(baseZ % noiseSize) * wordsPerSlice * 4 + offset];
              y2[i] = texArr[((baseZ + zoom) % noiseSize) * wordsPerSlice * 4 + offset];
              y3[i] = texArr[((baseZ + zoom * 2) % noiseSize) * wordsPerSlice * 4 + offset];
            }
            const t = (z % zoom) / zoom;
            const result = dwCubicInterpolate(y0, y1, y2, y3, t);
            for (let i = 0; i < 4; i++) {
              texArr[z * wordsPerSlice * 4 + x * 4 + baseY * 4 + i] = result[i];
            }
          }
        }
      }
    }
  }
  return texArr;
}

/** Table of the six noise textures MilkDrop presets can sample, with
 *  their sizes and zoom values from noise_noise.js:31-36. Consumers
 *  (a session-level noise resource owner) call `createNoiseTex` or
 *  `createNoiseVolTex` with each row's parameters to produce the
 *  pixel data. */
export const NOISE_TEX_SPECS: readonly {
  name: "noise_lq" | "noise_lq_lite" | "noise_mq" | "noise_hq"
      | "noisevol_lq" | "noisevol_hq";
  kind: "2d" | "3d";
  size: number;
  zoom: number;
}[] = [
  { name: "noise_lq",      kind: "2d", size: 256, zoom: 1 },
  { name: "noise_lq_lite", kind: "2d", size: 32,  zoom: 1 },
  { name: "noise_mq",      kind: "2d", size: 256, zoom: 4 },
  { name: "noise_hq",      kind: "2d", size: 256, zoom: 8 },
  { name: "noisevol_lq",   kind: "3d", size: 32,  zoom: 1 },
  { name: "noisevol_hq",   kind: "3d", size: 32,  zoom: 4 },
];
