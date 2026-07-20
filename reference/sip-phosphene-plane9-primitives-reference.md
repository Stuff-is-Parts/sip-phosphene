# Plane9 Primitive Inventory {#top}

---

### DOCUMENT ROLE

Layer 4 reference opened when evaluating Plane9 coverage against the accepted
primitive families. Responsibility: preserves the full-corpus node counts and
their GRAPH, SHADER, EXPRVM, GEOM, and COMPUTE classification. It does not set
compatibility status or an implementation roadmap.

---

### 1. CORPUS PRIMITIVE ACCOUNTING {#primitive-accounting}

#### I. WHAT

All 75 node types observed across 252 audited Plane9 scenes map structurally to
the five native primitive families; this is representational coverage, not
semantic implementation or compatibility.

#### II. HOW

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

## Historical frequency analysis — not a current roadmap

The frequency distribution is steeply top-heavy. Six node types (Shader, Clear,
Screen, RenderRect, RenderObject, RenderToTexture) dominate all usage. This
gave an early sequence estimate where each stage appeared to unlock a large,
measurable corpus fraction. Current work selection follows the typed
dependencies of an authentic source scene under the compatibility guideline;
these rows remain corpus accounting:

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
- MilkDrop's 16 fixed-pipeline operations → P1-P4 (see the MilkDrop primitive reference); no GEOM.
- Plane9's 75 nodes → all five, mostly P2/P3/P4, with GEOM the 3D addition.

Neither source is privileged. A `.milk` importer and a `.p9c` importer are both
just "parse source → emit graph of primitive nodes." The studio edits the IR.
Because the primitive set is the UNION derived from both corpora, every scene
in both engines fits by transcription, not adaptation — which was the goal.

## Local corpus used for this accounting

The audit used 252 `.p9c` scenes, eight loose GLSL files, and the installed
Plane9 distribution at the owner-designated, gitignored paths in the source-
location registry. Those artifacts must be reopened for a new semantic claim;
the counts here are not a retained substitute for them.

#### III. WHY

The full-corpus classification established that Plane9 adds geometry but does
not force a different scene model. Preserving that result prevents repeated
architecture speculation while keeping semantic compatibility tied to primary
evidence rather than counts.

[Back to Top](#top)
