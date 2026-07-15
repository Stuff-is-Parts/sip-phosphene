// Direct semantic tests for OracleAudioLevels + OracleTimeModel against
// butterchurn's AudioLevels + calcTimeAndFPS source. Every assertion
// cites the specific line in node_modules/butterchurn/lib/butterchurn.js
// (the readable form of the audioLevels module extracted into
// docs/evidence/butterchurn/) or in src/core/milk-audio.ts where the port
// carries the source-derived math inline.

import { describe, expect, it } from "vitest";
import { OracleAudioLevels, OracleTimeModel } from "../src/core/milk-audio";

const FFT_SIZE = 512;
const SAMPLE_RATE = 44100;

// Butterchurn audioLevels constructor at butterchurn.js:190-217. Bands
// derived from a fixed 20/320/2800/11025 Hz cutoff set; bucketHz =
// sampleRate / fftSize. Golden band bounds for sampleRate=44100,
// fftSize=512 (matches PHOSPHENE's FFT_SIZE constant):
//   bucketHz = 44100 / 512 = 86.1328125
//   bassLow  = round(20/86.13)-1  = 0 - 1 = -1 → clamped to 0
//   bassHigh = round(320/86.13)-1  = 4 - 1 = 3
//   midHigh  = round(2800/86.13)-1 = 33 - 1 = 32
//   trebHigh = round(11025/86.13)-1 = 128 - 1 = 127
// Bass integrates bins [0, 3); mid [3, 32); treb [32, 127).
function feedBand(band: "bass" | "mid" | "treb", amp: number): Float32Array {
  const arr = new Float32Array(FFT_SIZE / 2);
  const [lo, hi] = band === "bass" ? [0, 3] : band === "mid" ? [3, 32] : [32, 127];
  for (let i = lo; i < hi; i++) arr[i] = amp;
  return arr;
}

describe("OracleAudioLevels — initial state", () => {
  // Butterchurn audioLevels ctor at butterchurn.js:209-216:
  //   this.val = new Float32Array(3);  // default 0
  //   this.att.fill(1); this.avg.fill(1); this.longAvg.fill(1);
  it("initializes val=0, att=1 (bass/mid/treb read the initial state)", () => {
    const levels = new OracleAudioLevels(SAMPLE_RATE);
    expect(levels.bass).toBe(0);
    expect(levels.mid).toBe(0);
    expect(levels.treb).toBe(0);
    expect(levels.bass_att).toBe(1);
    expect(levels.mid_att).toBe(1);
    expect(levels.treb_att).toBe(1);
  });
});

describe("OracleAudioLevels — IIR rate 0.2/0.5 switch at short avg", () => {
  // Butterchurn audioLevels.updateAudioLevels at butterchurn.js:242-252:
  //   if (this.imm[i] > this.avg[i]) rate = 0.2 else rate = 0.5;
  //   avg[i] = avg[i] * rate + imm[i] * (1 - rate);
  // At fps=30, adjustRateToFPS returns rate unchanged (pow(rate, 1) = rate).
  it("uses rate 0.2 when imm rises above avg", () => {
    const levels = new OracleAudioLevels(SAMPLE_RATE);
    // Initial avg = 1 for every band. Feed a bass amplitude of 100 across
    // 3 bins → imm[bass] = 300. imm > avg (300 > 1) so rate = 0.2.
    // avg[bass] = 1 * 0.2 + 300 * 0.8 = 240.2
    levels.updateAudioLevels(feedBand("bass", 100), 30, 0);
    // val[bass] = imm/longAvg. longAvg[bass] on frame 0: 1*0.9 + 300*0.1 = 30.9.
    // val = 300 / 30.9 = 9.7087...
    // Float32Array storage on the port introduces ~1e-7 precision drift
    // vs Float64 math; both are equally-witnessed against the source
    // (butterchurn uses Float32Array too — audioLevels.js:209-213).
    expect(levels.bass).toBeCloseTo(300 / (1 * 0.9 + 300 * 0.1), 5);
    // att = avg/longAvg = 240.2 / 30.9 = 7.774...
    expect(levels.bass_att).toBeCloseTo(240.2 / 30.9, 5);
  });

  it("uses rate 0.5 when imm falls at or below avg", () => {
    const levels = new OracleAudioLevels(SAMPLE_RATE);
    // Feed silence: imm = 0 for every band. imm (0) ≤ avg (1) so rate = 0.5.
    // avg = 1 * 0.5 + 0 * 0.5 = 0.5.
    // longAvg (frame 0, rate 0.9) = 1 * 0.9 + 0 * 0.1 = 0.9.
    // val = 0 / 0.9 = 0. att = 0.5 / 0.9 = 0.5556.
    levels.updateAudioLevels(new Float32Array(FFT_SIZE / 2), 30, 0);
    expect(levels.bass).toBe(0);
    // Float32 precision drift (~1e-7) vs Float64 arithmetic on right side.
    expect(levels.bass_att).toBeCloseTo(0.5 / 0.9, 6);
  });
});

