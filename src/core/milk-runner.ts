/**
 * MilkDrop preset equation lifecycle — an exact port of the validation
 * oracle's runner (butterchurn PresetEquationRunner; verbatim source at
 * docs/evidence/butterchurn/equations_presetEquationRunner.js) driving
 * ORIGINAL preset EEL compiled by src/core/expr.ts.
 *
 * Ported semantics (each witnessed in the evidence file):
 * - Effective base values = runtime defaults ⊕ varMap-renamed file values
 *   (defaults witnessed in visualizer.js baseValsDefaults / shape / wave
 *   tables; varMap witnessed in milkdrop-preset-converter).
 * - Init: init_eqs on a clone of {baseVals, globals}; q1..q32 snapshot;
 *   then ONE frame_eqs run AT INITIALIZATION whose result defines the
 *   persistent user-variable key set (variables first assigned in later
 *   frames do NOT persist — oracle behavior).
 * - Per frame: pool = {mdVS, qInit, frameMap(user vars), globals};
 *   frame_eqs; user vars picked back; q-after-frame picked for units.
 * - Units (waves/shapes): initialized ONCE at preset init with the
 *   init-time q-after-frame; base vals REASSIGNED after unit init;
 *   t1..t8 snapshots; per-frame pool = {unit pool, tInit, qAfterFrame,
 *   unit frameMap, globals-subset}; per-point runs on the same pool.
 * - regs (reg00..reg99) are renderer-owned: merged into globals before
 *   frame equations, picked back after frame and pixel equations.
 *
 * scripts/validate-frame-equations.mjs proves this runner + expr.ts
 * against per-frame mdVSFrame values extracted from the running oracle.
 */

import { compile, type Program } from "./expr";

export type Pool = Record<string, number>;

/* --- witnessed default tables (visualizer.js baseValsDefaults etc.) --- */

export const MILK_BASE_DEFAULTS: Record<string, number> = {
  decay: 0.98, gammaadj: 2, echo_zoom: 2, echo_alpha: 0, echo_orient: 0,
  red_blue: 0, brighten: 0, darken: 0, wrap: 1, darken_center: 0,
  solarize: 0, invert: 0, fshader: 0, b1n: 0, b2n: 0, b3n: 0,
  b1x: 1, b2x: 1, b3x: 1, b1ed: 0.25,
  wave_mode: 0, additivewave: 0, wave_dots: 0, wave_thick: 0,
  wave_a: 0.8, wave_scale: 1, wave_smoothing: 0.75, wave_mystery: 0,
  modwavealphabyvolume: 0, modwavealphastart: 0.75, modwavealphaend: 0.95,
  wave_r: 1, wave_g: 1, wave_b: 1, wave_x: 0.5, wave_y: 0.5,
  wave_brighten: 1,
  mv_x: 12, mv_y: 9, mv_dx: 0, mv_dy: 0, mv_l: 0.9,
  mv_r: 1, mv_g: 1, mv_b: 1, mv_a: 1,
  warpanimspeed: 1, warpscale: 1, zoomexp: 1, zoom: 1, rot: 0,
  cx: 0.5, cy: 0.5, dx: 0, dy: 0, warp: 1, sx: 1, sy: 1,
  ob_size: 0.01, ob_r: 0, ob_g: 0, ob_b: 0, ob_a: 0,
  ib_size: 0.01, ib_r: 0.25, ib_g: 0.25, ib_b: 0.25, ib_a: 0,
};

export const MILK_SHAPE_DEFAULTS: Record<string, number> = {
  enabled: 0, sides: 4, additive: 0, thickoutline: 0, textured: 0,
  num_inst: 1, tex_zoom: 1, tex_ang: 0, x: 0.5, y: 0.5, rad: 0.1, ang: 0,
  r: 1, g: 0, b: 0, a: 1, r2: 0, g2: 1, b2: 0, a2: 0,
  border_r: 1, border_g: 1, border_b: 1, border_a: 0.1,
};

export const MILK_WAVE_DEFAULTS: Record<string, number> = {
  enabled: 0, samples: 512, sep: 0, scaling: 1, smoothing: 0.5,
  r: 1, g: 1, b: 1, a: 1, spectrum: 0, usedots: 0, thick: 0, additive: 0,
};

/* --- witnessed file-key -> runtime-name map (converter varMap) --- */

