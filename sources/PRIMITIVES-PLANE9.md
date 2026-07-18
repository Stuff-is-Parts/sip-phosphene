# Target Primitive Requirements — Plane9 corpus (companion to PRIMITIVES.md)

Derived from the FULL Plane9 distribution: 252 scenes parsed, 0 failures,
75 distinct node types, 3087 node instances. The corpus is the authority
(Plane9 is closed-source); every node type below was mapped to the target
primitive set, and every one maps — no unmapped nodes, i.e. no undiscovered
primitive hiding in the scenes.

## The conclusion: FIVE primitives, derived from both engines

MilkDrop's source alone yields four (compute, graph, shader, exprvm). The
Plane9 corpus adds the one MilkDrop could never reveal, because MilkDrop is 2D:

- **P2 GRAPH** — named textures + arbitrary passes + feedback — 1029 instances
- **P3 SHADER** — WGSL vertex/fragment stages — 910 instances
- **P4 EXPRVM** — expression/value/color nodes (CPU per-frame) — 623 instances
- **GEOM** — mesh generation + operations (3D) — 335 instances — **Plane9-only; absent from MilkDrop**
- **P1 COMPUTE** — particles, instancing, fluid/sim — 64 instances
- (P2+P3 combos: Bloom/Blur/Streak — 126 instances — not new; graph+shader arrangements)

Had the target been designed from the MilkDrop audit alone, the first Plane9
`Cube` node would have required acrobatics. The corpus caught GEOM before a
line of engine was written. That is the entire reason to derive from scenes.

## Build order — dictated by corpus usage, not preference

The frequency distribution is steeply top-heavy. Six node types (Shader, Clear,
Screen, RenderRect, RenderObject, RenderToTexture) dominate all usage. This
gives a build order where each stage unlocks a large, measurable fraction of
the corpus:

1. **P2 GRAPH + P3 SHADER first.** 110/252 scenes (43%) use ONLY graph+shader+exprvm
   primitives — no geometry, no compute. Build these two (plus P4) and that
   fraction becomes renderable.
2. **P4 EXPRVM alongside** — 623 instances, and MilkDrop's half is already
   verified (35 functions/operators, tonight). Plane9 Expression/Vector/MinMax
   share the same VM.
3. **GEOM second** — 109/252 scenes (43%) use mesh geometry. This is the
   big Plane9-specific build: mesh primitives (Cube/Sphere/Plane/Cylinder/Disc/
   Torus) + ops (Transform/Subdivide/Extrude/InvertMesh/SelectMesh).
4. **P1 COMPUTE last** — only 55/252 scenes (21%) need it, and the hardest
   members (Fluid2d, LinearSolver) appear in 3 scenes each. The rarest thing is
   the hardest to build; it is correctly the last, not the foundation.

## What this means for "receive both sources without acrobatics"

Both engines compile into the same five-primitive graph IR:
- MilkDrop's 16 fixed-pipeline operations → P1-P4 (see PRIMITIVES.md); no GEOM.
- Plane9's 75 nodes → all five, mostly P2/P3/P4, with GEOM the 3D addition.

Neither source is privileged. A `.milk` importer and a `.p9c` importer are both
just "parse source → emit graph of primitive nodes." The studio edits the IR.
Because the primitive set is the UNION derived from both corpora, every scene
in both engines fits by transcription, not adaptation — which was the goal.

## Retained corpus (the specification's evidence)
252 .p9c scenes + 8 loose .glsl shader files + the Plane9 distribution
(owner-designated copies at source-scenes/plane9; see PLANE9-EVIDENCE.md). These are the authority for every Plane9
behavior, since no source exists. Any primitive-mapping question is resolved
against these files, not against assumption.
