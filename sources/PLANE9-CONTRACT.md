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
in from HSLAToColor. The Color port converts as vec4, driven either by a
saved constant or by an incoming value edge from HSLAToColor / RGBAToColor;
the render edge from Clear.Render to Screen.Render is preserved verbatim.

**HSLAToColor** — dll: "Converts a Hue, Saturation, Lightness and alpha
component to a color" (name 0x1fa1d0, description 0x1fa1e0). Ports Hue
(help verbatim: "The 'real' color. In degrees", 0x1fa228), Saturation,
Lightness, Alpha; out Color. **RESOLVED for the Color Cycle slice
2026-07-18** with an evidence boundary: the standard CSS/Wikipedia HSL-to-RGB
formula reproduces Color Cycle's saved input/output vector to one part in
10^6 and is what the native op implements. This is one retained vector,
not a general proof of the formula — the native op's binding to this slice
holds until either a second vector or observation of the running node
against known inputs establishes the general case.

**MinMax node** — dll: "Interpolates a float value using delay times.
Doesn't handle 'local' evaluators." Nine ports: Min, Max, Mode, DelayMin,
DelayMax, DelayMode, ITimeMin, ITimeMax, ITimeMode. history.txt line 413
(v1.6): "Forced MinMax node to only update itself once a frame" — witness
that MinMax ticks once per frame.

**PARTIALLY GROUNDED, PARTIALLY PRODUCER-INFERRED 2026-07-18**. The
mode name-to-integer table below comes from a Todd-supplied DLL
static-analysis walk at RVAs 0x100DD600 (frame evaluator), 0x100DD9A0
(mode/range selector), 0x100DDAE0 (selector jump table), 0x101FBB50 (mode
pointer table), and 0x1001FE30 (shared xorshift128 RNG). The state
machine implementation that consumes those integers is PHOSPHENE's own
producer inference against the mode names plus the once-per-frame
constraint from history.txt line 413 — no byte-level disassembly-vs-
implementation diff has been performed. Reviewer note 2026-07-18:
"the code selects several behaviors not demonstrated by retained primary
evidence" — the affected choices are named explicitly under
**PRODUCER-INFERRED LIFECYCLE CHOICES** below.

**GROUNDED (owner-supplied spec 2026-07-18, pending byte-level DLL
verification)**:

- **Mode integer mapping** — the six-item table:
  `0 = None, 1 = Rand, 2 = RandShortestDist, 3 = LoopUp, 4 = LoopDown,
  5 = PingPong`. This supersedes the earlier "four-name list at 0x1fab8c"
  reading; the additional entries (None and PingPong) sit in the runtime
  table at 0x101FBB50 rather than the local literal pool. Corpus coverage
  of {0..5}: Mode {1: 101, 2: 11, 3: 1, 4: 5} in the 252-scene sample.
- **Once-per-frame update** — history.txt line 413 (v1.6): "Forced MinMax
  node to only update itself once a frame" — this is the ONE part of the
  state-machine specification with pre-owner-spec source evidence.
- **Curve association** — Todd's spec: LoopUp and LoopDown use linear;
  Rand/RandShortestDist/PingPong use smoothstep 3t²−2t³. This is the
  owner-supplied claim, held to the same "pending DLL verification"
  standard as the mode mapping.
- **RandShortestDist range** — interpolates through the shortest arc over
  `[Min, Max]` (circular).

**PRODUCER-INFERRED LIFECYCLE CHOICES (UNRESOLVED against Plane9)**. The
PHOSPHENE state machine ships six behavioral choices whose grounding is
producer inference from the mode names plus the corpus, not the DLL:

- The initial value of a MinMax node is Min. (Not established from
  primary evidence — plausibility only.)
