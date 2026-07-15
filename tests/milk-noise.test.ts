// Direct semantic tests for the projectM-authoritative noise generator
// against docs/evidence/projectm/MilkdropNoise.cpp `generate2D` and
// `generate3D`. Every assertion cites the projectM behavior verified.

import { describe, expect, it } from "vitest";
import {
  fCubicInterpolate, dwCubicInterpolateU32,
  createNoiseTex, createNoiseVolTex, NOISE_TEX_SPECS,
} from "../src/gpu/milk-noise";
import { makeMulberry32 } from "../src/core/milk-runner";

describe("fCubicInterpolate — projectM MilkdropNoise.cpp fCubicInterpolate", () => {
  it("returns y1 at t=0", () => {
    expect(fCubicInterpolate(1, 2, 3, 4, 0)).toBe(2);
    expect(fCubicInterpolate(0.1, 0.5, 0.9, 0.3, 0)).toBe(0.5);
  });

  it("returns y2 at t=1", () => {
    expect(fCubicInterpolate(1, 2, 3, 4, 1)).toBe(3);
    expect(fCubicInterpolate(0.1, 0.5, 0.9, 0.3, 1)).toBeCloseTo(0.9, 10);
  });
});

describe("dwCubicInterpolateU32 — projectM MilkdropNoise.cpp dwCubicInterpolate", () => {
  it("operates on packed uint32 values per shift (byte-wise interpolation)", () => {
    // At t=0 the function returns y1 exactly (per fCubicInterpolate).
    // Packed uint32 y1 with byte pattern (A, B, C, D) at shifts 24,16,8,0.
    const y0 = 0;
    const y1 = 0x40506070; // bytes: 0x40, 0x50, 0x60, 0x70 at shifts 24, 16, 8, 0
    const y2 = 0xff000000;
    const y3 = 0;
    const out = dwCubicInterpolateU32(y0, y1, y2, y3, 0);
    // At t=0, each channel returns byte of y1.
    expect((out >>> 24) & 0xff).toBe(0x40);
    expect((out >>> 16) & 0xff).toBe(0x50);
    expect((out >>> 8)  & 0xff).toBe(0x60);
    expect(out & 0xff).toBe(0x70);
  });
});

describe("createNoiseTex — projectM 2D noise", () => {
  it("produces size * size * 4 bytes at zoom=1", () => {
    const tex = createNoiseTex(16, 1, makeMulberry32(1));
    expect(tex).toBeInstanceOf(Uint8Array);
    expect(tex.length).toBe(16 * 16 * 4);
  });

  it("is deterministic for a fixed seed", () => {
    const a = createNoiseTex(16, 1, makeMulberry32(42));
    const b = createNoiseTex(16, 1, makeMulberry32(42));
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("produces different output for different seeds", () => {
    const a = createNoiseTex(16, 1, makeMulberry32(1));
    const b = createNoiseTex(16, 1, makeMulberry32(2));
    let differ = false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { differ = true; break; }
    expect(differ).toBe(true);
  });

  it("produces bytes in the full 0..255 range from projectM's packed pack + wrap semantics", () => {
    // At RANGE=256, each channel value can be 128..383. After 8-bit
    // truncation via projectM's packed uint32 (bit-spill included),
    // final byte values span 0..255.
    const tex = createNoiseTex(32, 1, makeMulberry32(7));
    let low = 0, high = 0;
    for (let i = 0; i < tex.length; i++) {
      if (tex[i] < 128) low++;
      else high++;
    }
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(0);
  });

  it("produces size * size * 4 bytes at zoom=4 with cubic interpolation", () => {
    const tex = createNoiseTex(16, 4, makeMulberry32(1));
    expect(tex.length).toBe(16 * 16 * 4);
  });
});

describe("createNoiseVolTex — projectM 3D noise", () => {
  it("produces size ** 3 * 4 bytes at zoom=1", () => {
    const tex = createNoiseVolTex(8, 1, makeMulberry32(1));
    expect(tex.length).toBe(8 * 8 * 8 * 4);
  });

  it("produces size ** 3 * 4 bytes at zoom=4 with cubic interpolation", () => {
    const tex = createNoiseVolTex(8, 4, makeMulberry32(1));
    expect(tex.length).toBe(8 * 8 * 8 * 4);
  });

  it("is deterministic for a fixed seed at zoom=4", () => {
    const a = createNoiseVolTex(8, 4, makeMulberry32(99));
    const b = createNoiseVolTex(8, 4, makeMulberry32(99));
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe("NOISE_TEX_SPECS — projectM MilkdropNoise.cpp factory sizes", () => {
  it("matches projectM's six shader-visible noise textures", () => {
    const specs = NOISE_TEX_SPECS.map((s) => [s.name, s.kind, s.size, s.zoom]);
    expect(specs).toEqual([
      ["noise_lq",      "2d", 256, 1],
      ["noise_lq_lite", "2d", 32,  1],
      ["noise_mq",      "2d", 256, 4],
      ["noise_hq",      "2d", 256, 8],
      ["noisevol_lq",   "3d", 32,  1],
      ["noisevol_hq",   "3d", 32,  4],
    ]);
  });
});
