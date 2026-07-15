# Plane9 semantic inventory

Tracking surface for Plane9 compatibility work under
[COMPATIBILITY-GOAL.md](../COMPATIBILITY-GOAL.md). Each row names one
source-defined item, the authoritative evidence that defines its
behavior, where PHOSPHENE represents and implements it, the direct
semantic test that pins it, and its current status.

The execution model derivation lives in
[`plane9-execution-model.md`](plane9-execution-model.md). This inventory
does not duplicate that derivation — it records what has been implemented
and what remains, with status derived from evidence (test presence,
source citation, code location), not from prose claims.

Status values are the same as [`semantic-inventory-milkdrop.md`](semantic-inventory-milkdrop.md):
`implemented`, `partial`, `unresolved`, `unsupported`.

## 1. Scene container

| Item | Source | PHOSPHENE representation | PHOSPHENE implementation | Semantic test | Status | Notes |
|---|---|---|---|---|---|---|
| `.p9c` zip container holding `scene.xml`; root `Plane9Scene` with attributes and Nodes/Connections children | `plane9-execution-model.md` §1 (census 252/252 scenes parsed) | `src/import/p9.ts` `parseP9c` | same | `tests/p9-import.test.ts` (6 tests) | partial | Missing: assertion for each root attribute (`FormatVersion`, `WarmupTime`, etc.) parsed at the exact value stored, for a controlled input scene. |
| `@WarmupTime` seconds pre-run before display | Plane9 wiki + census evidence | not represented in the graph | not implemented | none | unresolved | Every trail/feedback scene starts cold without this. Needs a graph-level warmup declaration. |
| `Node[@Type,@Id,...]` with `Port[@Id]` children carrying `Value` (numbers, vectors, CDATA shader text) | scene.xml structure | `src/import/p9.ts` node parsing | same | see p9-import.test.ts | partial | Missing: per-port value-type coercion test (number vs vector-string vs shader-text CDATA) for a controlled input. |
| `Connections/Connection[@Out, @In]` single-link encoding (3271 corpus instances) | census | `src/import/p9.ts` connection parsing → `graph.data` edges | same | none dedicated | partial | Missing: assertion that every parsed connection produces a matching data edge with correct source/target port ids. |

## 2. Node inventory (75 shipped types)

| Item | Source | PHOSPHENE representation | PHOSPHENE implementation | Semantic test | Status | Notes |
|---|---|---|---|---|---|---|
| Screen / Clear / RenderRect (top-scene structure, 252/252/214 scenes) | census; `plane9-execution-model.md` §2 | `src/import/p9.ts` maps to graph nodes | not fully implemented in `GraphExecutor` | none dedicated | partial | The Screen + Clear scene root must produce a valid graph.order for the executor. Needs per-node semantic test. |
| Shader (fullscreen-shader draw, 247/252) | scene shader CDATA; helper library at `$P9/nodedata/shader.glsl` (706 lines, 96 defs) | `src/import/p9.ts` produces `draw-fullscreen` nodes | GraphExecutor refuses `lang!=wgsl`; glsl-p9 → WGSL translator not implemented | none | unresolved | Blocking the largest single body of Plane9 compatibility work. Translator must consume the 706-line helper library plus per-scene fragment. |
| RenderObject / MeshObject / primitive meshes (Cube/Sphere/Plane/…, 161/252) | census; DLL string tables | `src/import/p9.ts` → `draw-mesh` nodes | `GraphExecutor.compileMesh` for a few primitives; refuses others | none | partial | Missing: per-primitive geometry test that asserts the vertex buffer matches the source-defined mesh for cube/sphere/plane. |
| RenderToTexture / PreviousLayer / Store/CopyTexture (138/252) | census | `graph.target` nodes with `feedback: true` | GraphExecutor front/back rotation | none dedicated | partial | Missing: assertion that a graph with a feedback target rotates front/back exactly per source, and that PreviousLayer resolves to the back buffer. |
| Bloom (103/252) | `$P9/nodedata/bloom.glsl`, `blur.glsl`, `downscale2.glsl` | `graph.bloom` node | GraphExecutor bright + blur H/V + composite | none dedicated | partial | Missing: WGSL-input/output test of each bloom step against the Plane9 GLSL formulas. |
| Expression / Vector / MinMax / HSLAToColor (CPU dataflow, 93/252) | scene XML + `docs/plane9-execution-model.md` §3 | `graph.data` CPU edges + `cpu-expr` nodes | not implemented — `GraphExecutor` refuses `g.data.length > 0` | none | unresolved | The CPU per-frame dataflow is unimplemented. Needs an expression runtime executing on the CPU each frame and feeding uniforms. |
| CloneExpression / MeshInstancer (per-clone math, 59/252) | scene XML | not represented | not implemented | none | unresolved | Instancing needs both mesh instancing and per-instance evaluation of a CPU expression. |
| Particles / Fluid2d / LinearSolver (21/252) | scene XML + Plane9 particle system evidence | `graph.particles` node | GraphExecutor `particles` handling | none dedicated | partial | Missing: per-particle-step math test. |
| Beat / SoundTexture / Spectrum / Oscilloscope / Waveform / Bars (audio nodes, 17..12/252) | Plane9 audio helpers | not represented | not implemented | none | unresolved | Audio nodes need mapping to PHOSPHENE audio features. |
| TextWriter / Clock (7/252) | scene XML | `graph.texture` node with `source.kind=text` | GraphExecutor rasterizes text into image slot | none dedicated | partial | Missing: pin exact text-image content for a controlled input. |
| Transitions between scenes (40/252) | scene XML `SceneCompatibility` | not represented | not implemented | none | unresolved | Cross-scene transitions require a scene-level state model not present. |
| File textures / images (42/252) | scene XML port values | `graph.imageAsset` | GraphExecutor loads via createImageBitmap | none dedicated | partial | Missing: assertion that a preset with a texture port produces the correct image binding. |
| VR output (tagged subset) | scene XML tag | not represented | not implemented | none | unsupported | Out of PHOSPHENE scope until an editable representation is designed. |

