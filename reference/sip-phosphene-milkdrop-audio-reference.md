# MilkDrop and Plane9 Audio Evidence {#top}

---

### DOCUMENT ROLE

Layer 4 reference opened for audio capture, FFT, loudness, beat, waveform,
spectrum, or scene audio-input work. Responsibility: preserves the cited source
contracts for MilkDrop's audio variables and Plane9's scene-facing audio path;
the source inventory owns cross-engine status.

---

### 1. AUDIO CONTRACTS {#audio-contracts}

#### I. WHAT

Audio is a raw host substrate translated into source-specific, explicit scene
semantics: MilkDrop's PCM/FFT/Loudness variables and Plane9's audio nodes.

#### II. HOW

Sources opened this audit (per SOURCE-LOCATIONS.md; no retained copies):
- **[MD-SRC]** projectM @ 2f244141320f6b97b09bf99964cc72a4efdfcfd3 (master,
  fetched 2026-07-17): src/libprojectM/Audio/{AudioConstants.hpp,
  FrameAudioData.hpp, PCM.cpp/.hpp, Loudness.cpp/.hpp, MilkdropFFT.cpp}.
  Tier 2 — classic vis_milk2 source (tier 1) not yet consulted; consult on any
  suspected divergence.
- **[P9-HIST]** history.txt in C:\Program Files (x86)\Plane9 (author changelog).
- **[P9-CORPUS]** scene.xml extracted from corpus .p9c files (named per row).

═══════════════════════════════════════════════════════════════════
## MILKDROP — what bass/mid/treb/…_att/vol ACTUALLY are
═══════════════════════════════════════════════════════════════════

The pipeline, per frame [MD-SRC PCM.cpp:52-74]:
1. copy newest 576 waveform samples per channel (input normalized to ±128
   scale: `128 * sample / amplitude`, PCM.cpp:26; AudioConstants.hpp:8);
2. FFT each channel: 480 samples in → 512 spectrum samples out, equalize=true
   (PCM.hpp:107), with pre-FFT adjacent-sample damping
   `0.5*(x[i]+x[i-1])` (PCM.cpp:107-109), Hann envelope
   `0.5+0.5*sin(i*mult−π/2)` (MilkdropFFT.cpp:64), equalize table
   `−0.02*ln((N/2−i)/(N/2))` (MilkdropFFT.cpp:86-93);
3. align waveforms for stable rendering (PCM.cpp:66-67, WaveformAligner);
4. beat detection runs on the LEFT channel spectrum only (PCM.cpp:70-72).

| Variable | Source computation | Citation |
|---|---|---|
| band sum (bass/mid/treb) | sum of spectrum samples in band sixth: band i sums `[512·i/6, 512·(i+1)/6)` — bass = first sixth, mid = second, treb = third (only the first half of the spectrum is used) | Loudness.cpp:29-39, Loudness.hpp:26-33 |
| short average | `avg = avg·rate + current·(1−rate)`, rate = 0.2 when rising, 0.5 when falling, FPS-adjusted | Loudness.cpp:41-44 |
| long average | same form, rate = 0.9 for first 50 frames, else 0.992, FPS-adjusted | Loudness.cpp:46-47 |
| FPS adjustment | `pow(pow(rate,30), secondsSinceLastFrame)` — rates are defined at 30 FPS and scaled to actual dt | Loudness.cpp:53-58 |
| **bass / mid / treb** | `current / longAverage` (1.0 when longAverage < 0.001) — RELATIVE loudness revolving around 1.0; <0.7 quiet, >1.3 loud | Loudness.cpp:49, Loudness.hpp:52-55 |
| **bass_att / mid_att / treb_att** | `shortAverage / longAverage` — the attenuated (smoothed) relative loudness; NOT an alias of bass | Loudness.cpp:50, PCM.cpp:89-91 |
| **vol / vol_att** | `(bass+mid+treb)·0.333` / `(bassAtt+midAtt+trebAtt)·0.333` | PCM.cpp:93-94 |
| waveform | 480 samples per channel of the aligned, ±128-scaled wave | FrameAudioData.hpp:31-32, AudioConstants.hpp:9 |
| spectrum | 512 samples per channel | FrameAudioData.hpp:34-35 |

