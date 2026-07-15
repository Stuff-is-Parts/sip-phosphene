// Exact port of Butterchurn's audio + time chain, the validation oracle's
// authoritative reimplementation of MilkDrop semantics
// (COMPATIBILITY-GOAL.md Source Authority). Every constant and formula is
// witnessed in node_modules/butterchurn/lib/butterchurn.js:
//
// - FFT: src/audio/fft.js — samplesIn=1024, samplesOut=512, NFREQ=1024,
//   equalize table equalizeArr[i] = -0.02*ln((512-i)/512), raw signed
//   byte input (byte-128, NOT normalized), magnitude sqrt(re^2+im^2).
// - AudioProcessor: src/audio/audioProcessor.js — timeArray[i]=byte-128;
//   L/R smoothed pairwise then undersampled x2 to 512 samples; main
//   freqArray = FFT(timeArray).
// - AudioLevels: src/audio/audioLevels.js — bucketHz = sampleRate/1024;
//   band bin ranges from 20/320/2800/11025 Hz cutoffs; imm = plain bin
//   sum; avg IIR rate 0.2 (rising) / 0.5 (falling); longAvg rate 0.9
//   (frame<50) / 0.992, all rates adjusted pow(rate, 30/FPS); outputs
//   val = imm/longAvg (bass/mid/treb), att = avg/longAvg (_att), both
//   1.0 when longAvg < 0.001.
// - Time/FPS: src/rendering/renderer.js calcTimeAndFPS — time += 1/fps
//   each frame; fps starts 30, damped 0.93 toward
//   timeHist.length/(histSpan), abrupt jumps (>3) replace when
//   frame > 120; frameNum increments before globalVars are built.
//
// The oracle page is created with AudioContext({sampleRate: 44100}) so
// bucketHz is committed, not device-dependent.
//
// scripts/validate-audio-model.mjs proves this port against per-frame
// globalVars extracted from the running Butterchurn oracle.

export const ORACLE_SAMPLE_RATE = 44100;

const FFT_SIZE = 1024;
const NUM_SAMPS = 512;

/* ------------------------- FFT (butterchurn port) ---------------------- */

class ButterchurnFFT {
  constructor(samplesIn, samplesOut, equalize) {
    this.samplesIn = samplesIn;
    this.samplesOut = samplesOut;
    this.NFREQ = samplesOut * 2;
    if (equalize) {
      this.equalizeArr = new Float32Array(samplesOut);
      const invHalfNFREQ = 1.0 / samplesOut;
      for (let i = 0; i < samplesOut; i++) {
        this.equalizeArr[i] = -0.02 * Math.log((samplesOut - i) * invHalfNFREQ);
      }
    } else {
      this.equalizeArr = null;
    }
    // bit-reversal table
    this.bitrevtable = new Uint16Array(this.NFREQ);
    for (let i = 0; i < this.NFREQ; i++) this.bitrevtable[i] = i;
    for (let i = 0, j = 0; i < this.NFREQ; i++) {
      if (j > i) {
        const tmp = this.bitrevtable[i];
        this.bitrevtable[i] = this.bitrevtable[j];
        this.bitrevtable[j] = tmp;
      }
      let m = this.NFREQ >> 1;
      while (m >= 1 && j >= m) { j -= m; m >>= 1; }
      j += m;
    }
    // cos/sin table
    let dftsize = 2, tabsize = 0;
    while (dftsize <= this.NFREQ) { tabsize++; dftsize <<= 1; }
    this.cossintable = [new Float32Array(tabsize), new Float32Array(tabsize)];
    dftsize = 2;
    let k = 0;
    while (dftsize <= this.NFREQ) {
      const theta = -2.0 * Math.PI / dftsize;
      this.cossintable[0][k] = Math.cos(theta);
      this.cossintable[1][k] = Math.sin(theta);
      k++;
      dftsize <<= 1;
    }
  }

