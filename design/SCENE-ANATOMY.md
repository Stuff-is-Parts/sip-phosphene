# PHOSPHENE Scene Anatomy & Tech Stack

Derived from: PRIMITIVES.md (MilkDrop 16 ops), PRIMITIVES-PLANE9.md (75 nodes,
252 scenes), and the real .p9c wiring model (typed ports + Out/In edges).
Every structural choice below is tagged **[DERIVED]** (forced by a source
feature, with the evidence) or **[DESIGN]** (Claude's choice where the sources
don't dictate — the seam where judgment enters and you should scrutinize).

═══════════════════════════════════════════════════════════════════
## PART 1 — TECH STACK
═══════════════════════════════════════════════════════════════════

| Layer | Choice | Why (traceable) |
|---|---|---|
| GPU API | **WebGPU / WGSL** | [DERIVED] P1 COMPUTE (64 Plane9 instances incl. Fluid2d/LinearSolver) requires compute shaders + storage buffers; only WebGPU offers them in-browser. Storage textures serve P2 GRAPH (1029 instances). |
| Language | **TypeScript** | [DESIGN] type safety for the IR; not source-dictated. |
| Render core | **Render-graph engine** (named textures, arbitrary passes, declared deps) | [DERIVED] Plane9's Connections block IS a render graph (RenderToTexture→StoreTexture→Shader chains); MilkDrop's blur pyramid + video echo + preset-blend need multi-target passes. Fixed pipeline = the original failure. |
| Geometry | **Mesh subsystem** (primitives + ops, CPU-gen → GPU buffers) | [DERIVED] GEOM primitive: 22 Plane9 node types, 335 instances, 109/252 scenes. MilkDrop has none — this exists solely because the corpus proved it. |
| Compute | **Compute-pass support** in the graph | [DERIVED] Particles(28), MeshInstancer(16), Fluid2d/LinearSolver(6). |
| Expression | **Expr→IR→JS VM** (per-frame) + **Expr→WGSL** (per-vertex/pixel) option | [DERIVED] MilkDrop per-frame(471+) & per-vertex(1841+) EEL; Plane9 Expression(144)/Vector(163)/MinMax(118). MilkDrop half already verified (35 fns). |
| Shader translation | **GLSL/HLSL → WGSL transpiler**, checked via **naga** (real WGSL compiler) | [DERIVED] Plane9 Shader(453) = GLSL; MilkDrop warp/comp = HLSL. Goal doc requires shaders checked through a real target-language impl. |
| Audio | **Web Audio AnalyserNode + FFT** | [DERIVED] MilkDrop fft.cpp bands/wave; Plane9 SoundTexture(13)/Spectrum(3)/Beat(21). |
| Studio UI | **IR-as-document node editor** + shader/expr editors | [DERIVED] Plane9 IS a node graph; editing the IR directly = no import round-trip loss. [DESIGN] framework (Svelte/React/vanilla) is free choice — not load-bearing. |
| Native | **Tauri** (same web build → screensaver/multi-monitor) | [DESIGN] deferred; wraps identical code. |

The five primitives the stack must expose first-class: **P2 GRAPH, P3 SHADER,
P4 EXPRVM, GEOM, P1 COMPUTE.** Both engines compile into these. Nothing in
either corpus maps outside them (proven: 0 unmapped of 75 Plane9 nodes).

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
  resources:   Resource[]      // textures, meshes, audio bindings, images        [DERIVED: FileTexture(64), MeshObject(104)]
  nodes:       Node[]          // the primitive instances
  edges:       Edge[]          // Out→In port connections                          [DERIVED: .p9c Connections block]
  expressions: ExprProgram[]   // per-frame / per-vertex code, compiled to IR       [DERIVED: Expression(144), MilkDrop per_frame/per_vertex]
  timeline?:   Keyframe[]      // optional; Transition(40), Beat-driven             [DERIVED: Transition node + goal doc choreography]
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

**Plane9 import** [DERIVED]: near 1:1. Each .p9c Node→Node (op = its Type),
each Port→Port, Connections→edges. The 75 node types become ops tagged with one
of the 5 primitives. Shaders pass through the GLSL→WGSL transpiler. This is
transcription, confirmed against the real wiring model above.

**MilkDrop import** [DERIVED]: the fixed pipeline (milkdropfs.cpp:1048-1214)
emits a CANONICAL graph — motion→warp+feedback→blur→shapes→waves→composite as
pre-wired nodes. Per-frame/per-vertex EEL → expr programs. warp/comp HLSL →
shader nodes. The 46 already-verified elements become the bodies of these
nodes, checks attached.

Neither engine is privileged: both are front-end parsers emitting the same
graph. The studio edits the graph. [DERIVED from goal doc: "editable, saveable,
reloadable, portable"; import = transcription not adaptation.]

### How it achieves the goal-doc scene goals
- **exactness / no mutation** — the IR is the union of both primitive sets, so
  no source op is flattened. [DERIVED]
- **editable/portable** — graph IR is the document; .phos is its serialization.
- **verifiable** — each node op is an element with a reference/subject/check
  (the pattern already proven on 46 MilkDrop elements). A scene renders
  correctly iff its nodes each pass. [DERIVED from kernel method]

═══════════════════════════════════════════════════════════════════
## PART 3 — WHERE THIS IS DESIGN, NOT DERIVATION (scrutinize these)
═══════════════════════════════════════════════════════════════════
- **[DESIGN]** Five primitive *categories* as the tag set. The corpus proves 5
  clusters exist; calling them exactly these 5 (vs, say, splitting GEOM-gen
  from GEOM-transform) is a judgment. Revisit if a node resists its bucket.
- **[DESIGN]** Expressions as a separate top-level array vs inline in nodes.
  Chosen for the studio's expr editor; either works.
- **[DESIGN]** Timeline as optional top-level. Transition(40) could instead be
  just another node type. Flagged for your call.
- **[DESIGN]** TypeScript, UI framework, Tauri timing — all free choices.

The DERIVED rows are forced by evidence and safe. The DESIGN rows are the seam
where the old failure (fluent architecture from taste) could re-enter — they
get the same scrutiny as any candidate work: cheap to change now, costly later.
