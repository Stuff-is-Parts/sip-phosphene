# PHOSPHENE — engine vertical slice

A narrow, honest slice: a browser player + studio over a WebGPU feedback engine
that renders ONE MilkDrop preset (101-per_frame.milk) with its expressions
executed and its borders drawn per projectM source geometry.

## Entry points
- `index.html` — player (splash, demo/mic/file audio, HUD, fullscreen)
- `studio.html` — editor (shows the pipeline descriptor, edits values/equation live, save .milk)
- `engine-test.html` — bare engine render, no UI

## What is verified, and how (run these)
- `node check.mjs` — expression path: engine runs the preset equation; a changed
  coefficient is rejected. LIMIT: not an independent oracle (both sides use JS
  Math.sin) — see the header comment in check.mjs. States its own scope honestly.
- The border shader (src/render-wgsl.mjs) is transcribed from projectM source
  (milkdropfs.cpp:3460): border frames at max-norm radius [1-ob, 1] (outer) and
  [1-ob-ib, 1-ob] (inner), with ob_a/ib_a as the source uses them. Correctness
  of the transcription is confirmed by a human reading the two side by side, and
  by you loading the scene and seeing it render. There is no automated visual
  "taste-test" check — that was removed as self-referential.

## Known limits (stated, not hidden)
- The expression check is correlated with the implementation (shared Math.sin).
  A truly independent check requires butterchurn or retained projectM output.
- The pipeline is executed directly by engine.mjs. `pipelineDescriptor` in the
  IR is DISPLAY structure for the studio; the engine does NOT yet execute a
  general graph. Making the graph drive execution is pending (PHOSPHENE-GOAL.md).
- Arithmetic operators use JS operators, not the eel add/sub/mul/div functions
  (identical for IEEE-754 doubles; stated in expr-vm.mjs).
- The mechanical gate (npm run gate) PASSES: syntax, strict typecheck, lint, dead-code.

## Mechanical gate
`npm run gate` = syntax → typecheck → lint → deadcode. Standard tools only.
It proves the code is well-formed, NOT that it is behaviorally correct.
Behavior is judged by a human viewing the output.

## To run
Serve over http (WebGPU needs https/http, not file://):
    python -m http.server 8000
Open http://localhost:8000/ in Chrome/Edge.
