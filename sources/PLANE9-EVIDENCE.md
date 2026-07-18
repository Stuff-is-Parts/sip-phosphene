# Plane9 Evidence Ledger

Tier-1/tier-2 evidence catalog for the Plane9 conversion path, per
PHOSPHENE-GOAL.md Source Authority. Every claim below is witnessed from the
named files; anything not witnessed is listed under Unresolved. Compiled
2026-07-18.

Prior Plane9 audits this ledger complements (read them together):
`sources/PLANE9-CONTRACT.md` (scene-visible expression vocabulary from the
252-scene scan, with band()/deltatime partial semantics from history.txt),
`sources/PRIMITIVES-PLANE9.md` (all 75 node types mapped to the target
primitive set), and `sources/AUDIO-PATH.md` (audit method). This ledger's
engine-strings extraction executed CONTRACT's named resolution path 3
("Plane9Engine.dll strings").

## Source authority record (owner-designated locations)

| Source | Location | Role |
|---|---|---|
| Scene corpus (252 .p9c copies) | `C:\Users\tdeme\Repositories\sip-phosphene\source-scenes\plane9\` | Tier 1 — scene graphs, ports, values, connections |
| Plane9 installation | `C:\Program Files (x86)\Plane9\` | Tier 2 — engine binaries, shader libraries, docs; tier 5 oracle (run it and look) |

Install inventory (witnessed): `Plane9.exe`, `Plane9.Studio.exe` (the scene
editor), `Plane9.scr`, `Plane9Engine.dll` (the engine), `bass.dll` (audio
library), `quazip.dll` (zip container support), Qt5 runtime, `openvr_api.dll`,
`nodedata/` (engine GLSL: bloom, blur, downscale2, ls_jacobi, scenefxaa,
scenepreaa, shader, streak + fonts/), `nodeicons/`, `data/` (texture assets),
`scenes/` (installed copies of the same categories as the corpus),
`plane9.txt` (credits), `Plane9Doc.url`, `licenses/`, `playlists/`.

Credits in `plane9.txt` (witnessed): program by Joakim Dahl / Planestate
Software; Expression Evaluator: expreval by Brian Allen Vanderburg II
(http://expreval.sourceforge.net). The expreval identification was first
recorded in `sources/PLANE9-CONTRACT.md` (Key structural finding); this
ledger re-witnessed it from the same file.

## Container format — witnessed at the byte level

A `.p9c` file is a ZIP archive (`PK\x03\x04` magic, consistent with
quazip.dll in the install). Corpus-wide census 2026-07-18: **252 of 252
files are zips, 252 of 252 contain `scene.xml`**, plus `scene.jpg` and
`preview.jpg` thumbnails in each examined archive.

## scene.xml anatomy — witnessed in Clear, Black, Color Cycle, Face Of Sound

- Root: `<Plane9Scene FormatVersion="2" Id ParentId WarmupTime SceneType
  Version Created LastModified>` — **FormatVersion census: 252 of 252 are
  version 2.** One uniform format governs the whole corpus.
- Metadata: `<Author>`, `<Desc>`, `<Tags>`, `<License Type=...>`.
- `<Nodes>`: each `<Node Type="..." Name="...">` carries `<Port Id="..."
  Value="..."/>` entries. Scalar ports hold numbers ("75"), vectors are
  space-separated ("0 0 1 1"), booleans are "false"/"true". Multiline
  content (GLSL shader text, expression scripts) nests as
  `<Port Id="Shader"><Value>...</Value></Port>`.
- `<Connections>`: `<Connection Out="NodeName.PortId" In="NodeName.PortId"/>`
  — a directed port-to-port edge list. This is structurally congruent with
  the .phos graph IR's nodes/ports/edges.
- `<SceneCompatibility>` with `<GoodScenes/>`/`<BadScenes>` name lists
  (playlist-transition compatibility hints).

## Node types — corpus census

75 distinct node types across 252 scenes; full counts retained at
`design/plane9-node-type-census.txt` (mechanically derived). Head of the
distribution: Shader 453, Clear 387, Screen 252 (one per scene), RenderRect
243, RenderObject 190, RenderToTexture 164, Vector 163, Expression 144,
MinMax 118, Bloom 104, MeshObject 104. Shader dominance means GLSL
translation is the long pole for broad corpus coverage; the smallest scenes
need none of it.

## Expression language — witnessed tokens

From Color Cycle and Face Of Sound: `in1.x = beat(0)*1;`,
`band(-1, 0, 0, 0.1)`, `noise1(t)`, `noise2(t,1)`, `time`, `deltatime`,
`perm`, `permrand`, `out1=...`. Semantics belong to expreval (named above)
plus Plane9's registered functions/variables — Unresolved until traced.

## Licenses — corpus census

CC BY-NC-SA 3.0: 142 scenes · CC BY-NC-SA 4.0: 108 · **CC0: 2 (Other/Black,
Other/Color Cycle)**. Per-scene license is embedded in scene.xml. The CC0
pair is unencumbered for retention and conversion; `color-cycle.scene.xml`
is retained verbatim at `sources/plane9/color-cycle.scene.xml`
(sha256 cac87795ddef4fe7f4ae5f8a43b1fe39ae0eb5517f719acf72c26bbe480ccacc).

## Scene-2 candidate: Other/Color Cycle.p9c

The smallest LIVE scene in the corpus: 7 nodes — Screen, Clear, HSLAToColor,
MinMax x3, Beat — six connections, no shaders, no meshes, no textures, CC0,
music-reactive (Beat.BeatStrength drives saturation; MinMax oscillators
drive hue and lightness; the scene is a beat-following background color).
The Plane9 analog of 101-per_frame.milk: every behavior in it is graph
plumbing plus five node types whose semantics must be established from
evidence before conversion. Black (2 nodes) and Clear (2 nodes) are static
templates — valid smoke tests but not scenes.

## Unresolved (explicit, per PHOSPHENE-GOAL — never filled with plausible behavior)

- Per-node SEMANTICS for all 75 types. PARTIALLY RESOLVED 2026-07-18: the
  engine dll embeds the full node reference (descriptions + per-port help
  for every type), retained at `design/plane9-engine-node-strings.txt`;
  the five candidate types' contracts are ledgered in
  `sources/PLANE9-NODES.md` with the remaining behavioral unknowns (enum
  mappings, interpolation curves, beat algorithm) queued there with named
  evidence sources. The public doc site carries no node reference
  (witnessed 2026-07-18 fetch of plane9.com/p9doc).
- Graph evaluation order and per-frame lifecycle (what fires when; how
  Render connections chain into the Screen node).
- Expression evaluator semantics: expreval grammar plus Plane9's registered
  functions (beat, band, noise1/noise2) and variables (time, deltatime,
  perm, permrand, in/out registers).
- Audio analysis pipeline feeding Beat/Waveform/band() (bass.dll is the
  input library; the analysis chain is not yet traced).
- Shader uniform/attribute contract (gMVP, gIn1-3, gColor1-2, gColor,
  gTexture1, iPosition, iTexCoord, iColor, si/so varyings, VERTEXOUTPUT
  preprocessing) — needed for Shader-node scenes, NOT for the candidate.
- SceneType codes (witnessed values: 1, 2, 2304) and WarmupTime semantics.
RESOLVED during compilation: no corpus scene carries runtime resources
inside the zip — member census across all 252 archives is exactly
scene.xml + scene.jpg + preview.jpg, 252 each, zero extras. Scene-external
assets (textures like FileTexture's) resolve against the install's `data/`
directory, which is where the shareable-package question moves next.
