/**
 * MilkDrop noise-texture generators — projectM-authoritative port from
 * docs/evidence/projectm/MilkdropNoise.cpp (retained at pinned SHA
 * 2f244141320f6b97b09bf99964cc72a4efdfcfd3). COMPATIBILITY-GOAL.md
 * §Source-Authority puts projectM above butterchurn for the default
 * execution path.
 *
 * Byte-exact reproduction of projectM's packed uint32_t layout.
 *
 * projectM stores each pixel as a packed uint32:
 *
 *     dst[x] = (v0 << 24) | (v1 << 16) | (v2 << 8) | v3
 *
 * where each `vN` is `(rand() % RANGE) + RANGE/2` and can exceed 255.
 * When `vN > 255` its bit 8 spills into the next-higher byte via the
 * OR. PHOSPHENE reproduces this exactly by storing the packed value in
 * a `Uint32Array` — the JS integer OR handles 32-bit semantics — and
 * running per-row swaps + cubic interpolation on the packed values so
 * the spill survives every step.
 *
 * Final upload byte layout for `rgba8unorm`.
 *
 * projectM uploads its uint32 array to OpenGL with `GL_BGRA + GL_UNSIGNED_BYTE`
 * on desktop (see `MilkdropNoise::GetPreferredInternalFormat`). Under
 * that interpretation and little-endian host storage the shader sees:
 *
 *     R = byte at addr+2 = (packed >> 16) & 0xff
 *     G = byte at addr+1 = (packed >>  8) & 0xff
 *     B = byte at addr+0 =  packed        & 0xff
 *     A = byte at addr+3 = (packed >> 24) & 0xff
 *
 * PHOSPHENE targets `rgba8unorm`, where the shader reads byte 0 as R,
 * byte 1 as G, byte 2 as B, byte 3 as A. To preserve projectM's
 * shader-visible values the byte-emission remaps the packed uint32
 * with those exact expressions.
 *
 * RNG ownership. projectM seeds a fresh `std::default_random_engine`
 * from `system_clock` at each `generate2D`/`generate3D` call.
 * PHOSPHENE accepts a `MilkRng` so the stream is reproducible under
 * `MilkSession.noiseRng`, which is independent from the shader RNG
 * and from the preset equation RNG.
 */

import { type MilkRng } from "../core/milk-runner";

/** projectM's `fCubicInterpolate` per MilkdropNoise.cpp. */
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

/** projectM's `dwCubicInterpolate` per MilkdropNoise.cpp — operates on
 *  the packed uint32 layout directly so bit-spill in the packed value
 *  is preserved end-to-end. Each of the four bytes is interpolated
 *  independently, clamped to [0, 1], and packed back into the result. */
export function dwCubicInterpolateU32(
  y0: number, y1: number, y2: number, y3: number, t: number,
): number {
  let ret = 0;
  for (let i = 0; i < 4; i++) {
    const shift = i * 8;
    const c0 = ((y0 >>> shift) & 0xff) / 255;
    const c1 = ((y1 >>> shift) & 0xff) / 255;
    const c2 = ((y2 >>> shift) & 0xff) / 255;
    const c3 = ((y3 >>> shift) & 0xff) / 255;
    let f = fCubicInterpolate(c0, c1, c2, c3, t);
    if (f < 0) f = 0;
    if (f > 1) f = 1;
    ret = (ret | (((f * 255) | 0) << shift)) >>> 0;
  }
  return ret;
}

/** projectM uses `std::uniform_int_distribution<int>(0, INT32_MAX)` on
 *  a `std::default_random_engine`. PHOSPHENE simulates that on top of
 *  a MilkRng. */
function randInt(rng: MilkRng): number {
  return Math.floor(rng.next() * 0x7fffffff);
}

/** Pack four `(rand() % RANGE) + RANGE/2` draws into projectM's exact
 *  packed uint32 layout, preserving bit-spill via the JS OR. */
