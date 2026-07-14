import type { AudioFeatures } from "../core/types";

export class Analysis implements AudioFeatures {
  beatCount = 0;
  lastBeat = -10;
  bass = 0; mid = 0; treble = 0; beat = 0; energy = 0; bpm = 0;
  spec = new Float32Array(64);
  wave = new Float32Array(64);

  private avgBass = 0.01;
  private cooldown = 0;
  private beatTimes: number[] = [];
  private freq: Uint8Array<ArrayBuffer> | null = null;
  private time: Uint8Array<ArrayBuffer> | null = null;

  attach(analyser: AnalyserNode): void {
    this.freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    this.time = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    this.analyser = analyser;
  }
  private analyser: AnalyserNode | null = null;

  /** Simulated beat (transport TAP button, offline testing). */
  inject(nowSec: number): void {
    this.beat = 1;
    this.pushBeat(nowSec);
  }

  private pushBeat(nowSec: number): void {
    this.beatCount++;
    this.lastBeat = nowSec;
    this.beatTimes.push(nowSec);
    if (this.beatTimes.length > 9) this.beatTimes.shift();
    if (this.beatTimes.length >= 4) {
      const iv: number[] = [];
      for (let i = 1; i < this.beatTimes.length; i++) {
        iv.push(this.beatTimes[i] - this.beatTimes[i - 1]);
      }
      iv.sort((a, b) => a - b);
      const med = iv[iv.length >> 1];
      if (med > 0.25 && med < 1.5) this.bpm = Math.round(60 / med);
    }
  }

  update(nowSec: number): void {
    const an = this.analyser;
    if (!an || !this.freq || !this.time) {
      // Idle signal so the canvas is never dead.
      this.bass = 0.15 + 0.1 * Math.sin(nowSec * 0.8);
      this.mid = 0.12; this.treble = 0.08; this.energy = 0.12;
      this.beat *= 0.92;
      for (let i = 0; i < 64; i++) {
        this.spec[i] = 0.05 + 0.04 * Math.sin(nowSec * 2 + i * 0.4);
        this.wave[i] = Math.sin(nowSec * 3 + i * 0.3) * 0.15;
      }
      return;
    }
    an.getByteFrequencyData(this.freq);
    an.getByteTimeDomainData(this.time);
    const f = this.freq;
    const band = (lo: number, hi: number) => {
      let s = 0;
      for (let i = lo; i < hi; i++) s += f[i];
      return s / ((hi - lo) * 255);
    };
    const bass = band(1, 9), mid = band(9, 90), treble = band(90, 380);
    this.bass += (bass - this.bass) * 0.35;
    this.mid += (mid - this.mid) * 0.3;
    this.treble += (treble - this.treble) * 0.3;
    this.energy = this.bass * 0.5 + this.mid * 0.35 + this.treble * 0.15;

    this.avgBass = this.avgBass * 0.985 + bass * 0.015;
    if (this.cooldown > 0) this.cooldown--;
    if (bass > this.avgBass * 1.38 && bass > 0.12 && this.cooldown === 0) {
      this.beat = 1;
      this.cooldown = 14;
      this.pushBeat(nowSec);
    } else {
      this.beat *= 0.9;
    }

    const n = f.length;
    for (let i = 0; i < 64; i++) {
      const a = Math.floor(Math.pow(i / 64, 1.6) * 420) + 1;
      const b = Math.floor(Math.pow((i + 1) / 64, 1.6) * 420) + 2;
      let s = 0;
      for (let j = a; j < b; j++) s += f[Math.min(j, n - 1)];
      this.spec[i] += (s / ((b - a) * 255) - this.spec[i]) * 0.4;
      const w = (this.time[Math.floor((i / 64) * this.time.length)] - 128) / 128;
      this.wave[i] += (w - this.wave[i]) * 0.5;
    }
  }
}
