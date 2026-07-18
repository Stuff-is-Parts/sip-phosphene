# PHOSPHENE — engine vertical slice

A narrow, honest slice: a browser player + studio over a WebGPU feedback engine
that renders ONE scene. The scene is a native `.phos` file
(`scenes/md-101-per_frame.phos`), transcribed by `src/phos.mjs` from the MilkDrop
preset `101-per_frame.milk` with hash-pinned provenance in `meta.source`. All
pages load the `.phos`; the `.milk` is the retained source recipe. Format spec:
`design/PHOS-FORMAT.md`; commented creator template: `scenes/TEMPLATE.phos`.

## Entry points
- `index.html` — player (splash, demo/mic/file audio, HUD, fullscreen)
- `studio.html` — editor (shows the scene graph's nodes/ports from the .phos, edits values/equation live, export .milk)
- `engine-test.html` — bare engine render, no UI

## What is verified, and how (run these)
- `node check.mjs` — expression path: engine runs the preset equation; a changed
  coefficient is rejected. LIMIT: this is the remaining independent-oracle gap
  for that particular expression-path test (both sides use JS Math.sin and the
  Engine's own time) — see the header comment in check.mjs. It is not the only
  verification gap in the project; see "Known limits" below for the others.
  Also checks the .phos format structurally: committed scene == converter output
  byte-for-byte, serialize∘parse fixed point, load-path equivalence with the
  .milk import, template legality, refusal of mutant classes (unknown
  key/type/version, dangling edge, unsupported resources, multi-driver into one
  input port, unsupported .milk lines, missing required engine variable), and
  retention of source comment lines through transcription.

## Known limits (stated, not hidden)
- The expression-path oracle is correlated with the implementation (shared
  Math.sin, shared Engine time). A truly independent check requires butterchurn
  or retained projectM output. This is the remaining oracle gap for the
  expression-path test specifically, not for the whole project.
- Graph edges are the sole topology authority (reviewer foundation 2026-07-18):
  every op declares its typed input and output ports, edges are typed and
  node-qualified, and render completeness is checked as pure dataflow — every
  declared render output has an outgoing edge, every declared render input has
  an incoming edge, and exactly one presentation sink (a render op declaring
  `presented: render`) exists. There is no separate sequence grammar. A
  structurally valid graph executes subject to each registered operation's
  declared value constraints and render-plan input requirements: a port
  constraint refuses an out-of-witness value on any write path, and a render
  op that requires a specific incoming pass shape (borders requires an
  in-flight warp-feedback pass) refuses at contribute time. Value ops read
  inputs and propagate outputs along value edges; render ops receive port-keyed
  input plans, return port-keyed output plans, and the executor deep-clones
  each returned plan per outgoing edge so branch consumers cannot share
  mutable state. Multi-driver into any input port and constant-plus-edge on
  any input port both refuse at construction. Per-vertex programs are refused
  at import and at engine construction until the engine executes them.
- The headless check verifies the produced render **plans**' structure and
  values. The browser shared render-plan executor (`src/render-executor.mjs`,
  consumed by `src/player.mjs` and `src/studio.mjs`) turns those plans into
  WebGPU commands at run time. The automated checks do not execute those
  WebGPU commands against a real GPU, so GPU-side border geometry, video echo,
  and mesh rasterization remain human-viewed.
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
- The full warp path renders through the source's own finite mesh: UVs are
  computed at 48×36 grid vertices (src/warp-mesh.mjs — milkdropfs.cpp:1877-1926,
  strip topology plugin.cpp:2300-2324) and the GPU interpolates between them,
  so zoom=0 reproduces the source's exact all-NaN interpolation structure
  rather than a per-fragment substitute. zoom flows to the mesh unclamped
  exactly as the source runs it (the range-check block at milkdropfs.cpp:677-679
  clamps only gamma and echo_zoom), so whatever the preset writes is what
  renders.
- Border rings and video echo apply only above the source's 0.001 alpha
  thresholds (milkdropfs.cpp:3451, :4168), matching the source's skip paths.
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
- MilkDrop's `Timekeeper` and its loudness/audio chain are still supplied
  globally by the Engine, not through explicit graph components. `time` and
  `fps` in the flat EEL pool come from `src/timekeeper.mjs` (DoTime,
  pluginshell.cpp:1895+), and `bass`/`mid`/`treb`/`_att` come from
  `src/audio/analysis.mjs`. This is an interim ownership problem: source-
  specific timing and audio behavior must eventually be represented as
  explicit graph components a scene references. No currently accepted Plane9
  conversion consumes Plane9 time or audio — the accepted `Clear → Screen`
  slice is time-invariant, Color Cycle refuses at the compatibility gate, and
  Beat's detector remains unresolved so `musicActive=false` is supplied in
  product. The native MinMax op advances using the raw `dt` passed to
  `Engine.step()`, not MilkDrop's damped `Timekeeper.time`; before Plane9
  MinMax conversion can be accepted, the project must establish the exact
  meaning and lifecycle of Plane9's evaluator/frame delta from
  `Plane9Engine.dll` and represent the appropriate timing dependency
  explicitly. See design/PHOS-FORMAT.md's Semantics section and the
  conversion rule in CLAUDE.md ("Both engines before shared machinery;
  convert, never emulate").

## Mechanical gate
`npm run gate` = syntax → typecheck → lint → style → deadcode. Standard tools
only. Knip's entries are the real roots that its plugins cannot auto-discover:
the two HTML-hosted modules (`player.mjs`, `studio.mjs`) and `pcm-tap.js`
(loaded by string URL from an AudioWorklet call). The `check.mjs` script is
discovered from the `check` npm script and does not need an explicit entry;
`@webgpu/types` is discovered by knip from its `.d.ts` reference. Orphan
files and unused exports in non-entry modules are detected (both proven with
planted cases). BLIND SPOT, stated: unused exports OF the entry modules
themselves are exempt — those are covered by review, not by knip.
It proves the code is well-formed, NOT that it is behaviorally correct.
Visual and product quality are judged by a human viewing the output; source
compatibility is judged against external semantic evidence per the goal doc,
not against what looks right on screen.

## To run
Serve over http (WebGPU needs https/http, not file://):
    python -m http.server 8000
Open http://localhost:8000/ in Chrome/Edge.
