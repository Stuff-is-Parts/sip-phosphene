// MilkDrop audio semantics from the documented model
// (docs/milkdrop-execution-model.md §3, derived from projectM
// Audio/Loudness.cpp): FFT of the time-domain frame, 6-equal-band split,
// bands 0/1/2 = bass/mid/treb, short-window asymmetric IIR (0.2 attack /
// 0.5 release), long-window baseline (0.9 first 50 frames, then 0.992),
// values exposed as ratios around 1.0.
//
// Consumes the deterministic frames from ref-audio.mjs so PHOSPHENE
// validation renders see the SAME audio the Butterchurn oracle saw.

import { SAMPLES, FPS, audioFrame } from "./ref-audio.mjs";

/* ---------------------------- radix-2 FFT ----------------------------- */

function fftMagnitudes(samples /* Float64Array length N (power of 2) */) {
  const n = samples.length;
  const re = Float64Array.from(samples);
  const im = new Float64Array(n);
  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k], uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe; im[i + k + len / 2] = uIm - vIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
  const mags = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mags[i] = Math.hypot(re[i], im[i]) / (n / 2);
  return mags;
}

/* ------------------------- Loudness state model ------------------------ */

class BandLoudness {
  constructor() { this.current = 0; this.average = 0; this.longAverage = 0; this.frames = 0; }
  /** rates are per-frame decay factors at 30 fps (Loudness.cpp). */
  update(sum, secondsSinceLastFrame) {
    const adjust = (rate) => Math.pow(Math.pow(rate, FPS), secondsSinceLastFrame);
    this.current = sum;
    const shortRate = adjust(sum > this.average ? 0.2 : 0.5);
    this.average = this.average * shortRate + sum * (1 - shortRate);
    const longRate = adjust(this.frames < 50 ? 0.9 : 0.992);
    this.longAverage = this.longAverage * longRate + sum * (1 - longRate);
    this.frames++;
  }
  get relative() { return this.average / Math.max(this.longAverage, 0.001); }
  get relativeAtt() { return this.current / Math.max(this.longAverage, 0.001); }
}

/** Stateful mapper: deterministic ref-audio frames -> PHOSPHENE
 *  AudioFeatures with MilkDrop-correct value semantics. */
export class MilkAudioModel {
  constructor() {
    this.bands = [new BandLoudness(), new BandLoudness(), new BandLoudness()];
    this.beatCount = 0;
    this.lastBeat = 0;
    this.prevBassAtt = 0;
  }

  /** Features for frame index f (call sequentially from 0). */
  features(f) {
    const { c } = audioFrame(f);
    const t = f / FPS;
    const signed = new Float64Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) signed[i] = (c[i] - 128) / 128;
    const mags = fftMagnitudes(signed); // 512 bins
    const bins = mags.length;
    const bandSums = [0, 0, 0];
    for (let b = 0; b < 3; b++) {
      const start = Math.floor(bins * b / 6), end = Math.floor(bins * (b + 1) / 6);
      for (let i = start; i < end; i++) bandSums[b] += mags[i];
      this.bands[b].update(bandSums[b], 1 / FPS);
    }
    const bass = this.bands[0].relative;
    const mid = this.bands[1].relative;
    const treble = this.bands[2].relative;
    const bassAtt = this.bands[0].relativeAtt;
    // Beat: bass_att crossing 1.3 upward — the documented preset idiom.
    if (bassAtt > 1.3 && this.prevBassAtt <= 1.3) {
      this.beatCount++;
      this.lastBeat = t;
    }
    const beat = Math.max(0, 1 - (t - this.lastBeat) * 3);
    this.prevBassAtt = bassAtt;

    // 64-bin log-ish downsample for PHOSPHENE spec()/wav().
    const spec = new Float32Array(64);
    for (let i = 0; i < 64; i++) {
      const start = Math.floor(Math.pow(i / 64, 1.6) * (bins - 8));
      const end = Math.max(start + 1, Math.floor(Math.pow((i + 1) / 64, 1.6) * (bins - 8)));
      let s = 0;
      for (let k = start; k < end; k++) s += mags[k];
      spec[i] = Math.min(1, (s / (end - start)) * 8);
    }
    const wave = new Float32Array(64);
    for (let i = 0; i < 64; i++) wave[i] = signed[Math.floor(i * SAMPLES / 64)];

    return {
      beatCount: this.beatCount,
      lastBeat: this.lastBeat,
      bass, mid, treble,
      beat,
      energy: (bass + mid + treble) / 3,
      bpm: 120,
      spec, wave,
    };
  }
}
