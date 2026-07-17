// Audio input — demo/mic/file sources feeding the pcm-tap AudioWorklet, which
// streams every sample block to Analysis.addSamples (the PCM::AddToBuffer
// model — see analysis.mjs). No AnalyserNode: the analysis chain is the
// derived MilkDrop FFT, not the browser's. If AudioWorklet is unavailable the
// source refuses to start rather than silently degrading.
import { Analysis } from './analysis.mjs';

export class AudioEngine {
  analysis = new Analysis();
  source = 'none';
  label = 'no source';
  /** @type {AudioContext|null} */ #ctx = null;
  /** @type {AudioWorkletNode|null} */ #tap = null;
  /** @type {AudioNode[]} */ #demoNodes = [];
  /** @type {ReturnType<typeof setInterval>|null} */ #demoTimer = null;
  /** @type {MediaStream|null} */ #micStream = null;
  /** @type {AudioBufferSourceNode|null} */ #fileSrc = null;

  /** @returns {Promise<AudioContext>} */ async #ensure() {
    if (!this.#ctx) {
      const ctx = new AudioContext();
      if (!ctx.audioWorklet) throw new Error('AudioWorklet unavailable — refusing to run without the derived PCM tap');
      await ctx.audioWorklet.addModule(new URL('./pcm-tap.js', import.meta.url));
      const tap = new AudioWorkletNode(ctx, 'pcm-tap');
      tap.port.onmessage = (e) => this.analysis.addSamples(e.data.l, e.data.r);
      tap.connect(ctx.destination); // silent output; keeps the node processing
      this.#ctx = ctx; this.#tap = tap;
    }
    if (this.#ctx.state === 'suspended') void this.#ctx.resume();
    return this.#ctx;
  }
  #stopAll() {
    for (const n of this.#demoNodes) {
      try { /** @type {any} */ (n).stop?.(); } catch { /* not started */ }
      try { n.disconnect(); } catch { /* detached */ }
    }
    this.#demoNodes = [];
    if (this.#demoTimer) { clearInterval(this.#demoTimer); this.#demoTimer = null; }
    this.#micStream?.getTracks().forEach((/** @type {MediaStreamTrack} */ t) => t.stop());
    this.#micStream = null;
    try { this.#fileSrc?.stop(); } catch { /* not started */ }
    this.#fileSrc = null;
  }
  async startDemo() {
    const ctx = await this.#ensure(); this.#stopAll();
    const tap = this.#tap;
    if (!tap) return;
    const out = ctx.createGain(); out.gain.value = 0.8;
    out.connect(tap); out.connect(ctx.destination);
    this.#demoNodes.push(out);
    const padF = ctx.createBiquadFilter();
    padF.type = 'lowpass'; padF.frequency.value = 600; padF.Q.value = 2;
    const padG = ctx.createGain(); padG.gain.value = 0.05;
    for (const fr of [110, 110.7, 164.8]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr;
      o.connect(padF); o.start(); this.#demoNodes.push(o);
    }
    padF.connect(padG); padG.connect(out);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 420;
    lfo.connect(lg); lg.connect(padF.frequency); lfo.start(); this.#demoNodes.push(lfo);
    const bpm = 124, spb = 60 / bpm, bassN = [55, 55, 65.4, 49];
    let step = 0, nextT = ctx.currentTime + 0.1;
    const schedule = () => {
      while (nextT < ctx.currentTime + 0.25) {
        const t = nextT, bar = Math.floor(step / 8), s8 = step % 8;
        if (s8 % 2 === 0) {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.frequency.setValueAtTime(150, t);
          o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
          g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
          o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.26);
        }
        {
          const b = ctx.createBufferSource();
          const buf = ctx.createBuffer(1, 2048, ctx.sampleRate);
          const d = buf.getChannelData(0);
          for (let i = 0; i < 2048; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / 2048) ** 2;
          b.buffer = buf;
          const hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 7000;
          const g = ctx.createGain(); g.gain.value = s8 % 2 ? 0.25 : 0.12;
          b.connect(hf); hf.connect(g); g.connect(out); b.start(t);
        }
        {
          const o = ctx.createOscillator(), g = ctx.createGain(), bf = ctx.createBiquadFilter();
          o.type = 'square'; o.frequency.value = (bassN[bar % 4] ?? 55) * (s8 === 6 ? 1.5 : 1);
          bf.type = 'lowpass'; bf.frequency.value = 340;
          g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + spb * 0.45);
          o.connect(bf); bf.connect(g); g.connect(out); o.start(t); o.stop(t + spb * 0.5);
        }
        nextT += spb / 2; step++;
      }
    };
    this.#demoTimer = setInterval(schedule, 60); schedule();
    this.source = 'demo'; this.label = 'internal demo · 124 bpm';
  }
  async startMic() {
    const ctx = await this.#ensure();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
    this.#stopAll(); this.#micStream = stream;
    if (this.#tap) ctx.createMediaStreamSource(stream).connect(this.#tap);
    this.source = 'mic'; this.label = 'microphone input';
  }
  async playFile(/** @type {File} */ file) {
    const ctx = await this.#ensure();
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    this.#stopAll();
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    if (this.#tap) { src.connect(this.#tap); src.connect(ctx.destination); }
    src.start();
    this.#fileSrc = src; this.source = 'file'; this.label = '♪ ' + file.name;
  }
}
