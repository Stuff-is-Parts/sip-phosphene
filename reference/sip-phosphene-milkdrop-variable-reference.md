# MilkDrop Per-Frame Variable Contract {#top}

---

### DOCUMENT ROLE

Layer 4 reference opened for MilkDrop per-frame variables, aliases, host inputs,
or equation lifecycle work. Responsibility: owns the perimeter trace from
source-visible EEL names to scene ports and host-supplied values; EEL numerical
semantics remain in the EEL reference.

---

### 1. VARIABLE PERIMETER {#variable-perimeter}

#### I. WHAT

Every name a converted MilkDrop expression can read or write is classified by
its source owner, default, direction, and implemented or refused crossing.

#### II. HOW

Trigger: two review escapes shared one shape — an element transcribed from its
local source lines while its perimeter went untraced. The sampler bug (clamped
where the source wraps) escaped because GPU state around the transcribed math
was never swept; the name-aliasing bug (equations writing `gamma` into a pool
keyed by `fGammaAdj`) escaped because nobody asked "what writes the variable
this clamp targets?". The generalized audit is **perimeter tracing**: for every
identifier the implementation consumes, trace in the source what writes it and
what reads it until the trace exits implemented scope, and require every
crossing to be implemented or refused. A crossing that is neither is exactly
where both bugs lived.

This file is the dataflow dimension of that audit (RENDER-STATE.md is the GPU
state dimension). The living ledger itself is DATA, not prose: the
`VAR_CONTRACT` table in `phosphene-engine/check.mjs` classifies every name in
MilkDrop's per-frame register list — the full regvar block at state.cpp:260-331
(MilkDrop2 @ Doormatty/MilkDrop2 d0670a3), 76 names — and the check asserts
each classification against the running engine every run. A future change that
breaks any classification fails the check; this file explains the classes and
records the boundaries the trace settled.

## The three classes (16 + 25 + 35 = 76)

| Class | Count | Meaning | Source witness |
|---|---|---|---|
| engine-injected | 16 | The engine writes these into the pool before equations run each frame | var_pf assignment block, milkdropfs.cpp:471-548 |
| file-mapped | 25 | Preset file keys carried into the pool (via the KEY_TO_EEL alias map where the EEL name differs) | regvar list state.cpp:260-331; alias map witnessed per RENDER-STATE.md row |
| equation-visible defaults | 35 | Preset state an equation can READ even when the file omits it — pool carries the source default | CState::Default, state.cpp:499-683, through the var_pf block |

## Injected-value provenance

| Name | Value | Source |
|---|---|---|
| time, fps | Timekeeper (DoTime damped) | pluginshell.cpp:1895+ (src/timekeeper.mjs) |
| frame | frame counter | milkdropfs.cpp:490 region |
| bass/mid/treb (+_att) | Loudness chain | MilkDrop audio reference |
| progress | time / 16 — (time − presetStart)/(next − start) with start 0 and fTimeBetweenPresets default 16.0 | milkdropfs.cpp:495; plugin.cpp:939. Preset rotation replaces the fixed duration when multi-scene sequencing lands. |
| meshx, meshy | 48, 36 | grid defaults plugin.cpp:952-953 (GridY = GridX·3/4, :1199) |
| pixelsx, pixelsy | live canvas pixels via Engine.setViewport(w, h, texW, texH), called by pages every frame; headless default 1024 | GetWidth/GetHeight, milkdropfs.cpp:543-544 |
| aspectx, aspecty | inverse aspect factors computed live from the window-matched render-target size | m_fInvAspectX/Y, plugin.cpp:2027-2030; assignment milkdropfs.cpp:545-546 |

## Boundaries the trace settled

- **vol / vol_att are intentionally ABSENT.** The regvar list at
  state.cpp:260-331 registers no such variables — a classic MilkDrop equation
  reading `vol` gets an auto-registered 0. Our engine previously injected them
  (projectM-4 exposes vol); tier-1 source governs the conflict, so the
  injection was removed and the check asserts absence. Conflict documented, not
  averaged.
- **fWarpAnimSpeed / fWarpScale have no regvar** — preset state, not
  equation-visible variables. They stay under their file keys (RENDER-STATE.md
  row).
- **q1..q32 and init-time monitor semantics are gated** behind per_frame_init,
  which the importer refuses. The refusal is the crossing's explicit handling;
  the rows unlock when per_frame_init support lands.
- **Defaults are pool-only until their subsystems render.** wave_*, mv_*,
  blur*, wrap, invert, etc. are readable by equations at their source defaults
  (the EQ_DEFAULTS underlay in src/engine.mjs); vars the renderer consumes get
  their defaults materialized into the .phos by the converter instead. When a
  subsystem (waves, blur, motion vectors) is transcribed, its vars move from
  underlay-only to rendered, and its pass gets a RENDER-STATE.md section in the
  same window.

## Standing practice (extends the RENDER-STATE.md rule to dataflow)

**Every window that ships a transcribed element also ships the perimeter trace
of that element's identifiers**: each name the new code consumes or publishes
is traced in the source ("what writes this? what reads this?") until the trace
exits implemented scope, and every crossing is implemented or refused — with
the classification landing as check data (a VAR_CONTRACT row or an ordinary
check case), not prose. The studio's live-value panel and equation editor are
the standing falsifier: every regvar is readable there, so a wrong
classification is user-visible.

#### III. WHY

Expression names are a dataflow boundary: a correct local equation still fails
when its aliases, defaults, host inputs, or persistence differ from the source.
The explicit perimeter prevents those crossings from remaining ambient.

[Back to Top](#top)
