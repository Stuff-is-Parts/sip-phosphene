# MilkDrop semantic inventory

Tracking surface for MilkDrop compatibility work under
[COMPATIBILITY-GOAL.md](../COMPATIBILITY-GOAL.md). Each row names one
source-defined item, the authoritative source that defines its behavior,
where PHOSPHENE represents and implements it, the direct semantic test
that pins it, and its current status.

The execution model derivation lives in
[`milkdrop-execution-model.md`](milkdrop-execution-model.md). This
inventory does not duplicate that derivation — it records what has been
implemented and what remains, with status derived from evidence (test
presence, source citation, code location), not from prose claims.

## Status values

| Value | Meaning |
|---|---|
| implemented | source-cited, represented in the graph, executed in the runtime, and pinned by a direct semantic test whose assertions cite the source |
| partial | some of the above is present but at least one is missing (e.g., implemented in the runtime but no direct semantic test) |
| unresolved | source behavior has not been established from evidence; not implemented; not approximated |
| unsupported | source behavior is established but the item is intentionally refused rather than implemented (documented reason, refusal cited in the executor) |

Every `implemented` row's semantic test cites the source location it
verifies against, either inline in the test or in this row.

Every `partial` row names the specific missing element in its notes.

Every `unresolved` row names the evidence still needed.

## 1. Parsing

| Item | Source | PHOSPHENE representation | PHOSPHENE implementation | Semantic test | Status | Notes |
|---|---|---|---|---|---|---|
| Preset section parsing (`[preset00]`, `warp_*`, `comp_*`, `per_frame_init_*`, `per_frame_*`, `per_pixel_*`, `wavecode_N_*`, `shapecode_N_*`) | milkdrop-preset-converter output shape; documented preset format (Geiss §2) | `src/import/milk.ts`, `src/import/milk-graph.ts` — `parseMilk`, `parseMilkComplete`, `milkToGraph` | same | `tests/milk-import.test.ts` (11 tests: named-section extraction, EEL body extraction, base-value coercion, unknown-section handling) | partial | Semantic tests confirm structural parse. Missing: assertion that every field with a documented default receives that default when absent from the file, per Geiss §3. |
| Numeric base value coercion (`fRating`, `fGammaAdj`, `fDecay`, etc. → `rating`, `gammaadj`, `decay`) | milkdrop-preset-converter `varMap` (evidence at `docs/evidence/butterchurn/`) | `src/core/milk-runner.ts` `MILK_VAR_MAP`, `mapMilkKeys` | same | none dedicated | partial | The varMap is transcribed in `MILK_VAR_MAP`. Missing: a test that asserts every documented key rename produces the correct runtime name across the three unit scopes (main / shape / wave). |
| Wave and shape numbered blocks (`wavecode_N_enabled` etc.) with `N` up to the source-defined limit | Geiss §3d, projectM `CustomWaveform.cpp` / `CustomShape.cpp` | `src/import/milk-graph.ts` (produces `milk-wave` and `milk-shape` nodes) | `src/core/milk-runner.ts` unit ctor loops | see `milk-import.test.ts` | partial | Missing: assertion that node `index` matches the source `N` and that node ordering follows source order. |

## 2. Runtime defaults

