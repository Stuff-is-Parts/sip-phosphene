# Plane9 Scene-Visible Contract — corpus + install evidence

The vocabulary Plane9 scenes actually read from their engine, audited by the
method of AUDIO-PATH.md so shared machinery derives from BOTH engines per the
conversion rule in CLAUDE.md. Sources opened this audit:
- **[P9-CORPUS]** all 252 scene.xml bodies (expression `<Value>` code extracted
  corpus-wide; per-token scene counts below are from a full 252-scene scan)
- **[P9-DOC]** plane9.txt + history.txt in C:\Program Files (x86)\Plane9

## Key structural finding

Plane9's expression evaluator is **expreval** by Brian Allen Vanderburg II
(credited in plane9.txt; expreval.sourceforge.net) — an open-source library.
Expression-language semantics are therefore source-auditable; `band()` and the
engine globals are Plane9 extensions on top of it (Plane9Engine.dll).
Registry updated with the expreval row.

## Engine-provided vocabulary (scene counts from the 252-scene scan)

| Token | Scenes using it | Evidence of semantics |
|---|---|---|
| `time` | 175 | count includes GLSL shader uniforms — expression-level vs shader-level split not yet separated |
| `band(channel, damping, bandnr, nomusic)` | 123 | RESOLVED 2026-07-18 from the official expression reference (plane9.com/wiki/expressionreference, v1.x era): channel (-1 = mono fold [P9-HIST:345,383]), damping, band number, no-music fallback. CONFLICT NOTE: this file previously read the 4th argument as damping from [P9-HIST:254,383]; the explicit reference signature outranks the changelog inference per PHOSPHENE-GOAL source-authority ordering. Exact band-count/edges still unresolved. |
| `deltatime` | 98 | per-frame elapsed time factor (`x*rate*deltatime` integrators corpus-wide); dll Expression-node docs add: "deltatime (not correct when connected to local port)" (design/plane9-engine-node-strings.txt). Relation to the 30Hz-locked analyzer [P9-HIST:68] still **UNRESOLVED** |
| `beat(nomusic)` | 52 | RESOLVED 2026-07-18 (official expression reference): returns current beat strength, with the argument as the no-music fallback — the expression-level twin of the Beat node's BeatStrength. The detection ALGORITHM stays unresolved (PLANE9-NODES.md queue). |
| `rand(` | 54 | RESOLVED 2026-07-18 (official expression reference documents the family at Plane9 level): rand()/srand() in [0,1]/[-1,1] on an internal seed, seeded variants rand(&seed)/srand(&seed), plus random(min,max)/srandom(). Bit-exact generator identity still needs expreval source when Expression scenes enter scope. |
| `aspect` | 20 | RESOLVED 2026-07-18: dll Expression-node docs say "aspect Current render aspect." (design/plane9-engine-node-strings.txt); also perm/permrand documented there (not reset for node life; initial 0 / 0.0-1.0). |
| `frame` | 12 | frame counter candidate — **UNRESOLVED** |
| `soundlevel`, `fps`, `mouse` | 0 / 0 / 1 | effectively unused by the corpus |

## Contract shape vs MilkDrop's

MilkDrop exposes damped `time`/`fps` plus the PCM variable set to equations;
Plane9 exposes `deltatime`-style integration plus `band()` audio pulls plus
node-port wiring (SoundTexture/Beat/Spectrum per AUDIO-PATH.md). Under the
conversion rule these become separate explicit components — a Plane9-converted
scene references plane9-deltatime/plane9-band components exactly as a MilkDrop
scene references milkdrop-time/milkdrop-loudness. Nothing here forces a new
primitive: both contracts are expression-layer (P4) plus graph inputs (P2).

## Node semantics resolved from the install (2026-07-18 end-to-end read)

Every file in `C:\Program Files (x86)\Plane9` was read this pass — the eight
`nodedata/*.glsl` files, `history.txt` and `plane9.txt` end to end, the two
`.rcc` containers (parsed by the Qt Resource Collection format, blobs zlib-
decompressed), and the `Plane9Engine.dll` string table at the MinMax
metadata region and neighboring node blocks.

**Screen node** — camera port descriptions verbatim from the dll node table:
Viewport "A part of the screen that we should render everything to", CamPos,
CamLookAt, CamLookAtInWorldSpace, CamFov, CamNear, CamFar, ScaleByAspect.
Color Cycle values: Viewport "0 0 1 1", CamPos "0 0 -2", CamFov 45, and
`ScaleByAspect false` — camera is unused for a geometry-free Clear scene.

**Clear node** — dll: "Fills the viewport with a single color." One port
Color (RGBA); connections witness `Clear.Render` out to `Screen.Render`,
`Clear.Color` in from HSLAToColor.

