// Audio analysis DERIVED from projectM @ 2f244141320f6b97b09bf99964cc72a4efdfcfd3
// (src/libprojectM/Audio/: MilkdropFFT.cpp, Loudness.cpp, PCM.cpp) per the
// audit at reference/sip-phosphene-milkdrop-audio-reference.md. Samples arrive continuously from the
// pcm-tap.js AudioWorklet into the 576-sample rings below (AddToBuffer,
// PCM.cpp:12-37); the per-frame update copies the ring and runs the chain
// (UpdateFrameAudioData, PCM.cpp:52-74) — the same write/read model as the
// source. Not ported: WaveformAligner (rendering-stability only; nothing
// consumes it) and the right-channel spectrum (beat bands consume LEFT only
// per PCM.cpp:70-72; spectrumR gains a consumer before it gains code).
// Single-threaded JS replaces the source's mutex: worklet messages and the
// frame update interleave on one event loop, so no tearing is possible.

const AUDIO_BUFFER_SAMPLES = 576; // AudioConstants.hpp:8
const WAVEFORM_SAMPLES = 480;     // AudioConstants.hpp:9
const SPECTRUM_SAMPLES = 512;     // AudioConstants.hpp:10

// Radix-2 FFT with envelope + equalize tables — MilkdropFFT.cpp:37-203.
export class MilkdropFFT {
  constructor(/** @type {number} */ samplesIn, /** @type {number} */ samplesOut, /** @type {boolean} */ equalize) {
    this.samplesIn = samplesIn;
    this.numFrequencies = samplesOut * 2;                        // :39
    // bit-reversal table — :95-124
    const N = this.numFrequencies;
    this.bitRevTable = new Array(N);
    for (let i = 0; i < N; i++) this.bitRevTable[i] = i;
    let j = 0;
    for (let i = 0; i < N; i++) {
      if (j > i) { const t = this.bitRevTable[i]; this.bitRevTable[i] = this.bitRevTable[j]; this.bitRevTable[j] = t; }
      let m = N >> 1;
      while (m >= 1 && j >= m) { j -= m; m >>= 1; }
      j += m;
    }
    // per-octave twiddle roots — :126-148
    this.cosSinTable = [];
    for (let dftSize = 2; dftSize <= N; dftSize <<= 1) {
      const theta = -2 * Math.PI / dftSize;
      this.cosSinTable.push([Math.cos(theta), Math.sin(theta)]);
    }
    // Hann envelope, power = 1 — :47-74
    this.envelope = new Array(samplesIn);
    const mult = (1 / samplesIn) * 2 * Math.PI;
    for (let i = 0; i < samplesIn; i++) this.envelope[i] = 0.5 + 0.5 * Math.sin(i * mult - Math.PI * 0.5);
    // equalize table — :76-93
    const half = N / 2;
    this.equalize = new Array(half);
    if (equalize) {
      for (let i = 0; i < half; i++) this.equalize[i] = -0.02 * Math.log((half - i) / half);
    } else {
      for (let i = 0; i < half; i++) this.equalize[i] = 1;
    }
  }
  // waveformData (>= samplesIn) -> spectrum magnitudes (numFrequencies/2) — :150-203
  timeToFrequencyDomain(/** @type {Float32Array|number[]} */ waveformData) {
    const N = this.numFrequencies;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const idx = /** @type {number} */ (this.bitRevTable[i]);
      if (idx < this.samplesIn) re[i] = (waveformData[idx] ?? 0) * (this.envelope[idx] ?? 0);
    }
    let octave = 0;
    for (let dftSize = 2; dftSize <= N; dftSize <<= 1) {
      let wr = 1, wi = 0;
      const [wpr, wpi] = /** @type {[number, number]} */ (this.cosSinTable[octave]);
      const hdftsize = dftSize >> 1;
      for (let m = 0; m < hdftsize; m++) {
        for (let i = m; i < N; i += dftSize) {
          const j = i + hdftsize;
          const tr = (re[j] ?? 0) * wr - (im[j] ?? 0) * wi;
          const ti = (re[j] ?? 0) * wi + (im[j] ?? 0) * wr;
          re[j] = (re[i] ?? 0) - tr; im[j] = (im[i] ?? 0) - ti;
          re[i] = (re[i] ?? 0) + tr; im[i] = (im[i] ?? 0) + ti;
        }
        const nwr = wr * wpr - wi * wpi;
        wi = wr * wpi + wi * wpr; wr = nwr;
      }
      octave++;
    }
    const out = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) out[i] = (this.equalize[i] ?? 0) * Math.hypot(re[i] ?? 0, im[i] ?? 0);
    return out;
  }
}

