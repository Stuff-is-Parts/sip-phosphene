# Source-property inventory

Repository-tracked capability inventory of every source property observed
in MilkDrop preset content, Plane9 `.p9c` scene bodies, Plane9
`nodedata/*.glsl` files, Plane9 host metadata retained by the project,
and the DLL evidence already recorded at `sources/PLANE9-CONTRACT.md`.

Purpose (reviewer 2026-07-18): PHOSPHENE must become a native,
source-neutral substrate into which MilkDrop and Plane9 scenes are
mechanically transpiled. This document is the accounting system: every
source property either maps to a typed PHOS representation or produces a
named refusal. Coverage is over the currently observed corpus, not
speculative future formats.

Rows are organised by technical role, not by application. Each row
records:

- **Source** — MilkDrop or Plane9, plus the specific artifact family.
- **Exact source name** — verbatim source token.
- **Origin class** — scene-authored, connection-derived, resource-derived,
  or host-supplied.
- **PHOS representation** — the typed representation in `.phos` or the
  refusal target.
- **Native execution status** — engine implementation state.
- **Compatibility status** — source-compatibility gate disposition.
- **Unresolved evidence** — what would close the row.

Statuses are one of:

| Symbol | Meaning |
|---|---|
| **IMPL** | Native engine implements the representation and it renders. |
| **PLAN** | Representation exists in `.phos` typing, engine planning covers it, browser realization not yet exercised on WebGPU. |
| **REFUSE** | Source property is recognised, parser routes it to a named refusal. |
| **PARSE** | Source parser retains the raw value; downstream routing is a pending row. |
| **N/A** | Source does not carry this property. |
| **PENDING** | Row identified from corpus/DLL evidence, PHOS routing not yet chosen. |

---

## 1. Scalar, vector and color values

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | `fDecay`, `fWarpAnimSpeed`, `fWarpScale`, `fZoomExponent`, `fGammaAdj`, `fVideoEchoZoom`, `fVideoEchoAlpha` | scene-authored | `warp-feedback` / `composite` op float ports | IMPL | IMPL | — |
| MilkDrop | `nVideoEchoOrientation` | scene-authored | `composite` op float port (rounded mod 4 at draw) | IMPL | IMPL | — |
| MilkDrop | `zoom`, `rot`, `warp`, `cx`, `cy`, `dx`, `dy`, `sx`, `sy` | scene-authored | `warp-feedback` op float ports; per-frame equations may rewrite | IMPL | IMPL | — |
| MilkDrop | `ib_size`, `ib_r`, `ib_g`, `ib_b`, `ib_a`, `ob_size`, `ob_r`, `ob_g`, `ob_b`, `ob_a` | scene-authored | `borders` op float ports; folded into warp-feedback pass at contribute | IMPL | IMPL | — |
| Plane9 | Clear.Color | scene-authored | `clear-color` op vec4 port | IMPL | IMPL | — |
| Plane9 | RGBAToColor.Red/Green/Blue/Alpha | scene-authored | `RGBAToColor` op float ports; Color vec4 output | IMPL | IMPL | — |
| Plane9 | HSLAToColor.Hue/Saturation/Lightness/Alpha | scene-authored | `HSLAToColor` op float ports; Color vec4 output | IMPL | REFUSE | 2nd retained Plane9 vector from a different Hue segment. |
| Plane9 | MinMax.Min/Max/Mode/DelayMin/DelayMax/DelayMode/ITimeMin/ITimeMax/ITimeMode | scene-authored | `MinMax` op float ports (DelayMode/ITimeMode port-constrained to 1) | IMPL | REFUSE | DLL disassembly of evaluator/selector/RNG at 0x100DD600/0x100DD9A0/0x1001FE30. |
| Plane9 | Beat.NoMusic/Amplification/Min/Max | scene-authored | `Beat` op float ports; product supplies musicActive=false | IMPL | REFUSE | Detector at CBeatNode 0x240a60; controlled-audio probe. |

