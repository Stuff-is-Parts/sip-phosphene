# PHOSPHENE Source-Property Inventory {#top}

### DOCUMENT ROLE

Layer 4 reference opened for task selection, coverage review, or any claim that
a source property is implemented, refused, or pending. Responsibility: owns the
single cross-engine property-level accounting surface. The engine-specific
references and mapped primary artifacts supply semantics; this inventory routes
to them without replacing them.

---

### 1. COVERAGE ACCOUNTING {#coverage}

#### I. WHAT

Purpose (reviewer 2026-07-18): PHOSPHENE must become a native,
source-neutral substrate into which MilkDrop and Plane9 scenes are
mechanically transpiled. This document is the accounting system: every
source property either maps to a typed PHOS representation or produces a
named refusal. Coverage is over the currently observed corpus, not
speculative future formats.

This is the single coverage-accounting index, not a semantic
substitute for the primary sources and not independent proof of current status.
Each row routes work to the mapped live source evidence, converter decision,
native implementation, authentic source path, and refusal or result. Statuses
are repository claims and must be reconciled with those artifacts whenever the
row changes. Do not create a parallel inventory.

#### II. HOW

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
| **IMPL** | Native representation and ordinary execution path exist; this alone is not source evidence. |
| **PLAN** | Representation exists in `.phos` typing, engine planning covers it, browser realization not yet exercised on WebGPU. |
| **REFUSE** | Source property is recognised, parser routes it to a named refusal. |
| **PARSE** | Source parser retains the raw value; downstream routing is a pending row. |
| **PASS** | Compatibility gate accepts the evidenced source mapping at the stated granularity. |
| **UNRESOLVED** | Source mapping is incomplete or inadequately evidenced and must not contribute to compatibility PASS. |
| **N/A** | Source does not carry this property. |
| **PENDING** | Row identified from corpus/DLL evidence, PHOS routing not yet chosen. |

---

## 1. Scalar, vector and color values

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | `fDecay`, `fWarpAnimSpeed`, `fWarpScale`, `fZoomExponent`, `fGammaAdj`, `fVideoEchoZoom`, `fVideoEchoAlpha` | scene-authored | `warp-feedback` / `composite` op float ports | IMPL | PASS | — |
| MilkDrop | `nVideoEchoOrientation` | scene-authored | `composite` op float port (rounded mod 4 at draw) | IMPL | PASS | — |
| MilkDrop | `zoom`, `rot`, `warp`, `cx`, `cy`, `dx`, `dy`, `sx`, `sy` | scene-authored | `warp-feedback` op float ports; per-frame equations may rewrite | IMPL | PASS | — |
| MilkDrop | `ib_size`, `ib_r`, `ib_g`, `ib_b`, `ib_a`, `ob_size`, `ob_r`, `ob_g`, `ob_b`, `ob_a` | scene-authored | `borders` op float ports; folded into warp-feedback pass at contribute | IMPL | PASS | — |
| Plane9 | Clear.Color | scene-authored | `clear-color` op vec4 port | IMPL | PASS | — |
| Plane9 | RGBAToColor.Red/Green/Blue/Alpha | scene-authored | `RGBAToColor` op float ports; Color vec4 output | IMPL | PASS | — |
| Plane9 | HSLAToColor.Hue/Saturation/Lightness/Alpha | scene-authored | `HSLAToColor` op float ports; Color vec4 output | IMPL | UNRESOLVED | 2nd retained Plane9 vector from a different Hue segment. |
| Plane9 | MinMax.Min/Max/Mode/DelayMin/DelayMax/DelayMode/ITimeMin/ITimeMax/ITimeMode | scene-authored | `MinMax` op float ports (DelayMode/ITimeMode port-constrained to 1) | IMPL | UNRESOLVED | DLL disassembly of evaluator/selector/RNG at 0x100DD600/0x100DD9A0/0x1001FE30. |
| Plane9 | Beat.NoMusic/Amplification/Min/Max | scene-authored | `Beat` op float ports; product supplies musicActive=false | IMPL | UNRESOLVED | Detector at CBeatNode 0x240a60; controlled-audio probe. |

