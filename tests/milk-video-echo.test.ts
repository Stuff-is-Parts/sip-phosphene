// Direct semantic tests for the projectM VideoEcho port at
// src/gpu/milk-video-echo.ts, verified against
// docs/evidence/projectm/VideoEcho.cpp (pinned SHA
// 2f244141320f6b97b09bf99964cc72a4efdfcfd3). Every assertion cites
// the projectM behavior the port must reproduce.

import { describe, expect, it } from "vitest";
import {
  computeEchoPositions, computeShades, computeEchoUvs,
  computeGammaAdjustmentUvs, computeHueRandomOffsets,
  planEchoActiveDraws, planEchoInactiveDraws,
} from "../src/gpu/milk-video-echo";
import { makeMulberry32 } from "../src/core/milk-runner";

describe("computeEchoPositions — projectM VideoEcho::Draw geometry", () => {
  it("expands the base -1..+1 quad by 1/width and 1/height on a square viewport", () => {
    // Square viewport: aspect = 1 / (1 * invAspectY=1) = 1 → aspectMults both 1.
    // fOnePlusInvWidth = 1 + 1/640; fOnePlusInvHeight = 1 + 1/640.
    const pts = computeEchoPositions(640, 640, 1);
    const w = 1 + 1 / 640;
    const h = 1 + 1 / 640;
    expect(pts[0]).toEqual([-w, h]);
    expect(pts[1]).toEqual([w, h]);
    expect(pts[2]).toEqual([-w, -h]);
    expect(pts[3]).toEqual([w, -h]);
  });

  it("stretches the y multiplier when the viewport is wider than tall (aspect > 1)", () => {
    // width=1920, height=1080, invAspectY=1 → aspect = 1920/1080 > 1.
    // aspectMultX=1, aspectMultY=aspect.
    const pts = computeEchoPositions(1920, 1080, 1);
    const aspect = 1920 / 1080;
    const w = 1 + 1 / 1920;
    const h = (1 + 1 / 1080) * aspect;
    expect(pts[0][1]).toBeCloseTo(h, 10);
    expect(pts[3][0]).toBeCloseTo(w, 10);
  });
});

describe("computeShades — projectM VideoEcho::Draw shade oscillator + normalize", () => {
  it("normalizes so at least one channel per corner equals 1.0 before the 0.5 blend", () => {
    // projectM divides by max then applies 0.5 + 0.5*value, so the
    // channel that was max ends at 1.0 exactly.
    const shades = computeShades(0.5, [0.1, 0.2, 0.3, 0.4]);
    for (const s of shades) {
      const max = Math.max(s[0], s[1], s[2]);
      expect(max).toBeCloseTo(1, 10);
    }
  });

  it("keeps every channel in [0.5, 1.0]", () => {
    const shades = computeShades(0.5, [0.1, 0.2, 0.3, 0.4]);
    for (const s of shades) {
      for (const c of s) {
        expect(c).toBeGreaterThanOrEqual(0.5);
        expect(c).toBeLessThanOrEqual(1.0);
      }
    }
  });

  it("shifts phase when time changes", () => {
    const a = computeShades(1.0, [0.1, 0.2, 0.3, 0.4]);
    const b = computeShades(2.0, [0.1, 0.2, 0.3, 0.4]);
    let differ = false;
    for (let i = 0; i < 4 && !differ; i++) {
      for (let c = 0; c < 3; c++) if (a[i][c] !== b[i][c]) differ = true;
    }
    expect(differ).toBe(true);
  });

  it("depends on hueRandomOffsets indices 1, 2, 3 per projectM's shade math", () => {
    // projectM reads hueRandomOffsets[3] for R, [1] for G, [2] for B;
    // index 0 is not touched by the shade calculation.
    const base = computeShades(0.5, [0.1, 0.2, 0.3, 0.4]);
    const swap0 = computeShades(0.5, [0.99, 0.2, 0.3, 0.4]);
    for (let i = 0; i < 4; i++) {
      expect(base[i][0]).toBeCloseTo(swap0[i][0], 10);
      expect(base[i][1]).toBeCloseTo(swap0[i][1], 10);
      expect(base[i][2]).toBeCloseTo(swap0[i][2], 10);
    }
  });
});

