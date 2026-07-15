// Direct semantic tests for MilkPresetRunner against butterchurn's
// PresetEquationRunner source. Every assertion cites the specific
// evidence line at docs/evidence/butterchurn/equations_presetEquationRunner.js
// so a reader can re-derive each rule without leaving the test.
//
// The runner is the state machine every milk-* graph stage reads. If a
// rule here regresses, PHOSPHENE's preset semantics diverge from the
// authoritative source and the failing test names the specific rule
// and its source line.

import { describe, expect, it } from "vitest";
import { MilkPresetRunner, makeMulberry32, type MilkPresetDef } from "../src/core/milk-runner";

// Minimal globals that satisfy the runner's expected inputs. Butterchurn
// packs the same keys into mdVSBase at presetEquationRunner.js:68-85.
const globals = () => ({
  frame: 0, time: 0, fps: 30,
  bass: 0, bass_att: 1, mid: 0, mid_att: 1, treb: 0, treb_att: 1,
  meshx: 48, meshy: 36,
  aspectx: 1, aspecty: 1,
  pixelsx: 800, pixelsy: 600,
});

// Every test constructs a deterministic runner using the same seed the
// pipeline commits (0x5eed1e55), so draws are reproducible across runs.
const SEED = 0x5eed1e55;
const rng = () => makeMulberry32(SEED);

const emptyDef = (over: Partial<MilkPresetDef> = {}): MilkPresetDef => ({
  baseValues: {}, initEel: "", frameEel: "", pixelEel: "",
  waves: [], shapes: [], ...over,
});

describe("MilkPresetRunner — seeded random draw order", () => {
  // Butterchurn PresetEquationRunner.initializeEquations at
  // equations_presetEquationRunner.js:88-89 fills rand_start[0..3] then
  // rand_preset[0..3] from Math.random in that order, BEFORE running
  // init_eqs at :91. Both arrays hold four draws each and are consumed
  // from the same seeded stream, so a caller replaying the seed
  // reproduces every downstream shader-uniform and hue-base seed.
  it("consumes 8 draws for rand_start[0..3] then rand_preset[0..3] before init_eqs runs", () => {
    // Golden values: the first 8 outputs of makeMulberry32(0x5eed1e55).
    const oracle = makeMulberry32(SEED);
    const expected = [
      oracle.next(), oracle.next(), oracle.next(), oracle.next(),
      oracle.next(), oracle.next(), oracle.next(), oracle.next(),
    ];

    const runner = new MilkPresetRunner(emptyDef(), globals(), rng());
    expect(runner.randStart).toEqual(expected.slice(0, 4));
    expect(runner.randPreset).toEqual(expected.slice(4, 8));
  });

  it("draws rand_start + rand_preset BEFORE init_eqs (proven by rand() inside init_eqs picking up the 9th draw)", () => {
    // If the runner consumed rand_start (4) + rand_preset (4) before
    // init_eqs, then a `q1 = rand(1);` in init_eqs picks the 9th draw
    // from the same seeded stream.
    const oracle = makeMulberry32(SEED);
    for (let i = 0; i < 8; i++) oracle.next(); // skip randStart + randPreset
    const expectedNinth = oracle.next(); // rand(1) in expr.ts returns rng() when x<1 (see expr.ts FUNCS.rand)

    const runner = new MilkPresetRunner(
      emptyDef({ initEel: "q1 = rand(1);" }),
      globals(), rng(),
    );
    // The init-time frame_eqs also runs (butterchurn line 98) — that's
    // fine because it runs with empty frameEel here and consumes no draws.
    expect(runner.mdVSQAfterFrame.q1).toBe(expectedNinth);
  });
});

describe("MilkPresetRunner — q-var lifecycle", () => {
  // Butterchurn presetEquationRunner.js:93 (mdVSQInit = pick(after-init, qs))
  // and :199 (runFrameEquations spreads mdVSQInit into every frame's env).
  // The rule: q1..q32 reset to the init snapshot every frame; per-frame
  // writes to q1..q32 are visible during the frame but do NOT feed back
  // into the next frame's q.
  it("q1..q32 reset to the init snapshot at the start of every frame", () => {
    const runner = new MilkPresetRunner(
      emptyDef({ initEel: "q1 = 5;", frameEel: "q1 = q1 + 1;" }),
      globals(), rng(),
    );
    runner.runFrameEquations(globals());
    expect(runner.mdVSFrame.q1).toBe(6); // 5 + 1
    runner.runFrameEquations(globals());
    // q1 resets to 5, then + 1 = 6 — NOT 7. The rule is source-cited at
    // presetEquationRunner.js:199 where mdVSQInit re-merges every frame.
    expect(runner.mdVSFrame.q1).toBe(6);
  });
});

