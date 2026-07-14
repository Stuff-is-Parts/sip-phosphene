# Visualizer capability matrix

Ground truth for parity work: what real content from the incumbent tools
actually uses, against what PHOSPHENE has. The Plane9 column comes from
parsing all 252 scenes of a stock Plane9 install with `scripts/inventory-p9.mjs`
(raw counts in [`p9-corpus-report.json`](p9-corpus-report.json)); the MilkDrop
column from the format documented in its BSD-released source.

## Plane9 corpus, by share of scenes using each capability

| Capability (Plane9 nodes) | Scenes | PHOSPHENE answer |
|---|---|---|
| Fullscreen shader draw (Shader, RenderRect) | 247/252 | ✅ WGSL stages, superset (audio uniforms, //@param) |
| 3D geometry (RenderObject, MeshObject, Cube/Sphere/Plane/…) | 161/252 | 🟡 raymarched SDF (sdSphere/sdBox/sdTorus/sdCylinder, opRep, camRay) — no rasterized mesh pipeline |
| Render-to-texture graphs (RenderToTexture, PreviousLayer, Store/CopyTexture) | 138/252 | 🟡 fixed bg→fg→post + ping-pong feedback covers the dominant feedback use; arbitrary pass graphs are spec'd (see scene spec, Future) |
| Bloom | 103/252 | 🟡 per-scene in-shader glow; no separable built-in pass |
| CPU expression dataflow (Expression, Vector, MinMax, HSLAToColor…) | 93/252 | ✅ expression mod source (`expr` routes, per-frame programs, persistent vars) |
| Instancing with per-clone math (CloneExpression, MeshInstancer) | 59/252 | 🟡 in-shader loops; no instance-buffer primitive |
| Transitions between scenes | 40/252 | ✅ crossfade/liquid/iris/warp-slide morphs |
| File textures / images | 42/252 | ✅ scene-embedded image, `img(uv)` |
| Particles / fluid (Particles, Fluid2d, LinearSolver) | 21/252 | 🟡 shader-side fields; no stateful particle system |
| Audio analysis (Beat, SoundTexture, Spectrum, Oscilloscope, Waveform, Bars) | 17–12/252 | ✅ superset: bands, flux beat, median BPM, 64-bin spectrum + waveform, `spec()/wav()` |
| Text (TextWriter, Clock) | 7/252 | ❌ none |
| VR output | tagged subset | ❌ none |

## MilkDrop, from the documented preset format

| Capability | PHOSPHENE answer |
|---|---|
| Per-frame equations (EEL: q-vars, audio vars, math funcs, loop/megabuf/compound assignment, lazy if-blocks) | ✅ `expr` mod routes — corpus-verified: 9,666 of 9,669 equation-bearing Cream of the Crop presets compile (99.97%, [`milk-corpus-report.json`](milk-corpus-report.json)); the 3 failures are malformed files real MilkDrop also drops |
| Feedback warp (zoom/rot/dx/dy/warp per frame) | ✅ `warpUV()` stdlib + expression-driven params |
| Frame decay | ✅ `mdDecay` route on `prevTex` |
| Waveform drawing (nWaveMode, wave_r/g/b/a/x/y) | ✅ `waveLine()` stdlib polyline; modes collapse to the main draw |
| Custom waves (wavecode_N) | 🟡 mapped onto the main waveform draw; per-wave equations not executed |
| Custom shapes (shapecode_N) | ❌ reported, not represented |
| Per-pixel (per-vertex mesh) equations | 🟡 approximated by the parametric warp wobble |
| MilkDrop 2 warp/comp HLSL shaders | 🟡 detected and reported; parametric warp/composite used instead |
| Preset blending / transitions | ✅ scene morphs |
| `.milk` import | ✅ FROM MILKDROP… in the studio (`src/import/milk.ts`) |

Legend: ✅ met or exceeded · 🟡 partially covered, path known · ❌ not present.

projectM tracks the MilkDrop rows: it is an LGPL reimplementation of the same
preset format, so its capability set is the MilkDrop column (its source is
consulted as documentation only — no code is ported from it).

## Licensing facts that bound content use

- Plane9 stock scenes: 250/252 CC BY-NC-SA (3.0 or 4.0), 2 CC0 — attribution
  fields carry through the importer; NC scenes stay out of any paid tier.
- MilkDrop 2 engine/format: BSD-licensed — algorithms portable with attribution.
- Individual `.milk` presets: property of their authors — import locally,
  strip before redistribution unless the author's terms allow it.
