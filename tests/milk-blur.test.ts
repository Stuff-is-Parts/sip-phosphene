// Direct semantic tests for the ported butterchurn blur math.
// Every value is compared against the exact JavaScript computation in
// docs/evidence/butterchurn/rendering_shaders_blur_blurHorizontal.js
// and rendering_shaders_blur_blurVertical.js.

import { describe, expect, it } from "vitest";
import {
  BLUR_WEIGHTS,
  BLUR_LEVEL_RATIOS,
  horizontalUniforms,
  verticalUniforms,
  getScaleAndBias,
  getBlurTargetSize,
  getBlurCascadeSizes,
} from "../src/gpu/milk-blur";

describe("milk-blur — weight and offset constants", () => {
  // blurHorizontal.js:28 and blurVertical.js:28.
  it("uses the exact 8-weight vector from the source", () => {
    expect([...BLUR_WEIGHTS]).toEqual([4.0, 3.8, 3.5, 2.9, 1.9, 1.2, 0.7, 0.3]);
  });

  // rendering_renderer.js:102.
  it("uses source-defined level ratios", () => {
    expect(BLUR_LEVEL_RATIOS.map((r) => [...r])).toEqual([
      [0.5, 0.25],
      [0.125, 0.125],
      [0.0625, 0.0625],
    ]);
  });
});

describe("milk-blur — horizontalUniforms", () => {
  // Verified against blurHorizontal.js:28-39 with the exact weight
  // vector. The published shader consumes ws (four pair-sums), ds
  // (four pair-weighted-offset positions), and wDiv (a normalizing
  // factor of 0.5 / total).
  it("packs pair sums, offsets, and wDiv per the source formula", () => {
    const { ws, ds, wDiv } = horizontalUniforms();
    const w = BLUR_WEIGHTS;
    expect(ws[0]).toBeCloseTo(w[0] + w[1], 12);
    expect(ws[1]).toBeCloseTo(w[2] + w[3], 12);
    expect(ws[2]).toBeCloseTo(w[4] + w[5], 12);
    expect(ws[3]).toBeCloseTo(w[6] + w[7], 12);
    expect(ds[0]).toBeCloseTo(0 + 2 * w[1] / ws[0], 12);
    expect(ds[1]).toBeCloseTo(2 + 2 * w[3] / ws[1], 12);
    expect(ds[2]).toBeCloseTo(4 + 2 * w[5] / ws[2], 12);
    expect(ds[3]).toBeCloseTo(6 + 2 * w[7] / ws[3], 12);
    expect(wDiv).toBeCloseTo(0.5 / (ws[0] + ws[1] + ws[2] + ws[3]), 12);
  });
});

describe("milk-blur — verticalUniforms", () => {
  // Verified against blurVertical.js:28-34.
  it("packs V-pass weights and offsets per the source formula", () => {
    const { wds, wDiv } = verticalUniforms();
    const w = BLUR_WEIGHTS;
    const w1V = w[0] + w[1] + w[2] + w[3];
    const w2V = w[4] + w[5] + w[6] + w[7];
    expect(wds[0]).toBeCloseTo(w1V, 12);
    expect(wds[1]).toBeCloseTo(w2V, 12);
    expect(wds[2]).toBeCloseTo(0 + 2 * ((w[2] + w[3]) / w1V), 12);
    expect(wds[3]).toBeCloseTo(2 + 2 * ((w[6] + w[7]) / w2V), 12);
    expect(wDiv).toBeCloseTo(1.0 / ((w1V + w2V) * 2), 12);
  });
});