describe("MilkPresetRunner — user variable lifecycle", () => {
  // Butterchurn presetEquationRunner.js:100 sets mdVSUserKeys once at
  // preset load from the keys present after init_eqs + init-time
  // frame_eqs. Only these keys persist across frames — variables first
  // assigned in a LATER frame land on the ephemeral env but are dropped
  // from mdVSFrameMap when it re-picks by mdVSUserKeys at :201.
  it("persists user variables first assigned in init_eqs", () => {
    const runner = new MilkPresetRunner(
      emptyDef({
        initEel: "counter = 10;",
        frameEel: "counter = counter + 1;",
      }),
      globals(), rng(),
    );
    // The init-time frame_eqs run at presetEquationRunner.js:98 fires
    // before the first explicit runFrameEquations call, so counter
    // enters frame 0 at 11 (init set 10, init-time frame incremented
    // once), and each explicit call adds one more.
    runner.runFrameEquations(globals());
    expect(runner.mdVSFrame.counter).toBe(12);
    runner.runFrameEquations(globals());
    expect(runner.mdVSFrame.counter).toBe(13);
    runner.runFrameEquations(globals());
    expect(runner.mdVSFrame.counter).toBe(14);
  });

  it("persists user variables first assigned in the init-time frame_eqs run", () => {
    // The init-time frame_eqs run is source-cited at
    // presetEquationRunner.js:98. Any key first written there becomes
    // part of mdVSUserKeys and persists.
    const runner = new MilkPresetRunner(
      emptyDef({ initEel: "", frameEel: "tally = tally + 1;" }),
      globals(), rng(),
    );
    // Frame 0 is the first callable frame. tally started at undefined
    // in the init-time run and became 0 + 1 = 1 (undefined + 1 = NaN in
    // pure JS but expr.ts reads unknown ident as 0 by design). After the
    // init-time run tally = 1; that becomes the persisted starting value.
    runner.runFrameEquations(globals());
    expect(runner.mdVSFrame.tally).toBe(2); // init-time run set tally=1; frame 0 adds 1
    runner.runFrameEquations(globals());
    expect(runner.mdVSFrame.tally).toBe(3);
  });

  it("does not persist variables first assigned after the init-time frame_eqs run", () => {
    // Source: presetEquationRunner.js:100 mdVSUserKeys is fixed at init.
    // A key that becomes assigned only in a specific later-frame branch
    // is not in mdVSUserKeys, so mdVSFrameMap at :201 drops it after
    // that frame ends. The rule is subtle — the current runner has one
    // path where mdVSFrameMap re-picks by mdVSUserKeys, and that's the
    // only persistence surface.
    const runner = new MilkPresetRunner(
      emptyDef({
        initEel: "",
        // frame_eqs assigns 'latecomer' only when time > 100 — that
        // branch never fires during the init-time run. So 'latecomer'
        // is not in mdVSUserKeys.
        frameEel: "if(above(time, 100), latecomer = 42, 0);",
      }),
      globals(), rng(),
    );
    // Force the assignment during a later frame.
    runner.runFrameEquations({ ...globals(), time: 200 });
    expect(runner.mdVSFrame.latecomer).toBe(42);
    // Next frame with time < 100 should NOT still see latecomer =42
    // because latecomer was not in mdVSUserKeys → dropped from
    // mdVSFrameMap → re-reads as 0 in the next frame.
    runner.runFrameEquations({ ...globals(), time: 50 });
    expect(runner.mdVSFrame.latecomer ?? 0).toBe(0);
  });
});

