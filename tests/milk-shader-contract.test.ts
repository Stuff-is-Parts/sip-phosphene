// Direct semantic tests for the MilkDrop-2 shader-contract builder
// against docs/evidence/projectm/MilkdropShader.cpp `LoadVariables`.
// Every assertion cites the source line the ported behavior traces to.

import { describe, expect, it } from "vitest";
import { buildShaderContract, getBlurValues } from "../src/gpu/milk-pipeline";
import { MilkShaderInstance } from "../src/gpu/milk-shader-instance";
import { MilkSession } from "../src/gpu/milk-session";
import { makeMulberry32, type Pool } from "../src/core/milk-runner";

const baseFrame: Pool = {
  time: 0, fps: 30, frame: 0,
  bass: 0.5, mid: 0.4, treb: 0.3,
  bass_att: 1, mid_att: 1, treb_att: 1,
};
for (let i = 1; i <= 32; i++) baseFrame[`q${i}`] = i * 0.1;

const makeInstance = (kind: "warp" | "comp", seed = 1): MilkShaderInstance =>
  new MilkShaderInstance(kind, makeMulberry32(seed));

const makeSession = (seed = 2): MilkSession =>
  new MilkSession(makeMulberry32(seed), makeMulberry32(seed + 1));

describe("buildShaderContract — projectM MilkdropShader.cpp LoadVariables", () => {
  it("packs q1..q32 into eight float4 banks _qa.._qh", () => {
    const c = buildShaderContract(makeInstance("warp"), baseFrame, 800, 600, makeSession());
    expect(c.qBanks[0][0]).toBeCloseTo(0.1, 10);
    expect(c.qBanks[0][3]).toBeCloseTo(0.4, 10);
    expect(c.qBanks[7][3]).toBeCloseTo(3.2, 10);
  });

  it("defaults missing q values to 0", () => {
    const sparse: Pool = { time: 0, fps: 30 };
    const c = buildShaderContract(makeInstance("warp"), sparse, 800, 600, makeSession());
    for (let bank = 0; bank < 8; bank++) {
      for (let lane = 0; lane < 4; lane++) {
        expect(c.qBanks[bank][lane]).toBe(0);
      }
    }
  });

  it("computes landscape aspect (wider than tall)", () => {
    const c = buildShaderContract(makeInstance("warp"), baseFrame, 1600, 900, makeSession());
    expect(c.aspect[0]).toBe(1);
    expect(c.aspect[1]).toBeCloseTo(900 / 1600, 10);
    expect(c.texsize).toEqual([1600, 900, 1 / 1600, 1 / 900]);
  });

  it("populates mip_x/y/avg from log2 of viewport dimensions per projectM", () => {
    // projectM MilkdropShader.cpp:
    //   mipX = logf(viewportSizeX) / logf(2.0f)
    //   mipY = logf(viewportSizeY) / logf(2.0f)
    //   mipAvg = 0.5f * (mipX + mipY)
    const c = buildShaderContract(makeInstance("warp"), baseFrame, 1024, 512, makeSession());
    expect(c.mipX).toBeCloseTo(10, 10); // log2(1024) = 10
    expect(c.mipY).toBeCloseTo(9, 10);  // log2(512) = 9
    expect(c.mipAvg).toBeCloseTo(9.5, 10);
  });

  it("populates fast roam frequencies with projectM phase offsets (0.329, 1.293, 5.070, 20.051)", () => {
    // projectM MilkdropShader.cpp _c8 / _c9:
    //   {cos/sin(t * 0.329f + 1.2f), cos/sin(t * 1.293f + 3.9f),
    //    cos/sin(t * 5.070f + 2.5f), cos/sin(t * 20.051f + 5.4f)}
    const c = buildShaderContract(makeInstance("warp"), { ...baseFrame, time: 0 }, 800, 600, makeSession());
    expect(c.roamCos[0]).toBeCloseTo(0.5 + 0.5 * Math.cos(1.2), 10);
    expect(c.roamCos[1]).toBeCloseTo(0.5 + 0.5 * Math.cos(3.9), 10);
    expect(c.roamCos[3]).toBeCloseTo(0.5 + 0.5 * Math.cos(5.4), 10);
    expect(c.roamSin[2]).toBeCloseTo(0.5 + 0.5 * Math.sin(2.5), 10);
  });

  it("populates slow roam frequencies with projectM phase offsets (0.005, 0.0085, 0.0133, 0.0217)", () => {
    const c = buildShaderContract(makeInstance("warp"), { ...baseFrame, time: 0 }, 800, 600, makeSession());
    expect(c.slowRoamCos[0]).toBeCloseTo(0.5 + 0.5 * Math.cos(2.7), 10);
    expect(c.slowRoamCos[3]).toBeCloseTo(0.5 + 0.5 * Math.cos(3.8), 10);
    expect(c.slowRoamSin[1]).toBeCloseTo(0.5 + 0.5 * Math.sin(5.3), 10);
  });

  it("populates all 24 rotation matrices — six banks of four 4x4 mats", () => {
    // projectM MilkdropShader.cpp uploads:
    //   rot_s1..s4 (0..3), rot_d1..d4 (4..7), rot_f1..f4 (8..11),
    //   rot_vf1..vf4 (12..15), rot_uf1..uf4 (16..19), rot_rand1..rand4 (20..23).
    const c = buildShaderContract(makeInstance("warp"), baseFrame, 800, 600, makeSession());
    expect(c.rotStatic).toHaveLength(4);
    expect(c.rotDynamic).toHaveLength(4);
    expect(c.rotFast).toHaveLength(4);
    expect(c.rotVeryFast).toHaveLength(4);
    expect(c.rotUltraFast).toHaveLength(4);
    expect(c.rotPerFrame).toHaveLength(4);
    for (const bank of [c.rotStatic, c.rotDynamic, c.rotFast, c.rotVeryFast, c.rotUltraFast, c.rotPerFrame]) {
      for (const m of bank) {
        expect(m).toBeInstanceOf(Float32Array);
        expect(m.length).toBe(16);
      }
    }
  });

  it("warp and comp instances carry distinct randPreset values per projectM per-shader construction", () => {
    // projectM constructs two `MilkdropShader` objects (warp + comp);
    // each draws its own `floatRand()` values in its constructor, so
    // rand_preset differs between them.
    const rng = makeMulberry32(0xdead);
    const warp = new MilkShaderInstance("warp", rng);
    const comp = new MilkShaderInstance("comp", rng);
    const s = makeSession();
    const warpC = buildShaderContract(warp, baseFrame, 800, 600, s);
    const compC = buildShaderContract(comp, baseFrame, 800, 600, s);
    expect(warpC.randPreset).not.toEqual(compC.randPreset);
  });

  it("randFrame is drawn fresh per contract build (per invocation, not per frame)", () => {
    // projectM's LoadVariables draws four floatRand() calls at EACH
    // shader invocation — so a second call with the same shader
    // returns a different rand_frame even within one frame.
    const instance = makeInstance("warp");
    const s = makeSession(42);
    const a = buildShaderContract(instance, baseFrame, 800, 600, s);
    const b = buildShaderContract(instance, baseFrame, 800, 600, s);
    expect(a.randFrame).not.toEqual(b.randFrame);
  });

  it("carries the shader kind ('warp' or 'comp') identifying the source instance", () => {
    const cW = buildShaderContract(makeInstance("warp"), baseFrame, 800, 600, makeSession());
    const cC = buildShaderContract(makeInstance("comp"), baseFrame, 800, 600, makeSession());
    expect(cW.kind).toBe("warp");
    expect(cC.kind).toBe("comp");
  });

  it("progress is a number (0 pending an upstream playhead source)", () => {
    // projectM uploads renderContext.progress; PHOSPHENE stores 0 until
    // upstream data supplies a real value. Never null.
    const c = buildShaderContract(makeInstance("warp"), baseFrame, 800, 600, makeSession());
    expect(typeof c.progress).toBe("number");
    expect(c.progress).toBe(0);
  });
});

