import { clamp } from "./params";
import { midiLevels } from "./midi";
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
  }
}

const BUILTIN = new Set(["hue", "speed", "int", "fb"]);

/** Persistent smoothing state, keyed by route index. */
export class ModEngine {
  private smooth: number[] = [];
  private beatRandValue = Math.random();
  private beatRandCount = -1;

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
    const custom = new Float32Array(16);
    // Map custom names -> slots across all stages (later stages may reuse names;
    // first declaration wins, matching renderer slot assignment per stage).
    const slotOf = new Map<string, { slot: number; min: number; max: number }>();
    for (const stage of ["bg", "fg", "post"] as const) {
      for (const p of stageParams[stage] ?? []) {
        if (!slotOf.has(p.name)) slotOf.set(p.name, { slot: p.slot, min: p.min, max: p.max });
        custom[p.slot] = clamp(scene.custom[p.name] ?? p.def, p.min, p.max);
      }
    }

    scene.mods.forEach((m: ModRoute, i: number) => {
      const raw = m.base + sourceValue(m.source, audio, nowSec, this.beatRandValue) * m.gain;
      const prev = this.smooth[i] ?? raw;
      const val = prev * 0.7 + raw * 0.3;
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
    base.hue = base.hue; // free-running; palette wraps
    return { ...base, custom };
  }

  reset(): void {
    this.smooth = [];
    this.beatRandCount = -1;
  }
}
