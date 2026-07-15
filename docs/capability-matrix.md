# Source-requirements inventory

Requirements evidence for the compatibility work governed by
[`COMPATIBILITY-GOAL.md`](../COMPATIBILITY-GOAL.md): what real content from
the incumbent tools actually uses. The Plane9 rows come from parsing all 252
scenes of a stock Plane9 install with `scripts/inventory-p9.mjs` (raw counts
in [`p9-corpus-report.json`](p9-corpus-report.json)); the MilkDrop rows from
the format documented in its BSD-released source and in projectM.

This document records what the source formats require. It makes no claim
about what PHOSPHENE currently supports; per COMPATIBILITY-GOAL.md, support
claims are established only by reference-validated conversion evidence.

## Plane9 corpus, by share of scenes using each capability

| Capability (Plane9 nodes) | Scenes |
|---|---|
| Fullscreen shader draw (Shader, RenderRect) | 247/252 |
| 3D geometry (RenderObject, MeshObject, Cube/Sphere/Plane/…) | 161/252 |
| Render-to-texture graphs (RenderToTexture, PreviousLayer, Store/CopyTexture) | 138/252 |
| Bloom | 103/252 |
| CPU expression dataflow (Expression, Vector, MinMax, HSLAToColor…) | 93/252 |
| Instancing with per-clone math (CloneExpression, MeshInstancer) | 59/252 |
| File textures / images | 42/252 |
| Transitions between scenes | 40/252 |
| Particles / fluid (Particles, Fluid2d, LinearSolver) | 21/252 |
| Audio analysis (Beat, SoundTexture, Spectrum, Oscilloscope, Waveform, Bars) | 17–12/252 |
| Text (TextWriter, Clock) | 7/252 |
| VR output | tagged subset |

## MilkDrop, from the documented preset format

| Capability |
|---|
| Per-frame equations (EEL: q-vars, audio vars, math funcs, loop/megabuf/compound assignment, lazy if-blocks) |
| Feedback warp (zoom/rot/dx/dy/warp per frame) |
| Frame decay |
| Waveform drawing (nWaveMode, wave_r/g/b/a/x/y) |
| Custom waves (wavecode_N, per-frame and per-point equations) |
| Custom shapes (shapecode_N, per-frame equations) |
| Per-pixel (per-vertex mesh) equations |
| MilkDrop 2 warp HLSL shaders |
| MilkDrop 2 composite HLSL shaders |
| Blur cascade (GetBlur1/2/3, three-stage) |
| Noise textures (noise_lq/mq/hq, volume variants) |
| Motion vectors, inner/outer borders, video echo, gamma/brighten/darken/solarize/invert |
| Preset blending / transitions |

projectM is an LGPL reimplementation of the same preset format; its source is
consulted as authoritative behavioral documentation per COMPATIBILITY-GOAL.md
(no code is ported from it).

## Licensing facts that bound content use

- Plane9 stock scenes: 250/252 CC BY-NC-SA (3.0 or 4.0), 2 CC0 — attribution
  fields carry through import; NC scenes stay out of any paid tier.
- MilkDrop 2 engine/format: BSD-licensed — algorithms portable with attribution.
- Individual `.milk` presets: property of their authors — import locally,
  strip before redistribution unless the author's terms allow it.
