// Direct semantic tests for the composite-pass hue-base computation
// against butterchurn's shaders/comp.js generateHueBase source. This
// function drives the per-corner hue that the default composite shader
// modulates with (mdVSFrame.fShader-scaled) so a drift here changes
// every non-shader preset's frame colors.

import { describe, expect, it } from "vitest";
import { generateHueBase } from "../src/gpu/milk-pipeline";

describe("generateHueBase — comp.js hue oscillator math", () => {
  // The witnessed source (see the PHOSPHENE port comment in
  // src/gpu/milk-pipeline.ts generateHueBase) fills a 12-element
  // Float32Array as four RGB triples. For each corner i in [0, 4):
  //   r_raw = 0.6 + 0.3 * sin(time * 30 * 0.0143 + 3 + i*21 + randStart[3])
  //   g_raw = 0.6 + 0.3 * sin(time * 30 * 0.0107 + 1 + i*13 + randStart[1])
  //   b_raw = 0.6 + 0.3 * sin(time * 30 * 0.0129 + 6 + i*9 + randStart[2])
  //   maxshade = max(r_raw, g_raw, b_raw)
  //   {r,g,b} = 0.5 + 0.5 * ({r,g,b}_raw / maxshade)
  // The normalized values are always in [0.5, 1.0].
  it("returns 12 finite values, four RGB triples with each channel in [0.5, 1.0]", () => {
    const hue = generateHueBase(0.5, [0.1, 0.2, 0.3, 0.4]);
    expect(hue.length).toBe(12);
    for (let i = 0; i < 12; i++) {
      expect(Number.isFinite(hue[i])).toBe(true);
      expect(hue[i]).toBeGreaterThanOrEqual(0.5);
      expect(hue[i]).toBeLessThanOrEqual(1.0);
    }
  });

  it("normalizes each triple so at least one channel equals 1.0 (the max-shade rescale)", () => {
    const hue = generateHueBase(0.5, [0.1, 0.2, 0.3, 0.4]);
    for (let corner = 0; corner < 4; corner++) {
      const r = hue[corner * 3 + 0];
      const g = hue[corner * 3 + 1];
      const b = hue[corner * 3 + 2];
      const max = Math.max(r, g, b);
      // The max-shade rescale sets one channel to 0.5 + 0.5 = 1.0.
      expect(max).toBeCloseTo(1.0, 5);
    }
  });

  it("depends on randStart entries [1], [2], [3] as source formula prescribes (not [0])", () => {
    // The source uses randStart[3] for r_raw, [1] for g_raw, [2] for b_raw.
    // Perturbing randStart[0] must NOT change any output value.
    const rs = [0.1, 0.2, 0.3, 0.4];
    const rsAlt = [0.99, 0.2, 0.3, 0.4]; // only randStart[0] differs
    const a = generateHueBase(1.0, rs);
    const b = generateHueBase(1.0, rsAlt);
    for (let i = 0; i < 12; i++) expect(a[i]).toBe(b[i]);
  });

  it("shifts oscillator phase with time — same time reproduces same triples", () => {
    const rs = [0.1, 0.2, 0.3, 0.4];
    const a = generateHueBase(2.0, rs);
    const b = generateHueBase(2.0, rs);
    for (let i = 0; i < 12; i++) expect(a[i]).toBe(b[i]);
    const c = generateHueBase(3.0, rs);
    let anyDifferent = false;
    for (let i = 0; i < 12; i++) if (a[i] !== c[i]) anyDifferent = true;
    expect(anyDifferent).toBe(true);
  });

  it("reproduces the pinned raw-triple math for a controlled input", () => {
    // Pin the exact formula against Float64 arithmetic. Float32Array
    // storage introduces small drift; tolerance is 1e-6.
    const time = 0.5;
    const rs = [0.1, 0.2, 0.3, 0.4];
    const hue = generateHueBase(time, rs);
    const expectedRaw = (freq: number, phase: number, seed: number) =>
      0.6 + 0.3 * Math.sin(time * 30 * freq + phase + seed);
    for (let i = 0; i < 4; i++) {
      const rRaw = expectedRaw(0.0143, 3 + i * 21, rs[3]);
      const gRaw = expectedRaw(0.0107, 1 + i * 13, rs[1]);
      const bRaw = expectedRaw(0.0129, 6 + i * 9, rs[2]);
      const max = Math.max(rRaw, gRaw, bRaw);
      const rExp = 0.5 + 0.5 * rRaw / max;
      const gExp = 0.5 + 0.5 * gRaw / max;
      const bExp = 0.5 + 0.5 * bRaw / max;
      expect(hue[i * 3 + 0]).toBeCloseTo(rExp, 5);
      expect(hue[i * 3 + 1]).toBeCloseTo(gExp, 5);
      expect(hue[i * 3 + 2]).toBeCloseTo(bExp, 5);
    }
  });
});
