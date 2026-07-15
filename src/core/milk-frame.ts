/**
 * MilkDrop preset-equation lifecycle engine — the CPU state machine every
 * milk-* graph stage reads. Semantics from docs/milkdrop-execution-model.md
 * §2 (derived from projectM PerFrameContext/CustomWaveform):
 *
 * - Init code runs ONCE at load; the q1..q32 values at the end of init are
 *   snapshotted.
 * - EVERY frame, q1..q32 reset to that snapshot before per-frame code runs;
 *   all other per-frame user variables persist frame-to-frame.
 * - Custom-unit (wave/shape) contexts: init once (t1..t8 captured), each
 *   frame receives the preset's post-per-frame q values, runs unit
 *   per-frame code; per-point code runs per point with q and t flowing in;
 *   t-vars persist within the unit.
 * - reg00..reg99 and gmegabuf are shared across ALL contexts of the preset;
 *   megabuf is per-context.
 *
 * The base-value table (every numeric preset value) seeds the frame
 * environment each frame before equations run, matching projectM's
 * LoadStateVariables + defaults model.
 */

import { compile, type Program } from "./expr";

const Q_COUNT = 32;
const T_COUNT = 8;

/** Variables written fresh each frame from engine state (read-only inputs). */
export interface MilkFrameInputs {
  time: number;
  frame: number;
  fps: number;
  bass: number; mid: number; treb: number; vol: number;
  bass_att: number; mid_att: number; treb_att: number; vol_att: number;
  meshx: number; meshy: number;
  pixelsx: number; pixelsy: number;
  aspectx: number; aspecty: number;
  /** projectM provides preset progress; Butterchurn (the validation
   *  oracle) does not hand equations any progress value, so oracle-
   *  fidelity renders supply 0. */
  progress: number;
}

/** Per-frame audio level set: DISTINCT instantaneous ratios (bass/mid/
 *  treb = imm/longAvg) and attenuated ratios (_att = avg/longAvg), per
 *  the witnessed AudioLevels model (butterchurn src/audio/audioLevels.js,
 *  reimplementing MilkDrop's loudness model). */
export interface MilkAudioLevels {
  bass: number; bass_att: number;
  mid: number; mid_att: number;
  treb: number; treb_att: number;
}

/** Build the frame-input set the preset equations read. Conventions
 *  witnessed in the oracle (butterchurn.js):
 *  - time/fps/frame are the renderer's integrated values (time += 1/fps
 *    per frame; fps damped; frame counts renders starting at 1) — NOT
 *    naive frameIndex/FPS;
 *  - equations receive the INVERSE render aspect: for texsize (tx, ty),
 *    render aspectx = ty > tx ? tx/ty : 1 and aspecty = tx > ty ? ty/tx
 *    : 1; the equation env gets 1/aspectx and 1/aspecty (globalVars use
 *    invAspectx/invAspecty — witnessed);
 *  - vol / vol_att are the three-band means (witnessed in the warp/comp
 *    uniform uploads and waveform alpha computation). */
export function makeFrameInputs(
  time: number, frame: number, fps: number,
  levels: MilkAudioLevels,
  meshx: number, meshy: number, pixelsx: number, pixelsy: number,
  progress = 0,
): MilkFrameInputs {
  const renderAspectX = pixelsy > pixelsx ? pixelsx / pixelsy : 1;
  const renderAspectY = pixelsx > pixelsy ? pixelsy / pixelsx : 1;
  return {
    time, frame, fps,
    bass: levels.bass, mid: levels.mid, treb: levels.treb,
    vol: (levels.bass + levels.mid + levels.treb) / 3,
    bass_att: levels.bass_att, mid_att: levels.mid_att, treb_att: levels.treb_att,
    vol_att: (levels.bass_att + levels.mid_att + levels.treb_att) / 3,
    meshx, meshy, pixelsx, pixelsy,
    aspectx: 1 / renderAspectX,
    aspecty: 1 / renderAspectY,
    progress,
  };
}

/** Shared cross-context state: reg00..reg99 + gmegabuf. */
class SharedRegisters {
  values: Record<string, number> = {};
  /** Copy shared keys into an env before a context runs. */
  loadInto(env: Record<string, number>): void {
    for (const k of Object.keys(this.values)) env[k] = this.values[k];
  }
  /** Read shared keys back after a context ran. */
  storeFrom(env: Record<string, number>): void {
    for (const k of Object.keys(env)) {
      if (/^reg\d\d$/.test(k) || k.startsWith("@gmb")) this.values[k] = env[k];
    }
  }
}

