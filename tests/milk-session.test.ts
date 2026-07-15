// Direct semantic tests for MilkSession — the session-lifetime owner
// of prev-preset lifecycle, blend state, and per-frame rand_frame.
// Every assertion cites butterchurn's Renderer at
// node_modules/butterchurn/lib/butterchurn.js or the derivation at
// docs/milkdrop-execution-model.md §0-§1B.

import { describe, expect, it } from "vitest";
import { MilkSession } from "../src/gpu/milk-session";
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
  // Butterchurn's Renderer constructs prevPreset and prevRunner to
  // the blankPreset (rendering_renderer.js:164-179). PHOSPHENE keeps
  // them null to make the pre-first-preset state explicit.
  it("starts with null runners, no blending, and prevPresetWaveMode = 0", () => {
    const s = new MilkSession();
    expect(s.currentRunner).toBeNull();
    expect(s.prevRunner).toBeNull();
    expect(s.blending).toBe(false);
    expect(s.blendProgress).toBe(0);
    expect(s.prevPresetWaveMode).toBe(0);
  });
});

describe("MilkSession — preset load and old_wave_mode capture", () => {
  // Butterchurn rendering_renderer.js:191-194:
  //   this.prevPresetEquationRunner = this.presetEquationRunner;
  //   this.prevPreset = this.preset;
  //   this.preset = preset;
  //   this.preset.baseVals.old_wave_mode = this.prevPreset.baseVals.wave_mode;
  //
  // MilkSession splits that into beginPresetLoad() (which captures the
  // old wave_mode and records the runner swap) and installRunner()
  // (which the caller invokes after constructing the new runner with
  // the injected baseValues).
  it("captures prev wave_mode into prevPresetWaveMode on subsequent loads", () => {
    const s = new MilkSession();
    const firstRunner = new MilkPresetRunner(
      emptyDef({ baseValues: { wave_mode: 5 } }),
      globals(), makeMulberry32(1),
    );
    s.beginPresetLoad(0);
    s.installRunner(firstRunner);
    expect(s.currentRunner).toBe(firstRunner);
    expect(s.prevRunner).toBeNull();
    // wave_mode of the current preset = 5. Next load should surface
    // that as prevPresetWaveMode.
    s.beginPresetLoad(0);
    expect(s.prevPresetWaveMode).toBe(5);
    expect(s.prevRunner).toBe(firstRunner);
  });

  it("keeps prevPresetWaveMode at 0 on the first load (no prior preset)", () => {
    const s = new MilkSession();
    s.beginPresetLoad(0);
    // No prior runner exists — value stays at the initial 0.
    expect(s.prevPresetWaveMode).toBe(0);
  });
});

describe("MilkSession — blend timing", () => {
  it("starts blending only when a previous preset exists AND blendTime > 0", () => {
    const s = new MilkSession();
    // First load — no previous. Never blends.
    s.beginPresetLoad(2);
    expect(s.blending).toBe(false);
    // Install a runner then load another with blend.
    s.installRunner(new MilkPresetRunner(emptyDef(), globals(), makeMulberry32(1)));
    s.beginPresetLoad(2);
    expect(s.blending).toBe(true);
    expect(s.blendDuration).toBe(2);
    expect(s.blendProgress).toBe(0);
  });

  it("advances blendProgress toward 1 across beginFrame calls and clamps when done", () => {
    const s = new MilkSession();
    s.installRunner(new MilkPresetRunner(emptyDef(), globals(), makeMulberry32(1)));
    s.beginPresetLoad(2); // 2-second blend
    // Session time is currently 0; blendStartTime = 0.
    s.beginFrame(0.5); // time = 0.5, progress = 0.25
    expect(s.blendProgress).toBeCloseTo(0.25, 10);
    expect(s.blending).toBe(true);
    s.beginFrame(1.0); // time = 1.5, progress = 0.75
    expect(s.blendProgress).toBeCloseTo(0.75, 10);
    s.beginFrame(1.0); // time = 2.5, progress = 1.25 → clamped to 1, blending off
    expect(s.blending).toBe(false);
    expect(s.blendProgress).toBe(1);
  });
});

describe("MilkSession — nextRandFrame draws from the caller's RNG", () => {
  // Butterchurn calls Math.random() × 4 at each shader draw call
  // (butterchurn.js:3836, :4532). PHOSPHENE draws once per session
  // frame using the caller's committed RNG.
  it("returns four fresh draws from the RNG in call order", () => {
    const s = new MilkSession();
    const rng = makeMulberry32(0x5eed1e55);
    const oracle = makeMulberry32(0x5eed1e55);
    const expected: [number, number, number, number] = [
      oracle.next(), oracle.next(), oracle.next(), oracle.next(),
    ];
    expect(s.nextRandFrame(rng)).toEqual(expected);
  });

  it("consumes four RNG draws per call (successive calls advance the stream)", () => {
    const s = new MilkSession();
    const rng = makeMulberry32(0x5eed1e55);
    const oracle = makeMulberry32(0x5eed1e55);
    const first: [number, number, number, number] = [
      oracle.next(), oracle.next(), oracle.next(), oracle.next(),
    ];
    const second: [number, number, number, number] = [
      oracle.next(), oracle.next(), oracle.next(), oracle.next(),
    ];
    expect(s.nextRandFrame(rng)).toEqual(first);
    expect(s.nextRandFrame(rng)).toEqual(second);
  });
});

describe("MilkSession — beginFrame timing", () => {
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
