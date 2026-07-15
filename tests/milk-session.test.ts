// Direct semantic tests for MilkSession — the session-lifetime owner
// of preset-transition state, per-invocation shader RNG, and noise
// texture generation. Every assertion cites projectM behavior at
// docs/evidence/projectm/MilkdropPreset.cpp or MilkdropShader.cpp.

import { describe, expect, it } from "vitest";
import { MilkSession } from "../src/gpu/milk-session";
import { MilkShaderInstance } from "../src/gpu/milk-shader-instance";
import {
  MilkPresetRunner, makeMulberry32, type MilkPresetDef,
} from "../src/core/milk-runner";

const globals = () => ({
  frame: 0, time: 0, fps: 30,
  bass: 0, bass_att: 1, mid: 0, mid_att: 1, treb: 0, treb_att: 1,
  meshx: 48, meshy: 36,
  aspectx: 1, aspecty: 1,
  pixelsx: 800, pixelsy: 600,
});
const emptyDef = (over: Partial<MilkPresetDef> = {}): MilkPresetDef => ({
  baseValues: {}, initEel: "", frameEel: "", pixelEel: "",
  waves: [], shapes: [], ...over,
});

describe("MilkSession — initial state", () => {
  it("starts with null runners and no shader instances", () => {
    const s = new MilkSession();
    expect(s.currentRunner).toBeNull();
    expect(s.warpShader).toBeNull();
    expect(s.compShader).toBeNull();
    expect(s.prevPresetWaveMode).toBe(0);
  });
});

describe("MilkSession — beginPresetLoad captures prev wave_mode", () => {
  it("stores the previous preset's wave_mode as prevPresetWaveMode on subsequent loads", () => {
    const s = new MilkSession();
    const firstRunner = new MilkPresetRunner(
      emptyDef({ baseValues: { wave_mode: 5 } }),
      globals(), makeMulberry32(1),
    );
    s.beginPresetLoad(0);
    s.installRunner(firstRunner);
    s.beginPresetLoad(0);
    expect(s.prevPresetWaveMode).toBe(5);
  });

  it("keeps prevPresetWaveMode at 0 on the first load", () => {
    const s = new MilkSession();
    s.beginPresetLoad(0);
    expect(s.prevPresetWaveMode).toBe(0);
  });
});

describe("MilkSession — blending refuses when unimplemented", () => {
  it("throws when blendTime > 0 and a current preset exists", () => {
    // projectM runs the previous preset's equation code each frame
    // during blend and mixes frame state via mixFrameEquations.
    // PHOSPHENE has not implemented that yet, so a nonzero blendTime
    // with a prior preset installed must refuse rather than silently
    // becoming a zero-length transition.
    const s = new MilkSession();
    s.installRunner(new MilkPresetRunner(emptyDef(), globals(), makeMulberry32(1)));
    expect(() => s.beginPresetLoad(2)).toThrow(/blending is not implemented/i);
  });

  it("accepts blendTime > 0 on the first load (no prior preset to blend from)", () => {
    const s = new MilkSession();
    expect(() => s.beginPresetLoad(2)).not.toThrow();
  });

  it("accepts blendTime = 0 always", () => {
    const s = new MilkSession();
    s.installRunner(new MilkPresetRunner(emptyDef(), globals(), makeMulberry32(1)));
    expect(() => s.beginPresetLoad(0)).not.toThrow();
  });
});

describe("MilkSession — shader-instance ownership", () => {
  it("installShaders sets both warp and comp instances", () => {
    const s = new MilkSession();
    const warp = new MilkShaderInstance("warp", makeMulberry32(1));
    const comp = new MilkShaderInstance("comp", makeMulberry32(2));
    s.installShaders(warp, comp);
    expect(s.warpShader).toBe(warp);
    expect(s.compShader).toBe(comp);
  });
});

describe("MilkSession — RNG ownership", () => {
  it("shaderRng and noiseRng are independent streams", () => {
    // projectM keeps noise generation on `std::default_random_engine`
    // seeded from the system clock, independent of any per-shader
    // draws. Verify that advancing one stream does not affect the
    // other.
    const s = new MilkSession(makeMulberry32(1), makeMulberry32(2));
    const noiseBefore = s.noiseRng.next();
    for (let i = 0; i < 100; i++) s.shaderRng.next();
    const noiseAfter = s.noiseRng.next();
    const oracle = makeMulberry32(2);
    expect(noiseBefore).toBe(oracle.next());
    expect(noiseAfter).toBe(oracle.next());
  });
});

describe("MilkSession — noise-texture cache", () => {
  it("generates each shader-visible noise texture on demand from noiseRng", () => {
    const s = new MilkSession(makeMulberry32(1), makeMulberry32(2));
    const lq = s.noiseFor("noise_lq_lite");
    expect(lq).toBeInstanceOf(Uint8Array);
    expect(lq.length).toBe(32 * 32 * 4);
  });

  it("returns the same array on subsequent calls (cached)", () => {
    const s = new MilkSession(makeMulberry32(1), makeMulberry32(2));
    const a = s.noiseFor("noise_lq_lite");
    const b = s.noiseFor("noise_lq_lite");
    expect(a).toBe(b);
  });
});
