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

### Static-analysis reproduction procedure (2026-07-18, owner-directed)

Every dll claim below reproduces from `Plane9Engine.dll` in the v2.5.1
install, **sha256
`4cebc1b36f003a550b4fc6ae1979d579f4f7f27b03599c7aef88fd5526ba1196`**
(2,501,736 bytes), by scanning the raw file bytes for ASCII runs
(`re.finditer(rb"[\x20-\x7e]{3,}", data)` in Python) and reading the
matched string at the stated byte offset. Offsets are file offsets, not
virtual addresses. Corpus claims reproduce by unzipping `scene.xml` from
each of the 252 `.p9c` files under `source-scenes/plane9/` and tallying
`<Node Type=..>` / `<Port Id=.. Value=..>` matches.

**Control case validating the metadata layout:** the SignalGenerator node
block at 0x1eba14 carries its description, then port name `WaveformType`
(0x1ebb00), then the five enum item names contiguous and in order —
`Sine` 0x1ebb10, `Square` 0x1ebb18, `Triangle` 0x1ebb20, `Sawtooth`
0x1ebb2c, `Random` 0x1ebb38 — then the next port. Corpus
`SignalGenerator.WaveformType` values are {0: 9 scenes, 4: 5 scenes},
consistent with 0-based indexing over that five-name list (0=Sine,
4=Random) and inconsistent with 1-based.

**Screen node** — camera port NAMES and dll help text verbatim: Viewport
"A part of the screen that we should render everything to" (0x1f7fe4),
CamPos, CamLookAt, CamLookAtInWorldSpace, CamFov, CamNear, CamFar,
ScaleByAspect. Whether the camera has any runtime effect for a
geometry-free Clear scene is **UNRESOLVED** — cannot be inferred from the
port list; needs observation (a probe scene with CamPos/CamFov varied and
the rendered output recorded). **Witnessed geometry-free configuration**
(corpus scan 2026-07-18): 79 of 252 scenes carry the exact port set
`Viewport="0 0 1 1" CamPos="0 0 -2" CamRot="0 0 0" CamLookAt="0 0 1"
CamLookAtInWorldSpace="false" CamFov="45" CamNear="0.1" CamFar="1000"
ScaleByAspect="false"` — the retained Color Cycle fixture among them. The
converter (src/p9-import.mjs) accepts exactly this configuration as the
full-canvas render sink and refuses any deviation, so no camera-inertness
assumption is baked in.

**Clear node** — dll: "Fills the viewport with a single color."
(0x1f7ecc). **RESOLVED for the conversion boundary 2026-07-18**: the
node's function is to fill the render viewport with its Color, on this
evidence — the dll description; the engine render call
`CRenderOGL::Clear(glm::tvec4<float>&, float, int)` (mangled export at
0x2295b3) beside the `glClearColor` Qt-GL import (0x23341e); corpus
uniformity (all 387 Clear nodes across 252 scenes carry exactly one port,
Color); and history.txt:291 (v2.0.1 "ClearNode: Default clear nodes to
set alpha to 0.0" — Color carries alpha). Connections in the Color Cycle
scene.xml witness `Clear.Render` out to `Screen.Render` and `Clear.Color`
in from HSLAToColor. A Clear whose Color is a saved constant, wired
`Clear.Render -> Screen.Render` into the witnessed Screen configuration,
converts onto the shared executor's native `clear-color` op
(NATIVE_OPS, phosphene-engine/src/engine.mjs) whose realization is a
WebGPU clear pass. A Clear whose Color is DRIVEN (as in Color Cycle)
converts only when its driver converts — so Color Cycle still refuses.

**HSLAToColor** — dll: "Converts a Hue, Saturation, Lightness and alpha
component to a color" (name 0x1fa1d0, description 0x1fa1e0). Ports Hue
(help verbatim: "The 'real' color. In degrees", 0x1fa228), Saturation,
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
- **Mode enum names** witnessed in the dll literal pool at 0x1fab8c
  (`Rand`), 0x1fab94 (`RandShortestDist`), 0x1faba8 (`LoopUp`), 0x1fabb0
  (`LoopDown`) — contiguous, in this order, immediately before the
  `MinMax` node name at 0x1fabbc. A raw hexdump of 0x1fab40-0x1fabd0
  (2026-07-18) shows the bytes before `Rand` are a pointer table (11
  little-endian 0x10xxxxxx values), not further names — the list is
  exactly four names at this site, though string pooling means a
  short item name merged elsewhere in the binary cannot be excluded.
- **Numeric mode mapping is UNRESOLVED, and the 2026-07-18 corpus scan
  now REFUTES the simplest hypothesis**: corpus `MinMax.Mode` values are
  {1: 101, 2: 11, 3: 1, 4: 5} — no 0, and a 4 — while `MinMax.DelayMode`
  values are {0: 5, 1: 113} and `MinMax.ITimeMode` is {1: 118}. A single
  0-based index over the four-name list cannot produce Mode=4, and a
  single 1-based index cannot produce DelayMode=0, so the three mode
  ports do not share one indexing over one four-name list — either the
  lists differ per port or an unwitnessed extra item exists. The
  SignalGenerator control case (0-based over its five names) shows the
  engine has no fixed 1-based convention to lean on. **Observation that
  settles it**: in Plane9.Studio (or the editor of a pre-2.0 install),
  set a MinMax node's Mode dropdown to each entry in turn, save after
  each, and diff the saved integers; repeat for DelayMode/ITimeMode.
- **DelayMode and ITimeMode semantics UNRESOLVED** beyond the value
  ranges above.
- **Target-selection rule, RNG identity, delay lifecycle, interpolation
  curve UNRESOLVED**. The three `QEasingCurve` symbol imports in the dll
  (constructor-from-Type, destructor, `valueForProgress`) show only that
  Qt easing curves are USED somewhere in the engine; they do not identify
  MinMax as the caller, nor which curve type it uses.

**Beat node** — dll: "Detects the beat in the currently playing music and
output its as a value going from 0.0 to 1.0." (node name 0x1fb038,
description 0x1fb040). Ports with dll help verbatim: NoMusic "Value to
use if no music is playing" (0x1fb0a0), Amplification "How much to
amplify the values" (0x1fb0cc), Min "Minimum value" (0x1fb0fc), Max
"Maximum value" (0x1fb10c); out BeatStrength "The strength of the
current beat" (0x1fb11c). The switching rule between the detector and
NoMusic is **UNRESOLVED**. Composition of Amplification with Min/Max,
the detector's algorithm, and the audio-driven output are all
**UNRESOLVED** — the detector is compiled code (`CBeatNode` RTTI at
0x240a60; no exported method reveals it). Bounding facts from
history.txt: the sound analyzer is locked to 30 Hz (line 68, v2.4.0),
input is matched toward 44.1 kHz by sample skipping (lines 86-87,
v2.3.3), and the engine auto-normalizes sound with the max-level
tracking tuned at v2.4.0 (lines 74, 79, 295). **Observation that
settles the remainder**: play controlled audio with known onsets and
record the live BeatStrength value (probe scene wiring BeatStrength to
a visible output), across silence to witness the NoMusic switch.
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