## 2. Expressions and built-in variables

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | `per_frame_N` blocks | scene-authored | `.phos` `expressions[].stage='per-frame'.code` array | IMPL | IMPL | — |
| MilkDrop | `per_vertex_N` / `per_pixel_N` blocks | scene-authored | Refused at importer per-pixel/per-vertex clause | REFUSE | REFUSE | Per-vertex VM implementation. |
| MilkDrop | Built-ins: `time`, `fps`, `frame`, `bass`, `mid`, `treb`, `bass_att`, `mid_att`, `treb_att`, `progress`, `meshx`, `meshy`, `pixelsx`, `pixelsy`, `aspectx`, `aspecty` | host-supplied | Engine injects into flat EEL pool each step | IMPL | IMPL | — |
| MilkDrop | Regvars: `decay`, `gamma`, `echo_zoom`, `echo_alpha`, `echo_orient`, `zoomexp` | connection-derived | `KEY_TO_EEL` alias table syncs port ↔ pool | IMPL | IMPL | — |
| MilkDrop | EEL functions (35): projectm-eval TreeFunctions.c full table | host-supplied | `eelSubject` implementations transcribed from `projectm-eval@da885dc` | IMPL | IMPL | — |
| MilkDrop | EEL operators: `+ - * / % ^ = == != < > <= >= ? :` plus `!`, unary `-` `+` | scene-authored | `compileEEL` parser transcribes Compiler.y:55-75 grammar | IMPL | IMPL | — |
| MilkDrop | EEL refused: `&& \|\| \| &`, `$`-constants, compound assignment, megabuf | scene-authored | Parse-time refusal naming the token | REFUSE | REFUSE | Direct source evidence for each construct. |
| Plane9 | `time` (175 scenes) | host-supplied | `.phos` variable-view read; expression evaluator PENDING | PENDING | PENDING | Plane9 expreval identity vs projectm-eval. |
| Plane9 | `deltatime` (98 scenes) | host-supplied | 30 Hz analyzer lock evidence (history.txt:68); representation PENDING | PENDING | PENDING | Per-frame elapsed-time semantics vs `time`. |
| Plane9 | `band(channel, damping, bandnr, nomusic)` (123 scenes) | host-supplied | Representation PENDING; signature RESOLVED per plane9.com expression reference | PENDING | PENDING | Band-count/edges spec. |
| Plane9 | `beat(nomusic)` (52 scenes) | host-supplied | Representation PENDING | PENDING | PENDING | Detector algorithm at CBeatNode. |
| Plane9 | `rand()`, `srand()`, `random(min,max)`, `srandom()` (54 scenes) | host-supplied | Representation PENDING; family RESOLVED per plane9.com reference | PENDING | PENDING | expreval RNG identity for bit-exact reproduction. |
| Plane9 | `aspect` (20 scenes) | host-supplied | Representation PENDING; dll help "Current render aspect." (Plane9Engine.dll string) | PENDING | PENDING | — |
| Plane9 | `perm`, `permrand` (Expression-node metadata) | host-supplied | Representation PENDING; docs state initial 0 / 0.0-1.0, not reset for node life | PENDING | PENDING | Semantic clarity around per-scene lifetime. |
| Plane9 | `frame`, `soundlevel`, `fps`, `mouse` (0–12 scenes) | host-supplied | PENDING; corpus counts near zero | PENDING | PENDING | Frame counter definition; whether the corpus uses these at all. |

## 3. Time, frame and audio inputs

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | `Timekeeper.time`, `Timekeeper.fps` (damped) | host-supplied | Engine owns `Timekeeper`; injects into flat EEL pool | IMPL | IMPL | — |
| MilkDrop | Frame counter | host-supplied | Engine `.frame` increment per step | IMPL | IMPL | — |
| MilkDrop | Audio: PCM ring, FFT, Loudness (bass/mid/treb + `_att`) | host-supplied via front end | AudioEngine.analysis runs in player/studio; values passed into `Engine.step()`; injected globally into EEL pool | IMPL | IMPL | — |
| MilkDrop | `vol` (regvar candidate) | host-supplied | Absent — verified in var-contract check | N/A | N/A | — |
| MilkDrop | `WaveformAligner`, right-channel spectrum | host-supplied | Not ported; nothing consumes them yet | N/A | N/A | Consumer scene. |
| Plane9 | Beat.rawBeat (upstream detector) | host-supplied | Product supplies musicActive=false; op returns NoMusic | REFUSE | REFUSE | CBeatNode detector at 0x240a60. |
| Plane9 | Plane9 evaluator/frame delta | host-supplied | PENDING; native MinMax advances by raw `step(dt)` today | PENDING | REFUSE | Plane9 evaluator semantics; representation as graph component. |
| Plane9 | Sound analyzer: 30 Hz lock, 44.1 kHz sample skipping, decaying tracked max normalization | host-supplied | Documented at history.txt lines 68/86-87/74/79/295; not yet ported | PENDING | REFUSE | Full audio analyzer transcription. |

