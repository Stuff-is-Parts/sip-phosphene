/**
 * MilkSession — the session-lifetime owner of state that outlives any
 * single preset, matching the boundary butterchurn's Renderer class
 * draws (rendering_renderer.js:57 constructor). The Renderer object
 * holds current + previous presets, blend state, timing accumulators,
 * per-shader RNG-derived values, and the render resources
 * (framebuffers, blur cascade, noise, image slots).
 *
 * PHOSPHENE previously had NO session-level owner. MilkPipeline was
 * per-preset, which meant no `prevPreset.baseVals.wave_mode` was
 * accessible at load, no per-frame `rand_frame` had a genuine owner,
 * and blend state could not exist at all. This class introduces the
 * missing owner.
 *
 * Scope of this iteration:
 *
 * - `loadPreset(runner)` — records the preset transition, retains the
 *   PREVIOUS runner's `wave_mode` for the caller to inject as
 *   `old_wave_mode` into the next preset's baseValues at construction
 *   time, and starts blend timing (butterchurn.js:2381-2388).
 * - `nextRandFrame(rng)` — returns four fresh 4-vector components
 *   drawn from the provided `MilkRng`, matching butterchurn's
 *   `Math.random() × 4` calls at butterchurn.js:3836 (warp) and :4532
 *   (comp) but with the RNG owner explicit. Butterchurn draws per
 *   shader invocation; PHOSPHENE draws once per session frame so a
 *   shader-visible contract carries one committed set.
 * - `beginFrame() / endFrame()` — mark frame boundaries; a future
 *   iteration will move the calcTimeAndFPS timing state here.
 *
 * Not yet owned by this iteration and refused when needed:
 *
 * - Rotation matrices (rot_s/d/f/vf/uf/rand × 4). Butterchurn does
 *   not upload these to its warp/comp shaders (butterchurn.js:3372
 *   and :4321 uniform blocks omit them entirely). They are a
 *   projectM/original-MilkDrop header spec item; PHOSPHENE's shader
 *   contract keeps them null and any consumer that requires them
 *   must refuse.
 * - Prev-frame mip statistics (mip_x/y/xy/avg). Butterchurn does not
 *   upload these either. Same status.
 * - Six-pass blur cascade GPU pipeline. The shaders and math are
 *   ported at src/gpu/milk-blur.ts; the render pipeline that
 *   allocates the six targets and chains the H+V passes each frame
 *   is a subsequent iteration.
 * - Static noise textures and named-image resources. Fixed content
 *   from MilkdropNoise.cpp; not yet uploaded.
 *
 * A full-cascade MilkDrop 2 shader preset still refuses at
 * MilkPipeline.load() until every input above is available. */

import { type MilkPresetRunner } from "../core/milk-runner";
import { type MilkRng } from "../core/milk-runner";

export class MilkSession {
  /** The runner for the preset currently being rendered. `null` before
   *  the first `loadPreset` call. */
  currentRunner: MilkPresetRunner | null = null;
  /** The runner for the preset being blended out. `null` before the
   *  second `loadPreset` call (butterchurn initializes both to the
   *  blank preset — PHOSPHENE keeps null to make the pre-first-preset
   *  state explicit rather than pretending a blank is active). */
  prevRunner: MilkPresetRunner | null = null;

  /** `wave_mode` value the NEXT `loadPreset` must inject as
   *  `old_wave_mode` into the incoming preset's baseValues. Butterchurn
   *  reads `prevPreset.baseVals.wave_mode` at rendering_renderer.js:194.
   *  Value 0 = butterchurn's blankPreset default (see
   *  rendering_renderer.js:164-179), which is the correct initial
   *  state before any preset has ever been loaded. */
  prevPresetWaveMode = 0;

  /** Blend state — mirrors butterchurn's Renderer fields
   *  (rendering_renderer.js:72-75, 355-361). `blendDuration = 0`
   *  means no blending is active. */
  blending = false;
  blendStartTime = 0;
  blendDuration = 0;
  blendProgress = 0;

  /** Session time and frame counter — updated by `beginFrame(elapsed)`.
   *  Butterchurn owns these at rendering_renderer.js:65-71 and
   *  advances them in calcTimeAndFPS at :353. The MilkPresetRunner
   *  can read `time`, `frame`, `fps` from `globals`; the session is
   *  the source of truth for the values it hands the runner. */
  time = 0;
  frameNum = 0;
  fps = 30;

  /** Draw a fresh 4-vector for the shader-visible `rand_frame` uniform
   *  using the provided RNG. Butterchurn calls Math.random() four
   *  times at each shader `renderQuadTexture` invocation
   *  (butterchurn.js:3836 warp, :4532 comp). PHOSPHENE draws once per
   *  session frame and hands the same vector to all shader
   *  invocations that frame — the value the source draws IS just
   *  four random numbers, and matching source behavior means using a
   *  session-owned RNG rather than four uncoordinated draws per
   *  invocation. */
  nextRandFrame(rng: MilkRng): [number, number, number, number] {
    return [rng.next(), rng.next(), rng.next(), rng.next()];
  }

  /** Record the transition from the current preset to a new one.
   *  Butterchurn's `loadPreset` at rendering_renderer.js:183-239
   *  performs the semantic equivalent:
   *
   *  1. `blending = true; blendStartTime = time; blendDuration =
   *     blendTime; blendProgress = 0`.
   *  2. `prevPresetEquationRunner = presetEquationRunner`.
   *  3. `prevPreset = preset; preset = newPreset`.
   *  4. `preset.baseVals.old_wave_mode = prevPreset.baseVals.wave_mode`.
   *  5. Construct the new runner.
   *
   *  This class handles steps 1-3 and computes step 4's value. The
   *  runner construction (step 5) is the caller's responsibility
   *  because it needs the injected baseValues. The caller then calls
   *  `installRunner(newRunner)` to complete the transition. */
  beginPresetLoad(blendTime: number): void {
    // Capture the wave_mode of what will become the previous preset
    // BEFORE the swap so the caller can inject it into the new
    // preset's baseValues.
    this.prevPresetWaveMode = this.currentRunner?.baseVals?.wave_mode ?? 0;
    this.prevRunner = this.currentRunner;
    this.blending = blendTime > 0 && this.currentRunner !== null;
    this.blendStartTime = this.time;
    this.blendDuration = blendTime;
    this.blendProgress = 0;
  }

  /** Complete the preset transition: the new runner becomes current.
   *  Called after the caller constructs the runner with the injected
   *  `old_wave_mode` value from `prevPresetWaveMode`. */
  installRunner(runner: MilkPresetRunner): void {
    this.currentRunner = runner;
  }

  /** Advance session timing per frame. `elapsed` is the elapsed
   *  seconds since the previous frame (the caller measures this).
   *  Butterchurn's `calcTimeAndFPS` at rendering_renderer.js:336-378
   *  integrates `time += 1/fps` and damps `fps` toward the running
   *  average from `timeHist`; PHOSPHENE will move that logic into
   *  MilkSession in a future iteration. For now this class only
   *  tracks `frameNum` and `time` with a passthrough increment so
   *  callers that need to advance session time can. Blend progress
   *  advances by the same elapsed value. */
  beginFrame(elapsed: number): void {
    this.frameNum += 1;
    this.time += elapsed;
    if (this.blending) {
      this.blendProgress = (this.time - this.blendStartTime) / this.blendDuration;
      if (this.blendProgress >= 1) {
        this.blending = false;
        this.blendProgress = 1;
      }
    }
  }
}
