// Audio input — demo/mic/file sources feeding an AnalyserNode.
// Lifted from the prior build (engine-independent). Drives the Analysis class.
import { Analysis } from './analysis.mjs';

export class AudioEngine {
  analysis = new Analysis();
  source = 'none';
  label = 'no source — idle signal';
  #ctx = null; #analyser = null; #demoNodes = []; #demoTimer = null;
  #micStream = null; #fileSrc = null;

  #ensure() {
    if (!this.#ctx) {
      this.#ctx = new AudioContext();
      this.#analyser = this.#ctx.createAnalyser();
      this.#analyser.fftSize = 2048;
      this.#analyser.smoothingTimeConstant = 0.72;
      this.analysis.attach(this.#analyser);
    }
    if (this.#ctx.state === 'suspended') void this.#ctx.resume();
    return this.#ctx;
  }
  #stopAll() {
    for (const n of this.#demoNodes) {
      try { n.stop?.(); } catch { /* not started */ }
      try { n.disconnect(); } catch { /* detached */ }
    }
    this.#demoNodes = [];
    if (this.#demoTimer) { clearInterval(this.#demoTimer); this.#demoTimer = null; }
    this.#micStream?.getTracks().forEach((t) => t.stop());
    this.#micStream = null;
    try { this.#fileSrc?.stop(); } catch { /* not started */ }
    this.#fileSrc = null;
    try { this.#analyser?.disconnect(); } catch { /* detached */ }
  }
  startDemo() {
    const ctx = this.#ensure(); this.#stopAll();
    const analyser = this.#analyser;
    const out = ctx.createGain(); out.gain.value = 0.8;
    out.connect(analyser); analyser.connect(ctx.destination);
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
          o.type = 'square'; o.frequency.value = bassN[bar % 4] * (s8 === 6 ? 1.5 : 1);
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
    const ctx = this.#ensure();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } });
    this.#stopAll(); this.#micStream = stream;
    ctx.createMediaStreamSource(stream).connect(this.#analyser);
    this.source = 'mic'; this.label = 'microphone input';
  }
  async playFile(file) {
    const ctx = this.#ensure();
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    this.#stopAll();
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    src.connect(this.#analyser); this.#analyser.connect(ctx.destination); src.start();
    this.#fileSrc = src; this.source = 'file'; this.label = '♪ ' + file.name;
  }
}