  timeToFrequencyDomain(waveDataIn) {
    const real = new Float32Array(this.NFREQ);
    const imag = new Float32Array(this.NFREQ);
    for (let i = 0; i < this.NFREQ; i++) {
      const idx = this.bitrevtable[i];
      real[i] = idx < this.samplesIn ? waveDataIn[idx] : 0;
      imag[i] = 0;
    }
    let dftsize = 2, t = 0;
    while (dftsize <= this.NFREQ) {
      const wpr = this.cossintable[0][t];
      const wpi = this.cossintable[1][t];
      let wr = 1.0, wi = 0.0;
      const hdftsize = dftsize >> 1;
      for (let m = 0; m < hdftsize; m++) {
        for (let i = m; i < this.NFREQ; i += dftsize) {
          const j = i + hdftsize;
          const tempr = wr * real[j] - wi * imag[j];
          const tempi = wr * imag[j] + wi * real[j];
          real[j] = real[i] - tempr;
          imag[j] = imag[i] - tempi;
          real[i] += tempr;
          imag[i] += tempi;
        }
        const wtemp = wr;
        wr = wtemp * wpr - wi * wpi;
        wi = wi * wpr + wtemp * wpi;
      }
      dftsize <<= 1;
      t++;
    }
    const out = new Float32Array(this.samplesOut);
    if (this.equalizeArr) {
      for (let i = 0; i < this.samplesOut; i++) {
        out[i] = this.equalizeArr[i] * Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
      }
    } else {
      for (let i = 0; i < this.samplesOut; i++) {
        out[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
      }
    }
    return out;
  }
}

/* --------------------- AudioProcessor (butterchurn port) --------------- */

export class OracleAudioProcessor {
  constructor() {
    this.fft = new ButterchurnFFT(FFT_SIZE, NUM_SAMPS, true);
    this.timeArray = new Int8Array(FFT_SIZE);
    this.timeByteArraySignedL = new Int8Array(FFT_SIZE);
    this.timeByteArraySignedR = new Int8Array(FFT_SIZE);
    this.tempTimeArrayL = new Int8Array(FFT_SIZE);
    this.tempTimeArrayR = new Int8Array(FFT_SIZE);
    this.timeArrayL = new Int8Array(NUM_SAMPS);
    this.timeArrayR = new Int8Array(NUM_SAMPS);
    this.freqArray = new Float32Array(NUM_SAMPS);
    this.freqArrayL = new Float32Array(NUM_SAMPS);
    this.freqArrayR = new Float32Array(NUM_SAMPS);
  }

