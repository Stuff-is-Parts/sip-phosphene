// Deterministic reference audio: the single source of synthetic audio for
// BOTH reference renderers (Butterchurn) and PHOSPHENE validation renders.
// Frames are pure functions of (frameIndex) — no Date, no randomness —
// so any renderer fed these bytes at the same frame times sees identical
// input. 1024 samples per frame (Butterchurn fftSize = numSamps 512 * 2),
// 8-bit unsigned, 128 = silence.
//
// The signal is music-like on purpose: a beat pulse (~2 Hz), a bass tone,
// mids, and a treble transient tied to the beat, so beat-gated preset
// behavior (bass > 1.3 idioms) actually fires. FPS base is 30 to match
// projectM's IIR rate reference.

export const SAMPLES = 1024;
export const FPS = 30;

/** Time-domain byte arrays for a frame: { c, l, r } Uint8Array(1024). */
export function audioFrame(frameIndex) {
  const t = frameIndex / FPS;
  const c = new Uint8Array(SAMPLES);
  const l = new Uint8Array(SAMPLES);
  const r = new Uint8Array(SAMPLES);
  // Beat envelope: sharp attack at each half-second, exponential decay.
  const beatPhase = (t * 2) % 1;
  const beatEnv = Math.exp(-beatPhase * 6);
  for (let i = 0; i < SAMPLES; i++) {
    const st = t + i / 44100; // per-sample time at 44.1kHz
    const bass = Math.sin(2 * Math.PI * 55 * st) * (0.45 + 0.4 * beatEnv);
    const mid = Math.sin(2 * Math.PI * 440 * st) * 0.18
              + Math.sin(2 * Math.PI * 660 * st + 1.3) * 0.12;
    const treb = Math.sin(2 * Math.PI * 6000 * st) * 0.10 * beatEnv
               + Math.sin(2 * Math.PI * 9500 * st + 0.7) * 0.05;
    const mono = Math.max(-1, Math.min(1, bass + mid + treb));
    // slight stereo divergence so L/R-dependent presets have signal
    const spread = Math.sin(2 * Math.PI * 0.25 * st + i * 0.002) * 0.06;
    const lv = Math.max(-1, Math.min(1, mono + spread));
    const rv = Math.max(-1, Math.min(1, mono - spread));
    c[i] = Math.round(128 + mono * 110);
    l[i] = Math.round(128 + lv * 110);
    r[i] = Math.round(128 + rv * 110);
  }
  return { c, l, r };
}

/** Frame indices captured as reference fixtures (shared by all harnesses). */
export const CAPTURE_FRAMES = [30, 90, 180, 300];
export const TOTAL_FRAMES = 301;