describe("OracleAudioLevels — long IIR rate switch at frame 50", () => {
  // Butterchurn audioLevels.updateAudioLevels at butterchurn.js:254-258:
  //   if (frame < 50) rate = 0.9 else rate = 0.992;
  it("uses long rate 0.9 for frames < 50", () => {
    const levels = new OracleAudioLevels(SAMPLE_RATE);
    // Frame 49 boundary: frame < 50 is true so rate stays 0.9.
    const imm = new Float32Array(FFT_SIZE / 2);
    for (let i = 0; i < 3; i++) imm[i] = 100;
    levels.updateAudioLevels(imm, 30, 49);
    // longAvg[bass] = 1 * 0.9 + 300 * 0.1 = 30.9.
    expect(levels.bass).toBeCloseTo(300 / 30.9, 6);
  });

  it("uses long rate 0.992 for frames >= 50", () => {
    const levels = new OracleAudioLevels(SAMPLE_RATE);
    const imm = new Float32Array(FFT_SIZE / 2);
    for (let i = 0; i < 3; i++) imm[i] = 100;
    levels.updateAudioLevels(imm, 30, 50);
    // longAvg[bass] = 1 * 0.992 + 300 * 0.008 = 3.392.
    // Float32 precision drift (~1e-6) vs Float64 arithmetic on right side.
    expect(levels.bass).toBeCloseTo(300 / 3.392, 4);
  });
});

describe("OracleAudioLevels — effective fps clamp to [15, 144]", () => {
  // Butterchurn audioLevels.updateAudioLevels at butterchurn.js:227-231:
  //   if (!isFiniteNumber(fps) || fps < 15) effectiveFPS = 15
  //   else if (fps > 144) effectiveFPS = 144
  it("clamps sub-15 fps to 15 and adjusts rates accordingly", () => {
    const levels15 = new OracleAudioLevels(SAMPLE_RATE);
    const levels5 = new OracleAudioLevels(SAMPLE_RATE);
    const imm = new Float32Array(FFT_SIZE / 2);
    for (let i = 0; i < 3; i++) imm[i] = 100;
    levels15.updateAudioLevels(imm, 15, 100);
    levels5.updateAudioLevels(imm, 5, 100);
    // fps=5 clamps to 15 so both instances produce identical outputs.
    expect(levels5.bass).toBeCloseTo(levels15.bass, 10);
    expect(levels5.bass_att).toBeCloseTo(levels15.bass_att, 10);
  });

  it("clamps above-144 fps to 144", () => {
    const levels144 = new OracleAudioLevels(SAMPLE_RATE);
    const levels240 = new OracleAudioLevels(SAMPLE_RATE);
    const imm = new Float32Array(FFT_SIZE / 2);
    for (let i = 0; i < 3; i++) imm[i] = 100;
    levels144.updateAudioLevels(imm, 144, 100);
    levels240.updateAudioLevels(imm, 240, 100);
    expect(levels240.bass).toBeCloseTo(levels144.bass, 10);
  });

  it("clamps non-finite fps to 15", () => {
    const levelsNaN = new OracleAudioLevels(SAMPLE_RATE);
    const levels15 = new OracleAudioLevels(SAMPLE_RATE);
    const imm = new Float32Array(FFT_SIZE / 2);
    for (let i = 0; i < 3; i++) imm[i] = 100;
    levelsNaN.updateAudioLevels(imm, NaN, 100);
    levels15.updateAudioLevels(imm, 15, 100);
    expect(levelsNaN.bass).toBeCloseTo(levels15.bass, 10);
  });
});

describe("OracleAudioLevels — longAvg < 0.001 fallback", () => {
  // Butterchurn audioLevels.updateAudioLevels at butterchurn.js:263-266:
  //   if (this.longAvg[i] < 0.001) { val[i] = 1.0; att[i] = 1.0 }
  it("returns val=1 and att=1 when longAvg falls below 0.001", () => {
    const levels = new OracleAudioLevels(SAMPLE_RATE);
    // Force longAvg to drop to near zero by feeding silence many times.
    // At fps=30 frame>=50, longAvg *= 0.992 each step and imm*0.008
    // approaches zero. To get longAvg < 0.001 we need many iterations.
    // Faster: initialize by construction, then feed a signal that
    // decays longAvg. Simpler: use fps clamp effects. Actually the
    // straightforward path is to feed silence for enough frames that
    // longAvg approaches 0, but the initial value is 1 so it takes
    // many iterations. Instead we verify the branch by feeding a very
    // small imm that keeps longAvg small.
    // Direct approach: feed silence for 2000 frames at fps=30 with
    // frame>=50 (rate 0.992). longAvg[k] = 1 * (0.992)^N.
    // For longAvg < 0.001 we need N > log(0.001) / log(0.992) ≈ 861.
    const silence = new Float32Array(FFT_SIZE / 2);
    for (let f = 0; f < 900; f++) levels.updateAudioLevels(silence, 30, f + 50);
    expect(levels.bass).toBe(1); // val fallback
    expect(levels.bass_att).toBe(1); // att fallback
  });
});