  /** c/l/r: Uint8Array(1024) time-domain bytes, 128 = silence. */
  updateAudio(c, l, r) {
    for (let i = 0, j = 0, lastIdx = 0; i < FFT_SIZE; i++) {
      this.timeArray[i] = c[i] - 128;
      this.timeByteArraySignedL[i] = l[i] - 128;
      this.timeByteArraySignedR[i] = r[i] - 128;
      this.tempTimeArrayL[i] = 0.5 * (this.timeByteArraySignedL[i] + this.timeByteArraySignedL[lastIdx]);
      this.tempTimeArrayR[i] = 0.5 * (this.timeByteArraySignedR[i] + this.timeByteArraySignedR[lastIdx]);
      if (i % 2 === 0) {
        this.timeArrayL[j] = this.tempTimeArrayL[i];
        this.timeArrayR[j] = this.tempTimeArrayR[i];
        j += 1;
      }
      lastIdx = i;
    }
    this.freqArray = this.fft.timeToFrequencyDomain(this.timeArray);
    this.freqArrayL = this.fft.timeToFrequencyDomain(this.timeByteArraySignedL);
    this.freqArrayR = this.fft.timeToFrequencyDomain(this.timeByteArraySignedR);
  }
}

/* ---------------------- AudioLevels (butterchurn port) ----------------- */

const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class OracleAudioLevels {
  constructor(sampleRate = ORACLE_SAMPLE_RATE) {
    const bucketHz = sampleRate / FFT_SIZE;
    const bassLow = clampInt(Math.round(20 / bucketHz) - 1, 0, NUM_SAMPS - 1);
    const bassHigh = clampInt(Math.round(320 / bucketHz) - 1, 0, NUM_SAMPS - 1);
    const midHigh = clampInt(Math.round(2800 / bucketHz) - 1, 0, NUM_SAMPS - 1);
    const trebHigh = clampInt(Math.round(11025 / bucketHz) - 1, 0, NUM_SAMPS - 1);
    this.starts = [bassLow, bassHigh, midHigh];
    this.stops = [bassHigh, midHigh, trebHigh];
    this.val = new Float32Array(3);
    this.imm = new Float32Array(3);
    this.att = new Float32Array(3);
    this.avg = new Float32Array(3);
    this.longAvg = new Float32Array(3);
    this.att.fill(1);
    this.avg.fill(1);
    this.longAvg.fill(1);
  }

  static adjustRateToFPS(rate, baseFPS, FPS) {
    return Math.pow(rate, baseFPS / FPS);
  }

  updateAudioLevels(freqArray, fps, frame) {
    let effectiveFPS = fps;
    if (!Number.isFinite(effectiveFPS) || effectiveFPS < 15) effectiveFPS = 15;
    else if (effectiveFPS > 144) effectiveFPS = 144;
    this.imm.fill(0);
    for (let i = 0; i < 3; i++) {
      for (let j = this.starts[i]; j < this.stops[i]; j++) this.imm[i] += freqArray[j];
    }
    for (let i = 0; i < 3; i++) {
      let rate = this.imm[i] > this.avg[i] ? 0.2 : 0.5;
      rate = OracleAudioLevels.adjustRateToFPS(rate, 30.0, effectiveFPS);
      this.avg[i] = this.avg[i] * rate + this.imm[i] * (1 - rate);
      rate = frame < 50 ? 0.9 : 0.992;
      rate = OracleAudioLevels.adjustRateToFPS(rate, 30.0, effectiveFPS);
      this.longAvg[i] = this.longAvg[i] * rate + this.imm[i] * (1 - rate);
      if (this.longAvg[i] < 0.001) {
        this.val[i] = 1.0;
        this.att[i] = 1.0;
      } else {
        this.val[i] = this.imm[i] / this.longAvg[i];
        this.att[i] = this.avg[i] / this.longAvg[i];
      }
    }
  }

  get bass() { return this.val[0]; }
  get bass_att() { return this.att[0]; }
  get mid() { return this.val[1]; }
  get mid_att() { return this.att[1]; }
  get treb() { return this.val[2]; }
  get treb_att() { return this.att[2]; }
}

/* ----------------------- time/fps (butterchurn port) ------------------- */

export class OracleTimeModel {
  constructor() {
    this.frameNum = 0;
    this.fps = 30;
    this.time = 0;
    this.timeHist = [0];
    this.timeHistMax = 120;
  }

  /** One render step with an injected elapsedTime (seconds). Returns the
   *  {time, fps, frame} the renderer's globalVars carry for this frame. */
  advance(elapsed) {
    // calcTimeAndFPS with elapsedTime provided:
    this.time += 1.0 / this.fps;
    const newHistTime = this.timeHist[this.timeHist.length - 1] + elapsed;
    this.timeHist.push(newHistTime);
    if (this.timeHist.length > this.timeHistMax) this.timeHist.shift();
    const newFPS = this.timeHist.length / (newHistTime - this.timeHist[0]);
    // butterchurn uses this.frame (undefined on Renderer) in the jump
    // check: `this.frame > this.timeHistMax` is always false, so the
    // damped branch always runs (witnessed: Renderer has frameNum, not
    // frame; NaN/undefined comparisons are false).
    const damping = 0.93;
    this.fps = damping * this.fps + (1.0 - damping) * newFPS;
    // frameNum increments after calcTimeAndFPS, before globalVars.
    this.frameNum += 1;
    return { time: this.time, fps: this.fps, frame: this.frameNum };
  }
}

/* ------------- combined oracle model (audio + levels + time) ----------- */

/** Drives the full witnessed chain for a deterministic PCM source.
 *  step(c,l,r,elapsed) returns exactly the globalVars value set the
 *  Butterchurn renderer hands its equation runner each frame. */
export class OracleFrameModel {
  constructor(sampleRate = ORACLE_SAMPLE_RATE) {
    this.audio = new OracleAudioProcessor();
    this.levels = new OracleAudioLevels(sampleRate);
    this.timeModel = new OracleTimeModel();
  }