| Item | Source | PHOSPHENE representation | PHOSPHENE implementation | Semantic test | Status | Notes |
|---|---|---|---|---|---|---|
| Preset base value defaults (`decay`, `gammaadj`, `echo_zoom`, ..., 60+ keys) | Butterchurn `visualizer.js` `baseValsDefaults` (source not currently in `docs/evidence/butterchurn/` — needs re-extraction) | `src/core/milk-runner.ts` `MILK_BASE_DEFAULTS` | same | `tests/milk-frame.test.ts` covers a subset by running frame equations; `tests/milk-runner.test.ts` base-value-reload block asserts one representative key (`decay = 0.98`) reloads per frame | partial | Missing: exhaustive per-key assertion that every entry in `MILK_BASE_DEFAULTS` matches the source value. The re-extraction under `docs/evidence/butterchurn/` should include `visualizer.js` so the golden values can be cited by file:line. |
| Shape base value defaults | Butterchurn `visualizer.js` `baseValsDefaultsShape` (needs re-extraction) | `MILK_SHAPE_DEFAULTS` | same | none dedicated | partial | Same missing exhaustive assertion. |
| Wave base value defaults | Butterchurn `visualizer.js` `baseValsDefaultsWave` (needs re-extraction) | `MILK_WAVE_DEFAULTS` | same | none dedicated | partial | Same missing exhaustive assertion. |
| Renderer-injected `old_wave_mode` on the mdVS baseVals before the equation runner constructor | Butterchurn `rendering_renderer.js:194` (`preset.baseVals.old_wave_mode = prevPreset.baseVals.wave_mode`) | `MILK_BASE_DEFAULTS.old_wave_mode = 0` | consumed by `MilkPresetRunner` constructor via `baseVals` spread into `mdVS` | `tests/milk-runner.test.ts` renderer-injected-`old_wave_mode` block (2 tests: baseValues-supplied value flows to mdVSFrame; value preserves across frames when no equation touches it) | partial | Direct semantic test covers the runner-level contract for a supplied value. Unresolved: session-level prev-preset tracking — butterchurn holds the prev preset's `wave_mode` across a load boundary, PHOSPHENE has no session model that owns "the previous preset that finished blending" and defaults to 0. Row cannot reach `implemented` until preset blending is supported or explicitly refused with an editable-session boundary defined. |

## 3. Equation lifecycle

| Item | Source | PHOSPHENE representation | PHOSPHENE implementation | Semantic test | Status | Notes |
|---|---|---|---|---|---|---|
| Init frame runs `init_eqs` on a clone of `{baseVals, globals}` and snapshots `q1..q32` as `q_values_after_init_code` | projectM `MilkdropPreset.cpp` `RenderFrame()`; Butterchurn `equations_presetEquationRunner.js:91-93` | `src/core/milk-runner.ts` `MilkPresetRunner` constructor | same | `tests/milk-runner.test.ts` `q1..q32 reset to the init snapshot at the start of every frame` | implemented | |
| Per-frame code sees `{mdVS, qInit, frameMap(user vars), globals}` and writes user vars back; mdVSUserKeys fixed at init from init-time frame_eqs result | Butterchurn `equations_presetEquationRunner.js:98-102, :199-201` | `runFrameEquations` in `milk-runner.ts` | same | `tests/milk-runner.test.ts` user-variable-lifecycle block (3 tests: init-eqs-defined persists, init-time-frame-eqs-defined persists, later-frame-first-assigned does not persist) | implemented | |
| Per-pixel/per-vertex code runs per mesh vertex on a persistent pool, with `x`,`y`,`rad`,`ang`,`zoom`,`zoomexp`,`rot`,`warp`,`cx`,`cy`,`dx`,`dy`,`sx`,`sy` reset per vertex from mdVSFrame | projectM `PerPixelMesh.cpp`; Butterchurn `runVertEQs` | `runPixelEquations` in `milk-runner.ts` | same | none dedicated | partial | Missing: assertion that the vertex pool carries across vertices, that reset values come from mdVSFrame, and that the regs picked back from the last vertex feed the next frame's runFrameEquations. |
| `t1..t8` exist only in wave/shape contexts, set at init, readable per frame/point | Geiss §3d; projectM registers `t*` only in unit contexts | `TS` array in `milk-runner.ts` used inside wave and shape init loops | same | none dedicated | unresolved | Missing: test that verifies a preset assigning `t1` in wave init reads that value in per-frame/per-point, and that per-frame code in the preset context cannot read a t-variable set inside a wave. |

## 4. Random behavior

