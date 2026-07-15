// Direct-mapping checks for the copy and flip vertex-shader UV math
// used by MilkPipeline. Without a live WebGPU device we cannot read
// back GPU texels, so these tests verify the JavaScript helpers
// `computeCopyUv` and `computeFlipUv` that mirror the WGSL vertex math
// exactly. A shader-side change to the UV expressions in FLIP_WGSL or
// PRESENT_WGSL requires an equivalent change here.
//
// PHOSPHENE's WebGPU convention:
//   - framebuffer memory pixel (0, 0) sits at the TOP of the surface;
//   - NDC y = 1 also sits at the TOP;
//   - texture UV (0, 0) samples the memory texel at (0, 0).
//
// Copy mapping (identity):
//   NDC (-1, 1) [top-left]  → UV (0, 0)  [source top-left]
//   NDC (1, -1) [bottom-right] → UV (1, 1)  [source bottom-right]
//
// Vertical-flip mapping:
//   NDC (-1, 1) [top-left]  → UV (0, 1)  [source bottom-left]
//   NDC (1, -1) [bottom-right] → UV (1, 0)  [source top-right]

import { describe, expect, it } from "vitest";
import { computeCopyUv, computeFlipUv } from "../src/gpu/milk-pipeline";

describe("computeCopyUv — direct copy UV mapping", () => {
  it("maps NDC top-left (-1, 1) to UV (0, 0) — source top-left", () => {
    expect(computeCopyUv(-1, 1)).toEqual([0, 0]);
  });

  it("maps NDC bottom-right (1, -1) to UV (1, 1) — source bottom-right", () => {
    expect(computeCopyUv(1, -1)).toEqual([1, 1]);
  });

  it("maps NDC bottom-left (-1, -1) to UV (0, 1) — source bottom-left", () => {
    expect(computeCopyUv(-1, -1)).toEqual([0, 1]);
  });

  it("maps NDC top-right (1, 1) to UV (1, 0) — source top-right", () => {
    expect(computeCopyUv(1, 1)).toEqual([1, 0]);
  });
});

describe("computeFlipUv — vertical flip UV mapping", () => {
  it("maps NDC top-left (-1, 1) to UV (0, 1) — source bottom-left", () => {
    expect(computeFlipUv(-1, 1)).toEqual([0, 1]);
  });

  it("maps NDC bottom-right (1, -1) to UV (1, 0) — source top-right", () => {
    expect(computeFlipUv(1, -1)).toEqual([1, 0]);
  });

  it("maps NDC bottom-left (-1, -1) to UV (0, 0) — source top-left", () => {
    expect(computeFlipUv(-1, -1)).toEqual([0, 0]);
  });

  it("maps NDC top-right (1, 1) to UV (1, 1) — source bottom-right", () => {
    expect(computeFlipUv(1, 1)).toEqual([1, 1]);
  });
});

describe("copy and flip are distinct operations", () => {
  // Asymmetric-texel intent: pick a UV coordinate that produces
  // different values under each mapping. If the two functions produce
  // the same output at every vertex, they are the same operation, not
  // two different ones.
  it("produces different UV values at NDC (0, 0.5)", () => {
    const copy = computeCopyUv(0, 0.5);
    const flip = computeFlipUv(0, 0.5);
    expect(copy).not.toEqual(flip);
    expect(copy).toEqual([0.5, 0.25]);
    expect(flip).toEqual([0.5, 0.75]);
  });

  it("swaps the y coordinate between the two operations", () => {
    // A y-flip of an identity mapping y' = 1 - y. Given uv_copy = (u, v)
    // at some NDC vertex, uv_flip at the same vertex is (u, 1 - v).
    for (const py of [-1, -0.5, 0, 0.5, 1]) {
      const [cx, cy] = computeCopyUv(0.3, py);
      const [fx, fy] = computeFlipUv(0.3, py);
      expect(fx).toBe(cx);
      expect(fy).toBeCloseTo(1 - cy, 10);
    }
  });
});
