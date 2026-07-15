// Direct semantic tests for the MilkDrop-2 shader-contract builder
// against the projectM PresetShaderHeaderGlsl330.inc contract
// (docs/evidence/projectm/PresetShaderHeaderGlsl330.inc) and the
// derivation in docs/milkdrop-execution-model.md §11A-§11E.

import { describe, expect, it } from "vitest";
import { buildShaderContract, getBlurValues } from "../src/gpu/milk-pipeline";
import { type Pool } from "../src/core/milk-runner";

const baseFrame: Pool = {
  time: 0, fps: 30, frame: 0,
  bass: 0.5, mid: 0.4, treb: 0.3,
  bass_att: 1, mid_att: 1, treb_att: 1,
};
for (let i = 1; i <= 32; i++) baseFrame[`q${i}`] = i * 0.1;

describe("buildShaderContract — q1..q32 packed into 8 float4 banks", () => {
  // Per PresetShaderHeaderGlsl330.inc lines 29-36 and 89-120:
  //   uniform float4 _qa..._qh;
  //   #define q1 _qa.x ... #define q32 _qh.w
  // Contract must expose q1..q32 in the natural order.
  it("packs q1..q4 into qBanks[0], q5..q8 into qBanks[1], etc.", () => {
    const c = buildShaderContract(baseFrame, [0.1, 0.2, 0.3, 0.4], 800, 600);
    expect(c.qBanks[0]).toEqual([0.1, 0.2, 0.30000000000000004, 0.4]);
    expect(c.qBanks[1]).toEqual([0.5, 0.6000000000000001, 0.7000000000000001, 0.8]);
    // q9..q32 continue in the same layout.
    expect(c.qBanks[2][0]).toBeCloseTo(0.9, 10);
    expect(c.qBanks[7][3]).toBeCloseTo(3.2, 10);
  });

  it("defaults missing q values to 0", () => {
    const sparse: Pool = { time: 0, fps: 30 };
    const c = buildShaderContract(sparse, [0, 0, 0, 0], 800, 600);
    for (let bank = 0; bank < 8; bank++) {
      for (let lane = 0; lane < 4; lane++) {
        expect(c.qBanks[bank][lane]).toBe(0);
      }
    }
  });
});

describe("buildShaderContract — aspect and texsize (_c0, _c7)", () => {
  // Header defines: aspect = _c0 (xy fullscreen multiplier, zw inverse);
  // texsize = _c7 (w, h, 1/w, 1/h). Butterchurn's Renderer aspect is:
  //   aspectx = texsizeY > texsizeX ? texsizeX / texsizeY : 1
  //   aspecty = texsizeX > texsizeY ? texsizeY / texsizeX : 1
  it("computes landscape aspect (wider than tall)", () => {
    const c = buildShaderContract(baseFrame, [0, 0, 0, 0], 1600, 900);
    // texsizeX (1600) > texsizeY (900), so aspectXY = 1, aspectYX = 900/1600.
    expect(c.aspect[0]).toBe(1);
    expect(c.aspect[1]).toBeCloseTo(900 / 1600, 10);
    expect(c.aspect[2]).toBe(1);
    expect(c.aspect[3]).toBeCloseTo(1600 / 900, 10);
    expect(c.texsize).toEqual([1600, 900, 1 / 1600, 1 / 900]);
  });

  it("computes portrait aspect (taller than wide)", () => {
    const c = buildShaderContract(baseFrame, [0, 0, 0, 0], 600, 800);
    expect(c.aspect[0]).toBeCloseTo(600 / 800, 10);
    expect(c.aspect[1]).toBe(1);
  });
});

