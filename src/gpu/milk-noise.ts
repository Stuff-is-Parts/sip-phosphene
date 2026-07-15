/**
 * MilkDrop noise-texture generators — projectM-authoritative port from
 * docs/evidence/projectm/MilkdropNoise.cpp `generate2D` / `generate3D`.
 * COMPATIBILITY-GOAL.md §Source-Authority puts projectM above butterchurn
 * for the default execution path, so this module reproduces projectM's
 * behavior verbatim:
 *
 * 1. Per-pixel initial fill uses `(rand % RANGE) + RANGE/2` where
 *    RANGE = 216 when zoom > 1, 256 otherwise. Each of the four
 *    channels is an independent draw. Byte truncation matches
 *    projectM's implicit `<< N` overflow at the packed uint32_t
 *    boundary — a channel value of 383 stores as byte 127.
 * 2. After the fill, EACH row runs `size` random pixel-pair swaps
 *    within that row. This is projectM-distinctive; butterchurn does
 *    not do it. Same RNG stream as the fill.
 * 3. When zoom > 1, cubic-interpolate lattice points along X, then Y
 *    (2D) or X, Y, then Z (3D).
 *
 * The RNG parameter is an INDEPENDENT source per COMPATIBILITY-GOAL.md
 * — this stream does not consume or shift the preset equation RNG.
 * Callers own the noise-RNG lifetime; MilkSession is the session-level
 * owner.
 */

import { type MilkRng } from "../core/milk-runner";

/** Cubic interpolation across four sample points, parameter t ∈ [0, 1].
 *  Matches MilkdropNoise.cpp `fCubicInterpolate`. */
export function fCubicInterpolate(
  y0: number, y1: number, y2: number, y3: number, t: number,
): number {
  const t2 = t * t;
  const a0 = y3 - y2 - y0 + y1;
  const a1 = y0 - y1 - a0;
  const a2 = y2 - y0;
  const a3 = y1;
  return a0 * t * t2 + a1 * t2 + a2 * t + a3;
}

/** Per-channel cubic interpolation for a 4-channel RGBA byte pixel.
 *  Matches MilkdropNoise.cpp `dwCubicInterpolate`: normalize each channel
 *  to [0, 1], interpolate, clamp, and rescale to 0..255. */
export function dwCubicInterpolate(
  y0: readonly number[], y1: readonly number[],
  y2: readonly number[], y3: readonly number[], t: number,
): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    let f = fCubicInterpolate(y0[i] / 255, y1[i] / 255, y2[i] / 255, y3[i] / 255, t);
    if (f < 0) f = 0; else if (f > 1) f = 1;
    out[i] = Math.floor(f * 255);
  }
  return out;
}

/** Simulate projectM's `std::uniform_int_distribution<int>(0, INT32_MAX)`
 *  draw on top of the provided MilkRng. */
function randInt(rng: MilkRng): number {
  return Math.floor(rng.next() * 0x7fffffff);
}

/** Byte value from projectM's `(rand % RANGE) + RANGE/2` expression,
 *  truncated to a byte to match the implicit overflow at the packed
 *  uint32_t boundary. */
function packedByte(rng: MilkRng, range: number, halfRange: number): number {
  return (((randInt(rng) % range) + halfRange) & 0xff);
}

/** Fill one row with 4-channel bytes then swap `size` random pixel-pairs
 *  within that row. Matches MilkdropNoise.cpp `generate2D` inner loops. */
function fillAndSwapRow(
  tex: Uint8Array, row: number, size: number, rng: MilkRng,
  range: number, halfRange: number,
): void {
  const rowStart = row * size * 4;
  for (let x = 0; x < size; x++) {
    const p = rowStart + x * 4;
    tex[p]     = packedByte(rng, range, halfRange);
    tex[p + 1] = packedByte(rng, range, halfRange);
    tex[p + 2] = packedByte(rng, range, halfRange);
    tex[p + 3] = packedByte(rng, range, halfRange);
  }
  // Per-row random pixel-pair swaps (`size` swaps per row).
  for (let x = 0; x < size; x++) {
    const x1 = randInt(rng) % size;
    const x2 = randInt(rng) % size;
    const p1 = rowStart + x1 * 4;
    const p2 = rowStart + x2 * 4;
    for (let c = 0; c < 4; c++) {
      const t = tex[p1 + c];
      tex[p1 + c] = tex[p2 + c];
      tex[p2 + c] = t;
    }
  }
}

/** Sample four channels at a given texel offset. */
function readPixel(tex: Uint8Array, offset: number): [number, number, number, number] {
  return [tex[offset], tex[offset + 1], tex[offset + 2], tex[offset + 3]];
}

function writePixel(tex: Uint8Array, offset: number, p: [number, number, number, number]): void {
  tex[offset]     = p[0];
  tex[offset + 1] = p[1];
  tex[offset + 2] = p[2];
  tex[offset + 3] = p[3];
}

/** 2D noise per projectM MilkdropNoise.cpp `generate2D(size, zoomFactor)`.
 *  Returns a Uint8Array of `size * size * 4` bytes. When `zoom > 1`,
 *  lattice values fill every `zoom`-th X and Y position and cubic
 *  interpolation produces the intermediate texels. */