**Implication for the current engine (the drift this table replaces):**
`src/audio/analysis.mjs` bands (bins 1-9/9-90/90-380 of an AnalyserNode),
smoothing constants (0.35/0.3), beat threshold (1.38·avg), and BPM are invented;
`engine.mjs` aliasing `bass_att = bass` contradicts Loudness.cpp:50. The
faithful path: getFloatTimeDomainData → own 480→512 FFT port (envelope +
equalize per MilkdropFFT.cpp) → band sixths → the two-average relative chain
above. Web Audio's AnalyserNode FFT is NOT the MilkDrop FFT chain and cannot be
configured into it — the FFT itself is part of the ported semantics.

═══════════════════════════════════════════════════════════════════
## PLANE9 — engine-level audio + the three scene-facing nodes
═══════════════════════════════════════════════════════════════════

Engine-level behavior (author changelog) [P9-HIST, line numbers in history.txt]:

| Behavior | Evidence |
|---|---|
| Sound analyzer locked to 30 Hz update | :68 |
| Input contract 44.1 kHz; higher rates downsampled by skipping samples | :86-87 |
| Auto-normalization: running max, decays over time (~7 s high→low), up to 1000× | :74, :79, :295 |
| Up to 18 capture channels folded into left/right | :206 |
| Capture from "what you hear" or default recording device | :197 |
| Silence detection drives auto scene change | :207, :36 |
| Channel −1 = mono fold for waveform/spectrum consumers | :345 |

Scene-facing audio nodes (ports witnessed in corpus scene.xml; 34 of 252 corpus
scenes carry at least one) [P9-CORPUS]:

| Node | Ports (witnessed values) | Output wiring witnessed | Scene |
|---|---|---|---|
| SoundTexture | SoundType=0, History=50, Width=2, Damping=0.1, IncreaseRate=10, DecreaseRate=0.5, SpectrumAmplification=5 | `SoundTexture1.Texture → Shader1.Texture1` (audio as a texture input to shaders) | Line/Waves of sin.p9c |
| Beat | NoMusic=7.81847, Amplification=1, Min=1, Max=15 | `Beat1.BeatStrength → Rotator1.RotSpeedY` (scalar drives node params) | Abstract/Beyond The Stars.p9c |
| Spectrum | NoMusicLeft=0, NoMusicRight=0, NoMusicMono=0, Amplification=0.5 | `Spectrum1.Mono → Oscilloscope1.Wave` | Music/Rotating Osciloscope.p9c |
| Expression `band()` | four-arg calls witnessed: `band(0,1,0,0)`, `band(-1,1,0,0.1)`, `band(-1,2,0,0.005)` — first arg is channel (−1 = mono per :345), last is damping (per :383 "band … for different channels, damping and bands") | value used in expressions scaling motion/color | Abstract/Blue Particles, Color Beams, Electro, Entity |

**UNRESOLVED** (sources searched: history.txt, plane9.txt, corpus XML): the
exact internal math of Beat's NoMusic/Min/Max thresholds, SoundTexture's
History accumulation, and band()'s 2nd/3rd argument semantics. Next sources per
registry: plane9.com docs (Plane9Doc.url), Plane9Engine.dll strings, targeted
Studio observation. Not invented in the meantime — a PHOSPHENE port of these
nodes blocks on resolving them.

═══════════════════════════════════════════════════════════════════
## PHOSPHENE IMPLICATIONS (derived)
═══════════════════════════════════════════════════════════════════

1. The pool variables scenes read (`bass`, `bass_att`, …, `vol`) get MilkDrop's
   semantics — relative-to-long-average, revolving around 1.0 — replacing the
   invented 0..1 band energies. Silence then reads ~1.0 (matching MilkDrop's
   behavior), and the player's `0.5 + bass*2` scaling shim is deleted, not
   re-derived: with correct relative values no scaling belongs between the
   analyzer and the pool.
2. The FFT chain (480→512, envelope, equalize, adjacent-sample damping) is a
   port target of its own — P4/P1 per the MilkDrop primitive contract — testable against
   reference values computed from the cited formulas on fixed input.
3. Plane9's audio enters scenes as NODES (texture/scalar/wave via ports), which
   the .phos graph already models; MilkDrop's enters as pool variables. Both
   fit the existing five primitives; no new primitive required.
4. Non-reactive scenes are the degenerate case (no audio variable read, no
   audio node) — audio is ambient engine input in both source engines, present
   for every scene.

#### III. WHY

Source-specific analysis behavior is observable scene input, not interchangeable
browser plumbing; preserving its formulas and lifecycle prevents a plausible
Web Audio approximation from silently changing converted scenes.

[Back to Top](#top)
