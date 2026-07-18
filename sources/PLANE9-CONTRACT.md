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
| `deltatime` | 98 | per-frame elapsed time factor (`x*rate*deltatime` integrators corpus-wide); dll Expression-node docs add: "deltatime (not correct when connected to local port)" (witnessed in the Plane9Engine.dll string table at the Expression-node metadata block; extraction not retained). Relation to the 30Hz-locked analyzer [P9-HIST:68] still **UNRESOLVED** |
| `beat(nomusic)` | 52 | Signature RESOLVED 2026-07-18 (official expression reference): returns current beat strength, with the argument as the no-music fallback — the expression-level twin of the Beat node's BeatStrength. The detection ALGORITHM stays **UNRESOLVED**. |
| `rand(` | 54 | RESOLVED 2026-07-18 (official expression reference documents the family at Plane9 level): rand()/srand() in [0,1]/[-1,1] on an internal seed, seeded variants rand(&seed)/srand(&seed), plus random(min,max)/srandom(). Bit-exact generator identity still needs expreval source when Expression scenes enter scope. |
| `aspect` | 20 | RESOLVED 2026-07-18: dll Expression-node docs say "aspect Current render aspect." (witnessed in the Plane9Engine.dll string table at the Expression-node metadata block); also perm/permrand documented there (not reset for node life; initial 0 / 0.0-1.0). |
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

## Node port CONTRACT surfaces witnessed 2026-07-18 (semantic behavior remains UNRESOLVED)

Files read this pass in `C:\Program Files (x86)\Plane9`: the eight
`nodedata/*.glsl` files, `history.txt` and `plane9.txt` end to end, the two
`.rcc` containers (parsed by the Qt Resource Collection format, blobs
zlib-decompressed), and the `Plane9Engine.dll` string table at the MinMax
metadata region and neighboring node blocks. **These reads establish what
ports each node exposes and their dll help strings — they do NOT establish
runtime SEMANTICS, and the section below classifies each behavior row
accordingly.** Retraction 2026-07-18 (post-review): an earlier version of
this section marked HSLAToColor, MinMax numeric modes, ITimeMode/DelayMode
semantics, the interpolation curve, and Beat's composition as RESOLVED
from these reads. That inference was not warranted by the sources — one
saved input/output vector, string adjacency, popularity counts, and Qt
import lists do not fix runtime behavior. Rows below are re-classified.

**Screen node** — camera port NAMES and dll help text verbatim: Viewport
"A part of the screen that we should render everything to", CamPos,
CamLookAt, CamLookAtInWorldSpace, CamFov, CamNear, CamFar, ScaleByAspect.
Whether the camera has any runtime effect for a geometry-free Clear scene
is **UNRESOLVED** — cannot be inferred from the port list; needs
observation (a probe scene with CamPos/CamFov varied and the rendered
output recorded).

**Clear node** — dll: "Fills the viewport with a single color." One port
Color (RGBA); connections in the Color Cycle scene.xml witness
`Clear.Render` out to `Screen.Render` and `Clear.Color` in from
HSLAToColor.

**HSLAToColor** — dll: "Converts a Hue, Saturation, Lightness and alpha
component to a color". Ports Hue (in degrees per the dll help), Saturation,
Lightness, Alpha; out Color. The standard CSS/Wikipedia HSL-to-RGB formula
applied to Color Cycle's saved HSL ports reproduces Color Cycle's saved
Clear.Color to one part in 10^6. This is **a strong candidate consistent
with one retained input/output vector**, not a fully resolved formula —
resolution requires either a second independent vector or observation of
the running node against known inputs.

**MinMax node** — dll: "Interpolates a float value using delay times.
Doesn't handle 'local' evaluators." Nine ports: Min, Max, Mode, DelayMin,
DelayMax, DelayMode, ITimeMin, ITimeMax, ITimeMode. history.txt line 413
(v1.6): "Forced MinMax node to only update itself once a frame" — witness
that MinMax ticks once per frame; nothing else about its state model.
- **Mode enum names** witnessed adjacent in the dll string table at
  offsets 2075532/2075540/2075560/2075568: Rand, RandShortestDist,
  LoopUp, LoopDown. **Numeric mode mapping is UNRESOLVED** — string
  adjacency plus corpus popularity is not evidence of the integer
  assignment; the actual dropdown-to-integer mapping lives in the removed
  editor's implementation. Corpus statistics (Mode {1: 101, 2: 11, 3: 1,
  4: 5}) constrain the value range but do not identify which name maps
  to which number.
- **DelayMode and ITimeMode semantics UNRESOLVED**. Corpus values
  {DelayMode: 1=113, 0=5} and {ITimeMode: 1=118} identify the value range
  in use, not what 0 and 1 mean.
- **Target-selection rule, RNG identity, delay lifecycle, interpolation
  curve UNRESOLVED**. The three `QEasingCurve` symbol imports in the dll
  (constructor-from-Type, destructor, `valueForProgress`) show only that
  Qt easing curves are USED somewhere in the engine; they do not identify
  MinMax as the caller, nor which curve type it uses.

**Beat node** — dll: "Detects the beat in the currently playing music and
output its as a value going from 0.0 to 1.0." Ports NoMusic, Amplification,
Min, Max; out BeatStrength. dll help says NoMusic is "Value to use if no
music is playing" — the switching rule between the detector and NoMusic
is **UNRESOLVED**. Composition of Amplification with Min/Max, the
detector's algorithm, and the audio-driven output are all **UNRESOLVED**.
AUDIO-PATH.md's MilkDrop-side band-summing math describes MilkDrop's
detector, not Plane9's; treating it as sufficient for Color Cycle's Beat
was the inference the deleted runtime rested on.

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
