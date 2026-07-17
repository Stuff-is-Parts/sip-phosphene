// Audio analysis — bass/mid/treble/beat/energy/bpm from an AnalyserNode.
// Lifted from the prior build (engine-independent). Idle-signal fallback so the
// canvas is never dead. No external type dependency.
export class Analysis {
  bass = 0; mid = 0; treble = 0; beat = 0; energy = 0; bpm = 0;
  spec = new Float32Array(64);
  wave = new Float32Array(64);
  #avgBass = 0.01;
  #cooldown = 0;
  /** @type {number[]} */ #beatTimes = [];
  /** @type {Uint8Array<ArrayBuffer>|null} */ #freq = null;
  /** @type {Uint8Array<ArrayBuffer>|null} */ #time = null;
  /** @type {AnalyserNode|null} */ #analyser = null;

  attach(/** @type {AnalyserNode} */ analyser) {
    this.#freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    this.#time = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    this.#analyser = analyser;
  }
  inject(/** @type {number} */ nowSec) { this.beat = 1; this.#pushBeat(nowSec); }
  #pushBeat(/** @type {number} */ nowSec) {
    this.#beatTimes.push(nowSec);
    if (this.#beatTimes.length > 9) this.#beatTimes.shift();
    if (this.#beatTimes.length >= 4) {
      const iv = [];
      for (let i = 1; i < this.#beatTimes.length; i++) iv.push((this.#beatTimes[i] ?? 0) - (this.#beatTimes[i - 1] ?? 0));
      iv.sort((a, b) => a - b);
      const med = iv[iv.length >> 1] ?? 0;
      if (med > 0.25 && med < 1.5) this.bpm = Math.round(60 / med);
    }
  }
  update(/** @type {number} */ nowSec) {
    const an = this.#analyser;
    if (!an || !this.#freq || !this.#time) {
      this.bass = 0.15 + 0.1 * Math.sin(nowSec * 0.8);
      this.mid = 0.12; this.treble = 0.08; this.energy = 0.12; this.beat *= 0.92;
      for (let i = 0; i < 64; i++) {
        this.spec[i] = 0.05 + 0.04 * Math.sin(nowSec * 2 + i * 0.4);
        this.wave[i] = Math.sin(nowSec * 3 + i * 0.3) * 0.15;
      }
      return;
    }
    const freq = this.#freq, time = this.#time;
    if (!freq || !time) return;
    an.getByteFrequencyData(freq);
    an.getByteTimeDomainData(time);
    const f = freq;
    const band = (/** @type {number} */ lo, /** @type {number} */ hi) => { let s = 0; for (let i = lo; i < hi; i++) s += f[i] ?? 0; return s / ((hi - lo) * 255); };
    const bass = band(1, 9), mid = band(9, 90), treble = band(90, 380);
    this.bass += (bass - this.bass) * 0.35;
    this.mid += (mid - this.mid) * 0.3;
    this.treble += (treble - this.treble) * 0.3;
    this.energy = this.bass * 0.5 + this.mid * 0.35 + this.treble * 0.15;
    this.#avgBass = this.#avgBass * 0.985 + bass * 0.015;
    if (this.#cooldown > 0) this.#cooldown--;
    if (bass > this.#avgBass * 1.38 && bass > 0.12 && this.#cooldown === 0) {
      this.beat = 1; this.#cooldown = 14; this.#pushBeat(nowSec);
    } else { this.beat *= 0.9; }
    const n = f.length;
    for (let i = 0; i < 64; i++) {
      const a = Math.floor(Math.pow(i / 64, 1.6) * 420) + 1;
      const b = Math.floor(Math.pow((i + 1) / 64, 1.6) * 420) + 2;
      let s = 0; for (let j = a; j < b; j++) s += f[Math.min(j, n - 1)] ?? 0;
      this.spec[i] = (this.spec[i] ?? 0) + (s / ((b - a) * 255) - (this.spec[i] ?? 0)) * 0.4;
      const w = ((time[Math.floor((i / 64) * time.length)] ?? 128) - 128) / 128;
      this.wave[i] = (this.wave[i] ?? 0) + (w - (this.wave[i] ?? 0)) * 0.5;
    }
  }
}