function packQuadU32(rng: MilkRng, range: number, halfRange: number): number {
  const v0 = (randInt(rng) % range) + halfRange;
  const v1 = (randInt(rng) % range) + halfRange;
  const v2 = (randInt(rng) % range) + halfRange;
  const v3 = (randInt(rng) % range) + halfRange;
  return (((v0 << 24) | (v1 << 16) | (v2 << 8) | v3) >>> 0);
}

/** Convert projectM's packed uint32 array to a `rgba8unorm` byte layout
 *  that preserves projectM's BGRA-interpretation shader-visible values. */
function u32ToRgba8Unorm(tex32: Uint32Array): Uint8Array {
  const out = new Uint8Array(tex32.length * 4);
  for (let i = 0; i < tex32.length; i++) {
    const packed = tex32[i];
    out[i * 4]     = (packed >>> 16) & 0xff; // R = projectM's shader R
    out[i * 4 + 1] = (packed >>> 8)  & 0xff; // G
    out[i * 4 + 2] =  packed         & 0xff; // B
    out[i * 4 + 3] = (packed >>> 24) & 0xff; // A
  }
  return out;
}

/** 2D noise per projectM's `generate2D(size, zoomFactor)`. Returns a
 *  `Uint8Array` of `size * size * 4` bytes with the channel remap that
 *  gives PHOSPHENE `rgba8unorm` textures the same shader-visible
 *  values projectM's GL_BGRA upload produces. */
export function createNoiseTex(
  size: number, zoom: number, rng: MilkRng,
): Uint8Array {
  const range = zoom > 1 ? 216 : 256;
  const halfRange = range >> 1;
  const tex = new Uint32Array(size * size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      tex[y * size + x] = packQuadU32(rng, range, halfRange);
    }
    // Per-row random pixel-pair swaps operate on packed uint32 values.
    for (let x = 0; x < size; x++) {
      const x1 = randInt(rng) % size;
      const x2 = randInt(rng) % size;
      const tmp = tex[y * size + x1];
      tex[y * size + x1] = tex[y * size + x2];
      tex[y * size + x2] = tmp;
    }
  }

  if (zoom > 1) {
    // X-axis cubic interpolation on lattice rows.
    for (let y = 0; y < size; y += zoom) {
      const rowBase = y * size;
      for (let x = 0; x < size; x++) {
        if (x % zoom === 0) continue;
        const baseX = Math.floor(x / zoom) * zoom + size;
        const y0 = tex[rowBase + ((baseX - zoom) % size)];
        const y1 = tex[rowBase + (baseX % size)];
        const y2 = tex[rowBase + ((baseX + zoom) % size)];
        const y3 = tex[rowBase + ((baseX + zoom * 2) % size)];
        const t = (x % zoom) / zoom;
        tex[rowBase + x] = dwCubicInterpolateU32(y0, y1, y2, y3, t);
      }
    }
    // Y-axis cubic interpolation on every column.
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        if (y % zoom === 0) continue;
        const baseY = Math.floor(y / zoom) * zoom + size;
        const y0 = tex[((baseY - zoom) % size) * size + x];
        const y1 = tex[(baseY % size) * size + x];
        const y2 = tex[((baseY + zoom) % size) * size + x];
        const y3 = tex[((baseY + zoom * 2) % size) * size + x];
        const t = (y % zoom) / zoom;
        tex[y * size + x] = dwCubicInterpolateU32(y0, y1, y2, y3, t);
      }
    }
  }

  return u32ToRgba8Unorm(tex);
}

/** 3D volumetric noise per projectM's `generate3D(size, zoomFactor)`.
 *  The projectM source uses distinctive indexing that mixes slice and
 *  row bases (`dst[y * size + base_z + x]` instead of the "expected"
 *  `dst[base_z + y * size + x]`) in the Y and Z passes. PHOSPHENE
 *  reproduces the indexing verbatim rather than "repairing" it — under
 *  COMPATIBILITY-GOAL.md the retained projectM revision defines the
 *  behavior, and the correct treatment of any downstream visual effect
 *  is to match what the source runtime does. */