## 4. Image, texture and render-target inputs and outputs

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | Feedback texture pair (VS_MAIN and VS_TEMP in `plugin.cpp:949`) | host-supplied | Executor owns `tA`/`tB` ping-pong; not a `.phos` value | PLAN | PLAN | Texture graph value (this cycle: substrate row). |
| MilkDrop | Composite output → canvas | host-supplied | Composite pass writes swapchain directly | PLAN | PLAN | Explicit presentation resource ID. |
| Plane9 | Shader.Src (implicit texture input) | connection-derived | PENDING; drift op removed this cycle | PENDING | REFUSE | Explicit texture-resource port. |
| Plane9 | Shader.Render (implicit texture output) | connection-derived | PENDING | PENDING | REFUSE | Explicit texture-resource port with target format. |
| Plane9 | Shader.gSrcSampler / gBaseSampler (sampler2D uniforms) | connection-derived | PENDING; must map to explicit texture-resource inputs, not editable scene ports | PENDING | REFUSE | Texture-resource type with sampler descriptor. |
| Plane9 | Shader.gPermutation1dSampler / gPermutation2dSampler / gFastPerlinNoiseSampler | host-supplied | PENDING; requires pre-generated permutation/noise texture generators | PENDING | REFUSE | Provenance for permutation tables; noise texture generator. |

## 5. Dimensions and size policies

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | Feedback texture size (canvas-tracked, 16-block snap `plugin.cpp:1879-1880`) | resource-derived | Executor derives `texW`/`texH` from canvas; scenes do not set | IMPL | IMPL | — |
| MilkDrop | Composite overscan `1 + 1/W`, `1 + 1/H` | resource-derived | Executor computes per frame from canvas dimensions | IMPL | IMPL | — |
| Plane9 | Shader gSourceTextureSize | resource-derived | PENDING; must derive from connected texture resource, not editable port | PENDING | REFUSE | Texture descriptor propagation through edges. |
| Plane9 | Screen.Viewport | scene-authored | `screen` op vec4 port; witnessed geometry-free = `[0,0,1,1]` | IMPL (witnessed) | IMPL (witnessed) | Non-witnessed viewport semantics. |
| Plane9 | Screen.ScaleByAspect | scene-authored | `screen` op float port; witnessed = 0 | IMPL (witnessed) | IMPL (witnessed) | Non-zero semantics. |

## 6. Pixel and render-target formats

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | Feedback texture format (`rgba8unorm`) | host-supplied | Executor allocates `rgba8unorm` for `tA`/`tB` | IMPL | IMPL | — |
| MilkDrop | Composite target = canvas format | host-supplied | Executor uses `fmt` from `navigator.gpu.getPreferredCanvasFormat()` | IMPL | IMPL | — |
| Plane9 | Shader pass target format | resource-derived | PENDING; must be part of pipeline-cache identity, not fixed to `rgba8unorm` | PENDING | REFUSE | Substrate row: texture descriptor carries format. |
| Plane9 | Sample count | resource-derived | PENDING; corpus does not show MSAA references | PENDING | REFUSE | Corpus scan for sample count evidence. |

## 7. Sampler / filter / address behavior

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | Warp address mode (`wrap` variable → repeat/clamp) | scene-authored | `motion.wrap > 0.5` selects `sampWrap` vs `sampClamp` at executor | IMPL | IMPL | — |
| MilkDrop | Composite sampler = wrap (source `:976-981`) | host-supplied | Executor hard-binds `sampWrap` on composite | IMPL | IMPL | — |
| Plane9 | Shader sampler modes | host-supplied | PENDING; source `sampler_state` comment blocks name `MinFilter=Linear`, `AddressU=ClampToEdge` for blur | PENDING | REFUSE | Sampler descriptor as part of texture resource. |
| Plane9 | Mip / LOD | host-supplied | PENDING; source uses `textureLod(t, uv, 0.0)` explicitly | PENDING | REFUSE | Mip generation for non-zero LOD samples. |

