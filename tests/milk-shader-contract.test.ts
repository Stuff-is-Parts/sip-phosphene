// Direct semantic tests for the MilkDrop-2 shader-contract builder
// against the projectM PresetShaderHeaderGlsl330.inc contract
// (docs/evidence/projectm/PresetShaderHeaderGlsl330.inc) and the
// derivation in docs/milkdrop-execution-model.md §11A-§11E.

import { describe, expect, it } from "vitest";
import { buildShaderContract } from "../src/gpu/milk-pipeline";
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

  it("leaves randFrame at [0,0,0,0] pending session-owned per-frame RNG draws", () => {
    const c = buildShaderContract(baseFrame, [0.5, 0.6, 0.7, 0.8], 800, 600);
    // randPreset was passed through, but randFrame is session-owned and
    // stays zero until PHOSPHENE has a per-frame RNG source.
    expect(c.randPreset).toEqual([0.5, 0.6, 0.7, 0.8]);
    expect(c.randFrame).toEqual([0, 0, 0, 0]);
  });
});

describe("buildShaderContract — blur ranges from mdVSFrame (_c6.zw, _c13)", () => {
  // Per header lines 27-28 and 135-140, blurN_min/max come from
  // _c6.zw and _c13. Presets can write blurN_min/blurN_max in per-frame
  // code; the Renderer reads them from mdVSFrame at draw time.
  it("reads blurN_min and blurN_max from mdVSFrame", () => {
    const c = buildShaderContract({
      ...baseFrame,
      blur1_min: 0.05, blur1_max: 0.95,
      blur2_min: 0.1, blur2_max: 0.9,
      blur3_min: 0.2, blur3_max: 0.8,
    }, [0, 0, 0, 0], 800, 600);
    expect(c.blur1Min).toBe(0.05);
    expect(c.blur1Max).toBe(0.95);
    expect(c.blur2Min).toBe(0.1);
    expect(c.blur2Max).toBe(0.9);
    expect(c.blur3Min).toBe(0.2);
    expect(c.blur3Max).toBe(0.8);
  });

  it("defaults blur ranges to the identity unpack (0, 1) when preset does not set them", () => {
    const c = buildShaderContract(baseFrame, [0, 0, 0, 0], 800, 600);
    expect(c.blur1Min).toBe(0);
    expect(c.blur1Max).toBe(1);
    expect(c.blur2Min).toBe(0);
    expect(c.blur2Max).toBe(1);
    expect(c.blur3Min).toBe(0);
    expect(c.blur3Max).toBe(1);
  });
});