export function createNoiseVolTex(
  size: number, zoom: number, rng: MilkRng,
): Uint8Array {
  const range = zoom > 1 ? 216 : 256;
  const halfRange = range >> 1;
  const tex = new Uint32Array(size * size * size);
  const slice = size * size;

  for (let z = 0; z < size; z++) {
    const sliceStart = z * slice;
    for (let y = 0; y < size; y++) {
      const rowStart = sliceStart + y * size;
      for (let x = 0; x < size; x++) {
        tex[rowStart + x] = packQuadU32(rng, range, halfRange);
      }
      for (let x = 0; x < size; x++) {
        const x1 = randInt(rng) % size;
        const x2 = randInt(rng) % size;
        const tmp = tex[rowStart + x1];
        tex[rowStart + x1] = tex[rowStart + x2];
        tex[rowStart + x2] = tmp;
      }
    }
  }

  if (zoom > 1) {
    // X-axis pass on lattice rows across every lattice slice.
    for (let z = 0; z < size; z += zoom) {
      for (let y = 0; y < size; y += zoom) {
        const rowBase = z * size + y * size;
        for (let x = 0; x < size; x++) {
          if (x % zoom === 0) continue;
          const baseX = Math.floor(x / zoom) * zoom + size;
          const y0 = tex[rowBase + ((baseX - zoom) % size)];
          const y1 = tex[rowBase + (baseX % size)];
          const y2 = tex[rowBase + ((baseX + zoom) % size)];
          const y3 = tex[rowBase + ((baseX + zoom * 2) % size)];
          const t = (x % zoom) / zoom;
          tex[z * size + y * size + x] = dwCubicInterpolateU32(y0, y1, y2, y3, t);
        }
      }
    }
    // Y-axis pass on every column of every lattice slice — verbatim
    // projectM indexing including `base_z = z * size` (not `z * slice`).
    for (let z = 0; z < size; z += zoom) {
      for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
          if (y % zoom === 0) continue;
          const baseY = Math.floor(y / zoom) * zoom + size;
          const baseZ = z * size;
          const y0 = tex[((baseY - zoom) % size) * size + baseZ + x];
          const y1 = tex[(baseY % size) * size + baseZ + x];
          const y2 = tex[((baseY + zoom) % size) * size + baseZ + x];
          const y3 = tex[((baseY + zoom * 2) % size) * size + baseZ + x];
          const t = (y % zoom) / zoom;
          tex[y * size + baseZ + x] = dwCubicInterpolateU32(y0, y1, y2, y3, t);
        }
      }
    }
    // Z-axis pass — verbatim projectM indexing including `base_z * size + base_y + x`.
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        for (let z = 0; z < size; z++) {
          if (z % zoom === 0) continue;
          const baseY = y * size;
          const baseZ = Math.floor(z / zoom) * zoom + size;
          const y0 = tex[((baseZ - zoom) % size) * size + baseY + x];
          const y1 = tex[(baseZ % size) * size + baseY + x];
          const y2 = tex[((baseZ + zoom) % size) * size + baseY + x];
          const y3 = tex[((baseZ + zoom * 2) % size) * size + baseY + x];
          const t = (z % zoom) / zoom;
          tex[z * size + baseY + x] = dwCubicInterpolateU32(y0, y1, y2, y3, t);
        }
      }
    }
  }

  return u32ToRgba8Unorm(tex);
}

/** Manifest of the six MilkDrop-visible noise textures per projectM's
 *  static factory methods in `MilkdropNoise::LowQuality` etc.
 *  Consumers (MilkSession) call `createNoiseTex` or `createNoiseVolTex`
 *  with each row's parameters. */
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