## 2. Expressions and built-in variables

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | `per_frame_N` blocks | scene-authored | `.phos` `expressions[].stage='per-frame'.code` array | IMPL | PASS | — |
| MilkDrop | `per_vertex_N` / `per_pixel_N` blocks | scene-authored | Refused at importer per-pixel/per-vertex clause | REFUSE | UNRESOLVED | Per-vertex VM implementation. |
| MilkDrop | Built-ins: `time`, `fps`, `frame`, `bass`, `mid`, `treb`, `bass_att`, `mid_att`, `treb_att`, `progress`, `meshx`, `meshy`, `pixelsx`, `pixelsy`, `aspectx`, `aspecty` | host-supplied | Engine injects into flat EEL pool each step | IMPL | PASS | — |
| MilkDrop | Regvars: `decay`, `gamma`, `echo_zoom`, `echo_alpha`, `echo_orient`, `zoomexp` | connection-derived | `KEY_TO_EEL` alias table syncs port ↔ pool | IMPL | PASS | — |
| MilkDrop | EEL functions (35): projectm-eval TreeFunctions.c full table | host-supplied | `eelSubject` implementations transcribed from `projectm-eval@da885dc` | IMPL | PASS | — |
| MilkDrop | EEL operators: `+ - * / % ^ = == != < > <= >= ? :` plus `!`, unary `-` `+` | scene-authored | `compileEEL` parser transcribes Compiler.y:55-75 grammar | IMPL | PASS | — |
| MilkDrop | EEL refused: `&& \|\| \| &`, `$`-constants, compound assignment, megabuf | scene-authored | Parse-time refusal naming the token | REFUSE | UNRESOLVED | Direct source evidence for each construct. |
| Plane9 | `time` (175 scenes) | host-supplied | `.phos` variable-view read; expression evaluator PENDING | PENDING | UNRESOLVED | Plane9 expreval identity vs projectm-eval. |
| Plane9 | `deltatime` (98 scenes) | host-supplied | 30 Hz analyzer lock evidence (history.txt:68); representation PENDING | PENDING | UNRESOLVED | Per-frame elapsed-time semantics vs `time`. |
| Plane9 | `band(channel, damping, bandnr, nomusic)` (123 scenes) | host-supplied | Representation PENDING; signature RESOLVED per plane9.com expression reference | PENDING | UNRESOLVED | Band-count/edges spec. |
| Plane9 | `beat(nomusic)` (52 scenes) | host-supplied | Representation PENDING | PENDING | UNRESOLVED | Detector algorithm at CBeatNode. |
| Plane9 | `rand()`, `srand()`, `random(min,max)`, `srandom()` (54 scenes) | host-supplied | Representation PENDING; family RESOLVED per plane9.com reference | PENDING | UNRESOLVED | expreval RNG identity for bit-exact reproduction. |
| Plane9 | `aspect` (20 scenes) | host-supplied | Representation PENDING; dll help "Current render aspect." (Plane9Engine.dll string) | PENDING | UNRESOLVED | — |
| Plane9 | `perm`, `permrand` (Expression-node metadata) | host-supplied | Representation PENDING; docs state initial 0 / 0.0-1.0, not reset for node life | PENDING | UNRESOLVED | Semantic clarity around per-scene lifetime. |
| Plane9 | `frame`, `soundlevel`, `fps`, `mouse` (0–12 scenes) | host-supplied | PENDING; corpus counts near zero | PENDING | UNRESOLVED | Frame counter definition; whether the corpus uses these at all. |

## 3. Time, frame and audio inputs

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | `Timekeeper.time`, `Timekeeper.fps` (damped) | host-supplied | Engine owns `Timekeeper`; injects into flat EEL pool | IMPL | PASS | — |
| MilkDrop | Frame counter | host-supplied | Engine `.frame` increment per step | IMPL | PASS | — |
| MilkDrop | Audio: PCM ring, FFT, Loudness (bass/mid/treb + `_att`) | host-supplied via front end | AudioEngine.analysis runs in player/studio; values passed into `Engine.step()`; injected globally into EEL pool | IMPL | PASS | — |
| MilkDrop | `vol` (regvar candidate) | host-supplied | Absent — verified in var-contract check | N/A | N/A | — |
| MilkDrop | `WaveformAligner`, right-channel spectrum | host-supplied | Not ported; nothing consumes them yet | N/A | N/A | Consumer scene. |
| Plane9 | Beat.rawBeat (upstream detector) | host-supplied | Product supplies musicActive=false; op returns NoMusic | REFUSE | UNRESOLVED | CBeatNode detector at 0x240a60. |
| Plane9 | Plane9 evaluator/frame delta | host-supplied | PENDING; native MinMax advances by raw `step(dt)` today | PENDING | UNRESOLVED | Plane9 evaluator semantics; representation as graph component. |
| Plane9 | Sound analyzer: 30 Hz lock, 44.1 kHz sample skipping, decaying tracked max normalization | host-supplied | Documented at history.txt lines 68/86-87/74/79/295; not yet ported | PENDING | UNRESOLVED | Full audio analyzer transcription. |