| Item | Source | PHOSPHENE representation | PHOSPHENE implementation | Semantic test | Status | Notes |
|---|---|---|---|---|---|---|
| Preset load draws `rand_start[0..3]` then `rand_preset[0..3]` from the seeded stream before init_eqs | Butterchurn `equations_presetEquationRunner.js:88-91` | `MilkPresetRunner` constructor — `randStart` and `randPreset` populated via `this.rng.next()` in order | same | `tests/milk-runner.test.ts` seeded random-draw-order block (2 tests: golden 8 draws for randStart+randPreset; init_eqs picks the 9th draw) | implemented | Golden-value test uses `makeMulberry32(0x5eed1e55)` as reference generator, asserts bit-for-bit against the runner's draws. Uncovered a real bug in `src/core/expr.ts` — parse captured `FUNCS.rand` by value, so `Program.setRng()` did not affect compiled `rand()` calls. Fixed by looking up FUNCS.rand at run time for rand/randint. |
| EEL `rand(x)` floors `x` and returns `[0,1)` when `x<1`, else `[0, floor(x))`; draws from the Program's installed RNG | Butterchurn `presetBase.js` runtime; expr.ts port | `src/core/expr.ts` `FUNCS.rand` + per-Program rand closure (run-time-looked-up at expr.ts parse output) | same | `tests/expr.test.ts` covers `rand`/`randint` fallback; `tests/milk-runner.test.ts` covers seeded-stream binding | implemented | |
| gmegabuf shared across all runtime contexts of the preset (preset + pixel + wave + shape) as one 1M-cell array | Butterchurn `equations_presetEquationRunner.js:67` (`this.gmegabuf = new Array(1048576).fill(0)`) + `:84` (`mdVSBase.gmegabuf = this.gmegabuf`) | `src/core/expr.ts` `GMEGABUF_HOLDER` swap-and-restore + `MilkPresetRunner.gmegabuf` Float64Array(1048576) shared to every compiled Program | same | `tests/expr.test.ts` shared-gmegabuf tests (3 tests) | partial | Cross-Program sharing is asserted and the initial-zero read matches. Unresolved boundary semantics against the cited source: (1) butterchurn holds gmegabuf as a plain JavaScript `Array`, PHOSPHENE holds it as `Float64Array` — a preset that reads an out-of-range index gets `undefined` from butterchurn and `undefined` from Float64Array as well (matches), but a preset that ASSIGNS to an out-of-range index in butterchurn silently extends the sparse Array while PHOSPHENE discards the write; the source witness for whether butterchurn ever executes such writes is absent from the retained evidence and needs a direct source trace of every megabuf/gmegabuf write path before this row moves to `implemented`. (2) butterchurn's Array stores JavaScript numbers (float64 doubles); Float64Array also stores float64 — match at the value level. (3) Cross-preset persistence: butterchurn line 67 allocates a fresh Array in the runner constructor, PHOSPHENE allocates a fresh Float64Array in the runner constructor — match. (4) Preset blending (butterchurn keeps prev + curr runners live during blend, each with its own gmegabuf) is not modeled in PHOSPHENE; the row cannot reach `implemented` until blending is resolved. |

## 5. Audio processing

