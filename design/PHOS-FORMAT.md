# .phos — the PHOSPHENE native scene format (v1)

Structure derives from design/SCENE-ANATOMY.md (itself derived from the .p9c
wiring model + PRIMITIVES.md); policies below are tagged [DERIVED] (forced by a
named source or goal-doc requirement) or [DESIGN] (a choice — scrutinize).
Implementation: phosphene-engine/src/phos.mjs. Commented, runnable example:
phosphene-engine/scenes/TEMPLATE.phos.

## Carrier

- **Strict JSON**, parsed with native `JSON.parse`. No parser dependency.
  [DESIGN — but constrained by the repo rule "standard tools only"]
- **Annotation keys**: any object key beginning `//` is authoring annotation,
  ignored and *stripped* by the loader (glTF/`$comment` pattern). Comments do
  not survive a studio save. [DESIGN]
- **Unknown keys refuse**: any non-`//` key the spec does not define is a parse
  error naming the key and path. A scene never half-loads. [DERIVED —
  PHOSPHENE-GOAL.md refusal discipline; the external review flagged
  accept-unknown-silently as a defect in the expr VM]
- **Versioning**: `format` must equal `"phos/1"` exactly. On format change,
  migrate the scene files and bump — no multi-version load paths. [DESIGN —
  Current State Only; Plane9 precedent: FormatVersion]

## Top-level structure

```
{
  "format": "phos/1",
  "meta": {
    "name": string,                     // required
    "sourceEngine"?: "milkdrop"|"plane9"|"phosphene",
    "source"?: { "engine", "file", "sha256" },   // provenance of a ported scene
    "author"?, "description"?, "tags"?, "license"?, "credit"?
  },
  "resources": [],                      // v1: must be empty — refused if non-empty
  "nodes":   [ Node ],
  "edges":   [ { "out": "nodeId.portId", "in": "nodeId.portId" } ],
  "expressions": [ { "id", "stage": "per-frame"|"per-vertex", "code": [string],
                     "comments"?: [string] } ]   // comment-only source lines, verbatim
}
```

`comments` retains comment-only equation lines from a ported source file as
data (not as strippable `//` annotations), so they survive parse→serialize
round-trips. [DERIVED — exactness: source content is never silently dropped]

`meta.source` is the transpiler map made durable: every ported .phos names the
recipe file it was transcribed from, hash-pinned. [DERIVED — goal-doc Validation
Rule: expected values identify provenance]

`resources` and `timeline` are skeleton slots from SCENE-ANATOMY. They are
refused (non-empty `resources`, any `timeline`) until a scene forces their
implementation — same discipline as the engine buildout. [DERIVED — refusal
over unimplemented acceptance]

## Node and Port

```
Node { "id": string (unique), "primitive": "graph"|"shader"|"expr"|"geom"|"compute",
       "op": string, "ports": { portId: Port } }
Port { "type": "float"|"vec2"|"vec3"|"vec4"|"color"|"texture"|"mesh"|"effect"|"render",
       "value"?: number }              // v1: value only on float ports
```

Port names are the exact source-format keys — `fDecay`, `ib_r` — zero renaming.
[DERIVED — exactness standard: parsed fields preserved]

Edges must resolve to an existing node.port on both ends, with matching port
types. [DERIVED — .p9c Out/In model]

A value-carrying port name may appear on only one node per scene: the runtime
flattens port values into one variable pool by name, and a duplicate would
silently last-write-win. The parser refuses duplicates. [DERIVED — exactness:
no silent flattening]

## Scene-one mapping (101-per_frame.milk → nodes)

| .milk key | node | why (source citation) |
|---|---|---|
| fDecay | warp | decay applies in the warped blit / feedback (milkdropfs.cpp:1096, PRIMITIVES row 5) |
| zoom, rot, warp | warp | warp mesh distortion params (milkdropfs.cpp:1877-1898, row 3) |
| ob_size ob_r ob_g ob_b ob_a, ib_size ib_r ib_g ib_b ib_a | borders | border draw in the sprites region (milkdropfs.cpp:3460, rows 14 span 3383-3515); drawn before composite per the pipeline grammar (milkdropfs.cpp:1048-1214) |
| per_frame_N | expressions[] | per-frame equations (milkdropfs.cpp:471+, row 1) |

Canonical wiring for the MilkDrop import: `warp.out → borders.in`,
`borders.out → comp.in` (render-type ports). The engine does not yet execute
this graph — it runs the fixed pipeline and the loader flattens port values
into the runtime pool. The .phos file is the durable scene; the runtime IR
conforms to it, not the reverse. Making the graph drive execution is the named
pending work (PHOSPHENE-GOAL.md).

The converter (`milkToPhos`) throws on any .milk key not in this table —
completeness by refusal, no silent drops. [DERIVED — "nothing may be flattened
or silently omitted"]

## Semantics: how source behavior enters a scene

Per the conversion rule in CLAUDE.md and PHOSPHENE-GOAL.md's no-parallel-
runtimes requirement: the native substrate exposes platform primitives (raw
frame dt, raw audio samples via the pcm-tap worklet, WebGPU), and source-engine
behaviors exist as explicit, source-cited components expressed in that
substrate — milkdrop-time (pluginshell.cpp DoTime), milkdrop-loudness (the
PCM/Loudness chain), and Plane9 equivalents as their audits complete. A
converted scene carries or references the components its behavior depends on;
a hand-authored scene uses native primitives directly or pulls the same
components by choice. There is no ambient per-engine mode.

**Interim state (stated, not hidden):** the engine does not yet execute the
graph, so the MilkDrop time and loudness components are hardwired at the
engine level (src/timekeeper.mjs, src/audio/analysis.mjs) as stand-ins for
their future explicit-component form. This hardwiring applies MilkDrop
semantics to ALL scenes — including native ones — until graph execution lands
and the components move into the scenes that reference them. The hardwired
code is written as self-contained, source-cited modules precisely so the move
is a relocation, not a rewrite.

## What loading guarantees, and what it does not

Parsing validates structure and refuses unknowns; it does not prove the scene
renders correctly. Behavior is judged by the human viewing the output (repo
CLAUDE.md). The mechanical checks in check.mjs cover: committed .phos ==
converter output byte-for-byte, serialize∘parse fixed point, load-path
equivalence with the .milk import, and refusal of five mutant classes.