describe("MilkPresetRunner — reg-var lifecycle", () => {
  // Butterchurn presetEquationRunner.js:105 picks REGS from mdVSFrame
  // after init-time frame_eqs (and again after each per-pixel run by
  // the caller); the CALLER is responsible for supplying reg values
  // back through runFrameEquations' globalVars parameter (:199 spreads
  // globalVars into every frame's env, not a runner-owned mdVSRegs).
  // The runner-level contract is therefore two-part: init-time regs
  // are exposed on runner.mdVSRegs, and if the caller supplies regs in
  // globals, they show up in the per-frame env.
  it("exposes init-time reg values on runner.mdVSRegs", () => {
    const runner = new MilkPresetRunner(
      emptyDef({ initEel: "reg05 = 7;", frameEel: "reg05 = reg05 + 2;" }),
      globals(), rng(),
    );
    // init_eqs sets reg05 = 7. Init-time frame_eqs reads reg05 = 7 and
    // writes reg05 = 9. mdVSRegs after init is picked from mdVSFrame
    // (presetEquationRunner.js:105), so reg05 lands at 9.
    expect(runner.mdVSRegs.reg05).toBe(9);
  });

  it("consumes reg values supplied by the caller through globals", () => {
    const runner = new MilkPresetRunner(
      emptyDef({ frameEel: "reg07 = reg07 + 3;" }),
      globals(), rng(),
    );
    // Caller supplies reg07=100 via globals; runFrameEquations spreads
    // globals into the env; frame writes reg07 = 100 + 3 = 103.
    runner.runFrameEquations({ ...globals(), reg07: 100 });
    expect(runner.mdVSFrame.reg07).toBe(103);
  });
});

describe("MilkPresetRunner — base value reload per frame", () => {
  // Butterchurn presetEquationRunner.js:199 uses `this.mdVS` (which was
  // constructed once at init from baseVals + mdVSBase and never mutated
  // thereafter). Every frame's env includes `this.mdVS`. So per-frame
  // writes to base-value keys (like decay, zoom, gammaadj) DO NOT
  // accumulate — the base value is re-supplied fresh each frame.
  it("re-supplies base values each frame; per-frame writes do not accumulate", () => {
    const runner = new MilkPresetRunner(
      emptyDef({ frameEel: "decay = decay + 0.01;" }),
      globals(), rng(),
    );
    // decay defaults to 0.98 (see MILK_BASE_DEFAULTS). Each frame
    // starts at 0.98 and writes 0.98 + 0.01 = 0.99.
    runner.runFrameEquations(globals());
    expect(runner.mdVSFrame.decay).toBeCloseTo(0.99, 10);
    runner.runFrameEquations(globals());
    expect(runner.mdVSFrame.decay).toBeCloseTo(0.99, 10); // NOT 1.00
    runner.runFrameEquations(globals());
    expect(runner.mdVSFrame.decay).toBeCloseTo(0.99, 10); // NOT 1.01
  });
});