## 8. Transient, persistent and feedback resources

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | Feedback pair (persistent across frames) | host-supplied | Executor ping-pong `tA`/`tB` with per-frame swap | IMPL | IMPL | Substrate row: represent as persistent resource with lifetime tag. |
| MilkDrop | Canvas (presentation, per-frame) | host-supplied | Composite writes `ctx.getCurrentTexture()` | IMPL | IMPL | Substrate row: explicit presentation resource. |
| Plane9 | Shader intermediate render targets | host-supplied | PENDING; corpus multipass shaders imply transient targets between passes | PENDING | REFUSE | Substrate row: transient resource lifetime tag. |
| Plane9 | Bloom `gBaseSampler` (persistent across frames) | host-supplied | PENDING | PENDING | REFUSE | Whether `gBaseSampler` receives a cross-frame history. |

## 9. Multipass node scheduling

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | `warp-feedback` then `composite` sequence | host-supplied | Ops declare typed render ports; edges enforce the two-pass chain | IMPL | IMPL | — |
| Plane9 | `#if PASS == N` compile variants in `nodedata/*.glsl` | host-supplied | Removed this cycle; original drift exposed `Pass` as float scene port | PENDING | REFUSE | Whether `PASS` is scene-visible, host-generated, or internal-node-owned. |
| Plane9 | Bloom internal 5-pass schedule | host-supplied | PENDING; source declares 5 passes in one nodedata file | PENDING | REFUSE | Source evidence for pass scheduling authority. |
| Plane9 | Blur internal 4-pass schedule | host-supplied | PENDING | PENDING | REFUSE | Same. |
| Plane9 | Downscale2 internal 2-pass schedule | host-supplied | PENDING | PENDING | REFUSE | Same. |

## 10. Shader stages and entry points

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | Warp `vs`/`fs` (transcribed WGSL at `render-wgsl.mjs`) | host-supplied | Inline WGSL modules; executor compiles them | IMPL | IMPL | — |
| MilkDrop | Composite `vs`/`fs` | host-supplied | Inline WGSL modules | IMPL | IMPL | — |
| Plane9 | `#ifdef VERTEX` / `#ifdef FRAGMENT` blocks | host-supplied | PENDING; source uses one GLSL file per node with both stages | PENDING | REFUSE | WGSL translator with vertex + fragment entry points. |
| Plane9 | `VERTEXOUTPUT { ... }` (varyings) | host-supplied | PENDING; must become a WGSL `struct VSOut` | PENDING | REFUSE | Translator convention. |
| Plane9 | Vertex attributes `iPosition`, `iTexCoord`, `iColor` | host-supplied | PENDING; host supplies a full-screen quad or geometry-supplied buffers | PENDING | REFUSE | Source-visible quad geometry contract. |
| Plane9 | Fragment output `oColor` | host-supplied | PENDING; must become WGSL `@location(0)` | PENDING | REFUSE | Same. |

## 11. Uniforms supplied by scene ports vs by host

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | All scalar/color ports listed in row 1 | scene-authored | Ops declare them as float/vec4 ports | IMPL | IMPL | — |
| Plane9 | Shader `g`-prefix uniforms (e.g. `gBrightness`) | scene-authored | PENDING; whether every g-uniform is a scene port or some are host-supplied requires source evidence | PENDING | REFUSE | Per-uniform scene-port vs host-supplied classification from Plane9 source. |
| Plane9 | Shader `gRand2` (streak.glsl) | host-supplied? | PENDING; corpus suggests per-frame host-generated | PENDING | REFUSE | Whether host injects `gRand2` or the scene wires it. |
| Plane9 | Shader `gSourceTextureSize` | resource-derived | PENDING; drift exposed as editable port; must derive from connected texture | PENDING | REFUSE | Substrate row: derive from texture descriptor. |
| Plane9 | Shader `gMVP` (referenced by nodedata) | host-supplied? | PENDING | PENDING | REFUSE | Plane9 view/projection matrix supply mechanism. |

## 12. Mesh and geometry inputs

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | 48×36 warp mesh (indices + positions + warped UVs) | host-supplied | `warp-mesh.mjs`: `buildStripIndices`, `buildWarpUVs`, `meshPositions` | IMPL | IMPL | — |
| Plane9 | Cube, Sphere, Plane, Cylinder, Disc, Torus | scene-authored | PENDING; documented at `sources/PRIMITIVES-PLANE9.md` as GEOM primitive; 335 instances | PENDING | REFUSE | Mesh generator implementations plus source-evidence for parameterization. |
| Plane9 | Transform, Subdivide, Extrude, InvertMesh, SelectMesh | scene-authored | PENDING; mesh operations in GEOM primitive | PENDING | REFUSE | Op semantics from source. |

