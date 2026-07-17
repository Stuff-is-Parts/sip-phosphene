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
- `node check-render.mjs` — border GEOMETRY vs projectM source radii
  (milkdropfs.cpp:3460): inner ring at max-norm radius [1-ob-ib, 1-ob], outer at
  [1-ob, 1]; the old center-fill logic is rejected as a mutant. LIMIT: this is a
  pure-function mirror of the shader math checked against source radii, not a
  GPU pixel readback. GPU-level pixel verification needs a browser/wgpu run.

## Known limits (stated, not hidden)
- The expression check is correlated with the implementation (shared Math.sin).
  A truly independent check requires butterchurn or retained projectM output.
- The pipeline is executed directly by engine.mjs. `pipelineDescriptor` in the
  IR is DISPLAY structure for the studio; the engine does NOT yet execute a
  general graph. Making the graph drive execution is pending (PHOSPHENE-GOAL.md).
- Exponentiation (^) is NOT supported — it needs a real expression parser; the
  VM refuses it rather than mis-rewriting it. The current preset does not use it.
- Arithmetic operators use JS operators, not the eel add/sub/mul/div functions
  (identical for IEEE-754 doubles; stated in expr-vm.mjs).
- The mechanical gate (npm run gate) currently FAILS typecheck — the code runs
  but is not yet strict-type-clean. This is real work, not to be hidden by
  loosening the config.

## Mechanical gate
`npm run gate` = syntax → typecheck → lint → deadcode. Standard tools only.
It proves the code is well-formed, NOT that it is behaviorally correct.
Behavior is judged by a human viewing the output.

## To run
Serve over http (WebGPU needs https/http, not file://):
    python -m http.server 8000
Open http://localhost:8000/ in Chrome/Edge.
