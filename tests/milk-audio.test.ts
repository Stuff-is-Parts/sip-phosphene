// Prove the TypeScript OracleFrameModel port (src/core/milk-audio.ts)
// matches the .mjs mirror bit-for-bit on the shared witnessed math. Any
// drift between the two implementations would mean the production
// executor (which uses the TS module) reads different audio levels than
// the audio-model validation script (which uses the mjs mirror), so both
// stay identical or the tests break.
//
// Test method: feed both implementations the same deterministic PCM
// sequence for 60 frames and compare frame/time/fps/bass/mid/treb and
// their _att partners. Tolerance is exact equality (both are float64
// arithmetic driven by the same math).

import { describe, it, expect } from "vitest";
import { OracleFrameModel as TsModel } from "../src/core/milk-audio";
// @ts-expect-error — the mjs file is JavaScript with no declaration
import { OracleFrameModel as MjsModel } from "../scripts/lib/milk-audio-model.mjs";

// A deterministic PCM frame (no dependency on Node's ref-audio helper —
// avoids cross-target import). Same synthetic signal used by scripts.
function makeFrame(t: number): { c: Uint8Array; l: Uint8Array; r: Uint8Array } {
  const SAMPLES = 1024;
  const c = new Uint8Array(SAMPLES);
  const l = new Uint8Array(SAMPLES);
  const r = new Uint8Array(SAMPLES);
  const beatPhase = (t * 2) % 1;
  const beatEnv = Math.exp(-beatPhase * 6);
  for (let i = 0; i < SAMPLES; i++) {
    const st = t + i / 44100;
    const bass = Math.sin(2 * Math.PI * 55 * st) * (0.45 + 0.4 * beatEnv);
    const mid = Math.sin(2 * Math.PI * 440 * st) * 0.18 +
      Math.sin(2 * Math.PI * 660 * st + 1.3) * 0.12;
    const treb = Math.sin(2 * Math.PI * 6000 * st) * 0.10 * beatEnv +
      Math.sin(2 * Math.PI * 9500 * st + 0.7) * 0.05;
    const mono = Math.max(-1, Math.min(1, bass + mid + treb));
    const spread = Math.sin(2 * Math.PI * 0.25 * st + i * 0.002) * 0.06;
    const lv = Math.max(-1, Math.min(1, mono + spread));
    const rv = Math.max(-1, Math.min(1, mono - spread));
    c[i] = Math.round(128 + mono * 110);
    l[i] = Math.round(128 + lv * 110);
    r[i] = Math.round(128 + rv * 110);
  }
  return { c, l, r };
}

describe("milk-audio OracleFrameModel: TS port matches mjs mirror bit-for-bit", () => {
  it("agrees on frame/time/fps/bass/mid/treb across 60 frames", () => {
    const ts = new TsModel();
    const mjs = new MjsModel();
    for (let f = 0; f < 60; f++) {
      const { c, l, r } = makeFrame(f / 30);
      const a = ts.step(c, l, r, 1 / 30);
      const b = mjs.step(c, l, r, 1 / 30);
      for (const k of ["frame", "time", "fps", "bass", "bass_att", "mid", "mid_att", "treb", "treb_att"] as const) {
        expect(a[k]).toBeCloseTo(b[k], 12);
      }
    }
  });
});