describe("buildShaderContract — roam and slow_roam (_c8, _c9, _c10, _c11)", () => {
  // Per header lines 17-23: roam = 0.5 + 0.5 * cos/sin(time *
  // float4(0.3, 1.3, 5, 20)); slow_roam uses float4(0.005, 0.008,
  // 0.013, 0.022). Both stay in [0, 1].
  it("stays in [0, 1] for arbitrary time", () => {
    const c = buildShaderContract(
      { ...baseFrame, time: 12.5 }, [0, 0, 0, 0], 800, 600,
    );
    for (const v of [...c.roamCos, ...c.roamSin, ...c.slowRoamCos, ...c.slowRoamSin]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("returns roamCos = 1 and roamSin = 0.5 at time=0 (cos(0)=1, sin(0)=0)", () => {
    const c = buildShaderContract(
      { ...baseFrame, time: 0 }, [0, 0, 0, 0], 800, 600,
    );
    expect(c.roamCos).toEqual([1, 1, 1, 1]);
    expect(c.roamSin).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
});

describe("buildShaderContract — session-owned uniforms are null", () => {
  // The following uniforms are session/Renderer-owned and PHOSPHENE has
  // no source-correct implementation yet. Contract must expose them as
  // null so any preset shader that reads them refuses at load rather
  // than silently receiving fabricated values.
  it("leaves mip stats null", () => {
    const c = buildShaderContract(baseFrame, [0, 0, 0, 0], 800, 600);
    expect(c.mipX).toBeNull();
    expect(c.mipY).toBeNull();
    expect(c.mipAvg).toBeNull();
  });

  it("leaves all 24 rotation matrices null", () => {
    const c = buildShaderContract(baseFrame, [0, 0, 0, 0], 800, 600);
    expect(c.rotStatic).toBeNull();
    expect(c.rotDynamic).toBeNull();
    expect(c.rotFast).toBeNull();
    expect(c.rotVeryFast).toBeNull();
    expect(c.rotUltraFast).toBeNull();
    expect(c.rotPerFrame).toBeNull();
  });

  it("leaves randFrame null pending session-owned per-frame RNG draws", () => {
    const c = buildShaderContract(baseFrame, [0.5, 0.6, 0.7, 0.8], 800, 600);
    // randPreset is drawn by the runner at preset load, so it flows.
    // randFrame is session-owned per-frame; leaving it null forces
    // refusal for any shader that reads it (butterchurn.js:2789
    // uploads a fresh vec4 per frame from session RNG).
    expect(c.randPreset).toEqual([0.5, 0.6, 0.7, 0.8]);
    expect(c.randFrame).toBeNull();
  });

  it("leaves progress null pending source-witnessed owner", () => {
    // Butterchurn's warp/comp shader uniform block at butterchurn.js:3372
    // and :4321 does NOT include a `progress` uniform. The header spec
    // names one but butterchurn never uploads. Null forces refusal.
    const c = buildShaderContract(baseFrame, [0, 0, 0, 0], 800, 600);
    expect(c.progress).toBeNull();
  });
});

describe("getBlurValues — source-witnessed clamping (butterchurn.js:3030-3070)", () => {
  // The three-stage recursion:
  //   Level 1: if max1 - min1 < 0.1, collapse both to avg - 0.05.
  //   Level 2: max2 = min(max1, max2), min2 = max(min1, min2), then
  //     apply the same min-distance guard.
  //   Level 3: max3 = min(max2, max3), min3 = max(min2, min3), then
  //     apply the same min-distance guard.
  it("passes through wide non-overlapping ranges unchanged", () => {
    const { blurMins, blurMaxs } = getBlurValues({
      b1n: 0, b1x: 1, b2n: 0.1, b2x: 0.9, b3n: 0.2, b3x: 0.8,
    });
    expect(blurMins).toEqual([0, 0.1, 0.2]);
    expect(blurMaxs).toEqual([1, 0.9, 0.8]);
  });

  it("clamps level 2 min up to level 1 min when level 2 min is below it", () => {
    const { blurMins } = getBlurValues({
      b1n: 0.3, b1x: 1, b2n: 0.1, b2x: 0.9, b3n: 0.05, b3x: 0.8,
    });
    // level 2 min = max(0.3, 0.1) = 0.3
    // level 3 min = max(0.3, 0.05) = 0.3
    expect(blurMins[1]).toBe(0.3);
    expect(blurMins[2]).toBe(0.3);
  });

  it("clamps level 2 max down to level 1 max when level 2 max is above it", () => {
    const { blurMaxs } = getBlurValues({
      b1n: 0, b1x: 0.5, b2n: 0, b2x: 0.9, b3n: 0, b3x: 0.8,
    });
    // level 2 max = min(0.5, 0.9) = 0.5; then level 2 collapses to avg
    // (max-min = 0.5 > 0.1 so no clamp fires). level 3 max = min(0.5, 0.8) = 0.5.
    expect(blurMaxs[1]).toBe(0.5);
    expect(blurMaxs[2]).toBe(0.5);
  });

  it("collapses a narrow range to a single point per the source oddity", () => {
    // butterchurn.js:3040-3044 uses the same expression on both sides —
    // both min and max become avg - fMinDist * 0.5 when the range is
    // too narrow. PHOSPHENE reproduces the source verbatim rather than
    // "fixing" the apparent bug.
    const { blurMins, blurMaxs } = getBlurValues({
      b1n: 0.5, b1x: 0.55, b2n: 0.5, b2x: 0.6, b3n: 0, b3x: 1,
    });
    // level 1: max - min = 0.05 < 0.1 → both become avg - 0.05
    //   avg = (0.5 + 0.55) / 2 = 0.525; both = 0.475
    expect(blurMins[0]).toBeCloseTo(0.525 - 0.05, 10);
    expect(blurMaxs[0]).toBeCloseTo(0.525 - 0.05, 10);
  });

  it("defaults missing b*n/b*x to the source defaults (b*n=0, b*x=1)", () => {
    const { blurMins, blurMaxs } = getBlurValues({});
    expect(blurMins).toEqual([0, 0, 0]);
    expect(blurMaxs).toEqual([1, 1, 1]);
  });
});

describe("buildShaderContract — blur ranges routed through getBlurValues", () => {
  it("uses getBlurValues clamping, not raw b1n/b1x", () => {
    const c = buildShaderContract({
      ...baseFrame,
      // Provoke the level 2 clamp: b2x above b1x must clamp to b1x.
      b1n: 0, b1x: 0.5, b2n: 0, b2x: 0.9, b3n: 0, b3x: 1,
    }, [0, 0, 0, 0], 800, 600);
    // level 2 max = min(0.5, 0.9) = 0.5
    expect(c.blur2Max).toBe(0.5);
  });

  it("returns level defaults (0, 1) for empty inputs matching butterchurn defaults", () => {
    const c = buildShaderContract(baseFrame, [0, 0, 0, 0], 800, 600);
    expect(c.blur1Min).toBe(0);
    expect(c.blur1Max).toBe(1);
    expect(c.blur2Min).toBe(0);
    expect(c.blur2Max).toBe(1);
    expect(c.blur3Min).toBe(0);
    expect(c.blur3Max).toBe(1);
  });
});