describe("OracleAudioLevels — adjustRateToFPS pow(rate, 30/fps)", () => {
  // Butterchurn audioLevels.adjustRateToFPS at butterchurn.js:312-314:
  //   return Math.pow(rate, baseFPS / FPS);
  // Verified indirectly: at fps=60 the rate 0.2 becomes 0.2^(30/60) =
  // sqrt(0.2) = 0.4472..., which halves the effective response window.
  it("computes rate exponent as baseFPS / fps", () => {
    const levels30 = new OracleAudioLevels(SAMPLE_RATE);
    const levels60 = new OracleAudioLevels(SAMPLE_RATE);
    const imm = new Float32Array(FFT_SIZE / 2);
    for (let i = 0; i < 3; i++) imm[i] = 100;
    levels30.updateAudioLevels(imm, 30, 0);
    levels60.updateAudioLevels(imm, 60, 0);
    // avg (short window):
    //   fps=30: rate 0.2, avg = 1*0.2 + 300*0.8 = 240.2
    //   fps=60: rate 0.2^(0.5) = 0.4472, avg = 1*0.4472 + 300*0.5528 = 166.29
    // longAvg (rate 0.9 at frame<50):
    //   fps=30: rate 0.9, longAvg = 1*0.9 + 300*0.1 = 30.9
    //   fps=60: rate 0.9^0.5 = 0.9487, longAvg = 1*0.9487 + 300*0.0513 = 16.34
    // att:
    //   fps=30: 240.2 / 30.9 = 7.774
    //   fps=60: 166.29 / 16.34 = 10.176
    expect(levels30.bass_att).toBeCloseTo(240.2 / 30.9, 6);
    const rate60Short = Math.pow(0.2, 0.5);
    const avg60 = 1 * rate60Short + 300 * (1 - rate60Short);
    const rate60Long = Math.pow(0.9, 0.5);
    const long60 = 1 * rate60Long + 300 * (1 - rate60Long);
    expect(levels60.bass_att).toBeCloseTo(avg60 / long60, 6);
  });
});

describe("OracleTimeModel — advance", () => {
  // Butterchurn Renderer.calcTimeAndFPS witnessed in src/core/milk-audio.ts
  // (the port carries the source math inline at OracleTimeModel.advance).
  // Rules: frameNum increments per step; time += 1/fps (BEFORE updating
  // fps for this frame); fps damped by 0.93 * old + 0.07 * new.
  it("increments frameNum per step", () => {
    const t = new OracleTimeModel();
    expect(t.frameNum).toBe(0);
    t.advance(1 / 30);
    expect(t.frameNum).toBe(1);
    t.advance(1 / 30);
    expect(t.frameNum).toBe(2);
  });

  it("integrates time using 1/fps per step (not the elapsed argument)", () => {
    // The witnessed advance uses `this.time += 1 / this.fps` — not += elapsed.
    // Starting fps=30, first step: time += 1/30 = 0.03333.
    const t = new OracleTimeModel();
    t.advance(1 / 30);
    expect(t.time).toBeCloseTo(1 / 30, 12);
    // Second step: fps has been damped slightly by the timeHist FPS
    // computation but the increment is 1/fps AT ENTRY, so the second
    // time addition uses the already-damped fps.
    const fpsAfterFirst = t.fps;
    t.advance(1 / 30);
    expect(t.time).toBeCloseTo(1 / 30 + 1 / fpsAfterFirst, 12);
  });

  it("damps fps toward the timeHist-derived new fps with a 0.93/0.07 mix", () => {
    // Feed exactly 1/30 s of elapsed per step for enough frames that the
    // 120-entry timeHist saturates. The witnessed steady-state fps is
    // NOT exactly 30 — src/core/milk-audio.ts uses length/(last - first)
    // over a moving window, which yields 120 / (119/30) ≈ 30.252 in the
    // steady state. This value matches the historical E2E-oracle
    // observation of globals.fps at ~30.25210 for equally-spaced steps.
    const t = new OracleTimeModel();
    for (let i = 0; i < 300; i++) t.advance(1 / 30);
    expect(t.fps).toBeCloseTo(120 / (119 / 30), 6);
  });

  it("returns the same {time, fps, frame} it stores", () => {
    const t = new OracleTimeModel();
    const r = t.advance(1 / 30);
    expect(r.time).toBe(t.time);
    expect(r.fps).toBe(t.fps);
    expect(r.frame).toBe(t.frameNum);
  });
});
