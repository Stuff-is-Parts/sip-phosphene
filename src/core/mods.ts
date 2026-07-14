import { clamp } from "./params";
import { midiLevels } from "./midi";
import { compile, type Program } from "./expr";
import type {
  AudioFeatures, BaseParams, CustomParam, ModRoute, ModSource, Scene,
} from "./types";
import type { EffectiveParams } from "./params";

export function sourceValue(
  src: ModSource, a: AudioFeatures, nowSec: number, beatRand = 0,
): number {
  switch (src) {
    case "bass": return a.bass;
    case "mid": return a.mid;
    case "treble": return a.treble;
    case "beat": return a.beat;
    case "energy": return a.energy;
    case "bpmPhase": return a.bpm > 0 ? (nowSec * a.bpm / 60) % 1 : 0;
    case "specLow": return a.spec[4] ?? 0;
    case "specHigh": return a.spec[48] ?? 0;
    case "lfoSlow": return 0.5 + 0.5 * Math.sin(nowSec * 2 * Math.PI * 0.1);
    case "lfoFast": return 0.5 + 0.5 * Math.sin(nowSec * 2 * Math.PI * 1.0);
    // 1 -> 0 ramp over the beat interval (bpm-synced decay envelope)
    case "beatRamp": {
      const iv = a.bpm > 0 ? 60 / a.bpm : 0.5;
      return Math.max(0, 1 - (nowSec - a.lastBeat) / iv);
    }
    // random value picked on each beat and HELD until the next —
    // the MilkDrop q-variable move, as a routable source
    case "beatRand": return beatRand;
    case "midi1": return midiLevels[0];
    case "midi2": return midiLevels[1];
    case "midi3": return midiLevels[2];
    case "midi4": return midiLevels[3];
    // expr routes are evaluated by ModEngine against the shared env
    case "expr": return 0;
  }
}

const BUILTIN = new Set(["hue", "speed", "int", "fb"]);

/** Persistent smoothing state, keyed by route index. */
export class ModEngine {
  private smooth: number[] = [];
  private beatRandValue = Math.random();
  private beatRandCount = -1;
  private readonly scratch = new Float32Array(16); // reused per frame
  /** Shared per-frame expression state: persists across frames (q-vars etc.). */
  private exprEnv: Record<string, number> = {};
  private exprCache = new Map<string, Program | null>();
  private exprInitDone = new Set<string>();
  private frame = 0;
  /** Compile failures by program source, for the studio log. */
  readonly exprErrors = new Map<string, string>();

  private program(src: string): Program | null {
    const hit = this.exprCache.get(src);
    if (hit !== undefined) return hit;
    let prog: Program | null;
    try {
      prog = compile(src);
    } catch (err) {
      prog = null;
      this.exprErrors.set(src, (err as Error).message);
    }
    this.exprCache.set(src, prog);
    return prog;
  }

  private runExprPrograms(scene: Scene, audio: AudioFeatures, nowSec: number): void {
    const exprRoutes = scene.mods.filter((m) => m.source === "expr" && m.expr);
    if (!exprRoutes.length) return;
    const e = this.exprEnv;
    this.frame++;
    e.time = nowSec;
    e.frame = this.frame;
    e.fps = 60;
    e.bass = audio.bass; e.mid = audio.mid; e.treb = audio.treble;
    e.bass_att = (e.bass_att ?? audio.bass) * 0.9 + audio.bass * 0.1;
    e.mid_att = (e.mid_att ?? audio.mid) * 0.9 + audio.mid * 0.1;
    e.treb_att = (e.treb_att ?? audio.treble) * 0.9 + audio.treble * 0.1;
    e.beat = audio.beat; e.energy = audio.energy; e.bpm = audio.bpm;
    const ranOnce = new Set<string>();
    for (const m of exprRoutes) {
      if (m.init && !this.exprInitDone.has(m.init)) {
        this.exprInitDone.add(m.init);
        this.program(m.init)?.run(e);
      }
      const src = m.expr as string;
      if (ranOnce.has(src)) continue;
      ranOnce.add(src);
      this.program(src)?.run(e);
    }
  }

  private exprValue(m: ModRoute): number {
    const v = this.exprEnv[m.readVar ?? m.target] ?? this.exprEnv.out ?? 0;
    return Number.isFinite(v) ? v : 0;
  }

  evaluate(
    scene: Scene,
    stageParams: Record<string, CustomParam[]>,
    audio: AudioFeatures,
    nowSec: number,
  ): EffectiveParams {
    if (audio.beatCount !== this.beatRandCount) {
      this.beatRandCount = audio.beatCount;
      this.beatRandValue = Math.random();
    }
    const base: BaseParams = { ...scene.params };
    const custom = this.scratch;
    custom.fill(0);
    // Map custom names -> slots across all stages (later stages may reuse names;
    // first declaration wins, matching renderer slot assignment per stage).
    const slotOf = new Map<string, { slot: number; min: number; max: number }>();
    for (const stage of ["bg", "fg", "post"] as const) {
      for (const p of stageParams[stage] ?? []) {
        if (!slotOf.has(p.name)) slotOf.set(p.name, { slot: p.slot, min: p.min, max: p.max });
        custom[p.slot] = clamp(scene.custom[p.name] ?? p.def, p.min, p.max);
      }
    }

    this.runExprPrograms(scene, audio, nowSec);

    scene.mods.forEach((m: ModRoute, i: number) => {
      const isExpr = m.source === "expr";
      const raw = m.base +
        (isExpr ? this.exprValue(m) : sourceValue(m.source, audio, nowSec, this.beatRandValue)) * m.gain;
      // equations are exact per-frame values; audio sources get smoothing
      const prev = this.smooth[i] ?? raw;
      const val = isExpr ? raw : prev * 0.7 + raw * 0.3;
      this.smooth[i] = val;

      if (BUILTIN.has(m.target)) {
        (base as unknown as Record<string, number>)[m.target] =
          (scene.params as unknown as Record<string, number>)[m.target] + val;
      } else {
        const info = slotOf.get(m.target);
        if (info) {
          const start = scene.custom[m.target] ?? 0;
          custom[info.slot] = clamp(start + val, info.min, info.max);
        }
      }
    });

    base.fb = clamp(base.fb, 0, 0.97);
    base.int = clamp(base.int, 0, 3);
    base.speed = clamp(base.speed, 0, 4);
    // hue is left free-running; the palette wraps
    return { ...base, custom };
  }

  reset(): void {
    this.smooth = [];
    this.beatRandCount = -1;
    this.exprEnv = {};
    this.exprInitDone.clear();
    this.frame = 0;
  }
}