  step(c, l, r, elapsed) {
    const { time, fps, frame } = this.timeModel.advance(elapsed);
    this.audio.updateAudio(c, l, r);
    this.levels.updateAudioLevels(this.audio.freqArray, fps, frame);
    return {
      frame, time, fps,
      bass: this.levels.bass, bass_att: this.levels.bass_att,
      mid: this.levels.mid, mid_att: this.levels.mid_att,
      treb: this.levels.treb, treb_att: this.levels.treb_att,
    };
  }
}

/* --------------- PHOSPHENE AudioFeatures adapter (legacy path) --------- */

import { SAMPLES, FPS, audioFrame } from "./ref-audio.mjs";

/** Stateful mapper: deterministic ref-audio frames -> PHOSPHENE
 *  AudioFeatures. bass/mid/treble carry the oracle's val ratios
 *  (imm/longAvg) — the same numbers MilkDrop equations read. Used by the
 *  native-equivalence harness (any deterministic series works there) and
 *  by the legacy-path validation renders. */
export class MilkAudioModel {
  constructor() {
    this.model = new OracleFrameModel();
    this.beatCount = 0;
    this.lastBeat = 0;
    this.prevBassAtt = 0;
  }

  /** Features for frame index f (call sequentially from 0). */
  features(f) {
    const { c, l, r } = audioFrame(f);
    const t = f / FPS;
    const g = this.model.step(c, l, r, 1 / FPS);
    // Beat: bass_att crossing 1.3 upward — the documented preset idiom.
    if (g.bass_att > 1.3 && this.prevBassAtt <= 1.3) {
      this.beatCount++;
      this.lastBeat = t;
    }
    this.prevBassAtt = g.bass_att;
    const beat = Math.max(0, 1 - (t - this.lastBeat) * 3);

    // 64-bin spectrum/waveform for PHOSPHENE spec()/wav() — the native
    // uniform contract (not a MilkDrop surface; legacy path only).
    const mags = this.model.audio.freqArray;
    const bins = mags.length;
    const spec = new Float32Array(64);
    for (let i = 0; i < 64; i++) {
      const start = Math.floor(Math.pow(i / 64, 1.6) * (bins - 8));
      const end = Math.max(start + 1, Math.floor(Math.pow((i + 1) / 64, 1.6) * (bins - 8)));
      let s = 0;
      for (let k = start; k < end; k++) s += mags[k];
      spec[i] = Math.min(1, (s / (end - start)) / 96);
    }
    const wave = new Float32Array(64);
    for (let i = 0; i < 64; i++) wave[i] = (c[Math.floor(i * SAMPLES / 64)] - 128) / 128;

    return {
      beatCount: this.beatCount,
      lastBeat: this.lastBeat,
      bass: g.bass, mid: g.mid, treble: g.treb,
      beat,
      energy: (g.bass + g.mid + g.treb) / 3,
      bpm: 120,
      spec, wave,
      // Oracle-exact extras for milk-context consumers:
      bass_att: g.bass_att, mid_att: g.mid_att, treb_att: g.treb_att,
      time: g.time, fps: g.fps, frame: g.frame,
    };
  }
}