describe("milk-blur — getScaleAndBias per-level range compression", () => {
  // Verified against blurHorizontal.js:69-89. Level 0 uses the raw
  // [min, max] range. Levels 1 and 2 use the relative range within
  // their parent so the shader can chain the decompression.
  it("computes level 0 scale as 1/(max-min) and bias as -min*scale", () => {
    const mins = [0.1, 0.2, 0.3];
    const maxs = [0.9, 0.8, 0.7];
    const { scale, bias } = getScaleAndBias(0, mins, maxs);
    expect(scale).toBeCloseTo(1.0 / (0.9 - 0.1), 10);
    expect(bias).toBeCloseTo(-0.1 * (1.0 / (0.9 - 0.1)), 10);
  });

  it("computes level 1 relative to level 0 range", () => {
    const mins = [0.1, 0.2, 0.3];
    const maxs = [0.9, 0.8, 0.7];
    const { scale, bias } = getScaleAndBias(1, mins, maxs);
    const tempMin = (0.2 - 0.1) / (0.9 - 0.1);
    const tempMax = (0.8 - 0.1) / (0.9 - 0.1);
    const expScale = 1.0 / (tempMax - tempMin);
    const expBias = -tempMin * expScale;
    expect(scale).toBeCloseTo(expScale, 10);
    expect(bias).toBeCloseTo(expBias, 10);
  });

  it("computes level 2 relative to level 1 range", () => {
    const mins = [0.1, 0.2, 0.3];
    const maxs = [0.9, 0.8, 0.7];
    const { scale, bias } = getScaleAndBias(2, mins, maxs);
    const tempMin = (0.3 - 0.2) / (0.8 - 0.2);
    const tempMax = (0.7 - 0.2) / (0.8 - 0.2);
    const expScale = 1.0 / (tempMax - tempMin);
    const expBias = -tempMin * expScale;
    expect(scale).toBeCloseTo(expScale, 10);
    expect(bias).toBeCloseTo(expBias, 10);
  });

  it("returns identity (scale=1/(1-0)=1, bias=0) when the level range is [0, 1]", () => {
    const { scale, bias } = getScaleAndBias(0, [0, 0, 0], [1, 1, 1]);
    expect(scale).toBe(1);
    // -0 === 0 in ==, but toBe uses Object.is which distinguishes; the
    // formula is -min * scale = -0 * 1 = -0. Accept both zero signs.
    expect(Object.is(bias, 0) || Object.is(bias, -0)).toBe(true);
  });
});

describe("milk-blur — getBlurTargetSize source-exact rounding", () => {
  // Source: blur.js:3132-3139 verbatim.
  //   sizeX = max(w * ratio, 16); sizeX = floor((sizeX + 3) / 16) * 16
  //   sizeY = max(h * ratio, 16); sizeY = floor((sizeY + 3) / 4) * 4
  it("rounds X to the next multiple of 16 and Y to the next multiple of 4", () => {
    // 800 * 0.5 = 400. (400 + 3) / 16 = 25.1875. floor = 25. 25 * 16 = 400.
    // 600 * 0.5 = 300. (300 + 3) / 4 = 75.75. floor = 75. 75 * 4 = 300.
    expect(getBlurTargetSize(800, 600, 0.5)).toEqual([400, 300]);
    // 800 * 0.25 = 200. (200 + 3) / 16 = 12.6875. floor = 12. 12 * 16 = 192.
    // 600 * 0.25 = 150. (150 + 3) / 4 = 38.25. floor = 38. 38 * 4 = 152.
    expect(getBlurTargetSize(800, 600, 0.25)).toEqual([192, 152]);
  });

  it("clamps sub-16 sizes up to the 16-texel minimum on both axes", () => {
    // 16 * 0.0625 = 1. max(1, 16) = 16. Same for both axes.
    // Then X: (16 + 3) / 16 = 1.1875. floor = 1. 1 * 16 = 16.
    //      Y: (16 + 3) / 4 = 4.75. floor = 4. 4 * 4 = 16.
    expect(getBlurTargetSize(16, 16, 0.0625)).toEqual([16, 16]);
  });

  it("returns the six-target cascade sizes matching the source per-level pairs", () => {
    // Main resolution 800x600. Cascade produces three H intermediates
    // and three V outputs, each rounded per getBlurTargetSize.
    const s = getBlurCascadeSizes(800, 600);
    // Level 1: H at 0.5x, V at 0.25x
    expect(s.h[0]).toEqual(getBlurTargetSize(800, 600, 0.5));
    expect(s.v[0]).toEqual(getBlurTargetSize(800, 600, 0.25));
    // Level 2: H at 0.125x, V at 0.125x
    expect(s.h[1]).toEqual(getBlurTargetSize(800, 600, 0.125));
    expect(s.v[1]).toEqual(getBlurTargetSize(800, 600, 0.125));
    // Level 3: H at 0.0625x, V at 0.0625x
    expect(s.h[2]).toEqual(getBlurTargetSize(800, 600, 0.0625));
    expect(s.v[2]).toEqual(getBlurTargetSize(800, 600, 0.0625));
  });

  it("keeps V output smaller than H intermediate at level 1 as source ratios prescribe", () => {
    // Level 1: H at 0.5x, V at 0.25x. V is half the H in area.
    const s = getBlurCascadeSizes(800, 600);
    expect(s.v[0][0]).toBeLessThan(s.h[0][0]);
  });
});
