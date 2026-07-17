# PHOSPHENE — engine vertical slice

The full MilkDrop-capable engine core, proven end to end on one real preset
(101-per_frame.milk). This is the working engine, scoped to what one 2D preset
exercises — not a stripped demo.

## What it is
- `src/milk-import.mjs` — .milk source → scene IR (key=value parse, per-frame eqs)
- `src/eel.mjs` — the verified EEL element port (35 functions/operators)
- `src/expr-vm.mjs` — compiles EEL equations → JS, runs against the variable pool (P4)
- `src/engine.mjs` — the core: per-frame execution, variable pool, feedback state → render state
- `src/render-wgsl.mjs` — the warp-feedback + box-draw WGSL pass
- `index.html` — player: WebGPU canvas, splash + HUD, scene navigation, audio inputs (renamed from `player.html` when it became the site root)
- `studio.html` — node-graph editor over the same engine
- `tech.html` — minimal tech-slice demo: runs the 101-per_frame preset directly on a WebGPU canvas with feedback ping-pong (kept as a diagnostic page)
- `check.mjs` — the gate: import + per-frame execution vs independent reference + mutant

## What was PROVEN (by execution, not inspection)
1. `node check.mjs` — engine's per-frame equation matches the independent
   reference (ib_r = 0.7+0.4·sin(3t)) at **0 divergence over 600 frames**;
   mutant (sin(4t)) rejected.
2. WGSL compiled through **real naga/wgpu** — both feedback and blit shaders valid.
3. **Headless render**: the full pipeline (import→expr→render state→GPU→pixels)
   produced center pixel [184,0,0] where the preset math dictates 0.72·255=184.
4. **Animation**: 5 frames rendered with feedback ping-pong; on-screen red
   tracked the equation exactly (184,189,194,199,204) frame by frame.

## What it does NOT do (honestly scoped)
- Only this preset's feature footprint: per-frame expressions, decay/feedback,
  boxes. Warp/wave math exists (verified separately in phosphene-port) but this
  preset sets zoom/rot/warp=0, so those paths aren't exercised here.
- No GEOM, no compute — this is a 2D preset; those primitives aren't in its
  content (a Plane9 scene would force them — the next slice).
- No studio, no viewer navigation — those are shells over this core.
- Audio is stubbed to 1.0 in the browser build (AnalyserNode wiring is the
  next addition; the engine already accepts an audio object per step).

## To run on your screen
Serve the folder (WebGPU needs http, not file://):
    python -m http.server 8000
then open http://localhost:8000 in Chrome/Edge (WebGPU). You'll see the
red inner box pulsing per the equation, with feedback trails.

## The check that makes this real
Every claim above is a command that exits 0 or a pixel value that matches a
computed expectation. `node check.mjs` is the gate. The headless render proof
is reproducible with wgpu-py. None of it rests on "looks right."