describe("getBlurValues — projectM BlurTexture.cpp GetSafeBlurMinMaxValues", () => {
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
    expect(blurMins[1]).toBe(0.3);
    expect(blurMins[2]).toBe(0.3);
  });

  it("clamps level 2 max down to level 1 max when level 2 max is above it", () => {
    const { blurMaxs } = getBlurValues({
      b1n: 0, b1x: 0.5, b2n: 0, b2x: 0.9, b3n: 0, b3x: 0.8,
    });
    expect(blurMaxs[1]).toBe(0.5);
    expect(blurMaxs[2]).toBe(0.5);
  });

  it("collapses a narrow range to a single point per the projectM source oddity", () => {
    // projectM BlurTexture.cpp `GetSafeBlurMinMaxValues` uses the same
    // `avg - fMinDist * 0.5` expression on BOTH sides when the range is
    // too narrow. PHOSPHENE reproduces the source verbatim.
    const { blurMins, blurMaxs } = getBlurValues({
      b1n: 0.5, b1x: 0.55, b2n: 0.5, b2x: 0.6, b3n: 0, b3x: 1,
    });
    expect(blurMins[0]).toBeCloseTo(0.525 - 0.05, 10);
    expect(blurMaxs[0]).toBeCloseTo(0.525 - 0.05, 10);
  });
});

describe("buildShaderContract — blur ranges routed through getBlurValues", () => {
  it("uses getBlurValues clamping, not raw b1n/b1x", () => {
    const c = buildShaderContract(makeInstance("warp"), {
      ...baseFrame,
      b1n: 0, b1x: 0.5, b2n: 0, b2x: 0.9, b3n: 0, b3x: 1,
    }, 800, 600, makeSession());
    expect(c.blur2Max).toBe(0.5);
  });

  it("returns level defaults (0, 1) for empty inputs", () => {
    const c = buildShaderContract(makeInstance("warp"), baseFrame, 800, 600, makeSession());
    expect(c.blur1Min).toBe(0);
    expect(c.blur1Max).toBe(1);
    expect(c.blur2Min).toBe(0);
    expect(c.blur2Max).toBe(1);
    expect(c.blur3Min).toBe(0);
    expect(c.blur3Max).toBe(1);
  });
});
