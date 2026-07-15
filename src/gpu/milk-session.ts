/**
 * MilkSession — the session-lifetime owner of state that outlives any
 * single preset. Matches the boundary projectM's `Renderer` object
 * draws (docs/evidence/projectm/MilkdropPreset.cpp).
 *
 * Owned state:
 *
 * - Current MilkPresetRunner for the equation stream.
 * - Current warp and comp MilkShaderInstance objects — each with its
 *   own persistent `rand_preset` and rotation state per projectM
 *   MilkdropShader.cpp. Both instances draw from ONE shared RNG
 *   stream (`shaderRng`) so warp+comp construction matches projectM's
 *   single-process-`rand()` model.
 * - Independent RNG domains: `shaderRng` for all shader draws
 *   (construction + per-invocation), `noiseRng` for noise-texture
 *   generation. Neither consumes nor shifts the preset equation RNG
 *   stream.
 * - Session-lifetime noise texture data via `noiseFor(name)`, generated
 *   lazily from `noiseRng` per NOISE_TEX_SPECS.
 *
 * Not implemented yet (explicit refusals until stronger source
 * evidence and executor rework land):
 *
 * - Blending. projectM runs the previous preset's equation code each
 *   frame during blend and mixes frame state via `mixFrameEquations`.
 *   PHOSPHENE does not run any previous-preset equation stream, so
 *   `beginPresetLoad(blendTime)` throws when `blendTime > 0` and a
 *   current preset already exists.
 * - Session-owned frame time. The projectM Renderer owns time, frame,
 *   fps and feeds them into equations and shader uniforms. PHOSPHENE
 *   currently accepts these as `data.globals` at frame time; session
 *   timing unification is a separate coherent-window task and this
 *   class does not advance parallel counters that would confuse the
 *   two models.
 */

import { type MilkPresetRunner, makeMulberry32, type MilkRng } from "../core/milk-runner";
import { MilkShaderInstance } from "./milk-shader-instance";
import { NOISE_TEX_SPECS, createNoiseTex, createNoiseVolTex } from "./milk-noise";

const NOISE_RNG_SEED = 0xA110CADD;
const SHADER_RNG_SEED = 0xC0DEBEEF;

export class MilkSession {
  currentRunner: MilkPresetRunner | null = null;
  warpShader: MilkShaderInstance | null = null;
  compShader: MilkShaderInstance | null = null;

  /** `wave_mode` value the next preset load will inject as
   *  `old_wave_mode` into the incoming preset's baseValues per
   *  projectM's convention (`MilkdropPreset::RenderFrame` reads
   *  `state.mainTexture` from previous framebuffer, and equation
   *  code reads previous wave_mode via the injected slot). Initial 0
   *  matches the pre-first-load state. */
  prevPresetWaveMode = 0;

  /** RNG shared between shader construction and every subsequent
   *  per-invocation draw. Matches projectM's single-process-`rand()`
   *  usage: both `MilkdropShader` objects and every `LoadVariables`
   *  call pull from the same stream. */
  readonly shaderRng: MilkRng;
  /** RNG for noise-texture generation. Independent from the shader
   *  stream and from the preset equation RNG, matching projectM's
   *  `std::default_random_engine` seeded independently per
   *  `MilkdropNoise::generate2D` / `generate3D` call. */
  readonly noiseRng: MilkRng;

  private readonly noiseCache = new Map<string, Uint8Array>();

  constructor(shaderRng?: MilkRng, noiseRng?: MilkRng) {
    this.shaderRng = shaderRng ?? makeMulberry32(SHADER_RNG_SEED);
    this.noiseRng = noiseRng ?? makeMulberry32(NOISE_RNG_SEED);
  }

  /** Record the transition to a new preset. `blendTime > 0` while a
   *  current preset exists throws with an explicit "blending not
   *  implemented" message per COMPATIBILITY-GOAL.md: the previous
   *  preset's equation stream, mixed frame state, and blended
   *  drawing all need real implementations before blend timing can
   *  be honored. Captures the previous preset's `wave_mode` so the
   *  caller can inject it into the new runner's baseValues either
   *  way. */
  beginPresetLoad(blendTime: number): void {
    if (blendTime > 0 && this.currentRunner !== null) {
      throw new Error(
        "MilkSession: blendTime > 0 requested but blending is not implemented — " +
        "prev-preset equation execution and mixFrameEquations are unimplemented. " +
        "Pass blendTime = 0 or leave the parameter unset until the blend path lands.",
      );
    }
    this.prevPresetWaveMode = this.currentRunner?.baseVals?.wave_mode ?? 0;
  }

  /** Complete the preset transition: the new runner becomes current.
   *  Called after the caller constructs the runner with the injected
   *  `old_wave_mode` value from `prevPresetWaveMode`. */
  installRunner(runner: MilkPresetRunner): void {
    this.currentRunner = runner;
  }

  /** Install the new preset's warp and comp shader instances. */
  installShaders(warp: MilkShaderInstance, comp: MilkShaderInstance): void {
    this.warpShader = warp;
    this.compShader = comp;
  }

  /** Return the pixel data for one of the six shader-visible noise
   *  textures, generating it lazily from `noiseRng` on first access.
   *  Subsequent calls with the same spec return the cached data so
   *  the noise stream is drawn once per session per texture. */
  noiseFor(name: (typeof NOISE_TEX_SPECS)[number]["name"]): Uint8Array {
    const cached = this.noiseCache.get(name);
    if (cached) return cached;
    const spec = NOISE_TEX_SPECS.find((s) => s.name === name);
    if (!spec) throw new Error(`unknown noise texture: ${name}`);
    const data = spec.kind === "2d"
      ? createNoiseTex(spec.size, spec.zoom, this.noiseRng)
      : createNoiseVolTex(spec.size, spec.zoom, this.noiseRng);
    this.noiseCache.set(name, data);
    return data;
  }
}