export const MILK_VAR_MAP: Record<string, string> = {
  frating: "rating", fgammaadj: "gammaadj", fdecay: "decay",
  fvideoechozoom: "echo_zoom", fvideoechoalpha: "echo_alpha",
  nvideoechoorientation: "echo_orient", nwavemode: "wave_mode",
  badditivewaves: "additivewave", bwavedots: "wave_dots",
  bwavethick: "wave_thick", bmodwavealphabyvolume: "modwavealphabyvolume",
  bmaximizewavecolor: "wave_brighten", btexwrap: "wrap",
  bdarkencenter: "darken_center", bredbluestereo: "red_blue",
  bbrighten: "brighten", bdarken: "darken", bsolarize: "solarize",
  binvert: "invert", fwavealpha: "wave_a", fwavescale: "wave_scale",
  fwavesmoothing: "wave_smoothing", fwaveparam: "wave_mystery",
  wave_mystery: "wave_mystery", fmodwavealphastart: "modwavealphastart",
  fmodwavealphaend: "modwavealphaend", fwarpanimspeed: "warpanimspeed",
  fwarpscale: "warpscale", fzoomexponent: "zoomexp", fshader: "fshader",
  nmotionvectorsx: "mv_x", nmotionvectorsy: "mv_y",
  // unit-scoped renames
  thick: "thickoutline", instance: "instance", instances: "num_inst",
  num_instances: "num_inst", badditive: "additive", busedots: "usedots",
  bspectrum: "spectrum", bdrawthick: "thick",
};

/** Rename raw lowercased .milk keys to runtime names (witnessed converter
 *  `o()`: varMap[key] || key). `unit` selects the unit-scoped collisions:
 *  main `thick`->thickoutline does not apply to waves (bdrawthick->thick). */
export function mapMilkKeys(values: Record<string, number>, unit: "main" | "shape" | "wave"): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(values)) {
    let name = MILK_VAR_MAP[k] ?? k;
    if (unit === "wave" && k === "thick") name = "thick";
    out[name] = v;
  }
  return out;
}

/* ------------------------------ helpers -------------------------------- */

const QS = Array.from({ length: 32 }, (_, i) => `q${i + 1}`);
const TS = Array.from({ length: 8 }, (_, i) => `t${i + 1}`);
export const REGS = Array.from({ length: 100 }, (_, i) => (i < 10 ? `reg0${i}` : `reg${i}`));

const pick = (pool: Pool, keys: readonly string[]): Pool => {
  const out: Pool = {};
  for (const k of keys) if (k in pool) out[k] = pool[k];
  return out;
};
const omitKeys = (pool: Pool, keys: readonly string[]): string[] => {
  const set = new Set(keys);
  return Object.keys(pool).filter((k) => !set.has(k) && !k.startsWith("@"));
};

/** megabuf/gmegabuf cells live under expr.ts prefixes '@mb'/'@gmb'.
 *  They ride along in pools like ordinary keys. */

export interface MilkUnitDef {
  baseValues: Record<string, number>;
  initEel?: string;
  frameEel?: string;
  pointEel?: string;
}

export interface MilkPresetDef {
  baseValues: Record<string, number>;
  initEel: string;
  frameEel: string;
  pixelEel: string;
  waves: MilkUnitDef[];
  shapes: MilkUnitDef[];
}

function compileOrNull(src: string | undefined, errors: string[], what: string): Program | null {
  if (!src || !src.trim()) return null;
  try { return compile(src); } catch (e) {
    errors.push(`${what}: ${(e as Error).message}`);
    return null;
  }
}

export class MilkPresetRunner {
  readonly errors: string[] = [];
  readonly baseVals: Pool;
  /** 4+4 seeded draws consumed at init (witnessed); rand_start feeds the
   *  comp hue base, rand_preset the shader uniforms. */
  randStart: number[] = [0, 0, 0, 0];
  randPreset: number[] = [0, 0, 0, 0];
  private readonly initProg: Program | null;
  private readonly frameProg: Program | null;
  readonly pixelProg: Program | null;
  get runVertEQs(): boolean { return this.pixelProg !== null; }

  private mdVS: Pool;
  private mdVSQInit: Pool = {};
  mdVSRegs: Pool = {};
  mdVSFrame: Pool = {};
  private mdVSUserKeys: string[] = [];
  private mdVSFrameMap: Pool = {};
  mdVSQAfterFrame: Pool = {};

  readonly waveEnabled: boolean[] = [];
  private wavePools: Pool[] = [];
  private waveTInits: Pool[] = [];
  private waveUserKeys: string[][] = [];
  private waveFrameMaps: Pool[] = [];
  private waveFrameProgs: (Program | null)[] = [];
  private wavePointProgs: (Program | null)[] = [];
  readonly waveBaseVals: Pool[] = [];