## 4. Image, texture and render-target inputs and outputs

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | Feedback texture pair (VS_MAIN and VS_TEMP in `plugin.cpp:949`) | host-supplied | `.phos` declares `md-feedback` as a sampled/render-attachment `persistent-pingpong` texture; the executor allocates and swaps its physical pair | IMPL | PASS | — |
| MilkDrop | Composite output → canvas | host-supplied | `.phos` declares `canvas` as a per-frame presentation resource; the composite pass writes it and the render plan names it for presentation | IMPL | PASS | — |
| Plane9 | Shader.Src (implicit texture input) | connection-derived | PENDING; drift op removed this cycle | PENDING | UNRESOLVED | Explicit texture-resource port. |
| Plane9 | Shader.Render (implicit texture output) | connection-derived | PENDING | PENDING | UNRESOLVED | Explicit texture-resource port with target format. |
| Plane9 | Shader.gSrcSampler / gBaseSampler (sampler2D uniforms) | connection-derived | PENDING; must map to explicit texture-resource inputs, not editable scene ports | PENDING | UNRESOLVED | Texture-resource type with sampler descriptor. |
| Plane9 | Shader.gPermutation1dSampler / gPermutation2dSampler / gFastPerlinNoiseSampler | host-supplied | PENDING; requires pre-generated permutation/noise texture generators | PENDING | UNRESOLVED | Provenance for permutation tables; noise texture generator. |

## 5. Dimensions and size policies

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | Feedback texture size (canvas-tracked, 16-block snap `plugin.cpp:1879-1880`) | resource-derived | `md-feedback.size.policy='canvas-16block'`; executor derives dimensions from the live canvas | IMPL | PASS | — |
| MilkDrop | Composite overscan `1 + 1/W`, `1 + 1/H` | resource-derived | Executor computes per frame from canvas dimensions | IMPL | PASS | — |
| Plane9 | Shader gSourceTextureSize | resource-derived | PENDING; must derive from connected texture resource, not editable port | PENDING | UNRESOLVED | Texture descriptor propagation through edges. |
| Plane9 | Screen.Viewport | scene-authored | `screen` op vec4 port; witnessed geometry-free = `[0,0,1,1]` | IMPL (witnessed) | PASS (witnessed) | Non-witnessed viewport semantics. |
| Plane9 | Screen.ScaleByAspect | scene-authored | `screen` op float port; witnessed = 0 | IMPL (witnessed) | PASS (witnessed) | Non-zero semantics. |

## 6. Pixel and render-target formats

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | Feedback texture format (`rgba8unorm`) | host-supplied | `md-feedback.format='rgba8unorm'`; executor allocates both physical ping-pong textures from the descriptor | IMPL | PASS | — |
| MilkDrop | Composite target = canvas format | host-supplied | `canvas.format='preferred-canvas'`; executor resolves it from `navigator.gpu.getPreferredCanvasFormat()` | IMPL | PASS | — |
| Plane9 | RenderToTexture.Format=5 | scene-authored | Native resource schema and executor support `rgba16float`, but `p9ToPhos` registers no RenderToTexture native mapping | IMPL (substrate only) | UNRESOLVED | Complete RenderToTexture node contract; the format field alone is insufficient. |
| Plane9 | Shader pass target format | resource-derived | PENDING; must be part of pipeline-cache identity, not fixed to `rgba8unorm` | PENDING | UNRESOLVED | Substrate row: texture descriptor carries format. |
| Plane9 | Sample count | resource-derived | PENDING; corpus does not show MSAA references | PENDING | UNRESOLVED | Corpus scan for sample count evidence. |

## 7. Sampler / filter / address behavior

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | Warp address mode (`wrap` variable → repeat/clamp) | scene-authored | `motion.wrap > 0.5` selects `sampWrap` vs `sampClamp` at executor | IMPL | PASS | — |
| MilkDrop | Composite sampler = wrap (source `:976-981`) | host-supplied | Executor hard-binds `sampWrap` on composite | IMPL | PASS | — |
| Plane9 | Shader sampler modes | host-supplied | PENDING; source `sampler_state` comment blocks name `MinFilter=Linear`, `AddressU=ClampToEdge` for blur | PENDING | UNRESOLVED | Sampler descriptor as part of texture resource. |
| Plane9 | Mip / LOD | host-supplied | PENDING; source uses `textureLod(t, uv, 0.0)` explicitly | PENDING | UNRESOLVED | Mip generation for non-zero LOD samples. |

