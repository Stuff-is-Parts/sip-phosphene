# GPU Render-State Conformance — audit vs MilkDrop source

Trigger: the sampler address-mode bug (ours clamped where the source wraps)
escaped every prior audit. Root cause: the GPU state lived in page-inline
plumbing written in the pre-discipline demo era, and every audit since
targeted engine modules — the render-state layer was never swept against the
source's SetRenderState/SetSamplerState blocks, even though PHOSPHENE-GOAL.md
names "blend, depth, raster, and other render state" in the exactness
standard. Structural prevention: composite/warp GPU code is centralized in
src/render-wgsl.mjs (pages carry only packing), and the standing practice is
now: **every SetRenderState/SetSamplerState/SetTextureStageState call in a
transcribed pass's source region gets a row in this table before the pass
ships.** Source: MilkDrop2 @ Doormatty/MilkDrop2 d0670a3.

## Warp-blit pass (milkdropfs.cpp:970-1010 state block; :1877-1918 math)

| State | Source | Ours | Verdict |
|---|---|---|---|
| Sampler address U/V | WRAP, hardcoded (:976-981; per-preset choice commented out) | was clamp-to-edge (WebGPU default) | **FIXED** — repeat in all pages |
| Filtering | bilinear, stages 0/1 (:995 comment) | linear/linear | match |
| Cull / depth / blend | CULL_NONE, ZENABLE off, ALPHABLEND off (:985-991) | no cull, no depth attachment, no blend | match |
| Aspect factors | texture-based: (texY>texX)? texX/texY : 1 (plugin.cpp:2027-2029) | 1.0 with square 1024² target | match — square texture yields exactly 1 in the source's own formula |
| rad | sqrt(x²·aX² + y²·aY²) (plugin.cpp:2281) | sqrt(x²+y²), aspect 1 | match (aspect=1) |
| Half-texel offset | 0.5/texSize (:1786-1787 region) | 0.5/textureDimensions | match |

## Composite pass (ShowToUser_NoShaders, milkdropfs.cpp:4050-4260)

| State | Source | Ours | Verdict |
|---|---|---|---|
| Screen mapping | quad scaled LARGER than screen — aspect CROP + 1+1/W overscan (:4089-4114) | was stretch via canvas-pixels ÷ TEXTURE dims (also misplaced for canvas ≠ 1024) | **FIXED** — compositeWGSL crop with per-frame xmult/ymult |
| gammaAdj | iterative additive redraws; net = min(1, color·gamma); DEFAULT 2.0 (state.cpp:541) | was absent (plain blit — half the source's brightness at defaults) | **FIXED** — saturating multiply, default materialized into .phos comp node |
| Video echo | second zoomed/flipped layer mixed by echo alpha (:4169-4200); defaults zoom 2, alpha 0, orient 0 (state.cpp:542-544) | was absent | **FIXED** — implemented in compositeWGSL; alpha 0 default = off, editable in studio |
| Hue shade (fShader) | animated per-vertex tint when fShader > 0; default 0 (state.cpp:552) | not implemented; shade=1 at default | match at default — row unlocks when content sets fShader |
| Blend states | ONE/ZERO first draw, ONE/ONE additive redraws (:4171-4247) | folded into the min() closed form (valid: non-negative adds with per-channel clamp are order-insensitive) | match by equivalence, stated |

## Not yet audited (no such pass exists in the engine yet)

Blur pyramid, motion vectors, waves, shapes, sprites, preset-blend: each
carries its own source state block; its table section gets written in the same
window that transcribes the pass — that is what the standing practice above
exists to force.
