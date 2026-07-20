# MilkDrop Primitive Contract {#top}

---

### DOCUMENT ROLE

Layer 4 reference opened for MilkDrop pipeline topology or primitive-family
work. Responsibility: maps every audited MilkDrop render operation to the
accepted native primitive set and records the required target capability.
Detailed audio, EEL, render-state, and variable semantics have separate mapped
references.

---

### 1. MILKDROP PRIMITIVE MAPPING {#primitive-mapping}

#### I. WHAT

The audited MilkDrop viewer pipeline maps to GRAPH, SHADER, EXPRVM, and COMPUTE
capabilities; it does not require Plane9's GEOM family.

#### II. HOW

Method: the engine SOURCE defines the primitive VOCABULARY (what operations exist).
The SCENE CORPUS defines the GRAMMAR (which operations combine, in what arrangements).
The target model must express every row with MINIMAL MUTATION — if a source operation
needs acrobatics to fit, the target model is wrong, not the scene.

Each row: the source operation, the modern primitive it becomes, and the target
capability that must therefore exist. Derived from milkdrop2 source (cited).
Plane9 rows to be added from its scene corpus (closed source → scenes are the authority).

## Target primitive set (the four things the engine must offer first-class)
- **P1 COMPUTE** — storage buffers + compute passes (particles, per-vertex/pixel expr at scale, fluid)
- **P2 GRAPH** — named storage textures + arbitrary render passes with declared deps (feedback, echo, blur, StoreTexture)
- **P3 SHADER** — WGSL vertex/fragment stages (warp, color, waves, composite)
- **P4 EXPRVM** — CPU expression evaluator for serial per-frame globals

If a source operation maps cleanly onto P1–P4, import is transcription. Every row below
names its primitive. A source operation that fits NONE is a fifth primitive the engine is missing.

## MilkDrop operations → modern primitive

| # | Source operation | Source loc | Old technique | Modern primitive | Target need | PHOSPHENE status |
|---|---|---|---|---|---|---|
| 1 | per-frame equations | milkdropfs.cpp:471+ | x86 JIT (ns-eel2) | P4 EXPRVM | expr→JS compile | done — expr-vm parser + eel table, checked |
| 2 | per-vertex equations | milkdropfs.cpp:1841+ | CPU per-vertex | P4 or P3 (fold into vertex shader) | expr→WGSL option | captured by importer, NOT executed (no per-vertex content yet) |
| 3 | warp mesh distortion | milkdropfs.cpp:1877-1898 | CPU vertex grid, per-frame upload | P3 vertex/fragment | displacement field in shader | done — per-pixel warp in render-wgsl (:1877-1918) |
| 4 | motion vectors | milkdropfs.cpp:1239 | CPU line grid | P3 (instanced) | instanced line draw | — |
| 5 | warped blit + feedback | milkdropfs.cpp:1096 | copy prev frame, sample | P2 GRAPH (ping-pong) | zero-copy double buffer | done — ping-pong + WRAP sampler |
| 6 | blur pyramid (3 lvl) | milkdropfs.cpp:1584-1740 | 8-tap folded bilinear, H/V | P3 separable passes (old trick kept) | multi-target downsample chain | — |
| 7 | custom shapes | milkdropfs.cpp:2298 | CPU polygon gen | P3 (+ P4 for their equations) | per-instance expr + draw | — |
| 8 | custom waves | milkdropfs.cpp:2579 | CPU vertex gen from audio | P3 (+ P4) | audio-driven vertex expr | — |
| 9 | built-in waveform | milkdropfs.cpp:2900+ | CPU vertex from fR/fL | P3 | audio buffer → vertices | — |
| 10 | video echo | milkdropfs.cpp:4147+ | sample prev, zoom, orient flip | P2 + P3 | texture sample w/ transform | done — compositeWGSL echo |
| 11 | flipping (orient) | milkdropfs.cpp:4179 | vertex/UV corner swap | P3 (UV sign flip) | coordinate negate in sampler | done — echo orientation flips |
| 12 | composite shader | milkdropfs.cpp:1159 | user HLSL final pass | P3 (HLSL→WGSL) | shader transpile | non-shader path done (ShowToUser_NoShaders); HLSL path — |
| 13 | warp shader | milkdropfs.cpp:1091 | user HLSL warp pass | P3 (HLSL→WGSL) | shader transpile | — (fixed warp formula only) |
| 14 | sprites / user sprites | milkdropfs.cpp:3383,3515 | textured quads | P3 | textured quad draw | borders done (:3460); user sprites — |
| 15 | audio FFT + bands | fft.cpp | CPU FFT | P4 (or P1) | FFT → uniforms | done — worklet PCM + FFT + Loudness |
| 16 | preset blend (2 presets) | milkdropfs.cpp:726+ | run both, mix | P2 (two subgraphs + mix) | concurrent graph + blend | — |

## Pipeline order (the grammar MilkDrop itself imposes — milkdropfs.cpp:1048-1214)
motion vectors → warped blit(feedback) → blur → custom shapes → custom waves →
built-in wave → sprites → [composite] → user sprites

This ordering IS a grammar constraint: the target graph must be able to express
exactly this sequence of passes. It does, if P2 is a real graph (not a fixed pipeline).

## Missing-primitive check
Every MilkDrop operation above maps to P1-P4. No fifth primitive required BY MILKDROP.
Plane9's fluid solver (LinearSolver) is the open question — likely P1 COMPUTE, to be
CONFIRMED from a Plane9 fluid scene, not assumed.

Status column maintained per the forward-trace ledger request (2026-07-17): a row is 'done' only with a source-cited implementation and a check or human verdict; timekeeping (DoTime, pluginshell.cpp:1895+) is implemented though it predates this table's rows.

#### III. WHY

The mapping keeps source operations—not implementation convenience—as the unit
of translation and makes a genuinely missing native capability visible before
the source is flattened to fit the engine.

[Back to Top](#top)
