/**
 * PRODUCTION MilkDrop audio + time chain — an exact TypeScript port of
 * the validation oracle's authoritative reimplementation of MilkDrop's
 * semantics (butterchurn). This module is the single source of truth for
 * MilkDrop-facing audio derivation: the MilkPipeline consumes it during
 * end-to-end execution, the E2E validation harness consumes it, and the
 * audio-model validation script consumes it. No handwritten second copy.
 *
 * Every constant and formula is witnessed in node_modules/butterchurn/
 * lib/butterchurn.js, mirrored verbatim at:
 *   docs/evidence/butterchurn/rendering_renderer.js (Renderer.calcTimeAndFPS)
 *   docs/evidence/butterchurn/[audio bundle in butterchurn.js head]
 *
 * Design:
 * - FFT: samplesIn=1024, samplesOut=512, NFREQ=1024, equalize table
 *   equalizeArr[i] = -0.02 * ln((512-i)/512), signed byte input (byte-128,
 *   NOT normalized), magnitude sqrt(re^2 + im^2).
 * - AudioProcessor: timeArray[i] = c[i]-128; L/R smoothed pairwise then
 *   undersampled x2 to 512 samples; three frequency arrays via FFT of
 *   the full 1024 signed-byte inputs.
 * - AudioLevels: bucketHz = sampleRate/1024; band bin ranges from
 *   20/320/2800/11025 Hz cutoffs; imm = plain bin sum; avg IIR rate 0.2
 *   (rising) / 0.5 (falling); longAvg rate 0.9 (frame<50) / 0.992, all
 *   rates adjusted pow(rate, 30/FPS); outputs val = imm/longAvg
 *   (bass/mid/treb), att = avg/longAvg (_att); both 1.0 when
 *   longAvg < 0.001.
 * - Time/FPS: time += 1/fps each frame; fps damped 0.93 toward
 *   timeHist.length/histSpan; frameNum increments after calcTimeAndFPS.
 */

export const ORACLE_SAMPLE_RATE = 44100;
const FFT_SIZE = 1024;
const NUM_SAMPS = 512;

/* ------------------------- FFT (butterchurn port) ---------------------- */

class ButterchurnFFT {
  private readonly samplesIn: number;
  private readonly samplesOut: number;
  private readonly NFREQ: number;
  private readonly equalizeArr: Float32Array | null;
  private readonly bitrevtable: Uint16Array;
  private readonly cossintable: [Float32Array, Float32Array];

  constructor(samplesIn: number, samplesOut: number, equalize: boolean) {
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

  timeToFrequencyDomain(waveDataIn: Int8Array | Int16Array): Float32Array {
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
  private readonly fft: ButterchurnFFT;
  readonly timeArray = new Int8Array(FFT_SIZE);
  readonly timeArrayL = new Int8Array(NUM_SAMPS);
  readonly timeArrayR = new Int8Array(NUM_SAMPS);
  private readonly timeByteArraySignedL = new Int8Array(FFT_SIZE);
  private readonly timeByteArraySignedR = new Int8Array(FFT_SIZE);
  private readonly tempTimeArrayL = new Int8Array(FFT_SIZE);
  private readonly tempTimeArrayR = new Int8Array(FFT_SIZE);
  freqArray: Float32Array = new Float32Array(NUM_SAMPS);
  freqArrayL: Float32Array = new Float32Array(NUM_SAMPS);
  freqArrayR: Float32Array = new Float32Array(NUM_SAMPS);

  constructor() {
    this.fft = new ButterchurnFFT(FFT_SIZE, NUM_SAMPS, true);
  }

  /** c/l/r: Uint8Array(1024) time-domain bytes, 128 = silence. */
  updateAudio(c: ArrayLike<number>, l: ArrayLike<number>, r: ArrayLike<number>): void {
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

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class OracleAudioLevels {
  private readonly starts: [number, number, number];
  private readonly stops: [number, number, number];
  private readonly val = new Float32Array(3);
  private readonly imm = new Float32Array(3);
  private readonly att = new Float32Array(3);
  private readonly avg = new Float32Array(3);
  private readonly longAvg = new Float32Array(3);

  constructor(sampleRate: number = ORACLE_SAMPLE_RATE) {
    const bucketHz = sampleRate / FFT_SIZE;
    const bassLow = clampInt(Math.round(20 / bucketHz) - 1, 0, NUM_SAMPS - 1);
    const bassHigh = clampInt(Math.round(320 / bucketHz) - 1, 0, NUM_SAMPS - 1);
    const midHigh = clampInt(Math.round(2800 / bucketHz) - 1, 0, NUM_SAMPS - 1);
    const trebHigh = clampInt(Math.round(11025 / bucketHz) - 1, 0, NUM_SAMPS - 1);
    this.starts = [bassLow, bassHigh, midHigh];
    this.stops = [bassHigh, midHigh, trebHigh];
    this.att.fill(1);
    this.avg.fill(1);
    this.longAvg.fill(1);
  }

  private static adjustRateToFPS(rate: number, baseFPS: number, FPS: number): number {
    return Math.pow(rate, baseFPS / FPS);
  }

  updateAudioLevels(freqArray: Float32Array, fps: number, frame: number): void {
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

  get bass(): number { return this.val[0]; }
  get bass_att(): number { return this.att[0]; }
  get mid(): number { return this.val[1]; }
  get mid_att(): number { return this.att[1]; }
  get treb(): number { return this.val[2]; }
  get treb_att(): number { return this.att[2]; }
}

/* ----------------------- time/fps (butterchurn port) ------------------- */

export class OracleTimeModel {
  frameNum = 0;
  fps = 30;
  time = 0;
  private timeHist: number[] = [0];
  private readonly timeHistMax = 120;

  /** One render step with an injected elapsedTime (seconds). Returns the
   *  {time, fps, frame} the renderer's globalVars carry for this frame. */
  advance(elapsed: number): { time: number; fps: number; frame: number } {
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
  readonly audio = new OracleAudioProcessor();
  readonly levels: OracleAudioLevels;
  readonly timeModel = new OracleTimeModel();

  constructor(sampleRate: number = ORACLE_SAMPLE_RATE) {
    this.levels = new OracleAudioLevels(sampleRate);
  }

  step(c: ArrayLike<number>, l: ArrayLike<number>, r: ArrayLike<number>, elapsed: number): {
    frame: number; time: number; fps: number;
    bass: number; bass_att: number;
    mid: number; mid_att: number;
    treb: number; treb_att: number;
  } {
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