## 8. Transient, persistent and feedback resources

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | Feedback pair (persistent across frames) | host-supplied | `.phos` resource lifetime is `persistent-pingpong`; executor owns the physical pair and swaps it per frame | IMPL | PASS | — |
| MilkDrop | Canvas (presentation, per-frame) | host-supplied | `.phos` resource kind is `presentation`, lifetime is `per-frame`, and the composite pass writes the current canvas texture | IMPL | PASS | — |
| Plane9 | Shader intermediate render targets | host-supplied | PENDING; corpus multipass shaders imply transient targets between passes | PENDING | UNRESOLVED | Substrate row: transient resource lifetime tag. |
| Plane9 | Bloom `gBaseSampler` (persistent across frames) | host-supplied | PENDING | PENDING | UNRESOLVED | Whether `gBaseSampler` receives a cross-frame history. |

## 9. Multipass node scheduling

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | `warp-feedback` then `composite` sequence | host-supplied | Ops declare typed render ports; edges enforce the two-pass chain | IMPL | PASS | — |
| Plane9 | `#if PASS == N` compile variants in `nodedata/*.glsl` | host-supplied | Removed this cycle; original drift exposed `Pass` as float scene port | PENDING | UNRESOLVED | Whether `PASS` is scene-visible, host-generated, or internal-node-owned. |
| Plane9 | Bloom internal 5-pass schedule | host-supplied | PENDING; source declares 5 passes in one nodedata file | PENDING | UNRESOLVED | Source evidence for pass scheduling authority. |
| Plane9 | Blur internal 4-pass schedule | host-supplied | PENDING | PENDING | UNRESOLVED | Same. |
| Plane9 | Downscale2 internal 2-pass schedule | host-supplied | PENDING | PENDING | UNRESOLVED | Same. |

## 10. Shader stages and entry points

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | Warp `vs`/`fs` (transcribed WGSL at `render-wgsl.mjs`) | host-supplied | Inline WGSL modules; executor compiles them | IMPL | PASS | — |
| MilkDrop | Composite `vs`/`fs` | host-supplied | Inline WGSL modules | IMPL | PASS | — |
| Plane9 | `#ifdef VERTEX` / `#ifdef FRAGMENT` blocks | host-supplied | PENDING; source uses one GLSL file per node with both stages | PENDING | UNRESOLVED | WGSL translator with vertex + fragment entry points. |
| Plane9 | `VERTEXOUTPUT { ... }` (varyings) | host-supplied | PENDING; must become a WGSL `struct VSOut` | PENDING | UNRESOLVED | Translator convention. |
| Plane9 | Vertex attributes `iPosition`, `iTexCoord`, `iColor` | host-supplied | PENDING; host supplies a full-screen quad or geometry-supplied buffers | PENDING | UNRESOLVED | Source-visible quad geometry contract. |
| Plane9 | Fragment output `oColor` | host-supplied | PENDING; must become WGSL `@location(0)` | PENDING | UNRESOLVED | Same. |

## 11. Uniforms supplied by scene ports vs by host

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | All scalar/color ports listed in row 1 | scene-authored | Ops declare them as float/vec4 ports | IMPL | PASS | — |
| Plane9 | Shader `g`-prefix uniforms (e.g. `gBrightness`) | scene-authored | PENDING; whether every g-uniform is a scene port or some are host-supplied requires source evidence | PENDING | UNRESOLVED | Per-uniform scene-port vs host-supplied classification from Plane9 source. |
| Plane9 | Shader `gRand2` (streak.glsl) | host-supplied? | PENDING; corpus suggests per-frame host-generated | PENDING | UNRESOLVED | Whether host injects `gRand2` or the scene wires it. |
| Plane9 | Shader `gSourceTextureSize` | resource-derived | PENDING; drift exposed as editable port; must derive from connected texture | PENDING | UNRESOLVED | Substrate row: derive from texture descriptor. |
| Plane9 | Shader `gMVP` (referenced by nodedata) | host-supplied? | PENDING | PENDING | UNRESOLVED | Plane9 view/projection matrix supply mechanism. |

## 12. Mesh and geometry inputs

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | 48×36 warp mesh (indices + positions + warped UVs) | host-supplied | `warp-mesh.mjs`: `buildStripIndices`, `buildWarpUVs`, `meshPositions` | IMPL | PASS | — |
| Plane9 | Cube, Sphere, Plane, Cylinder, Disc, Torus | scene-authored | PENDING; documented in the Plane9 primitive reference as GEOM; 335 instances | PENDING | UNRESOLVED | Mesh generator implementations plus source-evidence for parameterization. |
| Plane9 | Transform, Subdivide, Extrude, InvertMesh, SelectMesh | scene-authored | PENDING; mesh operations in GEOM primitive | PENDING | UNRESOLVED | Op semantics from source. |

