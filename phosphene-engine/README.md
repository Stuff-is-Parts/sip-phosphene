# PHOSPHENE — engine vertical slice

A narrow, honest slice: a browser player + studio over a WebGPU feedback engine
that renders ONE scene. The scene is a native `.phos` file
(`scenes/101-per_frame.phos`), transcribed by `src/phos.mjs` from the MilkDrop
preset `101-per_frame.milk` with hash-pinned provenance in `meta.source`. All
pages load the `.phos`; the `.milk` is the retained source recipe. Format spec:
`design/PHOS-FORMAT.md`; commented creator template: `scenes/TEMPLATE.phos`.

## Entry points
- `index.html` — player (splash, demo/mic/file audio, HUD, fullscreen)
- `studio.html` — editor (shows the scene graph's nodes/ports from the .phos, edits values/equation live, export .milk)
- `engine-test.html` — bare engine render, no UI

## What is verified, and how (run these)
- `node check.mjs` — expression path: engine runs the preset equation; a changed
  coefficient is rejected. LIMIT: not an independent oracle (both sides use JS
  Math.sin) — see the header comment in check.mjs. States its own scope honestly.
  Also checks the .phos format structurally: committed scene == converter output
  byte-for-byte, serialize∘parse fixed point, load-path equivalence with the
  .milk import, template legality, refusal of mutant classes (unknown
  key/type/version, dangling edge, unsupported resources, duplicate value-port,
  unsupported .milk lines, missing required engine variable), and retention of
  source comment lines through transcription.

## Known limits (stated, not hidden)
- The expression check is correlated with the implementation (shared Math.sin).
  A truly independent check requires butterchurn or retained projectM output.
- The graph drives execution at slice scale: the engine derives its pass order
  from the scene's edges (reversed or broken chains are refused — checked), and
  render state is assembled by walking the ordered nodes. The executor supports
  the three ops this scene family uses; arbitrary topologies arrive with the
  scene that forces them (falsifier: no current content or surface exercises
  them).
- The studio saves the edited scene to .phos (updateScene writes pool edits
  back into the scene document's ports and equations; check.mjs proves the
  edit round-trip) and separately exports .milk back to the source format.
- The expression VM is a real parser (grammar per projectm-eval Compiler.y:55-75)
  routing every operation through the source-derived eel table: `^` is pow
  (left-associative), `/` carries the near-zero-divisor guard, `%` is int64
  mod, comparisons use the source epsilons, ternary and if() are lazy. Unwitnessed
  constructs (&& || | &, $-constants, compound assignment, megabuf) are refused
  with a parse error naming them — falsifier for those arrives with content
  that uses them.
- The full warp path renders: zoom/zoomexp/rot/warp/cx/cy/dx/dy/sx/sy drive the
  transcribed MilkDrop mesh formula (milkdropfs.cpp:1877-1918, per-pixel; the
  oscillators per :1782-1787 are checked against recompute), so every studio
  port edit now has a visible effect. zoom flows to the mesh unclamped exactly as the
  source runs it (the range-check block at milkdropfs.cpp:677-679 clamps only
  gamma and echo_zoom), so whatever the preset writes is what renders.
- The composite is transcribed from ShowToUser_NoShaders (milkdropfs.cpp:4050-4260):
  aspect CROP with overscan (not stretch), video echo (zoom/flip layer mixed by
  echo alpha), and gammaAdj as a saturating multiply — with the source defaults
  (fGammaAdj=2.0 per state.cpp:541) materialized into the .phos comp node. The
  sampler uses WRAP addressing per the source's sampler states (:976-981).
- There is no in-tree check of the border geometry against projectM source —
  the shader's max-norm ring math (src/render-wgsl.mjs) is confirmed by a human
  reading it next to milkdropfs.cpp:3460 and by viewing the render.
- The audio path IS derived (sources/AUDIO-PATH.md): a pcm-tap AudioWorklet
  streams every sample into the 576-ring AddToBuffer model, and
  src/audio/analysis.mjs runs MilkDrop's FFT (480→512, Hann envelope, equalize,
  adjacent-sample damping) and the Loudness relative-band chain, so
  bass/…_att/vol carry source semantics revolving around 1.0, passed unscaled.
  Stated residual differences: arithmetic runs in doubles where the C runs
  float32 (a numerical-path difference the goal doc permits), WaveformAligner
  and the right-channel spectrum are not ported (nothing consumes them yet).
- Timekeeping is MilkDrop's DoTime (src/timekeeper.mjs, pluginshell.cpp:1895+):
  `time` advances by 1/damped-fps from a 128-slot frame-time history, and the
  pool's `fps` is that damped value — not raw 1/dt. INTERIM: this and the audio
  chain are hardwired for ALL scenes (including native and future Plane9 ones)
  until graph execution lets scenes reference them as explicit components —
  see the Semantics section of design/PHOS-FORMAT.md and the conversion rule
  in CLAUDE.md ("Both engines before shared machinery; convert, never emulate").

## Mechanical gate
`npm run gate` = syntax → typecheck → lint → deadcode. Standard tools only.
It proves the code is well-formed, NOT that it is behaviorally correct.
Behavior is judged by a human viewing the output.

## To run
Serve over http (WebGPU needs https/http, not file://):
    python -m http.server 8000
Open http://localhost:8000/ in Chrome/Edge.
