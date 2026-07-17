# Plane9 Scene-Visible Contract — corpus + install evidence

The vocabulary Plane9 scenes actually read from their engine, audited by the
method of AUDIO-PATH.md so shared machinery derives from BOTH engines per the
conversion rule in CLAUDE.md. Sources opened this audit:
- **[P9-CORPUS]** all 252 scene.xml bodies (expression `<Value>` code extracted
  corpus-wide; per-token scene counts below are from a full 252-scene scan)
- **[P9-DOC]** plane9.txt + history.txt in C:\Program Files (x86)\Plane9

## Key structural finding

Plane9's expression evaluator is **expreval** by Brian Allen Vanderburg II
(credited in plane9.txt; expreval.sourceforge.net) — an open-source library.
Expression-language semantics are therefore source-auditable; `band()` and the
engine globals are Plane9 extensions on top of it (Plane9Engine.dll).
Registry updated with the expreval row.

## Engine-provided vocabulary (scene counts from the 252-scene scan)

| Token | Scenes using it | Evidence of semantics |
|---|---|---|
| `time` | 175 | count includes GLSL shader uniforms — expression-level vs shader-level split not yet separated |
| `band(a,b,c,d)` | 123 | a = channel, −1 = mono fold [P9-HIST:345,383]; d = damping [P9-HIST:254,383]; b and c vary independently in corpus (`band(-1,1,0,…)` vs `band(-1,1,2,…)` vs `band(-1,0,0,…)`) — mode/band-index candidates, **UNRESOLVED** |
| `deltatime` | 98 | per-frame elapsed time factor (used as `x*rate*deltatime` integrators corpus-wide); exact definition vs the 30Hz-locked analyzer [P9-HIST:68] **UNRESOLVED** |
| `beat` | 52 | Beat node also exists (BeatStrength port); expression-level `beat` semantics **UNRESOLVED** |
| `rand(` | 54 | expreval-or-Plane9 provenance **UNRESOLVED** — resolve from expreval source first |
| `aspect` | 20 | aspect ratio, presumed screen w/h — **UNRESOLVED** |
| `frame` | 12 | frame counter candidate — **UNRESOLVED** |
| `soundlevel`, `fps`, `mouse` | 0 / 0 / 1 | effectively unused by the corpus |

## Contract shape vs MilkDrop's

MilkDrop exposes damped `time`/`fps` plus the PCM variable set to equations;
Plane9 exposes `deltatime`-style integration plus `band()` audio pulls plus
node-port wiring (SoundTexture/Beat/Spectrum per AUDIO-PATH.md). Under the
conversion rule these become separate explicit components — a Plane9-converted
scene references plane9-deltatime/plane9-band components exactly as a MilkDrop
scene references milkdrop-time/milkdrop-loudness. Nothing here forces a new
primitive: both contracts are expression-layer (P4) plus graph inputs (P2).

## Resolution paths for the UNRESOLVED rows (registry sources, in order)

1. expreval source (sourceforge) — settles which functions/globals are the
   evaluator's own (rand, min, …) vs Plane9 extensions.
2. Plane9Doc.url / plane9.com node & expression documentation.
3. Plane9Engine.dll strings for the extension-function table.
4. Targeted Studio observation (write a probe scene printing candidates) —
   last resort per the goal doc's observation tier.