- The initial phase is a zero-duration delay so the state machine starts
  interpolating on the first tick. (Producer choice to avoid an initial
  frame of undefined output; Plane9's initial state is unresolved.)
- A change to the Mode input mid-cycle resets direction and phase.
  (Producer choice for clean re-entry; not observed.)
- LoopUp resets current to Min at cycle boundary and LoopDown resets to
  Max. (Derived from the mode names, not from observation.)
- A zero-duration delay transition consumes remaining frame time on the
  transition tick rather than costing a frame. (Producer choice to avoid
  the wasted-frame artifact from the previous cycle; Plane9's frame
  accounting at the transition is unresolved.)
- One phase transition per compute call. (Consistent with history.txt
  line 413's once-per-frame constraint; the exact transition semantics
  within that frame are unresolved.)

**UNRESOLVED**:
- **RNG identity** — PHOSPHENE ships Marsaglia's canonical xorshift128
  (constants 11/8/19, paper example seed 123456789/362436069/521288629/
  88675123) as an EXTERNAL reference implementation. Whether the DLL at
  0x1001FE30 uses those exact constants and initialization state is not
  established — the sequence PHOSPHENE draws is Marsaglia's, and matches
  Plane9's only to the extent that Plane9 also uses Marsaglia's
  canonical constants and seed. Observation: disassemble 0x1001FE30 and
  compare byte-level to Marsaglia's paper implementation, and locate the
  init call to determine the seed lifecycle.
- **DelayMode and ITimeMode per-integer semantics**. Corpus ranges
  {DelayMode: 0=5, 1=113} and {ITimeMode: 1=118} in the 252-scene
  sample. PHOSPHENE's compute function implements the DelayMode=1 /
  ITimeMode=1 behavior (uniform-random selection across the range) and
  REFUSES scenes carrying other values at Engine construction —
  DelayMode/ITimeMode ports are consumed inputs whose "1" case IS what
  the executor does. Observation: probe scenes varying each independently
  and diff the runtime behavior against saved traces.

**Beat node** — dll: "Detects the beat in the currently playing music and
output its as a value going from 0.0 to 1.0." (node name 0x1fb038,
description 0x1fb040). Ports with dll help verbatim: NoMusic "Value to
use if no music is playing" (0x1fb0a0), Amplification "How much to
amplify the values" (0x1fb0cc), Min "Minimum value" (0x1fb0fc), Max
"Maximum value" (0x1fb10c); out BeatStrength "The strength of the
current beat" (0x1fb11c).

**GROUNDED node-level composition 2026-07-18** from owner-supplied DLL
static analysis at RVA 0x100DF5A0 (Beat node evaluator), pending
byte-level verification:

- **Inactive audio** (music analysis not producing a signal):
  `BeatStrength = NoMusic`. NoMusic returns directly, without
  amplification, clamping, or Min/Max remapping.
- **Active audio**:
  `BeatStrength = min(Min + rawBeat * Amplification * (Max − Min),
  max(Min, Max))`. The formula is a linear composition capped at the upper
  endpoint of the Min/Max pair.

The executor treats `rawBeat` and `musicActive` as native audio inputs
supplied by the caller. **PHOSPHENE currently supplies `musicActive=false`
from both `src/studio.mjs` and `src/player.mjs`** (verified 2026-07-18)
because the upstream detector producing `rawBeat` is UNRESOLVED — see
below. Any Beat node in a running scene therefore returns
`BeatStrength = NoMusic` until the detector is recovered.

**UNRESOLVED at the upstream boundary**: the detector that produces
`rawBeat` from the audio stream is compiled code (`CBeatNode` RTTI at
0x240a60; no exported method reveals its algorithm). Bounding facts from
history.txt: the sound analyzer is locked to 30 Hz (line 68, v2.4.0),
input is matched toward 44.1 kHz by sample skipping (lines 86-87, v2.3.3),
and the engine auto-normalizes with a decaying tracked maximum
(lines 74, 79, 295). **Observation that settles it**: play controlled
audio with known onsets and record the live `rawBeat` value through a
probe scene wiring the detector output to a visible port.
AUDIO-PATH.md's MilkDrop-side band-summing math describes MilkDrop's
detector, not Plane9's; the upstream Plane9 detector must remain unfilled
until observation provides the recipe.

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