export function createNoiseTex(
  size: number, zoom: number, rng: MilkRng,
): Uint8Array {
  const range = zoom > 1 ? 216 : 256;
  const halfRange = range >> 1;
  const tex = new Uint8Array(size * size * 4);

  // Step 1+2: initial fill and per-row swaps.
  for (let y = 0; y < size; y++) {
    fillAndSwapRow(tex, y, size, rng, range, halfRange);
  }

  if (zoom <= 1) return tex;

  // Step 3a: cubic interpolate along X on lattice rows.
  for (let y = 0; y < size; y += zoom) {
    const rowStart = y * size * 4;
    for (let x = 0; x < size; x++) {
      if (x % zoom === 0) continue;
      const baseX = Math.floor(x / zoom) * zoom + size;
      const p0 = rowStart + ((baseX - zoom) % size) * 4;
      const p1 = rowStart + (baseX % size) * 4;
      const p2 = rowStart + ((baseX + zoom) % size) * 4;
      const p3 = rowStart + ((baseX + zoom * 2) % size) * 4;
      const t = (x % zoom) / zoom;
      writePixel(tex, rowStart + x * 4,
        dwCubicInterpolate(readPixel(tex, p0), readPixel(tex, p1),
                           readPixel(tex, p2), readPixel(tex, p3), t));
    }
  }
  // Step 3b: cubic interpolate along Y on every column.
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (y % zoom === 0) continue;
      const baseY = Math.floor(y / zoom) * zoom + size;
      const p0 = (((baseY - zoom) % size) * size + x) * 4;
      const p1 = ((baseY % size) * size + x) * 4;
      const p2 = (((baseY + zoom) % size) * size + x) * 4;
      const p3 = (((baseY + zoom * 2) % size) * size + x) * 4;
      const t = (y % zoom) / zoom;
      writePixel(tex, (y * size + x) * 4,
        dwCubicInterpolate(readPixel(tex, p0), readPixel(tex, p1),
                           readPixel(tex, p2), readPixel(tex, p3), t));
    }
  }
  return tex;
}

/** 3D volumetric noise per projectM MilkdropNoise.cpp `generate3D`.
 *  Returns a Uint8Array of `size * size * size * 4` bytes. */
export function createNoiseVolTex(
  size: number, zoom: number, rng: MilkRng,
): Uint8Array {
  const range = zoom > 1 ? 216 : 256;
  const halfRange = range >> 1;
  const tex = new Uint8Array(size * size * size * 4);
  const sliceBytes = size * size * 4;

  // Fill: per Z slice, per Y row: fill then swap.
  for (let z = 0; z < size; z++) {
    const sliceStart = z * sliceBytes;
    for (let y = 0; y < size; y++) {
      const rowStart = sliceStart + y * size * 4;
      for (let x = 0; x < size; x++) {
        const p = rowStart + x * 4;
        tex[p]     = packedByte(rng, range, halfRange);
        tex[p + 1] = packedByte(rng, range, halfRange);
        tex[p + 2] = packedByte(rng, range, halfRange);
        tex[p + 3] = packedByte(rng, range, halfRange);
      }
      for (let x = 0; x < size; x++) {
        const x1 = randInt(rng) % size;
        const x2 = randInt(rng) % size;
        const p1 = rowStart + x1 * 4;
        const p2 = rowStart + x2 * 4;
        for (let c = 0; c < 4; c++) {
          const t = tex[p1 + c];
          tex[p1 + c] = tex[p2 + c];
          tex[p2 + c] = t;
        }
      }
    }
  }

  if (zoom <= 1) return tex;

  const linearOffset = (x: number, y: number, z: number): number =>
    (z * size * size + y * size + x) * 4;

  // X-axis interpolation on lattice rows.
  for (let z = 0; z < size; z += zoom) {
    for (let y = 0; y < size; y += zoom) {
      for (let x = 0; x < size; x++) {
        if (x % zoom === 0) continue;
        const baseX = Math.floor(x / zoom) * zoom + size;
        const p0 = linearOffset((baseX - zoom) % size, y, z);
        const p1 = linearOffset(baseX % size, y, z);
        const p2 = linearOffset((baseX + zoom) % size, y, z);
        const p3 = linearOffset((baseX + zoom * 2) % size, y, z);
        const t = (x % zoom) / zoom;
        writePixel(tex, linearOffset(x, y, z),
          dwCubicInterpolate(readPixel(tex, p0), readPixel(tex, p1),
                             readPixel(tex, p2), readPixel(tex, p3), t));
      }
    }
  }
  // Y-axis interpolation on main slices.
  for (let z = 0; z < size; z += zoom) {
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        if (y % zoom === 0) continue;
        const baseY = Math.floor(y / zoom) * zoom + size;
        const p0 = linearOffset(x, (baseY - zoom) % size, z);
        const p1 = linearOffset(x, baseY % size, z);
        const p2 = linearOffset(x, (baseY + zoom) % size, z);
        const p3 = linearOffset(x, (baseY + zoom * 2) % size, z);
        const t = (y % zoom) / zoom;
        writePixel(tex, linearOffset(x, y, z),
          dwCubicInterpolate(readPixel(tex, p0), readPixel(tex, p1),
                             readPixel(tex, p2), readPixel(tex, p3), t));
      }
    }
  }
  // Z-axis interpolation everywhere.
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        if (z % zoom === 0) continue;
        const baseZ = Math.floor(z / zoom) * zoom + size;
        const p0 = linearOffset(x, y, (baseZ - zoom) % size);
        const p1 = linearOffset(x, y, baseZ % size);
        const p2 = linearOffset(x, y, (baseZ + zoom) % size);
        const p3 = linearOffset(x, y, (baseZ + zoom * 2) % size);
        const t = (z % zoom) / zoom;
        writePixel(tex, linearOffset(x, y, z),
          dwCubicInterpolate(readPixel(tex, p0), readPixel(tex, p1),
                             readPixel(tex, p2), readPixel(tex, p3), t));
      }
    }
  }
  return tex;
}

/** Manifest of the six MilkDrop-visible noise textures per projectM
 *  MilkdropNoise.hpp static factory methods. Consumers (MilkSession)
 *  invoke `createNoiseTex` or `createNoiseVolTex` per row. */
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
