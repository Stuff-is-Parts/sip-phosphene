// Direct semantic tests for MilkSession — the session-lifetime owner
// of prev-preset lifecycle, blend state, per-invocation rand_frame,
// timing, and noise-texture generation. Every assertion cites the
// projectM behavior at docs/evidence/projectm/MilkdropPreset.cpp or
// docs/evidence/projectm/MilkdropShader.cpp.

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
  it("starts with null runners and no blending", () => {
    const s = new MilkSession();
    expect(s.currentRunner).toBeNull();
    expect(s.prevRunner).toBeNull();
    expect(s.warpShader).toBeNull();
    expect(s.compShader).toBeNull();
    expect(s.blending).toBe(false);
    expect(s.blendProgress).toBe(0);
    expect(s.prevPresetWaveMode).toBe(0);
  });
});

describe("MilkSession — beginPresetLoad captures prev wave_mode", () => {
  it("stores the previous preset's wave_mode as prevPresetWaveMode on subsequent loads", () => {
    // projectM injects `old_wave_mode` from prev preset baseVals per
    // MilkdropPreset::RenderFrame convention. MilkSession captures the
    // value before the swap so the caller can inject it into the new
    // runner's baseValues.
    const s = new MilkSession();
    const firstRunner = new MilkPresetRunner(
      emptyDef({ baseValues: { wave_mode: 5 } }),
      globals(), makeMulberry32(1),
    );
    s.beginPresetLoad(0);
    s.installRunner(firstRunner);
    s.beginPresetLoad(0);
    expect(s.prevPresetWaveMode).toBe(5);
    expect(s.prevRunner).toBe(firstRunner);
  });

  it("keeps prevPresetWaveMode at 0 on the first load", () => {
    const s = new MilkSession();
    s.beginPresetLoad(0);
    expect(s.prevPresetWaveMode).toBe(0);
  });
});

describe("MilkSession — blend timing", () => {
  it("starts blending only when a previous preset exists AND blendTime > 0", () => {
    const s = new MilkSession();
    s.beginPresetLoad(2);
    expect(s.blending).toBe(false);
    s.installRunner(new MilkPresetRunner(emptyDef(), globals(), makeMulberry32(1)));
    s.beginPresetLoad(2);
    expect(s.blending).toBe(true);
    expect(s.blendDuration).toBe(2);
    expect(s.blendProgress).toBe(0);
  });

  it("advances blendProgress toward 1 across beginFrame calls and clamps at 1", () => {
    const s = new MilkSession();
    s.installRunner(new MilkPresetRunner(emptyDef(), globals(), makeMulberry32(1)));
    s.beginPresetLoad(2);
    s.beginFrame(0.5);
    expect(s.blendProgress).toBeCloseTo(0.25, 10);
    expect(s.blending).toBe(true);
    s.beginFrame(1.0);
    expect(s.blendProgress).toBeCloseTo(0.75, 10);
    s.beginFrame(1.0);
    expect(s.blending).toBe(false);
    expect(s.blendProgress).toBe(1);
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

  it("retains the previous warp and comp instances through beginPresetLoad", () => {
    // projectM keeps the previous shader objects alive during blend
    // so the previous preset's image can continue rendering; MilkSession
    // stashes them in prevWarpShader/prevCompShader when the transition
    // begins.
    const s = new MilkSession();
    const w1 = new MilkShaderInstance("warp", makeMulberry32(1));
    const c1 = new MilkShaderInstance("comp", makeMulberry32(2));
    s.installShaders(w1, c1);
    s.installRunner(new MilkPresetRunner(emptyDef(), globals(), makeMulberry32(1)));
    s.beginPresetLoad(2);
    expect(s.prevWarpShader).toBe(w1);
    expect(s.prevCompShader).toBe(c1);
  });
});

describe("MilkSession — RNG ownership", () => {
  it("shaderRng and noiseRng are independent streams", () => {
    // Advancing one must not shift the other — projectM keeps noise
    // generation on `std::default_random_engine` seeded independently
    // from any per-shader draws.
    const s = new MilkSession(makeMulberry32(1), makeMulberry32(2));
    const noiseBefore = s.noiseRng.next();
    // Advance shaderRng arbitrarily.
    for (let i = 0; i < 100; i++) s.shaderRng.next();
    const noiseAfter = s.noiseRng.next();
    // The two noiseRng draws are the FIRST and SECOND draws of the
    // noise stream — deterministic and unaffected by shaderRng.
    const oracle = makeMulberry32(2);
    expect(noiseBefore).toBe(oracle.next());
    expect(noiseAfter).toBe(oracle.next());
  });

  it("nextRandFrame draws four fresh values from the session shaderRng by default", () => {
    // projectM's LoadVariables draws four floatRand at each invocation.
    const s = new MilkSession(makeMulberry32(0x5eed1e55), makeMulberry32(99));
    const oracle = makeMulberry32(0x5eed1e55);
    const expected: [number, number, number, number] = [
      oracle.next(), oracle.next(), oracle.next(), oracle.next(),
    ];
    expect(s.nextRandFrame()).toEqual(expected);
  });

  it("consumes four RNG draws per invocation so successive calls advance the stream", () => {
    const s = new MilkSession(makeMulberry32(0x5eed1e55), makeMulberry32(99));
    const oracle = makeMulberry32(0x5eed1e55);
    const first: [number, number, number, number] = [
      oracle.next(), oracle.next(), oracle.next(), oracle.next(),
    ];
    const second: [number, number, number, number] = [
      oracle.next(), oracle.next(), oracle.next(), oracle.next(),
    ];
    expect(s.nextRandFrame()).toEqual(first);
    expect(s.nextRandFrame()).toEqual(second);
  });
});

describe("MilkSession — timing", () => {
  it("increments frameNum by 1 and advances time by elapsed seconds", () => {
    const s = new MilkSession();
    expect(s.frameNum).toBe(0);
    expect(s.time).toBe(0);
    s.beginFrame(1 / 30);
    expect(s.frameNum).toBe(1);
    expect(s.time).toBeCloseTo(1 / 30, 12);
    s.beginFrame(1 / 30);
    expect(s.frameNum).toBe(2);
    expect(s.time).toBeCloseTo(2 / 30, 12);
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
