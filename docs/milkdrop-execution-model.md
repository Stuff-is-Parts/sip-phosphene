# MilkDrop execution model (from authoritative source)

Derivation evidence for COMPATIBILITY-GOAL.md Plan step 1. Every section
cites its source. Primary sources: the projectM repository
(`github.com/projectM-visualizer/projectm`, master branch, LGPL — consulted
as behavioral documentation per COMPATIBILITY-GOAL.md Source Authority) and
Ryan Geiss's MilkDrop 2 preset authoring guide
(`geisswerks.com/hosted/milkdrop2/milkdrop_preset_authoring.html`).
Citations marked [fetched] were retrieved and quoted during derivation;
[summarized] means the retrieval tool condensed the code and the claim
should be re-verified against the file before implementation of that
subsystem relies on an exact constant not shown here.

## 0. Renderer vs. Equation Runner (ownership boundary)

Sources: `rendering_renderer.js` [fetched] plus
`equations_presetEquationRunner.js` [fetched, verbatim quotes at
`docs/evidence/butterchurn/`].

Two distinct owners:

- **Renderer** (butterchurn's `Renderer` class, `rendering_renderer.js`) —
  the session-lifetime object. Holds `preset`, `prevPreset`, the two
  `PresetEquationRunner` instances (current + previous, kept alive during
  blend), `blending` / `blendStartTime` / `blendDuration` /
  `blendProgress`, GL framebuffers and textures (`prevTexture`,
  `targetTexture`, `compTexture`, `blurTexture1/2/3`), the three
  `blurShader1/2/3` chains, four fixed `customWaveforms[0..3]` and
  `customShapes[0..3]` slots plus their `prev` counterparts, the
  `noise`/`image`/`titleText`/`darkenCenter`/`innerBorder`/`outerBorder`/
  `motionVectors`/`resampleShader`/`blendPattern` resources, and the
  timing state (`time`, `frameNum`, `fps`, `timeHist`, `presetTime`,
  `lastTime`).
- **Equation Runner** (`PresetEquationRunner` class,
  `equations_presetEquationRunner.js`) — the per-preset object. Owns
  `mdVS`, `mdVSQInit`, `mdVSRegs`, `mdVSFrame`, `mdVSFrameMap`,
  `mdVSQAfterFrame`, `mdVSUserKeys`, per-unit maps
  (`mdVSWaves`/`mdVSTWaveInits`/`mdVSUserKeysWaves`/`mdVSFrameMapWaves`
  and the same for shapes), `gmegabuf` (`new Array(1048576).fill(0)`),
  and the per-preset `rand_start` / `rand_preset` Float32Arrays.

Any behavior that reads state from before the current preset was loaded
(`old_wave_mode` from `prevPreset.baseVals.wave_mode`,
`prevPresetEquationRunner` outputs during blend, `numBlurPasses`
computed from the two shaders) is the Renderer's responsibility, not the
Runner's. The Runner sees only what the Renderer hands it via
`globalVars` + `preset.baseVals` at construction.

## 1. Frame pipeline order

Source: `MilkdropPreset.cpp` `RenderFrame()` [fetched]. Exact stage order:

1. Per-frame equation update (`PerFrameUpdate()`).
2. Motion vectors drawn onto the PREVIOUS frame texture (skipped frame 1).
3. Previous frame y-flip (`m_flipTexture`).
4. Per-pixel mesh warp: warp shader samples the flipped previous frame,
   writes the new canvas (`m_perPixelMesh.Draw()`).
5. Blur cascade update from the warped image (`m_state.blurTexture.Update()`).
6. Custom shapes (all instances, in index order).
7. Custom waveforms (all instances, in index order).
8. Default waveform.
9. Darken-center (only when `darken_center > 0`).
10. Borders (outer then inner).
11. Final composite (comp shader, or legacy video-echo + filters path).
12. Framebuffer swap (current ↔ previous).

Waves/shapes draw ONTO the warped canvas (they persist into the next
frame's feedback); composite output does not feed back.

## 1B. Preset lifecycle and blending

Source: `rendering_renderer.js` `loadPreset()` [fetched, lines 183-239].

Sequence when a new preset arrives at `loadPreset(preset, blendTime)`:

1. `this.blendPattern.createBlendPattern()` — the blend mask (a
   procedural pattern) is generated fresh.
2. Blending flags: `this.blending = true`; `this.blendStartTime =
   this.time`; `this.blendDuration = blendTime`; `this.blendProgress =
   0`.
3. `this.prevPresetEquationRunner = this.presetEquationRunner` — the
   OLD runner is retained, not destroyed. It continues to run
   `runFrameEquations` on the current audio each frame during the blend
   so the two rendered images can be crossfaded.
4. `this.prevPreset = this.preset` — same for the preset payload.
5. `this.preset = preset` — install the new payload.
6. `this.preset.baseVals.old_wave_mode = this.prevPreset.baseVals.wave_mode`
   — the ONLY renderer-injected key. Presets whose per-frame code reads
   `old_wave_mode` (like basic-waveform blender at
   `rendering_waves_basicWaveform.js:87`) get the previous preset's
   `wave_mode` this way.
7. `this.presetTime = this.time` — the new preset's per-preset time
   origin.
8. Fresh `globalVars` are computed from current audio + timing.
9. `this.presetEquationRunner = new PresetEquationRunner(this.preset,
   globalVars, params)` — the new runner is constructed. The mutation
   at step 6 already landed on `this.preset.baseVals`, so the new
   runner's `mdVS` spread picks it up.
10. `this.regVars = this.presetEquationRunner.mdVSRegs` — the renderer
    tracks regs at Renderer level (not runner) so they can flow into
    the runner's `globalVars` on next-frame calls.
11. Swap `warpShader` ↔ `prevWarpShader`, `compShader` ↔ `prevCompShader`
    so the OLD shaders keep running on the previous-preset image
    during blend. Update the shader texts on the (new) `warpShader`
    and `compShader` instances via `updateShader(warpText)` /
    `updateShader(compText)`.
12. Compute `numBlurPasses = max(getHighestBlur(warpText),
    getHighestBlur(compText))` — the blur-cascade length is a
    PER-PRESET decision the Renderer makes, not the graph parser.

Blending termination: `calcTimeAndFPS` updates `blendProgress =
(time - blendStartTime) / blendDuration`, and `blending = false` when
progress crosses 1.0. The final rendered frame during blend is
`blendMask * newImage + (1 - blendMask) * prevImage`; the mask is the
per-pixel blend pattern from `blendPattern.createBlendPattern`.

## 2. Equation contexts and variable lifecycle

Sources: `PerFrameContext.cpp/hpp`, `PerPixelContext.hpp`,
`Constants.hpp` (QVarCount=32, TVarCount=8) [fetched earlier this
derivation]; Geiss §3d.

- **Init code** runs once at preset load. The q1..q32 values at the end of
  init are snapshotted (`q_values_after_init_code`).
- **Every frame**, q1..q32 are reset to that snapshot before per-frame code
  runs. Nothing else persists frame-to-frame through q-vars; user variables
  in the per-frame context DO persist (Geiss §3d: "persistent variables").
- Per-frame code may write q1..q32; the post-per-frame values feed
  (a) per-pixel/per-vertex code and (b) the shader uniforms `_qa.._qh`.
- **Per-pixel (per-vertex) code** runs per mesh vertex on the CPU each
  frame, after per-frame, before the warp draw.
- **t1..t8** exist only in custom wave/shape contexts: set in the unit's
  init code, readable per frame/point (Geiss §3d). projectM registers
  them only in custom-unit contexts, not the preset context.
- **gmegabuf and reg00..reg99** are shared across ALL contexts of a preset.
- Q-var flow into custom units: unit per-frame context receives the
  preset's post-per-frame q values (`CustomWaveform.cpp`
  `InitPerPointEvaluationVariables` copies q + t into per-point context).

## 3. Audio data

Source: `Audio/Loudness.cpp` [fetched verbatim].

- Spectrum is split into 6 equal bands; bass/mid/treb sum bands 0/1/2.
- Short-window smoothed value: asymmetric single-pole IIR — rate 0.2 when
  rising, 0.5 when falling (rates are per-frame decay factors at 30 fps).
- Long-window baseline: rate 0.9 for the first 50 frames, then 0.992.
- Frame-rate compensation: `pow(pow(rate, 30), secondsSinceLastFrame)`.
- Shader/equation-visible values are RATIOS around 1.0:
  `bass = shortAverage / longAverage`, `bass_att = current / longAverage`
  (min longAverage clamp 0.001). Presets detect beats with idioms like
  `bass > 1.3` — values MUST exceed 1 on transients or beat-gated behavior
  never fires.
- There is no built-in `beat` variable in MilkDrop.

## 4. Per-pixel mesh and warp

Sources: `PerPixelMesh.cpp`, `RenderContext.hpp` [fetched earlier].

- Default mesh 64×48 (host-configurable 8..300; preset reads `meshx/meshy`).
- Loop over (gridX+1)×(gridY+1) vertices; per-pixel code runs at each.
- Equation-space: `x`,`y` in 0..1 (aspect-corrected from NDC);
  `rad = hypot(x*aspectX, y*aspectY)` on -1..1 coords (≈1 at narrow-axis
  corner), `ang = atan2(y*aspectY, x*aspectX)` in 0..2π.
- Motion params consumed by the warp: zoom, zoomexp, rot, warp, warp_x,
  warp_y (warp animation constants), cx, cy (rotation center), dx, dy
  (translation), sx, sy (stretch). ALL of these are per-vertex writable.
- Warp UVs computed on CPU per vertex, interpolated by rasterization.

## 5. Waveform rendering (default wave)

Sources: `Waveform.cpp`, `Waveforms/Circle.cpp` [fetched].

- `waveMode % Count` selects a mode class (factory). Modes are distinct
  vertex-generation programs (Circle, XYOscillation, CenteredSpiro,
  DerivativeLine, ExplosiveHash, Line, DoubleLine, SpectrumLine per
  projectM's Waveforms/ directory).
- Example (Circle) [fetched verbatim]: radius = 0.5 + 0.4*pcmR[i] +
  wave_mystery; first 10% of samples blend via cos mix; angle =
  (i/samples)*6.28 + time*0.2; x = r*cos(a)*aspectY + wave_x,
  y = r*sin(a)*aspectX + wave_y.
- Alpha: mode-dependent scaling, optional volume modulation
  (`alpha*(vol-lower)/(upper-lower)`), clamp 0..1; maximize-color
  normalizes max component to 1.
- Blend: additive (`SRC_ALPHA, ONE`) when `additivewave`, else standard.
- Thick: 4 draws with ±1px offsets. Dots: point primitives. LineStrip
  otherwise (LineLoop for closed modes).

## 6. Custom waves

Source: `CustomWaveform.cpp` [fetched].

- Per wave: enabled flag, samples count, spectrum|waveform source flag,
  smoothing, scaling, sep (channel separation).
- Per frame: init (once, t-vars), per-frame code (q in, t in/out).
- Per point loop over sampleCount: `sample` = i/(count-1) in 0..1;
  `value1` = left channel data[i], `value2` = right channel data[i]
  (spectrum or waveform per flag); defaults x = 0.5+value1?? —
  [summarized; the fetch showed `x = 0.5f + value1` as the pre-code
  default; verify exact default mapping for x/y before implementing].
  Per-point code then sets x, y, r, g, b, a per point.
- Smoothing: Catmull-Rom-like filter, coefficients (-0.15, 1.15, 1.15,
  -0.15) over 4 consecutive points, generating midpoints.
- Blend additive or standard; thick = 4 offset draws.

## 7. Custom shapes

Source: `CustomShape.cpp` (per agent report, consistent with Geiss §3):
per shape: enabled, sides, x/y/rad/ang, r/g/b/a + border colors,
textured flag (samples main canvas), tex_zoom, tex_ang, thickoutline,
additive, instances (num_inst) with per-instance equation reruns
(`instance` variable). Drawn as triangle fan with optional textured UVs
from the canvas, plus line-loop border.

## 8. Motion vectors

Source: `MotionVectors.cpp` [fetched].

- Grid `mv_x × mv_y` clamped to 64×48; fractional parts shift positions.
- Positions: `(i + 0.25)/(count + frac + 0.25 - 1) ± mv_dx/mv_dy`.
- Reverse-propagation: the shader looks up where each grid point WAS
  (inverted warp) and draws a line from there to the current position,
  clamped to a minimum length slightly over 1px. Color mv_r/g/b, alpha
  mv_a. Drawn onto the previous-frame texture BEFORE warp (stage 2).
- Edge guard: skip points outside (0.0001, 0.9999).

## 9. Borders

Source: `Border.cpp` [fetched]. Outer border: square ring from radius 1.0
to 1.0-ob_size, color ob_r/g/b/a. Inner: from 1.0-ob_size to
1.0-ob_size-ib_size, color ib_r/g/b/a. Standard alpha blend, drawn after
waves onto the canvas (8 triangles). Skipped when alpha ≤ 0.001.

## 10. Composite (no comp shader: legacy path)

Sources: `FinalComposite.cpp`, `VideoEcho.cpp`, `Filters.cpp` [fetched].

- If the preset has a comp shader (MilkDrop 2), it runs on a composite
  mesh grid with per-vertex `hue_shader` colors:
  `shade[corner][ch] = 0.6 + 0.3*sin(time*30*rand_factor + offset)`
  bilinearly blended [summarized — verify constants at implementation].
- Legacy path (MilkDrop 1-style presets): VideoEcho two-pass draw —
  pass 0 samples canvas at zoom 1, pass 1 at echo_zoom with UV
  `0.5 ± 0.5/zoom`, orientation flips U when orient odd, V when
  orient ≥ 2 (mod 4); alpha mix `1-echo_alpha` / `echo_alpha`.
- Gamma: mesh redrawn `int(gammaAdj)` extra times (additive doubling),
  fractional gamma on the last redraw.
- Filters after echo, each a full-screen quad with blend-mode arithmetic
  [fetched verbatim]:
  - brighten: (1-dst,0) then (0,dst) then (1-dst,0) — sqrt-like brighten.
  - darken: (0, dst) — squares the color.
  - solarize: (0, 1-dst) then (dst, 1) additive combination.
  - invert: (1-dst, 0).

## 11. Warp/comp shaders (MilkDrop 2 presets) — full resource contract

Source: `PresetShaderHeaderGlsl330.inc` [fetched verbatim in
`docs/evidence/projectm/PresetShaderHeaderGlsl330.inc`]. Read every
character; this section catalogs the exact contract PHOSPHENE's
transpiler and executor must honor.

### 11A. Uniform bank layout (float4 vectors, projectM canonical)

| Uniform | Purpose | Aliases from `#define` |
|---|---|---|
| `rand_frame` | Random 4-vector, refreshed per frame | — |
| `rand_preset` | Random 4-vector, once per preset load | — |
| `_c0` | Aspect: `.xy` = multiplier for aspect-aware fullscreen paste, `.zw` = inverse | `aspect` = `_c0` |
| `_c1`, `_c2`, `_c3`, `_c4` | `_c2.x=time`, `_c2.y=fps`, `_c2.z=frame`, `_c2.w=progress`; `_c3.xyzw=bass/mid/treb/vol`; `_c4.xyzw=bass_att/mid_att/treb_att/vol_att`; `_c1` reserved | see `time`/`fps`/`frame`/`progress`/`bass`/`mid`/`treb`/`vol`/`_att` `#define`s |
| `_c5` | `.xy` = scale,bias for `GetBlur1`; `.zw` = scale,bias for `GetBlur2` | — |
| `_c6` | `.xy` = scale,bias for `GetBlur3`; `.zw` = blur1_min, blur1_max | `blur1_min = _c6.z`, `blur1_max = _c6.w` |
| `_c7` | `.xy ≈ (texsizeX, texsizeY)`; `.zw ≈ (1/texsizeX, 1/texsizeY)` | `texsize = _c7` |
| `_c8`, `_c9` | `0.5 + 0.5 * cos/sin(time * float4(~0.3, ~1.3, ~5, ~20))` | `roam_cos = _c8`, `roam_sin = _c9` |
| `_c10`, `_c11` | `0.5 + 0.5 * cos/sin(time * float4(~0.005, ~0.008, ~0.013, ~0.022))` | `slow_roam_cos = _c10`, `slow_roam_sin = _c11` |
| `_c12` | `.x = mip_x` (#across), `.y = mip_y` (#down), `.z = mip_avg`, `.w` unused | `mip_x`, `mip_y`, `mip_xy = _c12.xy`, `mip_avg = _c12.z` |
| `_c13` | `.xy` = blur2_min, blur2_max; `.zw` = blur3_min, blur3_max | `blur2_min`, `blur2_max`, `blur3_min`, `blur3_max` |
| `_qa..._qh` | 8 float4 banks holding q1..q32 in the natural layout | `q1 = _qa.x`, ..., `q32 = _qh.w` |
| `rot_s1..rot_s4` | 4 static float4x3 rotations, randomized once at preset load, minor translation < 1 | — |
| `rot_d1..rot_d4` | 4 slowly-changing dynamic rotations | — |
| `rot_f1..rot_f4` | 4 faster-changing rotations | — |
| `rot_vf1..rot_vf4` | 4 very-fast rotations | — |
| `rot_uf1..rot_uf4` | 4 ultra-fast rotations | — |
| `rot_rand1..rot_rand4` | 4 rotations regenerated every frame | — |

**Every one of the 24 4x3 rotation matrices is a projectM-owned uniform
uploaded from the Renderer's rotation-state accumulators. Presets read
them via the `#define`d aliases.** The transpiler must expose all 24 as
inputs, not synthesize any of them.

### 11B. Samplers and GetBlur macros

Sampler naming decodes a 3-char filter+wrap prefix (see
`TextureManager::ExtractTextureSettings` and the header's
`#define sampler_FC_main sampler_fc_main` etc.):

| Prefix | Filter | Wrap |
|---|---|---|
| `fw` / `wf` | linear | repeat |
| `fc` / `cf` | linear | clamp |
| `pw` / `wp` | point | repeat |
| `pc` / `cp` | point | clamp |

`sampler_main` = `sampler_fw_main` (linear + repeat) by default.
`sampler_blur1`, `sampler_blur2`, `sampler_blur3` sample the three
blur-cascade output textures. Macros:

```
#define GetMain(uv)  (tex2D(sampler_main,uv).xyz)
#define GetPixel(uv) (tex2D(sampler_main,uv).xyz)
#define GetBlur1(uv) (tex2D(sampler_blur1,uv).xyz*_c5.x + _c5.y)
#define GetBlur2(uv) (tex2D(sampler_blur2,uv).xyz*_c5.z + _c5.w)
#define GetBlur3(uv) (tex2D(sampler_blur3,uv).xyz*_c6.x + _c6.y)
#define lum(x)       (dot(x,float3(0.32,0.49,0.29)))
```

The GetBlurN macros multiply the sampled compressed value by
scale/bias — the blur cascade stores range-compressed data (per §12)
and the shader must decompress on read.

### 11C. Noise textures (MilkDrop-owned, fixed content)

Source: `MilkdropNoise.cpp` [fetched earlier]. The Renderer owns six
noise textures; the transpiler must expose them as inputs, not
synthesize them:

| Name | Size | Zoom |
|---|---|---|
| `sampler_noise_lq` | 256² | 1 |
| `sampler_noise_lq_lite` | 32² | 1 |
| `sampler_noise_mq` | 256² | 4 |
| `sampler_noise_hq` | 256² | 8 |
| `sampler_noisevol_lq` | 32³ | 1 |
| `sampler_noisevol_hq` | 32³ | 4 |

Content: uniform random bytes (range 256 at zoom 1, 216 for zoomed
variants) with cubic interpolation between lattice points. These are
static — generated once per Renderer construction, never mutated.

### 11D. Extra images

`sampler_pw_image_N` and friends bind the Renderer's image-slot content
(`imageTextures.js`). Loaded via `renderer.loadExtraImages(imageData)`;
the transpiler must resolve `sampler_pw_image_N` to whatever the
Renderer has bound in slot N.

### 11E. Warp vs. comp entry differences

- Warp shader input: `uv` (post-warp), `uv_orig` (pre-warp), `rad`,
  `ang` in the current-fragment space.
- Comp shader input: `uv`, `rad`, `ang`, `hue_shader` (a per-fragment
  vec3 delivered by the composite mesh's per-vertex color).
- Warp output writes into the CANVAS target (the next warped frame);
  comp output writes into the COMPOSITE target that reaches the screen.

### 11F. Rewrite-target semantics

Presets can freely mutate any of the shader-visible uniforms in HLSL
because projectM uses `#define` aliases, not read-only bindings. The
transpiler must:

1. Emit every uniform as a WGSL module-scope `<private>` var so writes
   compile.
2. Initialize each private from its Renderer-supplied value at the top
   of the entry function.
3. Preserve the projectM output convention: warp presets read `ret`
   after the preset body runs and write it to the color attachment
   (with optional min/max against `sampler_main`); comp presets do the
   same without the sampler max.

## 12. Blur cascade

Source: `BlurTexture.cpp` [fetched, weights verbatim].

- Pyramid: blur0 = 1/2 main, blur1 = 1/4 (user "blur1"), blur2 = 1/8,
  blur3 = 1/8 (user "blur2"), blur4 = 1/16, blur5 = 1/16 (user "blur3").
- Base weights `{4.0, 3.8, 3.5, 2.9, 1.9, 1.2, 0.7, 0.3}`
  (fixtures/blurtexture.cpp:124, fetched copy).
- Horizontal pass: w1..w4 = pairwise sums; d1..d4 = 0/2/4/6 + 2*odd/pair;
  w_div = 0.5/(Σw). Vertical pass: w1 = first four, w2 = last four,
  d1 = 2*(w[2]+w[3])/w1, d2 = 2 + 2*(w[6]+w[7])/w2, w_div = 1/(2Σ).
- Passes per level: blur1 = 2, blur2 = 4, blur3 = 6 (each level = one
  H + one V pass on progressively smaller targets).
- Scale/bias packing per level from blurN_min/max:
  `scale = 1/(max-min); bias = -min*scale`, levels 1..2 chained relative
  to the previous level's range.
- Edge darken (first vertical pass only): `_c6 = {w_div, 1-edgeDarken,
  edgeDarken, 5.0}`.
- Blur shaders themselves: `Blur1FragmentShaderGlsl330.frag` (8-tap H)
  and `Blur2...` (4-tap V + edge darken) [fetched verbatim earlier].

## 13. Coordinate conventions

- Preset equation space: (0,0) top-left for per-vertex x/y reads
  (Geiss §3c); wave/shape y outputs are bottom-origin (Geiss §3c —
  the documented inconsistency).
- rad ≈ 0 center, 1 at corner of narrow axis; ang 0..2π, 0 = right,
  π/2 = up (Geiss §3c).
- aspect: narrow axis 1.0, wide axis < 1.0 (`RenderContext.hpp`).
- projectM renders GL Y-up and compensates with an explicit y-flip
  (pipeline stage 3), so preset-visible conventions match original
  MilkDrop (D3D).

## 14. Preset variable inventory (equation-visible)

Source: Geiss §3c table [fetched earlier]. Read-only: time, fps, frame,
progress, bass, mid, treb, bass_att, mid_att, treb_att, meshx, meshy,
pixelsx, pixelsy, aspectx, aspecty, blurN_min/max. Read-write: zoom,
zoomexp, rot, warp, cx, cy, dx, dy, sx, sy, wave_mode, wave_x, wave_y,
wave_r/g/b/a, wave_mystery, wave_usedots, wave_thick, wave_additive,
wave_brighten, ob_size, ob_r/g/b/a, ib_size, ib_r/g/b/a, mv_r/g/b/a,
mv_x (0..64), mv_y (0..48), mv_l (0..5), mv_dx, mv_dy, decay, gamma,
echo_zoom, echo_alpha, echo_orient, darken_center, wrap, invert,
brighten, darken, solarize, monitor, q1..q32.

## 15. Current PHOSPHENE HLSL-transpiler fabrications (catalog for
##     source-correct replacement)

Source-cited catalog of every fabricated value in
`src/transpile/hlsl.ts` at HEAD `be688a9`, with the source-correct
behavior identified per §0-§14. Each row is a work item; none of these
values may reach the executor while their listed source is unmet. The
transpiler must accept these values as inputs from the Renderer/graph
executor and stop synthesizing them.

| Line | Fabricated | Should come from | Correct source |
|---|---|---|---|
| 251-252 | `q1..q8` from `mdQ1()..mdQ8()`, `q9..q32 = 0` | Runner's post-per-frame `mdVSFrame.q1..q32` (§2) | `equations_presetEquationRunner.js:105` (`mdVSQAfterFrame`) |
| 281-282 | `frame = c.rawT * 60.0`, `fps = 60.0` | Renderer's `this.frameNum` and `this.fps` (§0, §1B step 8) | `rendering_renderer.js:65-67, 353-377` |
| 285 | `rand_preset = vec4f(0.42, 0.71, 0.13, 0.88)` | Runner's `mdVS.rand_preset` (Float32Array of 4 seeded draws) | `equations_presetEquationRunner.js:89` |
| 286 | `rand_frame = fract(vec4f(sin(rawT*91.7), ...))` | Renderer's per-frame regenerated `rand_frame` (4 fresh Math.random()) | `PresetShaderHeaderGlsl330.inc` line 5 (`rand_frame updated each frame`) |
| 287-290 | `roam_cos`, `roam_sin`, `slow_roam_cos`, `slow_roam_sin` computed inline from `rawT` | Renderer-uploaded `_c8`, `_c9`, `_c10`, `_c11` uniform values computed from `this.time` (§11A) | `PresetShaderHeaderGlsl330.inc` lines 17-23 |
| 293-295 | `blur1_min = 0, blur1_max = 1` (baseline defaults) | Preset-supplied `blur1_min` / `blur1_max` from `mdVSFrame` per §12; presets can assign them in `per_frame` code | Header `#define blur1_min _c6.z`, `blur1_max _c6.w` |
| 297-298 | `mip_x = 0.5, mip_y = 0.5, mip_xy = vec2f(0.5), mip_avg = 0.5` | Renderer's mip statistics from the previous-frame main texture (see `_c12` uniform per §11A) | Requires prev-frame texture sampling at Renderer level |
| 145-169 | `mdgetblur1/2/3` = 5-tap Gaussian over main framebuffer | Sample from the ACTUAL blur cascade texture (blur1/2/3 output) with the `_c5.xy`/`_c5.zw`/`_c6.xy` scale/bias decompression per §12 | `rendering_shaders_blur_blur.js`; blurN target textures owned by Renderer |
| 172-177 | `mdtex_blur1/2/3` fallback to `sampleFn` (main texture) | Sample from blur target texture | Same |
| 179-206 | Noise textures synthesized via `hash()` function | Renderer-owned MilkdropNoise textures per §11C | `MilkdropNoise.cpp` fixed-content textures |
| 225 | Warp shader output: `max(ret, srcTex(c.uv))` | Warp shader writes `ret` verbatim to the color target; the `max` against sampler_main is NOT in projectM's warp fragment (`projectm-warp-fragment.frag`) | Verify at `docs/evidence/projectm/projectm-warp-fragment.frag` |
| — | 24 rotation matrices `rot_s1..rot_rand4` | Renderer-owned rotation accumulators (16 dynamic + 4 rand-per-frame + 4 static) | Not currently exposed by the transpiler at all |

The correct fix pattern for all rows: extend `MilkFrameData` (the
per-frame input the pipeline hands the runner) with a
`shaderContract: MilkShaderContract` field carrying the full uniform
set the Renderer would own. The transpiler emits reads from that
contract; the pipeline populates it from the runner + session state.
Until each row's source is available, its refusal remains at pipeline
load time — approximation is not a valid substitute.