  readonly shapeEnabled: boolean[] = [];
  private shapePools: Pool[] = [];
  private shapeTInits: Pool[] = [];
  private shapeUserKeys: string[][] = [];
  private shapeFrameMaps: Pool[] = [];
  private shapeFrameProgs: (Program | null)[] = [];
  readonly shapeBaseVals: Pool[] = [];

  constructor(def: MilkPresetDef, globals: Pool, private readonly rand: () => number = Math.random) {
    this.baseVals = { ...MILK_BASE_DEFAULTS, ...mapMilkKeys(def.baseValues, "main") };
    this.initProg = compileOrNull(def.initEel, this.errors, "init");
    this.frameProg = compileOrNull(def.frameEel, this.errors, "per-frame");
    this.pixelProg = compileOrNull(def.pixelEel, this.errors, "per-pixel");

    // (witnessed: mdVS = {baseVals, mdVSBase}; rand_start then
    // rand_preset each consume 4 draws at init; the values feed the comp
    // hue base and shader uniforms, not the equation pool)
    this.mdVS = { ...this.baseVals, ...globals };
    this.randStart = [this.rand(), this.rand(), this.rand(), this.rand()];
    this.randPreset = [this.rand(), this.rand(), this.rand(), this.rand()];

    const nonUserKeys = [...QS, ...REGS, ...Object.keys(this.mdVS)];
    const afterInit = { ...this.mdVS };
    this.initProg?.run(afterInit);
    this.mdVSQInit = pick(afterInit, QS);
    this.mdVSRegs = pick(afterInit, REGS);
    const initUserVars = pick(afterInit, omitKeys(afterInit, nonUserKeys));
    // megabuf/gmegabuf cells ride along (prefixed keys)
    for (const k of Object.keys(afterInit)) if (k.startsWith("@")) initUserVars[k] = afterInit[k];

    // Init-time frame_eqs run (witnessed) — defines the persistent
    // user-variable key set.
    this.mdVSFrame = { ...this.mdVS, ...this.mdVSQInit, ...this.mdVSRegs, ...initUserVars };
    this.frameProg?.run(this.mdVSFrame);
    this.mdVSUserKeys = omitKeys(this.mdVSFrame, nonUserKeys);
    this.mdVSFrameMap = pick(this.mdVSFrame, this.mdVSUserKeys);
    for (const k of Object.keys(this.mdVSFrame)) if (k.startsWith("@")) this.mdVSFrameMap[k] = this.mdVSFrame[k];
    this.mdVSQAfterFrame = pick(this.mdVSFrame, QS);
    this.mdVSRegs = pick(this.mdVSFrame, REGS);

    // Units: initialized once, with init-time qAfterFrame (witnessed).
    def.waves.forEach((wave, i) => {
      const baseVals = { ...MILK_WAVE_DEFAULTS, ...mapMilkKeys(wave.baseValues, "wave") };
      this.waveBaseVals.push(baseVals);
      const enabled = baseVals.enabled !== 0;
      this.waveEnabled.push(enabled);
      if (!enabled) {
        this.wavePools.push({}); this.waveTInits.push({});
        this.waveUserKeys.push([]); this.waveFrameMaps.push({});
        this.waveFrameProgs.push(null); this.wavePointProgs.push(null);
        return;
      }
      const pool: Pool = { ...baseVals, ...globals };
      const nonUserWaveKeys = [...QS, ...TS, ...REGS, ...Object.keys(pool)];
      Object.assign(pool, this.mdVSQAfterFrame, this.mdVSRegs);
      const initProg = compileOrNull(wave.initEel, this.errors, `wave${i} init`);
      if (initProg) {
        initProg.run(pool);
        this.mdVSRegs = pick(pool, REGS);
        Object.assign(pool, baseVals); // witnessed: base vals reset after init
      }
      this.wavePools.push(pool);
      this.waveTInits.push(pick(pool, TS));
      const userKeys = omitKeys(pool, nonUserWaveKeys);
      this.waveUserKeys.push(userKeys);
      this.waveFrameMaps.push(pick(pool, userKeys));
      this.waveFrameProgs.push(compileOrNull(wave.frameEel, this.errors, `wave${i} per-frame`));
      this.wavePointProgs.push(compileOrNull(wave.pointEel, this.errors, `wave${i} per-point`));
    });

    def.shapes.forEach((shape, i) => {
      const baseVals = { ...MILK_SHAPE_DEFAULTS, ...mapMilkKeys(shape.baseValues, "shape") };
      this.shapeBaseVals.push(baseVals);
      const enabled = baseVals.enabled !== 0;
      this.shapeEnabled.push(enabled);
      if (!enabled) {
        this.shapePools.push({}); this.shapeTInits.push({});
        this.shapeUserKeys.push([]); this.shapeFrameMaps.push({});
        this.shapeFrameProgs.push(null);
        return;
      }
      const pool: Pool = { ...baseVals, ...globals };
      const nonUserShapeKeys = [...QS, ...TS, ...REGS, ...Object.keys(pool)];
      Object.assign(pool, this.mdVSQAfterFrame, this.mdVSRegs);
      const initProg = compileOrNull(shape.initEel, this.errors, `shape${i} init`);
      if (initProg) {
        initProg.run(pool);
        this.mdVSRegs = pick(pool, REGS);
        Object.assign(pool, baseVals); // witnessed: base vals reset after init
      }
      this.shapePools.push(pool);
      this.shapeTInits.push(pick(pool, TS));
      const userKeys = omitKeys(pool, nonUserShapeKeys);
      this.shapeUserKeys.push(userKeys);
      this.shapeFrameMaps.push(pick(pool, userKeys));
      this.shapeFrameProgs.push(compileOrNull(shape.frameEel, this.errors, `shape${i} per-frame`));
    });
  }

