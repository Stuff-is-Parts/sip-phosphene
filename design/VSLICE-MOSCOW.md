# Vertical Slice — MoSCoW over the full both-engine feature set

Denominator: the complete feature union of MilkDrop and Plane9 from
sources/PLAYER-STUDIO-FEATURES.md (evidence tags carried per row), plus the
scene-file obligations PHOSPHENE-GOAL.md imposes (saveable, reloadable,
portable). Supersedes STUDIO-SLICE-MOSCOW.md (deleted; git history holds it),
which bucketed only studio features bounded to scene one's content.

**Slice completion formula: every Must + every Should whose unlock condition is
met, plus at most ONE Could.** "Won't" means not required for the vertical slice — the
final deliverable's scope stays owned by PHOSPHENE-GOAL.md's completion
condition, where these features remain due.

**Unlocks at** names the condition that makes a feature meaningful; a feature
is slice-due only once unlocked. Rows unlock as scenes land — the remainder
becomes due automatically, matching the scene-driven stack buildout.

**Buckets below are [PROPOSED] — they freeze only after your pass.** After
that, per the original doc's own rule: the denominator can't be shrunk after
the fact.

## Player

| Feature | Evidence | Bucket | Unlocks at | Status |
|---|---|---|---|---|
| Render the running visual | both engines | M | now | done |
| Load native scene (.phos) | goal doc: reloadable | M | now | done |
| Open a scene file from disk (portable load) | goal doc: portable | M | now | done (drop a .phos on the player) |
| Fullscreen / windowed | [MD-SRC] [P9-DOC] | M | now | done |
| Audio source select (demo / mic / file) | [MD-SRC] [P9-DOC] | M | now | done |
| Audio analysis on derived semantics (spec sources/AUDIO-PATH.md) | fft.cpp / projectM Audio | M | now | done (worklet PCM ring + FFT + Loudness; also MilkDrop DoTime timekeeping in src/timekeeper.mjs) |
| Beat detection (source semantics) | [MD-SRC] [P9-DOC] | M | derived analyzer | done (the Loudness relative chain IS the beat signal; raw bass readout in HUD, no invented indicator) |
| Scene name display | [MD-SRC] [P9-DOC] | M | now | done |
| Next / prev scene | [MD-SRC] [P9-DOC] | M | scene 2 | — |
| Auto-advance on timer | [MD-SRC] [P9-DOC] | S | scene 2 | — |
| Random / shuffle | [MD-SRC] [P9-DOC] | S | 3+ scenes | — |
| Help overlay (F1) | [MD-SRC] [P9-DOC] | S | now | done |
| FPS display in player | [MD-SRC] [P9-DOC] | S | now | done |
| Waveform/spectrum exposed to scenes | [MD-SRC] [P9-DOC] | S | derived analyzer + a consuming scene | — |
| Auto-advance on silence | [P9-DOC] | C | derived analyzer + scene 2 | — |
| Lock current scene | [MD-SRC] | C | scene 2 | — |
| Hard cut / soft blend transitions | [MD-SRC] [P9-DOC] | S | scene 2 | — |
| Playlist | [MD-SRC] [P9-DOC] | S | many scenes | — |
| Preset rating / shuffle weighting | [MD-SRC] | W (slice) | many scenes | — |
| Video recording | [P9-DOC] | W (slice) | — | — |
| HDR / ACES output | [P9-DOC] | W (slice) | — | — |
| Desktop mode, always-on-top, screensaver, multi-monitor | [MD-SRC] [P9-DOC] [REPORT] | S | Tauri tier | — |
| VR | [P9-DOC] | W (slice) | explicit scope decision (STACK-COVERAGE) | — |

## Studio

| Feature | Evidence | Bucket | Unlocks at | Status |
|---|---|---|---|---|
| Render the running visual in editor | both | M | now | done |
| Load scene into IR | both | M | now | done |
| Show IR as node graph: nodes + ports + wiring | [P9-DOC] node editor; .p9c model | M | now | done (wiring controls validation, ordering, and state assembly under the fixed-pipeline contract; GPU dispatch is the fixed pipeline) |
| Show per-port values | [P9-DOC] | M | now | done |
| Edit port value / equation, live re-render | [MD-SRC] live edit; [P9-DOC] 0.5s debounce | M | now | done (ALL warp ports render via the transcribed mesh formula; full EEL operator set in the editor) |
| **Save edited scene to .phos** | goal doc: saveable | M | now | done (updateScene + Save button; edit round-trip checked) |
| Play / pause transport | both | M | now | done |
| Live per-frame variable readout | derived: structural frame-diff | M | now | done |
| Reset to preset defaults | original MoSCoW Should | S | now | done |
| Dirty indicator | [P9-DOC] | S | now | done |
| FPS / frame counter | [P9-DOC] | S | now | done |
| Metadata view (name) | [P9-DOC] | S | now | done |
| Export .milk (share back to source format) | [MD-SRC] copy .milk | S | now | done (lossy — README known limit) |
| Color picker on color ports | [P9-DOC] | C | a scene with color-typed ports (scene one has only floats — earlier "now" was wrong) | — |
| Syntax highlight on equations | cosmetic | C | now | — |
| Metadata editing (name/author/description) | [P9-DOC] | S | now | done (studio Metadata panel) |
| New-scene-from-template UI | [P9-DOC] templates | S | now | done (New button loads TEMPLATE.phos) |
| Export shareable package (.p9d equivalent) | [P9-DOC] | S | now | done — covered by the Save .phos download (the .phos IS the shareable unit) |
| Node add / wire / delete | [P9-DOC] full node editor | W (slice) | graph-executor generality (scene 2 forces it) | — |
| Shader editor | [MD-SRC] inline; [P9-DOC] full IDE | W (slice) | first custom-shader scene | — |
| Undo / redo | [P9-DOC] unlimited | W (slice) | real editor phase | — |
| Camera control (WASDEC) | [P9-DOC] | W (slice) | first 3D/GEOM scene | — |
| Timeline / choreography / record-to-video | [P9-DOC] | W (slice) | many scenes | — |

## Slice status against the formula

Every unlocked Must and every unlocked Should is done. No Could is currently
unlocked except syntax highlight, and the formula's "at most one Could" makes
it optional — not taken. The app-surface slice is therefore complete pending
(a) your bucket-freeze pass over this doc and (b) your taste test of the
running pages. Rows gated on scene 2, more scenes, the Tauri shell, or a
consuming scene become due automatically as those conditions land.

Engine-stack items (graph-driven execution, warp math, shader transpiler,
GEOM, compute) are deliberately absent from these tables: the app surface is
MoSCoW'd here; the engine is built scene-by-scene per the corpus-driven plan
(PRIMITIVES.md, PRIMITIVES-PLANE9.md). A feature row unlocking is what pulls
an engine capability in, never the reverse.