## 13. Viewport, camera and presentation

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | Presentation to canvas | host-supplied | Composite targets the explicit `canvas` presentation resource and sets `plan.presentation` | IMPL | PASS | — |
| Plane9 | Screen node (Viewport, CamPos, CamRot, CamLookAt, CamLookAtInWorldSpace, CamFov, CamNear, CamFar, ScaleByAspect) | scene-authored | `screen` op with port-constrained witnessed geometry-free config | IMPL (witnessed) | PASS (witnessed) | Non-witnessed configurations. |
| Plane9 | Non-witnessed camera configurations (173/252 corpus scenes) | scene-authored | Refused at Engine construction via `portConstraints` | REFUSE | UNRESOLVED | Runtime effect of camera ports outside geometry-free case. |

## 14. Blend, depth, raster and load/store state

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | Alpha-blend for border rings | host-supplied | Fragment shader mixes based on aGate threshold | IMPL | PASS | — |
| MilkDrop | Composite: `loadOp: 'clear'`, `storeOp: 'store'` | host-supplied | Executor hard-codes | IMPL | PASS | Substrate row: make explicit per-pass. |
| Plane9 | Shader pass blend/depth/raster | host-supplied | PENDING; corpus alpha-luminance handshake in scenepreaa→scenefxaa suggests specific writes | PENDING | UNRESOLVED | Per-pass blend state from source. |

## 15. External assets

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | External texture files | scene-authored | Not in retained corpus; refused at import | REFUSE | UNRESOLVED | Consumer scene forcing implementation. |
| Plane9 | External model / audio assets | scene-authored | Corpus does not carry; refused at import | REFUSE | UNRESOLVED | Same. |

## 16. Timelines and state persistence

| Source | Exact name | Origin | PHOS representation | Native | Compat | Unresolved evidence |
|---|---|---|---|---|---|---|
| MilkDrop | Per-frame equation state persistence | scene-authored | EEL pool persists across frames | IMPL | PASS | — |
| Plane9 | `perm` / `permrand` "not reset for node life" | host-supplied | PENDING per row-2 expressions | PENDING | UNRESOLVED | Per-node lifetime rule. |
| Plane9 | Scene `Author`, `Desc`, `Tags`, `License` | scene-authored | Scanner recognizes each line, but `p9ToPhos` currently discards its attributes and content | PENDING | UNRESOLVED | Preserve the exact fields in `.phos` metadata or an explicit source-provenance extension. |
| Plane9 | Scene `Id`, `ParentId`, `SceneType`, `DevelopmentTime`, `Created`, `LastModified` | scene-authored | Scanner retains the root attribute string only; `p9ToPhos` does not parse or preserve these fields | PENDING | UNRESOLVED | Field-level representation and conversion. |
| Plane9 | Scene `WarmupTime` | scene-authored | Scanner retains the root attribute string only; `p9ToPhos` neither preserves nor executes it | PENDING | UNRESOLVED | Definition, representation, and runtime enforcement. |
| Plane9 | Scene `Version`, `FormatVersion` | scene-authored | Scanner retains the root attribute string, but conversion neither validates nor preserves the versions | PENDING | UNRESOLVED | Accepted-version validation and durable provenance. |

---

## Coverage note

Sections 1–16 account for the properties observed in the audited MilkDrop
pipeline and the current Plane9 evidence. The Plane9 node table authorizes
Screen, Clear, and RGBAToColor mappings at node-variant granularity, but the
scene conversion is not compatibility-complete while root and metadata fields
are discarded and no authentic retained Screen + Clear fixture exercises the
ordinary product path. Every PENDING or UNRESOLVED row names the fact or path
that would close it.

The Plane9-Shader and Plane9-GEOM primitive families are represented by
PENDING rows on the properties they carry (rows 4, 5, 7, 8, 9, 10, 11,
12). The native resource substrate now exists, but it does not by itself
establish any Plane9 Shader or RenderToTexture source contract; those rows
remain UNRESOLVED at the compatibility gate.

#### III. WHY

Property-level accounting prevents a parser, native operation, or one evidenced
field from being mistaken for complete source compatibility. One cross-engine
inventory also exposes missing representation without creating a second source
authority.

[Back to Top](#top)
