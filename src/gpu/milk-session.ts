/**
 * MilkSession — the session-lifetime owner of state that outlives any
 * single preset. Matches the boundary projectM's `Renderer` object
 * draws (docs/evidence/projectm/MilkdropPreset.cpp `RenderFrame`
 * signature and companion state).
 *
 * Owned state:
 *
 * - Current + previous MilkPresetRunner (for the equation streams).
 * - Current + previous MilkShaderInstance for warp AND comp shaders
 *   independently — each with its own persistent `rand_preset` and
 *   rotation state per docs/evidence/projectm/MilkdropShader.cpp.
 * - Blend timing: `blendDuration`, `blendStartTime`, `blendProgress`,
 *   `blending`. `MilkPipeline.load(blendTime)` plumbs the real value.
 * - Timing accumulators: `time`, `frameNum`, `fps`. `MilkPipeline.frame`
 *   invokes `beginFrame(elapsed)` each frame.
 * - Independent RNG domains: `shaderRng` for shader-instance per-invocation
 *   draws (`rand_frame` and the four fully-random rotation slots) and
 *   `noiseRng` for the noise-texture generator. Neither consumes nor
 *   shifts the preset equation RNG stream.
 * - Session-lifetime noise texture data, generated on demand from
 *   `noiseRng` per NOISE_TEX_SPECS.
 */

import { type MilkPresetRunner, makeMulberry32, type MilkRng } from "../core/milk-runner";
import { MilkShaderInstance } from "./milk-shader-instance";
import { NOISE_TEX_SPECS, createNoiseTex, createNoiseVolTex } from "./milk-noise";

const NOISE_RNG_SEED = 0xA110CADD;
const SHADER_RNG_SEED = 0xC0DEBEEF;

export class MilkSession {
  currentRunner: MilkPresetRunner | null = null;
  prevRunner: MilkPresetRunner | null = null;

  /** Warp and comp shader instances for the current preset. */
  warpShader: MilkShaderInstance | null = null;
  compShader: MilkShaderInstance | null = null;
  /** Prior-preset shader instances retained through the blend. */
  prevWarpShader: MilkShaderInstance | null = null;
  prevCompShader: MilkShaderInstance | null = null;

  /** `wave_mode` value the next preset load will inject as
   *  `old_wave_mode` into the incoming preset's baseValues. Butterchurn
   *  reads `prevPreset.baseVals.wave_mode` at `rendering_renderer.js:194`
   *  and projectM handles the same equivalent transition. Initial value 0
   *  matches both engines' pre-first-load state. */
  prevPresetWaveMode = 0;

  blending = false;
  blendStartTime = 0;
  blendDuration = 0;
  blendProgress = 0;

  time = 0;
  frameNum = 0;
  fps = 30;

  /** RNG for shader per-invocation draws (`rand_frame` + the four
   *  fully-random rotation slots at slots 20..23 of `MilkdropShader`).
   *  Independent stream — does not consume the preset equation RNG. */
  readonly shaderRng: MilkRng;
  /** RNG for noise-texture generation. Independent from both the
   *  preset equation RNG and the shader RNG per COMPATIBILITY-GOAL.md
   *  and projectM's `std::default_random_engine` per-call construction
   *  in MilkdropNoise.cpp. */
  readonly noiseRng: MilkRng;

  private readonly noiseCache = new Map<string, Uint8Array>();

  constructor(shaderRng?: MilkRng, noiseRng?: MilkRng) {
    this.shaderRng = shaderRng ?? makeMulberry32(SHADER_RNG_SEED);
    this.noiseRng = noiseRng ?? makeMulberry32(NOISE_RNG_SEED);
  }

  /** Draw a fresh 4-vector for the shader-visible `rand_frame` uniform.
   *  projectM's `MilkdropShader::LoadVariables` calls `floatRand()`
   *  four times AT EACH shader variable-load — not once per frame.
   *  Callers invoke this per shader draw, so warp and comp receive
   *  distinct random 4-vectors, matching projectM behavior. */
  nextRandFrame(rng?: MilkRng): [number, number, number, number] {
    const r = rng ?? this.shaderRng;
    return [r.next(), r.next(), r.next(), r.next()];
  }

  /** Record the transition to a new preset. Captures the previous
   *  preset's `wave_mode` for `old_wave_mode` injection and starts
   *  blend timing. `blendTime` is the requested blend duration in
   *  seconds; the caller (MilkPipeline.load) plumbs the real value
   *  rather than hardcoding zero. */
  beginPresetLoad(blendTime: number): void {
    this.prevPresetWaveMode = this.currentRunner?.baseVals?.wave_mode ?? 0;
    this.prevRunner = this.currentRunner;
    this.prevWarpShader = this.warpShader;
    this.prevCompShader = this.compShader;
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

  /** Install the new preset's warp and comp shader instances.
   *  MilkPipeline calls this after constructing both instances (each
   *  seeded from a fresh RNG stream so `rand_preset` and the persistent
   *  rotation state match projectM's per-`MilkdropShader` construction
   *  pattern). */
  installShaders(warp: MilkShaderInstance, comp: MilkShaderInstance): void {
    this.warpShader = warp;
    this.compShader = comp;
  }

  /** Advance session timing per frame. `elapsed` is the elapsed
   *  seconds since the previous frame; `MilkPipeline.frame` computes
   *  it from `1 / mdVSFrame.fps` when the caller does not supply an
   *  explicit value. Blend progress advances by the same increment. */
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

  /** Return the pixel data for one of the six shader-visible noise
   *  textures, generating it lazily from `noiseRng` on first access.
   *  Subsequent calls with the same spec name return the cached data
   *  so the noise stream is drawn once per session per texture. */
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