  /** Per-frame preset equations (witnessed runFrameEquations). `globals`
   *  carries the frame inputs INCLUDING renderer-owned regs. */
  runFrameEquations(globals: Pool): Pool {
    this.mdVSFrame = { ...this.mdVS, ...this.mdVSQInit, ...this.mdVSFrameMap, ...globals };
    this.frameProg?.run(this.mdVSFrame);
    this.mdVSFrameMap = pick(this.mdVSFrame, this.mdVSUserKeys);
    for (const k of Object.keys(this.mdVSFrame)) if (k.startsWith("@")) this.mdVSFrameMap[k] = this.mdVSFrame[k];
    this.mdVSQAfterFrame = pick(this.mdVSFrame, QS);
    return this.mdVSFrame;
  }

  /** Unit per-frame pool assembly (witnessed generateWaveform /
   *  drawCustomShape: {mdVSWaves[i], frameMapWaves[i], qAfterFrame,
   *  tInits[i], globalVars}); the frame program is NOT run here — the
   *  wave generator runs it (shapes run it per instance). */
  waveFramePool(i: number, globals: Pool): Pool {
    return {
      ...this.wavePools[i], ...this.waveFrameMaps[i],
      ...this.mdVSQAfterFrame, ...this.waveTInits[i], ...globals,
    };
  }

  runWaveFrame(i: number, pool: Pool): void {
    this.waveFrameProgs[i]?.run(pool);
  }
  runWavePoint(i: number, pool: Pool): void {
    this.wavePointProgs[i]?.run(pool);
  }
  hasWavePoint(i: number): boolean { return this.wavePointProgs[i] !== null; }

  /** Persist unit user vars after per-point (witnessed: "this needs to be
   *  after per point"); megabuf cells (@-prefixed) ride along. */
  saveWaveFrame(i: number, pool: Pool): void {
    const map = pick(pool, this.waveUserKeys[i]);
    for (const k of Object.keys(pool)) if (k.startsWith("@")) map[k] = pool[k];
    this.waveFrameMaps[i] = map;
  }

