# PHOSPHENE Scene Anatomy and Stack Rationale {#top}

---

### DOCUMENT ROLE

Layer 4 architecture-history reference opened when a cited source requirement
appears not to fit the accepted native model. Responsibility: preserves the
source derivation of the five primitive families and the design seams behind
the graph architecture. The current format contract remains owned by
`sip-phosphene-format-reference.md`.

---

### 1. SOURCE-DERIVED ANATOMY {#anatomy}

#### I. WHAT

The accepted anatomy is a typed graph over GRAPH, SHADER, EXPRVM, GEOM, and
COMPUTE capabilities, with explicit resources and source-preserving ports.

#### II. HOW

Derived from the MilkDrop primitive contract, the Plane9 primitive inventory
(75 nodes across 252 scenes), and the real `.p9c` wiring model (typed ports +
Out/In edges).
Every structural choice below is tagged **[DERIVED]** (forced by a source
feature, with the evidence) or **[DESIGN]** (Claude's choice where the sources
don't dictate — the seam where judgment enters and you should scrutinize).

═══════════════════════════════════════════════════════════════════
## PART 1 — TECH STACK
═══════════════════════════════════════════════════════════════════

| Layer | Current foundation or required capability | Why (traceable) |
|---|---|---|
| GPU API | **WebGPU / WGSL** | [DERIVED] P1 COMPUTE (64 Plane9 instances incl. Fluid2d/LinearSolver) requires compute shaders + storage buffers; only WebGPU offers them in-browser. Storage textures serve P2 GRAPH (1029 instances). |
| Language | **JavaScript modules + JSDoc**, checked by strict TypeScript | [DESIGN] current implementation choice; not source-dictated. |
| Render core | **Resource-explicit render-graph engine** for currently registered ops | [DERIVED] Plane9's Connections block is a graph; MilkDrop feedback and multipass behavior require declared dependencies. General Plane9 graph coverage remains incomplete. |
| Geometry | **Required, not implemented** | [DERIVED] GEOM covers 22 Plane9 node types and 335 observed instances. The current `.phos` port type anticipates mesh values, but the resource schema and executor do not yet realize the subsystem. |
| Compute | **Required, not implemented as a general pass family** | [DERIVED] Particles, MeshInstancer, Fluid2d, and LinearSolver require it. A `compute` primitive tag alone is not execution support. |
| Expression | **MilkDrop per-frame JS VM implemented; per-vertex and Plane9 expression paths refused** | [DERIVED] Both sources require the broader expression surface, but accepted-unexecuted code is prohibited. |
| Shader translation | **No general GLSL/HLSL→WGSL transpiler exists** | [DERIVED] Current WGSL modules are bounded transcriptions. Plane9 Shader and general MilkDrop shader translation remain required source work. |
| Audio | **Raw PCM capture plus source-specific analysis code** | [DERIVED] MilkDrop and Plane9 expose different scene-visible audio contracts. Current time/audio ownership is still partly global rather than explicit graph data. |
| Studio UI | **Vanilla DOM + CodeMirror over the native document** | [DERIVED] Editing `.phos` directly avoids an import-only shadow model; full Plane9-grade graph editing remains product work. |
| Native | **No native shell is present** | [DESIGN] Tauri was proposed for desktop integration but is not an accepted implementation fact. |

The source inventory requires five capability families: **GRAPH, SHADER,
EXPRVM, GEOM, and COMPUTE**. All 75 observed Plane9 node types classify into
them structurally; that count does not prove the current format or executor
implements each family.

═══════════════════════════════════════════════════════════════════
## PART 2 — THE PHOSPHENE SCENE (.phos)
═══════════════════════════════════════════════════════════════════

A scene is a **typed node graph**: nodes with typed ports, wired by edges.
This shape is [DERIVED] directly from the .p9c model (Out="Node.Port"
In="Node.Port"), which is a superset of MilkDrop's fixed pipeline (MilkDrop
imports as a graph with its 16 ops pre-wired in canonical order).