| Item | Source | PHOSPHENE representation | PHOSPHENE implementation | Semantic test | Status | Notes |
|---|---|---|---|---|---|---|
| FFT with bit-reversal, 1024-sample signed center input, equalize table | Butterchurn `fft.js` / `audioProcessor.js` | `src/core/milk-audio.ts` `ButterchurnFFT` | same | none dedicated | partial | Missing: a golden-input test with a controlled PCM waveform whose expected FFT output is computed from butterchurn source math, asserting exact match. |
| AudioLevels IIR (0.2/0.5 short, 0.9/0.992 long, band cutoffs at 20/320/2800/11025 Hz) | Butterchurn `node_modules/butterchurn/lib/butterchurn.js:190-317` (AudioLevels class); projectM `Audio/Loudness.cpp` | `src/core/milk-audio.ts` `OracleAudioLevels` | same | `tests/milk-audio.test.ts` — initial state, 0.2/0.5 short-rate switch at bass rising vs falling, long-rate switch at frame 50 (0.9 → 0.992), effective fps clamp to [15, 144], longAvg<0.001 fallback, adjustRateToFPS = pow(rate, 30/fps) | implemented | Float32Array storage on both sides (butterchurn:209-213 and port:176-180) produces ~1e-7 precision drift; tolerances documented in the tests. |
| calcTimeAndFPS: damped fps 0.93, frame counter, time integrated from elapsed | Butterchurn `butterchurn.js` `calcTimeAndFPS`; PHOSPHENE port at `src/core/milk-audio.ts` `OracleTimeModel.advance` | same | same | `tests/milk-audio.test.ts` OracleTimeModel — frameNum increments per step, time uses 1/fps not elapsed, 120-entry timeHist saturates fps at 120/(119/30) ≈ 30.25 for equally-spaced steps, returned tuple matches stored fields | implemented | The steady-state fps of ~30.252 (not 30) is the E2E-observed value that appeared as `worstEquationDrift: globals.fps@250 err=3.76e-15, ours=30.252103634683735, oracle=30.25210363468362` in the deleted E2E report — same math on both sides, matching to float epsilon. |

## 6. Warp mesh and per-pixel geometry

| Item | Source | PHOSPHENE representation | PHOSPHENE implementation | Semantic test | Status | Notes |
|---|---|---|---|---|---|---|
| Warp UV computation using `warpTime`, `warpScaleInv`, `warpf0..warpf3` oscillators, plus per-vertex zoom/rot/cx/cy/sx/sy/dx/dy from either the per-pixel-run pool or mdVSFrame | projectM `PerPixelMesh.cpp`; Butterchurn `renderer.js` runPixelEquations; PHOSPHENE port at `src/core/milk-runner.ts:373-437` | same | same | `tests/milk-runner.test.ts` runPixelEquations warp UV block — identity map when warp=0, zoom=1 (corner and center vertices); zoom>1 halves the UV extent as source math predicts | partial | Missing: golden-input assertions for warp>0 oscillator offsets, non-zero rot, non-zero dx/dy, non-1 sx/sy, and per-pixel EEL running (all base-value-adjacent parameters exercised individually). |

## 7. Generated draw geometry

| Item | Source | PHOSPHENE representation | PHOSPHENE implementation | Semantic test | Status | Notes |
|---|---|---|---|---|---|---|
| Custom shape vertex fan (center + rim, sides clamped 3..100, aspect-corrected rim, optional texture UVs from tex_zoom/tex_ang, optional border line-strip) | projectM `CustomShape.cpp`; Butterchurn `shapes/customShape.js` | `src/gpu/milk-pipeline.ts` `buildShape` | same | none dedicated | partial | Missing: assertion that for a fixed pool, `buildShape` produces the exact triangle-list vertex array documented by the source. |
| Custom wave sample generator (mix1/mix2 smoothing, forward-then-reverse pass, spectrum-vs-time source, `smoothWaveAndColor` 2n-1 output) | Butterchurn `waves/customWaveform.js` + `waveUtils.js` | `src/gpu/milk-pipeline.ts` `buildCustomWave` + `smoothWaveAndColor` | same | none dedicated | partial | Missing: assertion for a fixed input timeArrayL/R that the output pd0/pd1 series matches the source math exactly. |
| Basic waveform modes 0..7 (per-mode geometry, alpha modulation, y-negation before smoothing) | Butterchurn `waves/basicWaveform.js` | `src/gpu/milk-pipeline.ts` `buildBasicWave` | same | none dedicated | partial | Missing: per-mode golden geometry tests. |
| Motion vector line list (mv_x, mv_y grid + bilinear UV sample from warpUVs; oracle quirk in the `else` branch of the fdist test) | Butterchurn `motionVectors/motionVectors.js` | `src/gpu/milk-pipeline.ts` `buildMotionVectors` | same | none dedicated | partial | Missing: golden vertex-buffer test that pins the oracle quirk verbatim. |
| Darken-center fan and border quads | Butterchurn `darkenCenter/darkenCenter.js` + `border/border.js` | `src/gpu/milk-pipeline.ts` `buildDarkenCenterAndBorders` | same | none dedicated | partial | Missing: geometry tests. |
| Comp grid hue-color interpolation with rand_start-seeded oscillators | Butterchurn `comp/comp.js` `generateHueBase` + `generateCompColors` | `src/gpu/milk-pipeline.ts` `generateCompColors` | same | none dedicated | partial | Missing: golden-color test with a fixed `mdVSFrame.time` and known `randStart`. |

