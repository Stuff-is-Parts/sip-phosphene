# projectM Interpretation Notes

Companion to `docs/evidence/projectm/` (retained verbatim at pinned SHA
`2f244141320f6b97b09bf99964cc72a4efdfcfd3`). This file collects PHOSPHENE's
interpretation of projectM behavior — deviation notes, mapping decisions,
and open questions — so the retained source in `evidence/projectm/`
stays a clean citation surface.

## Frame lifecycle (MilkdropPreset.cpp::RenderFrame)

The retained source names this exact order:

1. Store audio + render context; resize framebuffer if the viewport
   changed (setting `isFirstFrame` on resize).
2. Assign `state.mainTexture` to the previous framebuffer's color-0
   attachment as the equation code's read reference.
3. `PerFrameUpdate` — evaluate per-frame equations, load Q variables,
   clamp `gamma` (0..8) and `echo_zoom` (0.001..1000).
4. Set viewport to the full framebuffer size.
5. Bind the previous framebuffer.
6. If not `isFirstFrame`, draw motion vectors onto the previous frame's
   color-0 attachment via `motionVectors.Draw`.
7. `flipTexture.Draw` copies the previous framebuffer's color-0 into a
   y-flipped intermediate; reassign `mainTexture` to the flipped result.
8. Bind the current framebuffer; attach motion-vector UV map to color
   slot 1 so the warp mesh writes both color and UV outputs.
9. `perPixelMesh.Draw` warps the flipped previous frame into the current
   framebuffer's color-0.
10. Remove UV attachment from slot 1.
11. `blurTexture.Update` runs the H/V pass chain over six sequential
    targets, sourcing from what the retained source names as the
    warped image via `GetColorAttachmentTexture(previousFrameBuffer, 0)`.
12. Sprites — custom shapes, custom waves, default waveform draw onto
    the current framebuffer's color-0.
13. `darkenCenter.Draw()` fires when `darken_center > 0`.
14. `border.Draw(perFrameContext)` draws inner + outer borders.
15. `flipTexture.Draw` copies the current framebuffer's color-0 into a
    fresh y-flipped intermediate; `mainTexture` reassigns.
16. Bind read=current, draw=previous, run `finalComposite.Draw`. This
    writes the composited image into the previous framebuffer.
17. If `finalComposite` has no composite shader, a legacy y-flip runs on
    the previous framebuffer's color-0.
18. `std::swap(currentFrameBuffer, previousFrameBuffer)` — the swap
    fires AFTER composite.
19. Clear `isFirstFrame`.

`OutputTexture()` returns the current framebuffer's color-0 AFTER the
swap, which is the composited image from step 16.

## PHOSPHENE executor gap

The PHOSPHENE executor at `src/gpu/milk-pipeline.ts` does NOT yet
implement this order. Current behavior queues warp into the same render
pass as sprites and motion vectors, and the framebuffer swap sits inside
the CPU `milk-warp` dispatch case rather than after composite. Aligning
the executor with the retained order is queued as a coherent-window
blocker.

## Shader invocation contract (MilkdropShader.cpp::LoadVariables)

The retained source names the order of uniform uploads at each
invocation:

1. `vertex_transformation` = `orthogonalProjection` matrix.
2. `rand_frame` = four `floatRand()` draws.
3. `rand_preset` = the four persistent values chosen at construction.
4. `_c0` through `_c13` scalar uniform banks.
5. `tempMatrices[0..19]` built from persistent state + `floatTime`
   (no new random draws).
6. `tempMatrices[20..23]` built from six fresh `floatRand()` draws each
   (angle X, angle Y, angle Z, translation X, translation Y, translation
   Z) = 24 draws total.
7. Upload matrices as `SetUniformMat3x4` — 3 columns × 4 rows = 12
   floats per matrix.
8. `_qa` through `_qh` q-variable banks.
9. Texture and sampler bindings for main, blur, and preset-referenced
   samplers.

## PHOSPHENE representation of rotation uploads

`SetUniformMat3x4("rot_s1", tempMatrices[0])` calls
`glUniformMatrix3x4fv(loc, 1, GL_FALSE, glm::value_ptr(mat4))`. GLM's
`glm::mat4` stores 16 floats in column-major order. `glUniformMatrix3x4fv`
reads 12 floats for a 3-column × 4-row matrix, taking the first 3 columns
of the 4×4 in column-major order. Column 3 (translation) is discarded.

PHOSPHENE represents each uploaded matrix as a `Float32Array(12)`. Bytes
0-15 hold column 0 of the projectM 4×4 (four floats in column-major
order), bytes 16-31 hold column 1, and bytes 32-47 hold column 2. The
representation is derived by taking the first 12 floats of the 16-float
column-major glm::mat4.

Verification test: apply a pure X-axis rotation of π/4 to the vector
(0, 1, 0). The 4×4 rotation matrix in column-major memory is
`[1,0,0,0, 0,cos(π/4),sin(π/4),0, 0,-sin(π/4),cos(π/4),0, 0,0,0,1]`.
Take the first 12 floats. Applying the corresponding transformation to
(0, 1, 0) yields (0, cos(π/4), sin(π/4)) — that is `(0, √2/2, √2/2)`.

## PHOSPHENE deviation notes

- **rand_preset per shader vs. shared stream** — projectM's `floatRand()`
  is a global `rand()` wrapper; construction of the two `MilkdropShader`
  objects (warp + comp) shares the process-wide RNG stream. PHOSPHENE
  routes both construction calls through one `MilkSession.shaderRng`
  instance so the stream is preserved across warp+comp construction.
- **Noise generator RNG** — projectM's `MilkdropNoise` seeds a fresh
  `std::default_random_engine` from `system_clock` at each `generate2D`
  or `generate3D` call. PHOSPHENE uses a `MilkSession.noiseRng` that
  is independent from the shader stream, matching the source's
  intent that noise draws do not shift shader draws.
- **Preset playhead progress** — projectM uploads
  `renderContext.progress` in `_c2.w`. PHOSPHENE has no upstream source
  for this value yet; a shader that reads `progress` must refuse at
  load, and the contract exposes progress as `null` rather than
  fabricating a zero.
- **Blending** — projectM's `Renderer` runs the previous preset's
  equation code each frame during blend and mixes frame state via
  `mixFrameEquations`. PHOSPHENE does not run any previous-preset
  equation stream. Any `blendTime > 0` at `MilkPipeline.load` throws
  with "blending not implemented" until the mixed-frame execution
  path lands.

## Open questions

- The exact `SetUniformMat3x4` byte order for HLSL preset code that
  accesses these matrices as `float4x3` needs one end-to-end trace
  through the HLSL parser output before the HLSL translator rewrite
  begins. The PHOSPHENE representation above assumes GLSL `mat3x4`
  column-major memory layout matches the OpenGL upload; the HLSL
  transpose behavior may require a per-column swap.
- Noise texture byte layout for WebGPU `rgba8unorm` versus projectM's
  desktop-GL BGRA format — see the noise-packing note in
  `src/gpu/milk-noise.ts` for the current mapping.