### Top-level structure
```
Scene {
  format: "phos/1"
  meta:        { name, author, description, tags, license, credit, sourceEngine }   [DERIVED: .p9c has Author/Desc/Tags/License; goal doc needs credit/license for ports]
  resources:   Resource[]      // current phos/1: texture or presentation only
  nodes:       Node[]          // the primitive instances
  edges:       Edge[]          // Out→In port connections                          [DERIVED: .p9c Connections block]
  expressions: ExprProgram[]   // per-frame / per-vertex code, compiled to IR       [DERIVED: Expression(144), MilkDrop per_frame/per_vertex]
  timeline:    refused if present until semantics are implemented
}
```

### A Node
```
Node {
  id: string
  primitive: "graph" | "shader" | "expr" | "geom" | "compute"   [DERIVED: the 5-primitive set]
  op: string          // e.g. "RenderToTexture","Shader","Cube","Particles","warp"
  ports: { [portId]: Port }
}
Port {
  type: "float"|"vec2"|"vec3"|"vec4"|"color"|"texture"|"mesh"|"effect"|"render"   [DERIVED: .p9c port types — Render/Effect/Object/Texture/Color observed]
  value?: literal            // constant, when not wired                            [DERIVED: .p9c ports carry Value]
  // wiring is in edges[], not here
}
Edge { out: "nodeId.portId", in: "nodeId.portId" }                                  [DERIVED: exact .p9c model]
```

### Why this inherits BOTH sources without mutation

**Plane9 target projection** [DERIVED]: structurally near 1:1—nodes, ports, and
connections can project to the typed graph once each complete semantic contract
exists. The current converter accepts only three node-variant mappings, lacks a
general GLSL→WGSL path, and drops root/metadata fields, so it does not yet
realize that complete projection.

**MilkDrop target projection** [DERIVED]: the fixed pipeline can emit a
canonical prewired graph. The current converter implements the retained
per-frame/warp/borders/composite subset and refuses unsupported source records;
it does not yet implement the complete shapes, waves, custom shader, or
per-vertex surface.

Neither engine is privileged: both are front-end parsers emitting the same
graph. The studio edits the graph. [DERIVED from goal doc: "editable, saveable,
reloadable, portable"; import = transcription not adaptation.]

### How it achieves the goal-doc scene goals
- **exactness / no mutation** — the IR is the union of both primitive sets, so
  no source op is flattened. [DERIVED]
- **editable/portable** — graph IR is the document; .phos is its serialization.
- **inspectable** — source mappings and graph data can be compared to external
  evidence at their actual execution boundaries. Node-local correctness does
  not establish interaction, scene, or product-path correctness.

═══════════════════════════════════════════════════════════════════
## PART 3 — WHERE THIS IS DESIGN, NOT DERIVATION (scrutinize these)
═══════════════════════════════════════════════════════════════════
- **[DESIGN]** Five primitive *categories* as the tag set. The corpus proves 5
  clusters exist; calling them exactly these 5 (vs, say, splitting GEOM-gen
  from GEOM-transform) is a judgment. Revisit if a node resists its bucket.
- **[DESIGN]** Expressions as a separate top-level array vs inline in nodes.
  Chosen for the studio's expr editor; either works.
- **[DESIGN]** A timeline top-level was proposed, but current `phos/1` refuses
  any presence; source evidence must decide whether timeline behavior is graph
  data, product sequencing, or both.
- **[DESIGN]** JavaScript/JSDoc, the current UI structure, and any future native
  shell are implementation choices rather than source facts.

The DERIVED rows are forced by evidence and safe. The DESIGN rows are the seam
where the old failure (fluent architecture from taste) could re-enter — they
get the same scrutiny as any candidate work: cheap to change now, costly later.

#### III. WHY

This record distinguishes requirements forced by the two sources from choices
made by the project, so a concrete missing capability can be evaluated without
casually reopening the established graph/resource/executor foundation.

[Back to Top](#top)