## 8. Pass ordering and pipeline

| Item | Source | PHOSPHENE representation | PHOSPHENE implementation | Semantic test | Status | Notes |
|---|---|---|---|---|---|---|
| Frame pipeline order (frame eqs → motion vectors → previous-flip → warp → blur → shapes → waves → basic wave → darken center → borders → composite → swap) | projectM `MilkdropPreset.cpp` `RenderFrame`; documented in `milkdrop-execution-model.md` §1 | `src/core/graph.ts` graph.order + `src/gpu/milk-pipeline.ts` switch dispatch | same | none dedicated | partial | Missing: assertion that `milkToGraph(parsedPreset).graph.order` reproduces the source pipeline order for representative presets. |
| Rgba8unorm target format with mip chain, `LINEAR_MIPMAP_LINEAR`, anisotropy | projectM `RenderContext.hpp`; Butterchurn `renderer.js` | `src/gpu/milk-pipeline.ts` TARGET_FORMAT + makeTarget + samplers | same | none dedicated | partial | Format choice is a source-behavior claim; test not required, but the sampler wrap-mode (repeat vs clamp-to-edge based on `mdVSFrame.wrap`) is a semantic rule that needs a test. |

## 9. Shader translation

| Item | Source | PHOSPHENE representation | PHOSPHENE implementation | Semantic test | Status | Notes |
|---|---|---|---|---|---|---|
| MilkDrop 2 warp shader (HLSL → WGSL) | source HLSL forms in the corpus; MilkDrop 2 shader authoring reference | not implemented | not implemented | not implemented | unresolved | 80 of 97 corpus presets refuse at load for this. Blocks the largest single body of compatibility work. |
| MilkDrop 2 comp shader (HLSL → WGSL) | same | not implemented | not implemented | not implemented | unresolved | 79 presets. |
| Blur cascade (bright, blur H, blur V) as a chain the comp shader can sample | Butterchurn `blur/*` | not implemented | not implemented | not implemented | unresolved | 66 presets. |
| Default warp shader (decay-multiplied previous sample) | Butterchurn `shaders/warp.js` | `WARP_WGSL` in `milk-pipeline.ts` | same | none dedicated | partial | Missing: WGSL-input/output test with controlled uv, decay, and previous-frame texture data. |
| Default composite shader (echo_zoom, echo_alpha, echo_orient, gammaadj, brighten/darken/solarize/invert, fShader blend) | Butterchurn `shaders/comp.js` | `COMP_WGSL` in `milk-pipeline.ts` | same | none dedicated | partial | Same missing WGSL-level test. |

## 10. Refused surfaces

| Item | Reason for refusal | Location of refusal |
|---|---|---|
| `perPixelInit` (non-empty `per_pixel_init` block) | Per-vertex init lifecycle not modeled in the runner. The oracle runs it once at preset load inside a per-vertex context and feeds outputs to the first per_pixel run. | `src/gpu/milk-pipeline.ts` load-time check |
| MilkDrop 2 warp shader | See row above | `src/gpu/milk-pipeline.ts` load-time check |
| MilkDrop 2 comp shader | See row above | `src/gpu/milk-pipeline.ts` load-time check |
| Blur cascade | Consumed only by unimplemented shaders | `src/gpu/milk-pipeline.ts` load-time check |

Refused items do not block: they are the concrete backlog of future
inventory rows that must move from `unresolved` to `implemented`.