  /** Per-vertex (per-pixel) equations + warp UV computation — port of the
   *  witnessed oracle loop (renderer.js runPixelEquations; the same math
   *  as projectM PresetWarpVertexShaderGlsl330.vert + PerPixelMesh.cpp
   *  warpFactors, evidence at docs/evidence/). Writes (gridX+1)*(gridY+1)
   *  UV pairs into warpUVs; the vertex pool carries across vertices and
   *  its regs feed back to the renderer (witnessed). Returns the final
   *  vertex pool. `aspectx/aspecty` here are the RENDER aspect values
   *  (1, texY/texX for landscape), not the equation-facing inverses. */
  runPixelEquations(
    mdVSFrame: Pool, gridX: number, gridY: number,
    aspectx: number, aspecty: number, warpUVs: Float32Array,
  ): Pool {
    const gridX1 = gridX + 1;
    const gridY1 = gridY + 1;
    const warpTimeV = mdVSFrame.time * mdVSFrame.warpanimspeed;
    const warpScaleInv = 1.0 / mdVSFrame.warpscale;
    const warpf0 = 11.68 + 4.0 * Math.cos(warpTimeV * 1.413 + 10);
    const warpf1 = 8.77 + 3.0 * Math.cos(warpTimeV * 1.113 + 7);
    const warpf2 = 10.54 + 3.0 * Math.cos(warpTimeV * 1.233 + 3);
    const warpf3 = 11.49 + 4.0 * Math.cos(warpTimeV * 0.933 + 5);
    const runVert = this.pixelProg !== null;
    const v = { ...mdVSFrame }; // one clone per frame, carried across vertices
    let offset = 0;
    for (let iz = 0; iz < gridY1; iz++) {
      for (let ix = 0; ix < gridX1; ix++) {
        const x = (ix / gridX) * 2.0 - 1.0;
        const y = (iz / gridY) * 2.0 - 1.0;
        const rad = Math.sqrt(x * x * aspectx * aspectx + y * y * aspecty * aspecty);
        if (runVert) {
          // utils.atan2 (witnessed): atan2 shifted into [0, 2*PI)
          let ang = 0;
          if (!(iz === gridY / 2 && ix === gridX / 2)) {
            ang = Math.atan2(y * aspecty, x * aspectx);
            if (ang < 0) ang += 2 * Math.PI;
          }
          v.x = x * 0.5 * aspectx + 0.5;
          v.y = y * -0.5 * aspecty + 0.5;
          v.rad = rad;
          v.ang = ang;
          v.zoom = mdVSFrame.zoom;
          v.zoomexp = mdVSFrame.zoomexp;
          v.rot = mdVSFrame.rot;
          v.warp = mdVSFrame.warp;
          v.cx = mdVSFrame.cx;
          v.cy = mdVSFrame.cy;
          v.dx = mdVSFrame.dx;
          v.dy = mdVSFrame.dy;
          v.sx = mdVSFrame.sx;
          v.sy = mdVSFrame.sy;
          this.pixelProg?.run(v);
        }
        const warp = runVert ? v.warp : mdVSFrame.warp;
        const zoom = runVert ? v.zoom : mdVSFrame.zoom;
        const zoomExp = runVert ? v.zoomexp : mdVSFrame.zoomexp;
        const cx = runVert ? v.cx : mdVSFrame.cx;
        const cy = runVert ? v.cy : mdVSFrame.cy;
        const sx = runVert ? v.sx : mdVSFrame.sx;
        const sy = runVert ? v.sy : mdVSFrame.sy;
        const dx = runVert ? v.dx : mdVSFrame.dx;
        const dy = runVert ? v.dy : mdVSFrame.dy;
        const rot = runVert ? v.rot : mdVSFrame.rot;
        const zoom2V = Math.pow(zoom, Math.pow(zoomExp, rad * 2.0 - 1.0));
        const zoom2Inv = 1.0 / zoom2V;
        let u = x * 0.5 * aspectx * zoom2Inv + 0.5;
        let vv = -y * 0.5 * aspecty * zoom2Inv + 0.5;
        u = (u - cx) / sx + cx;
        vv = (vv - cy) / sy + cy;
        if (warp !== 0) {
          u += warp * 0.0035 * Math.sin(warpTimeV * 0.333 + warpScaleInv * (x * warpf0 - y * warpf3));
          vv += warp * 0.0035 * Math.cos(warpTimeV * 0.375 - warpScaleInv * (x * warpf2 + y * warpf1));
          u += warp * 0.0035 * Math.cos(warpTimeV * 0.753 - warpScaleInv * (x * warpf1 - y * warpf2));
          vv += warp * 0.0035 * Math.sin(warpTimeV * 0.825 + warpScaleInv * (x * warpf0 + y * warpf3));
        }
        const u2 = u - cx;
        const v2 = vv - cy;
        const cosRot = Math.cos(rot);
        const sinRot = Math.sin(rot);
        u = u2 * cosRot - v2 * sinRot + cx;
        vv = u2 * sinRot + v2 * cosRot + cy;
        u -= dx;
        vv -= dy;
        u = (u - 0.5) / aspectx + 0.5;
        vv = (vv - 0.5) / aspecty + 0.5;
        warpUVs[offset] = u;
        warpUVs[offset + 1] = vv;
        offset += 2;
      }
    }
    return v;
  }

  shapeFramePool(i: number, globals: Pool): Pool {
    return {
      ...this.shapePools[i], ...this.shapeFrameMaps[i],
      ...this.mdVSQAfterFrame, ...this.shapeTInits[i], ...globals,
    };
  }

  runShapeFrame(i: number, pool: Pool): void {
    this.shapeFrameProgs[i]?.run(pool);
  }

  saveShapeFrame(i: number, pool: Pool): void {
    const map = pick(pool, this.shapeUserKeys[i]);
    for (const k of Object.keys(pool)) if (k.startsWith("@")) map[k] = pool[k];
    this.shapeFrameMaps[i] = map;
  }
}