## 13. Viewport, camera and presentation

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | Presentation to canvas | host-supplied | Composite writes swapchain | IMPL | IMPL | Substrate row: make explicit as a presentation resource. |
| Plane9 | Screen node (Viewport, CamPos, CamRot, CamLookAt, CamLookAtInWorldSpace, CamFov, CamNear, CamFar, ScaleByAspect) | scene-authored | `screen` op with port-constrained witnessed geometry-free config | IMPL (witnessed) | IMPL (witnessed) | Non-witnessed configurations. |
| Plane9 | Non-witnessed camera configurations (173/252 corpus scenes) | scene-authored | Refused at Engine construction via `portConstraints` | REFUSE | REFUSE | Runtime effect of camera ports outside geometry-free case. |

## 14. Blend, depth, raster and load/store state

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | Alpha-blend for border rings | host-supplied | Fragment shader mixes based on aGate threshold | IMPL | IMPL | — |
| MilkDrop | Composite: `loadOp: 'clear'`, `storeOp: 'store'` | host-supplied | Executor hard-codes | IMPL | IMPL | Substrate row: make explicit per-pass. |
| Plane9 | Shader pass blend/depth/raster | host-supplied | PENDING; corpus alpha-luminance handshake in scenepreaa→scenefxaa suggests specific writes | PENDING | REFUSE | Per-pass blend state from source. |

## 15. External assets

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | External texture files | scene-authored | Not in retained corpus; refused at import | REFUSE | REFUSE | Consumer scene forcing implementation. |
| Plane9 | External model / audio assets | scene-authored | Corpus does not carry; refused at import | REFUSE | REFUSE | Same. |

## 16. Timelines and state persistence

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | Per-frame equation state persistence | scene-authored | EEL pool persists across frames | IMPL | IMPL | — |
| Plane9 | `.phos` `timeline` field | scene-authored | Refused non-empty at parse | REFUSE | REFUSE | Consumer scene. |
| Plane9 | `perm` / `permrand` "not reset for node life" | host-supplied | PENDING per row-2 expressions | PENDING | REFUSE | Per-node lifetime rule. |
| Plane9 | Scene `DevelopmentTime`, `Created`, `LastModified` | scene-authored | Parsed metadata retained on Scene | IMPL | IMPL | — |
| Plane9 | Scene `WarmupTime` | scene-authored | Parsed; PENDING what "warmup" means at runtime | PARSE | PENDING | Definition and enforcement. |
| Plane9 | Scene `Version`, `FormatVersion` | scene-authored | Parsed and refused non-`FormatVersion="2"` at converter | IMPL | IMPL | — |

---

## Coverage note

Sections 1, 2 (MilkDrop half), 3 (MilkDrop half), 4 (MilkDrop half), 5 (MilkDrop half), 6 (MilkDrop half), 7 (MilkDrop half), 8 (MilkDrop half), 9 (MilkDrop half), 10 (MilkDrop half), 11 (MilkDrop half), 12 (MilkDrop half), 13 (Plane9 witnessed subset), 14 (MilkDrop half), 15, and 16 cover every property observed in either the MilkDrop retained pipeline or the currently-authorized Plane9 slice (Screen, Clear, RGBAToColor). Every PENDING row names the specific evidence that would close it.

The Plane9-Shader and Plane9-GEOM primitive families are represented by
PENDING rows on the properties they carry (rows 4, 5, 7, 8, 9, 10, 11,
12). The reviewer 2026-07-18 direction was to not re-authorize any
Plane9 Shader-node conversion until a resource substrate exists in
`.phos`, so those PENDING rows remain PENDING at the compatibility gate.

## Related documents

- `sources/PLANE9-CONTRACT.md` — Plane9 corpus + install evidence.
- `sources/PRIMITIVES-PLANE9.md` — five-primitive target set derived from the 252-scene corpus.
- `sources/PRIMITIVES.md` — MilkDrop-derived primitives.
- `design/PHOS-FORMAT.md` — `.phos` format specification.
- `design/SCENE-ANATOMY.md` — `.p9c` wiring model.
- `design/VSLICE-MOSCOW.md` — vertical-slice MoSCoW.
