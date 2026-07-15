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
| Preset base value defaults (`decay`, `gammaadj`, `echo_zoom`, ..., 60+ keys) | Butterchurn `visualizer.js` `baseValsDefaults` (evidence file) | `src/core/milk-runner.ts` `MILK_BASE_DEFAULTS` | same | `tests/milk-frame.test.ts` covers a subset by running frame equations | partial | Missing: exhaustive assertion that every key in `MILK_BASE_DEFAULTS` matches the value at the cited source line for that key. |
| Shape base value defaults | Butterchurn `visualizer.js` `baseValsDefaultsShape` | `MILK_SHAPE_DEFAULTS` | same | none dedicated | partial | Same missing exhaustive assertion. |
| Wave base value defaults | Butterchurn `visualizer.js` `baseValsDefaultsWave` | `MILK_WAVE_DEFAULTS` | same | none dedicated | partial | Same missing exhaustive assertion. |

## 3. Equation lifecycle

| Item | Source | PHOSPHENE representation | PHOSPHENE implementation | Semantic test | Status | Notes |
|---|---|---|---|---|---|---|
| Init frame runs `init_eqs` on a clone of `{baseVals, globals}` and snapshots `q1..q32` as `q_values_after_init_code` | projectM `MilkdropPreset.cpp` `RenderFrame()`; Butterchurn `PresetEquationRunner`; Geiss §3d | `src/core/milk-runner.ts` `MilkPresetRunner` constructor | same | `tests/milk-frame.test.ts` init flow | partial | Missing: assertion that q1..q32 reset to the init snapshot at every frame. |
| Per-frame code sees `{mdVS, qInit, frameMap(user vars), globals, regs}` and writes user vars back | Butterchurn `PresetEquationRunner.runFrameEquations` | `runFrameEquations` in `milk-runner.ts` | same | `milk-frame.test.ts` covers frame flow | partial | Missing: assertion that user variables first assigned in the initial frame_eqs run become persistent and user variables first assigned in later frames do NOT persist. The E2E gate at the prior HEAD flagged `mdVSFrame.old_wave_mode`, `.var`, `.zm`, `.rd`, `.att`, `.tm` as missing from PHOSPHENE — direct test needed to isolate whether that failure lives in this lifecycle rule. |
| Per-pixel/per-vertex code runs per mesh vertex on a persistent pool, with `x`,`y`,`rad`,`ang`,`zoom`,`zoomexp`,`rot`,`warp`,`cx`,`cy`,`dx`,`dy`,`sx`,`sy` reset per vertex from mdVSFrame | projectM `PerPixelMesh.cpp`; Butterchurn `runVertEQs` | `runPixelEquations` in `milk-runner.ts` | same | none dedicated | partial | Missing: assertion that the vertex pool carries across vertices, that reset values come from mdVSFrame, and that the regs picked back from the last vertex feed the next frame's runFrameEquations. |
| `t1..t8` exist only in wave/shape contexts, set at init, readable per frame/point | Geiss §3d; projectM registers `t*` only in unit contexts | `TS` array in `milk-runner.ts` used inside wave and shape init loops | same | none dedicated | unresolved | Missing: test that verifies a preset assigning `t1` in wave init reads that value in per-frame/per-point, and that per-frame code in the preset context cannot read a t-variable set inside a wave. |

## 4. Random behavior

