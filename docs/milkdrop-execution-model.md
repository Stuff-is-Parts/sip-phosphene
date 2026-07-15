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

## 11. Warp/comp shaders (MilkDrop 2 presets)

Source: `PresetShaderHeaderGlsl330.inc` [fetched verbatim, full text in
session record; re-fetch at implementation]. Key contract:

- `GetMain(uv)`/`GetPixel(uv)` = `tex2D(sampler_main, uv).xyz`.
- `GetBlur1(uv)` = `tex2D(sampler_blur1, uv).xyz * _c5.x + _c5.y`;
  Blur2 uses `_c5.z/_c5.w`; Blur3 uses `_c6.x/_c6.y`.
- `lum(x) = dot(x, float3(0.32, 0.49, 0.29))`.
- Samplers: `sampler_{fw|fc|pw|pc}_main` (filter linear|point × wrap
  repeat|clamp, decoded from the 2-char prefix), `sampler_main` =
  fw default; blur1/2/3; noise_lq (256², zoom 1), noise_lq_lite (32²),
  noise_mq (256², zoom 4), noise_hq (256², zoom 8), noisevol_lq (32³),
  noisevol_hq (32³, zoom 4) — sizes/zoom from `MilkdropNoise.cpp`
  [fetched]. Noise = uniform random bytes (range 256 at zoom 1, 216
  zoomed) cubically interpolated between lattice points.
- Uniforms: time, fps, frame, progress, bass/mid/treb/vol + _att,
  q1..q32 (as _qa.._qh), aspect (xy mult, zw inverse), texsize
  (w,h,1/w,1/h), rand_preset (4 per-preset randoms), rand_frame,
  roam_cos/sin, slow_roam_cos/sin, mip_x/y/xy/avg, blurN_min/max,
  20 float4x3 rotation matrices (rot_s/d/f/vf/uf/rand 1-4).
- Warp shader input: uv (warped), uv_orig, rad, ang; comp shader input:
  uv, rad, ang, hue_shader.

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