describe("computeEchoUvs — projectM orientation UVs for pass 1", () => {
  const tempLow = 0.25;
  const tempHigh = 0.75;
  const zoom = 2; // tempLow = 0.5 - 0.25 = 0.25; tempHigh = 0.5 + 0.25 = 0.75

  it("orientation 0 leaves the base UVs unchanged", () => {
    const uvs = computeEchoUvs(1, zoom, 0);
    expect(uvs[0]).toEqual([tempLow, tempLow]);
    expect(uvs[3]).toEqual([tempHigh, tempHigh]);
  });

  it("orientation 1 flips horizontally (u -> 1 - u)", () => {
    const uvs = computeEchoUvs(1, zoom, 1);
    expect(uvs[0]).toEqual([1 - tempLow, tempLow]);
    expect(uvs[3]).toEqual([1 - tempHigh, tempHigh]);
  });

  it("orientation 2 flips vertically (v -> 1 - v)", () => {
    const uvs = computeEchoUvs(1, zoom, 2);
    expect(uvs[0]).toEqual([tempLow, 1 - tempLow]);
    expect(uvs[3]).toEqual([tempHigh, 1 - tempHigh]);
  });

  it("orientation 3 flips both axes", () => {
    const uvs = computeEchoUvs(1, zoom, 3);
    expect(uvs[0]).toEqual([1 - tempLow, 1 - tempLow]);
    expect(uvs[3]).toEqual([1 - tempHigh, 1 - tempHigh]);
  });
});

describe("computeGammaAdjustmentUvs — projectM DrawGammaAdjustment initial UVs", () => {
  it("returns the identity 0..1 UV rectangle", () => {
    expect(computeGammaAdjustmentUvs()).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
  });
});

describe("planEchoActiveDraws — two-pass echo lifecycle with gamma redraws", () => {
  const shades: [number, number, number][] = [
    [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1],
  ];

  it("emits pass 0 overwrite + pass 1 additive when gamma is at or below 0.001", () => {
    // No redraws — planEchoActiveDraws emits exactly two draws.
    const draws = planEchoActiveDraws(0.001, 0.5, 2, 0, shades);
    expect(draws).toHaveLength(2);
    expect(draws[0].blend).toBe("overwrite");
    expect(draws[0].label).toBe("video-echo-pass-0");
    expect(draws[1].blend).toBe("additive");
    expect(draws[1].label).toBe("video-echo-pass-1");
  });

  it("adds one redraw per integer of gammaAdj minus one, plus one final fractional redraw per pass", () => {
    // gammaAdj = 2.5. redrawCount = floor(2.5 - 0.0001) = 2 per pass.
    // So each pass = 1 (initial) + 2 redraws = 3 draws. Total = 6.
    const draws = planEchoActiveDraws(2.5, 0.5, 2, 0, shades);
    expect(draws).toHaveLength(6);
    // Final redraw uses fractional gamma = 2.5 - 2 = 0.5.
    const finalPass0 = draws[2];
    expect(finalPass0.label).toBe("video-echo-pass-0-gamma-1");
    // Colors on the final redraw carry gamma * mix * shade. mix for
    // pass 0 = 1 - 0.5 = 0.5. gamma = 0.5. shade = 1. So color = 0.25.
    expect(finalPass0.colors[0][0]).toBeCloseTo(0.5 * 0.5 * 1, 10);
  });
});

describe("planEchoInactiveDraws — gamma-adjustment lifecycle", () => {
  const shades: [number, number, number][] = [
    [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1],
  ];

  it("emits floor(gammaAdj - 0.0001) + 1 draws (first overwrite, rest additive)", () => {
    // gammaAdj = 1.7: floor(1.6999) = 1 → 2 draws.
    const draws = planEchoInactiveDraws(1.7, shades);
    expect(draws).toHaveLength(2);
    expect(draws[0].blend).toBe("overwrite");
    expect(draws[1].blend).toBe("additive");
    // Final redraw uses fractional gamma = 1.7 - 1 = 0.7.
    expect(draws[1].colors[0][0]).toBeCloseTo(0.7, 10);
  });

  it("emits one draw when gammaAdj is below 1", () => {
    // gammaAdj = 0.5: floor(0.4999) = 0 → 1 draw with gamma = 0.5.
    const draws = planEchoInactiveDraws(0.5, shades);
    expect(draws).toHaveLength(1);
    expect(draws[0].blend).toBe("overwrite");
    expect(draws[0].colors[0][0]).toBeCloseTo(0.5, 10);
  });
});

describe("computeHueRandomOffsets — projectM PresetState hue seeding", () => {
  it("returns four values, each scaled by 0.01 within projectM's per-index modulo", () => {
    const rng = makeMulberry32(0x12345);
    const offs = computeHueRandomOffsets(rng);
    expect(offs).toHaveLength(4);
    expect(offs[0]).toBeGreaterThanOrEqual(0);
    expect(offs[0]).toBeLessThan(64841 * 0.01);
    expect(offs[1]).toBeLessThan(53751 * 0.01);
    expect(offs[2]).toBeLessThan(42661 * 0.01);
    expect(offs[3]).toBeLessThan(31571 * 0.01);
  });

  it("is deterministic under a fixed seed so tests can inject a known value", () => {
    const a = computeHueRandomOffsets(makeMulberry32(0xdead));
    const b = computeHueRandomOffsets(makeMulberry32(0xdead));
    expect(a).toEqual(b);
  });
});