| Item | Source | PHOSPHENE representation | PHOSPHENE implementation | Semantic test | Status | Notes |
|---|---|---|---|---|---|---|
| Preset load draws `rand_start[0..3]` then `rand_preset[0..3]` from the seeded stream before init_eqs | Butterchurn `visualizer.js` `loadPreset` + `presetEquationRunner.js` | `MilkPresetRunner` constructor — `randStart` and `randPreset` populated via `this.rng.next()` in order | same | none dedicated | partial | The RecordingMilkRng infrastructure was retained. Missing: golden-value test that seeds `makeMulberry32(committed seed)` and asserts the first 8 draws land in randStart+randPreset in the documented order. |
| EEL `rand(x)` floors `x` and returns `[0,1)` when `x<1`, else `[0, floor(x))` | Butterchurn `presetBase.js` runtime; expr.ts port | `src/core/expr.ts` `FUNCS.rand` + per-Program rand closure | same | `tests/expr.test.ts` covers a subset | partial | Missing: assertion that two `rand()` calls in a single program consume two draws from the installed RNG in source order. |
| gmegabuf shared across all runtime contexts of the preset (preset + pixel + wave + shape) as one 1M-cell array | Butterchurn `equations_presetEquationRunner.js:67` (`this.gmegabuf = new Array(1048576).fill(0)`) + `:84` (`mdVSBase.gmegabuf = this.gmegabuf`) | `src/core/expr.ts` `GMEGABUF_HOLDER` swap-and-restore + `MilkPresetRunner.gmegabuf` Float64Array(1048576) shared to every compiled Program | same | `tests/expr.test.ts` shared-gmegabuf tests (3 tests) | partial | Cross-Program sharing is asserted and the initial-zero read matches. Unresolved boundary semantics against the cited source: (1) butterchurn holds gmegabuf as a plain JavaScript `Array`, PHOSPHENE holds it as `Float64Array` — a preset that reads an out-of-range index gets `undefined` from butterchurn and `undefined` from Float64Array as well (matches), but a preset that ASSIGNS to an out-of-range index in butterchurn silently extends the sparse Array while PHOSPHENE discards the write; the source witness for whether butterchurn ever executes such writes is absent from the retained evidence and needs a direct source trace of every megabuf/gmegabuf write path before this row moves to `implemented`. (2) butterchurn's Array stores JavaScript numbers (float64 doubles); Float64Array also stores float64 — match at the value level. (3) Cross-preset persistence: butterchurn line 67 allocates a fresh Array in the runner constructor, PHOSPHENE allocates a fresh Float64Array in the runner constructor — match. (4) Preset blending (butterchurn keeps prev + curr runners live during blend, each with its own gmegabuf) is not modeled in PHOSPHENE; the row cannot reach `implemented` until blending is resolved. |

## 5. Audio processing

| Item | Source | PHOSPHENE representation | PHOSPHENE implementation | Semantic test | Status | Notes |
|---|---|---|---|---|---|---|
| FFT with bit-reversal, 1024-sample signed center input, equalize table | Butterchurn `fft.js` / `audioProcessor.js` | `src/core/milk-audio.ts` `ButterchurnFFT` | same | none dedicated (parity test against the mjs mirror was retired) | partial | Missing: a golden-input test with a controlled PCM waveform whose expected FFT output is computed from butterchurn source math, asserting exact match. |
| AudioLevels IIR (0.2/0.5 short, 0.9/0.992 long, band cutoffs at 20/320/2800/11025 Hz) | Butterchurn `audioLevels.js`; projectM `Audio/Loudness.cpp` | `src/core/milk-audio.ts` `OracleAudioLevels` | same | none dedicated | partial | Missing: a step-response test that feeds a constant PCM level and asserts the smoothed value follows the first-order response the coefficients define at the frame rate the model uses. |
| calcTimeAndFPS: damped fps 0.93, frame counter, time integrated from elapsed | Butterchurn `butterchurn.js` `calcTimeAndFPS` | `src/core/milk-audio.ts` `OracleTimeModel` | same | none dedicated | partial | Missing: a test that steps N frames with a fixed elapsed and asserts fps damping matches the closed-form solution. |

## 6. Warp mesh and per-pixel geometry

| Item | Source | PHOSPHENE representation | PHOSPHENE implementation | Semantic test | Status | Notes |
|---|---|---|---|---|---|---|
| Warp UV computation using `warpTime`, `warpScaleInv`, `warpf0..warpf3` oscillators, plus per-vertex zoom/rot/cx/cy/sx/sy/dx/dy from either the per-pixel-run pool or mdVSFrame | projectM `PerPixelMesh.cpp`; Butterchurn `renderer.js` runPixelEquations | `src/core/milk-runner.ts` `runPixelEquations` | same | none dedicated | partial | Missing: a golden-input test that runs runPixelEquations on a preset with known mdVSFrame and asserts every UV in the returned Float32Array matches values derived by the same formula independently. |

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