// Relative band loudness — Loudness.cpp:29-58. band: 0=bass, 1=mid, 2=treb;
// band i sums spectrum samples [512*i/6, 512*(i+1)/6) (integer division).
export class Loudness {
  constructor(/** @type {number} */ band) {
    this.band = band;
    this.average = 0; this.longAverage = 0;
    this.currentRelative = 1; this.averageRelative = 1;
  }
  static adjustRateToFps(/** @type {number} */ rate, /** @type {number} */ dt) {  // :53-58
    return Math.pow(Math.pow(rate, 30), dt);
  }
  update(/** @type {Float32Array} */ spectrum, /** @type {number} */ dt, /** @type {number} */ frame) {
    const start = Math.floor(SPECTRUM_SAMPLES * this.band / 6);       // :31-32
    const end = Math.floor(SPECTRUM_SAMPLES * (this.band + 1) / 6);
    let current = 0;
    for (let s = start; s < end; s++) current += spectrum[s] ?? 0;
    let rate = Loudness.adjustRateToFps(current > this.average ? 0.2 : 0.5, dt); // :43-44
    this.average = this.average * rate + current * (1 - rate);
    rate = Loudness.adjustRateToFps(frame < 50 ? 0.9 : 0.992, dt);               // :46-47
    this.longAverage = this.longAverage * rate + current * (1 - rate);
    this.currentRelative = Math.abs(this.longAverage) < 0.001 ? 1 : current / this.longAverage; // :49
    this.averageRelative = Math.abs(this.longAverage) < 0.001 ? 1 : this.average / this.longAverage; // :50
  }
}

// The per-frame chain — PCM.cpp:52-97. Values revolve around 1.0 (silence -> 1.0
// via the longAverage guard), so no scaling belongs between here and the pool.
export class Analysis {
  bass = 1; mid = 1; treb = 1;
  bassAtt = 1; midAtt = 1; trebAtt = 1;
  vol = 1; volAtt = 1;
  spectrum = new Float32Array(SPECTRUM_SAMPLES);
  waveform = new Float32Array(0); // display tap consumed by the studio scope overlay
  #fft = new MilkdropFFT(WAVEFORM_SAMPLES, SPECTRUM_SAMPLES, true); // PCM.hpp:107
  #bassL = new Loudness(0);
  #midL = new Loudness(1);
  #trebL = new Loudness(2);
  #frame = 0;
  // 576-sample input rings — PCM.cpp AddToBuffer model
  #inputL = new Float32Array(AUDIO_BUFFER_SAMPLES);
  #inputR = new Float32Array(AUDIO_BUFFER_SAMPLES);
  #start = 0;

  // Continuous sample intake from the worklet tap — PCM.cpp:12-37 (float
  // variant Add: 128 * sample / 1, PCM.cpp:26,39-42; mono duplicates into
  // both channels per the channels==1 path, PCM.cpp:31-34).
  addSamples(/** @type {Float32Array} */ left, /** @type {Float32Array|null} */ right) {
    const count = left.length;
    for (let i = 0; i < count; i++) {
      const off = (this.#start + i) % AUDIO_BUFFER_SAMPLES;
      this.#inputL[off] = 128 * (left[i] ?? 0);
      this.#inputR[off] = right ? 128 * (right[i] ?? 0) : /** @type {number} */ (this.#inputL[off]);
    }
    this.#start = (this.#start + count) % AUDIO_BUFFER_SAMPLES;
  }
  update(/** @type {number} */ dt) {
    this.#frame += 1;
    // copy the ring oldest-to-newest — CopyNewWaveformData, PCM.cpp:117-125
    /** @type {number[]} */
    const wave = new Array(AUDIO_BUFFER_SAMPLES);
    for (let i = 0; i < AUDIO_BUFFER_SAMPLES; i++) wave[i] = this.#inputL[(this.#start + i) % AUDIO_BUFFER_SAMPLES] ?? 0;
    // pre-FFT adjacent-sample damping — PCM.cpp:104-110
    /** @type {number[]} */
    const damped = new Array(AUDIO_BUFFER_SAMPLES);
    let oldI = 0;
    for (let i = 0; i < AUDIO_BUFFER_SAMPLES; i++) { damped[i] = 0.5 * ((wave[i] ?? 0) + (wave[oldI] ?? 0)); oldI = i; }
    this.waveform = Float32Array.from(damped); // display copy; the chain's array stays private
    this.spectrum = this.#fft.timeToFrequencyDomain(damped);
    this.#bassL.update(this.spectrum, dt, this.#frame);   // PCM.cpp:70-72
    this.#midL.update(this.spectrum, dt, this.#frame);
    this.#trebL.update(this.spectrum, dt, this.#frame);
    this.bass = this.#bassL.currentRelative;              // PCM.cpp:85-91
    this.mid = this.#midL.currentRelative;
    this.treb = this.#trebL.currentRelative;
    this.bassAtt = this.#bassL.averageRelative;
    this.midAtt = this.#midL.averageRelative;
    this.trebAtt = this.#trebL.averageRelative;
    this.vol = (this.bass + this.mid + this.treb) * 0.333;          // PCM.cpp:93
    this.volAtt = (this.bassAtt + this.midAtt + this.trebAtt) * 0.333; // PCM.cpp:94
  }
}