describe("MilkPresetRunner — runPixelEquations warp UV math", () => {
  // Butterchurn rendering_renderer.js runPixelEquations mirrors the
  // projectM PerPixelMesh.cpp warpFactors + PresetWarpVertexShaderGlsl330
  // vertex math. When the preset carries no per_pixel code and default
  // baseVals (zoom=1, warp=0, rot=0, cx=cy=0.5, sx=sy=1, dx=dy=0), the
  // UV at each mesh vertex reduces to a simple identity-like map from
  // NDC-space (x, y) in [-1, 1] to UV-space (u, v) in [0, 1]:
  //   u = x * 0.5 * aspectx + 0.5
  //   v = -y * 0.5 * aspecty + 0.5
  // (aspectx = aspecty = 1 on a square viewport). This is the source
  // math at src/core/milk-runner.ts runPixelEquations lines 373-437.
  it("produces the identity warp when warp=0, zoom=1, rot=0 (source-cited defaults suppressed)", () => {
    // MILK_BASE_DEFAULTS carries warp=1 as the default (evidence at
    // src/core/milk-runner.ts and butterchurn baseValsDefaults). Warp=1
    // adds the four warpf oscillator offsets, so the "identity" case
    // requires an explicit warp=0 baseValues entry to isolate.
    const runner = new MilkPresetRunner(
      emptyDef({ baseValues: { warp: 0 } }), globals(), rng(),
    );
    const gridX = 4;
    const gridY = 4;
    const uvs = new Float32Array((gridX + 1) * (gridY + 1) * 2);
    // Aspect = 1 on the equation-facing input (butterchurn renderer.js
    // passes render aspect, not the inverse; on a square viewport both
    // are 1). Base mdVSFrame values come from the runner constructor
    // after the init-time frame_eqs run — all defaults.
    runner.runPixelEquations(runner.mdVSFrame, gridX, gridY, 1, 1, uvs);
    // Vertex (0, 0) → NDC (-1, -1) → UV (0, 1).
    expect(uvs[0]).toBeCloseTo(0, 6);
    expect(uvs[1]).toBeCloseTo(1, 6);
    // Vertex (gridX, gridY) → NDC (1, 1) → UV (1, 0).
    const last = (gridX + 1) * (gridY + 1) - 1;
    expect(uvs[last * 2]).toBeCloseTo(1, 6);
    expect(uvs[last * 2 + 1]).toBeCloseTo(0, 6);
    // Center vertex → NDC (0, 0) → UV (0.5, 0.5).
    const center = ((gridY / 2) * (gridX + 1) + gridX / 2);
    expect(uvs[center * 2]).toBeCloseTo(0.5, 6);
    expect(uvs[center * 2 + 1]).toBeCloseTo(0.5, 6);
  });

  it("scales UV toward center when zoom > 1", () => {
    // zoom acts as an inverse-scale on the UV mapping: the warp reads
    // texel(u, v) where u = x * 0.5 * aspectx / zoom + 0.5 for the
    // identity per-pixel case. zoom=2 → half the UV extent → the
    // outermost vertex maps to UV 0.25 or 0.75, not 0 or 1.
    const runner = new MilkPresetRunner(
      emptyDef({ baseValues: { zoom: 2, warp: 0 } }), globals(), rng(),
    );
    const gridX = 4;
    const gridY = 4;
    const uvs = new Float32Array((gridX + 1) * (gridY + 1) * 2);
    runner.runPixelEquations(runner.mdVSFrame, gridX, gridY, 1, 1, uvs);
    // Vertex (0, 0) → NDC (-1, -1) → u = -1 * 0.5 / 2 + 0.5 = 0.25.
    expect(uvs[0]).toBeCloseTo(0.25, 6);
    // Vertex (gridX, gridY) → NDC (1, 1) → u = 1 * 0.5 / 2 + 0.5 = 0.75.
    const last = (gridX + 1) * (gridY + 1) - 1;
    expect(uvs[last * 2]).toBeCloseTo(0.75, 6);
  });
});

describe("MilkPresetRunner — renderer-injected old_wave_mode", () => {
  // Butterchurn rendering_renderer.js:194 injects into baseVals BEFORE
  // constructing the PresetEquationRunner:
  //   this.preset.baseVals.old_wave_mode = this.prevPreset.baseVals.wave_mode;
  // So mdVSFrame at every frame carries an `old_wave_mode` value that
  // came from the previous preset. Presets like the basic-waveform
  // blender at rendering_waves_basicWaveform.js:87 read
  // `mdVSFrame.old_wave_mode` — a preset that reads this key when it
  // was never assigned by init or per-frame relies on the renderer's
  // injection. The runner must accept a baseValues.old_wave_mode
  // supplied by its caller (the pipeline) and expose it in mdVSFrame.
  it("exposes an old_wave_mode value supplied via baseValues", () => {
    const runner = new MilkPresetRunner(
      emptyDef({ baseValues: { old_wave_mode: 3 } }),
      globals(), rng(),
    );
    runner.runFrameEquations(globals());
    expect(runner.mdVSFrame.old_wave_mode).toBe(3);
  });

  it("preserves old_wave_mode across frames when no equation touches it", () => {
    const runner = new MilkPresetRunner(
      emptyDef({ baseValues: { old_wave_mode: 5 } }),
      globals(), rng(),
    );
    runner.runFrameEquations(globals());
    runner.runFrameEquations(globals());
    runner.runFrameEquations(globals());
    // old_wave_mode is a base value, so every frame re-supplies it
    // from mdVS. Per-frame writes would accumulate if they existed,
    // but this test carries no such writes so the value stays at 5.
    expect(runner.mdVSFrame.old_wave_mode).toBe(5);
  });
});