**HSLAToColor** — RESOLVED from the scene file itself: standard HSL-to-RGB
(CSS/Wikipedia formulation) reproduces Color Cycle's saved Clear color
"0.03857 0.11049 0.216148" from the node's own ports (H 215.7, S 0.697156,
L 0.127359) to one part in 10^6. The scene file carries its own test vector.

**MinMax node** — dll: "Interpolates a float value using delay times.
Doesn't handle 'local' evaluators." Nine ports: Min, Max, Mode, DelayMin,
DelayMax, DelayMode, ITimeMin, ITimeMax, ITimeMode. history.txt line 413
(v1.6): "Forced MinMax node to only update itself once a frame" —
MinMax is a value node ticking once per frame.
- **Mode enum**: four names in dll dropdown order at file offsets
  2075532/2075540/2075560/2075568 — Rand, RandShortestDist, LoopUp,
  LoopDown. Corpus usage across 118 instances is {Mode: 1=101, 2=11, 3=1,
  4=5}, which together with the four-name adjacent block resolves to
  1=Rand (the default, matching majority usage), 2=RandShortestDist,
  3=LoopUp, 4=LoopDown.
- **DelayMode** and **ITimeMode**: both hold {0, 1} in the corpus (DelayMode
  113 of 118 at 1 with 5 at 0; ITimeMode all 118 at 1) — 0-based off/on.
- **Interpolation curve**: the dll imports exactly three `QEasingCurve`
  functions (constructor-from-Type, destructor, `valueForProgress`), so
  interpolation between drawn Min/Max targets over ITime seconds uses a
  Qt easing curve — the specific curve type is a dll-internal parameter
  not exposed as a port; a Color-Cycle-faithful port defaults to Qt's
  Linear (QEasingCurve::Type = 0) until falsified.

**Beat node** — dll: "Detects the beat in the currently playing music and
output its as a value going from 0.0 to 1.0." Ports NoMusic, Amplification,
Min, Max; out BeatStrength. Detection algorithm is internal; corpus witness
in AUDIO-PATH.md scenes shows the port range (NoMusic values 0.2..100,
Amplification 1..7, Min 0..1, Max 1..200) and BeatStrength as the driver
of scalar ports downstream. The internal detector is the only remaining
unresolved element for a Color-Cycle-faithful port; the visible scale
(0.0..1.0 dll-documented) plus AUDIO-PATH's MilkDrop-side band-summing
math is sufficient to render Color Cycle without invention — the scene
overrides NoMusic live via MinMax2, so the detector's response only
matters when actual audio is present.

**Shader-node uniform contract** — witnessed end-to-end in the eight
`nodedata/*.glsl` files:
- Preamble every scene inherits: `PI`, `PI2`, saturate, tosrgb/tolinear,
  `_hsv2rgb`, `_rand`/`_rand2`/`_rand3`/`_rand4`, hammersley, `_perm`,
  `_noise` (Simplex, Brian Sharpe), `_noisefast`, `_fbm`/`_fbmfast`,
  `_turbulence`/`_turbulencefast`, `_ridgedmf`, `_voronoi`, tonemap
  ACES/Uncharted2/Filmic, `_blackBody`, `_textureBicubic`,
  `_texturePanoramic`, `_screenSpaceDither`, and the PBR chain (`_shade`,
  `_lightDirectional`, `_lightPoint`, `_specularIBL`).
- Multi-pass syntax: `#ifdef VERTEX`/`#ifdef FRAGMENT`, `#if PASS == N`,
  `VERTEXOUTPUT { ... }` block for varyings, `si.tex`/`so.tex` typed
  interpolants (per-pass struct), `iPosition`/`iTexCoord`/`iColor`
  vertex attributes, `oColor` fragment output, `gl_FragCoord` allowed.
- Node-supplied uniforms follow the `g` prefix convention (per v2.3
  release notes: "Prefix shader variables with 'g' as in 'gTime'").
  Bloom's uniforms: gScale, gSampleScale, gSourceTextureSize, gCurve,
  gThreshold, gSrcSampler, gBaseSampler. Blur/downscale/streak use
  gBrightness/gRand2/gOffsets/gWeights. Node-defined uniforms `gIn1..3`,
  `gColor1..2`, `gMVP` (etc.) are the Shader-node port-to-uniform binding.

## Resolution paths for the UNRESOLVED rows (registry sources, in order)

1. expreval source (sourceforge) — settles which functions/globals are the
   evaluator's own (rand, min, …) vs Plane9 extensions.
2. Plane9Doc.url / plane9.com node & expression documentation.
3. Plane9Engine.dll strings for the extension-function table.
4. Targeted Studio observation (write a probe scene printing candidates) —
   last resort per the goal doc's observation tier.