export class MilkUnitContext {
  private env: Record<string, number> = {};
  private tSnapshot: number[] = new Array(T_COUNT).fill(0);
  private initProgram: Program | null = null;
  private perFrameProgram: Program | null = null;
  private perPointProgram: Program | null = null;
  private initDone = false;
  readonly errors: string[] = [];

  constructor(
    private readonly shared: SharedRegisters,
    private readonly baseValues: Record<string, number>,
    initCode: string, perFrame: string, perPoint: string,
  ) {
    try { if (initCode) this.initProgram = compile(initCode); }
    catch (e) { this.errors.push(`unit init: ${(e as Error).message}`); }
    try { if (perFrame) this.perFrameProgram = compile(perFrame); }
    catch (e) { this.errors.push(`unit per-frame: ${(e as Error).message}`); }
    try { if (perPoint) this.perPointProgram = compile(perPoint); }
    catch (e) { this.errors.push(`unit per-point: ${(e as Error).message}`); }
  }

  /** Run unit per-frame: receives preset q values; returns the env. */
  runFrame(qValues: number[], inputs: MilkFrameInputs): Record<string, number> {
    // base values seed the env each frame (r/g/b/a/x/y/rad/ang/...)
    for (const [k, v] of Object.entries(this.baseValues)) this.env[k] = v;
    for (const [k, v] of Object.entries(inputs)) this.env[k] = v;
    for (let i = 0; i < Q_COUNT; i++) this.env[`q${i + 1}`] = qValues[i];
    this.shared.loadInto(this.env);
    if (!this.initDone) {
      this.initDone = true;
      this.initProgram?.run(this.env);
      for (let i = 0; i < T_COUNT; i++) this.tSnapshot[i] = this.env[`t${i + 1}`] ?? 0;
    }
    // t-vars: reset to the unit's init snapshot each frame (Geiss §3d:
    // t1-t8 bridge init -> frame; per-frame writes flow into per-point).
    for (let i = 0; i < T_COUNT; i++) this.env[`t${i + 1}`] = this.tSnapshot[i];
    this.perFrameProgram?.run(this.env);
    this.shared.storeFrom(this.env);
    return this.env;
  }

  /** Run per-point code for point index i of n. value1/value2 = audio data. */
  runPoint(sample: number, value1: number, value2: number): Record<string, number> {
    this.env.sample = sample;
    this.env.value1 = value1;
    this.env.value2 = value2;
    this.perPointProgram?.run(this.env);
    return this.env;
  }

  get hasPerPoint(): boolean { return this.perPointProgram !== null; }
}

export class MilkFrameEngine {
  private env: Record<string, number> = {};
  private qSnapshot: number[] = new Array(Q_COUNT).fill(0);
  private initProgram: Program | null = null;
  private perFrameProgram: Program | null = null;
  private initDone = false;
  readonly shared = new SharedRegisters();
  readonly errors: string[] = [];

  constructor(
    private readonly baseValues: Record<string, number>,
    initCode: string,
    perFrame: string,
  ) {
    try { if (initCode) this.initProgram = compile(initCode); }
    catch (e) { this.errors.push(`init: ${(e as Error).message}`); }
    try { if (perFrame) this.perFrameProgram = compile(perFrame); }
    catch (e) { this.errors.push(`per-frame: ${(e as Error).message}`); }
  }

  /** Run one frame; returns the post-per-frame environment (read motion
   *  values, wave params, q values, etc. from it). */
  runFrame(inputs: MilkFrameInputs): Record<string, number> {
    // Base values seed writable preset variables each frame (projectM
    // reloads defaults, then per-frame mutates).
    for (const [k, v] of Object.entries(this.baseValues)) this.env[k] = v;
    for (const [k, v] of Object.entries(inputs)) this.env[k] = v;
    this.shared.loadInto(this.env);

    if (!this.initDone) {
      this.initDone = true;
      this.initProgram?.run(this.env);
      for (let i = 0; i < Q_COUNT; i++) this.qSnapshot[i] = this.env[`q${i + 1}`] ?? 0;
      this.shared.storeFrom(this.env);
    }
    // q1..q32 reset to the init snapshot EVERY frame (model doc §2).
    for (let i = 0; i < Q_COUNT; i++) this.env[`q${i + 1}`] = this.qSnapshot[i];
    this.perFrameProgram?.run(this.env);
    this.shared.storeFrom(this.env);
    return this.env;
  }

  /** Post-per-frame q values (feed per-pixel, units, and shader uniforms). */
  qValues(): number[] {
    const out = new Array(Q_COUNT);
    for (let i = 0; i < Q_COUNT; i++) out[i] = this.env[`q${i + 1}`] ?? 0;
    return out;
  }

  /** Read a variable from the current frame env (0 when unset). */
  get(name: string): number {
    const v = this.env[name];
    return Number.isFinite(v) ? v : 0;
  }
}