## 3. Shader translation

| Item | Source | PHOSPHENE representation | PHOSPHENE implementation | Semantic test | Status | Notes |
|---|---|---|---|---|---|---|
| glsl-p9 helper library (706 lines, 96 definitions) | `fixtures/plane9/shader.glsl` (evidence, gitignored copy of `$P9/nodedata/shader.glsl`) | not translated | not implemented | none | unresolved | The translator must produce WGSL equivalents for every helper the corpus uses. Census-driven prioritization: translate helpers by descending frequency of use. |
| Vertex + fragment two-stage shader form (`#ifdef VERTEX`, `#ifdef FRAGMENT`, `VERTEXOUTPUT`) | scene shader CDATA blocks; `Plane9Engine.dll` string tables | parser at `src/import/p9.ts` splits into `ShaderSource.vertex`/`fragment`/`interstage` | not executed | none | partial | Parsing produces the split; the translator that emits WGSL vertex + fragment from these parts is missing. |
| Post-process shaders (bloom, blur, streak, downscale2, ls_jacobi, scenefxaa, scenepreaa) | `$P9/nodedata/*.glsl` | not translated | not implemented | none | unresolved | Each has a fixed uniform contract from the DLL. |
| Uniforms and render-state contract from `Plane9Engine.dll` string tables | `fixtures/plane9/engine-dll-strings.txt` | partially parsed | not implemented | none | unresolved | Every enum value and every uniform name the engine sets must be represented. |

## 4. CPU dataflow

| Item | Source | PHOSPHENE representation | PHOSPHENE implementation | Semantic test | Status | Notes |
|---|---|---|---|---|---|---|
| Per-frame expression evaluation feeding shader uniforms and mesh transforms | Expression/Vector/MinMax/HSLAToColor nodes; scene XML | `graph.data` edges | refused by `GraphExecutor` | none | unresolved | The expression runtime is the closest thing PHOSPHENE has, but the wiring layer that consumes Expression node inputs and produces uniform outputs does not exist. |
| Uniform routing (mod-route nodes) | scene XML | `graph.nodes` with kind `mod-route` | GraphExecutor evaluates via `ModEngine` | none dedicated | partial | Missing: assertion that a mod-route feeding a fullscreen draw produces the correct uniform value at runtime. |

## 5. Refused surfaces

| Item | Reason for refusal | Location |
|---|---|---|
| `.p9c` scene with non-WGSL shader draw nodes | glsl-p9 → WGSL translator not implemented | `src/gpu/graph-executor.ts` `EXECUTABLE_KINDS` filter |
| `.p9c` scene with data edges (`g.data.length > 0`) | Plane9 CPU dataflow executor not implemented | `src/gpu/graph-executor.ts` load-time refusal |
| `draw-fullscreen` with `blend: "alpha"` | Not evidenced as a native consumer form | `src/gpu/graph-executor.ts` load-time refusal |
| `draw-fullscreen` with `p9State` | Render-state enum mapping not evidenced | `src/gpu/graph-executor.ts` load-time refusal |
| `texture` node sourcing `sound` or `previous-frame` | Not implemented | `src/gpu/graph-executor.ts` |
| VR output tag | Out of PHOSPHENE editable-scene scope | not modeled |

Refused items do not block: they are the concrete backlog of future
inventory rows that must move from `unresolved` to `implemented`.
