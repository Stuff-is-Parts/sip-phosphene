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
| Internal texture size | window size (nTexSize -1 auto-exact default: plugin.cpp:949, 1851-1852), snapped to 16-pixel blocks (:1879-1880) | canvas size, 16-snapped, recreated on resize | **FIXED** — was a fixed square 1024², an untraced demo-era parameter that pushed the borders past non-square windows |
| Sampler address U/V | WRAP, hardcoded (:976-981; per-preset choice commented out) | was clamp-to-edge (WebGPU default) | **FIXED** — repeat in all pages |
| Filtering | bilinear, stages 0/1 (:995 comment) | linear/linear | match |
| Cull / depth / blend | CULL_NONE, ZENABLE off, ALPHABLEND off (:985-991) | no cull, no depth attachment, no blend | match |
| Aspect factors | aX=(texY>texX)?texX/texY:1, aY=(texX>texY)?texY/texX:1 from texture size (plugin.cpp:2027-2030) | computed live in Engine, applied in the feedback shader (apply :1881-1882, undo :1914-1916) and checked | **FIXED** — was constant 1, valid only inside the untraced square-texture frame |
| rad | sqrt(x²·aX² + y²·aY²) (plugin.cpp:2281) | transcribed with the live aspect factors | match |
| Half-texel offset | 0.5/texSize (:1786-1787 region) | 0.5/textureDimensions | match |
| Border alpha gate | each ring draws only if a > 0.001 (:3451) | was unconditional | **FIXED** — thresholds added |

## Composite pass (ShowToUser_NoShaders, milkdropfs.cpp:4050-4260)

| State | Source | Ours | Verdict |
|---|---|---|---|
| Screen mapping | quad scaled LARGER than screen — aspect CROP + 1+1/W overscan; aspect = W/(H·invAspectY) (:4089-4114, :4101-4103) | compositeWGSL crop with per-frame xmult/ymult from the transcribed formula; nets to pure overscan with window-matched targets | **FIXED** (twice: stretch → crop, then square-frame aspect → live invAspectY) |
| gammaAdj | iterative additive redraws; net = min(1, color·gamma); DEFAULT 2.0 (state.cpp:541) | was absent (plain blit — half the source's brightness at defaults) | **FIXED** — saturating multiply, default materialized into .phos comp node |
| Post-equation clamps | gamma clamped 0..8, echo_zoom clamped 0.001..1000 after per-frame equations (:677-679) | was absent — equations could push echo_zoom to 0 and divide by zero in the echo branch | **FIXED** — clamps in Engine.step, checked |
| Equation variable names | equations write the EEL names: decay, gamma, echo_zoom, echo_alpha, echo_orient, zoomexp (state.cpp:260-331 regvar list) | pool used .milk file keys, so gamma=4 in the editor altered nothing | **FIXED** — pool carries EEL names via a witnessed alias map, checked |
| Video echo | second zoomed/flipped layer mixed by echo alpha, applied only above the 0.001 threshold (:4168-4200); defaults zoom 2, alpha 0, orient 0 (state.cpp:542-544) | was absent | **FIXED** — implemented in compositeWGSL with the threshold |
| Hue shade (fShader) | animated per-vertex tint when fShader > 0; default 0 (state.cpp:552) | not implemented; shade=1 at default | match at default — row unlocks when content sets fShader |
| Blend states | ONE/ZERO first draw, ONE/ONE additive redraws (:4171-4247) | folded into the min() closed form (valid: non-negative adds with per-channel clamp are order-insensitive) | match by equivalence, stated |

## Not yet audited (no such pass exists in the engine yet)

Blur pyramid, motion vectors, waves, shapes, sprites, preset-blend: each
carries its own source state block; its table section gets written in the same
window that transcribes the pass — that is what the standing practice above
exists to force.

## Implementation parameters (the untraced-constant sweep)

Trigger: the square-1024² texture — a demo-era constant that survived every
audit because later conformance rows were judged INSIDE the frame it created
("match (aspect=1)" was true only given the untraced square). The class is the
**frame-inherited constant**: a pre-discipline implementation parameter that
downstream rows treat as a given instead of tracing to the source. Standing
rule: **every constant the implementation chooses either carries a source
citation at its site or appears in this table with its disposition.** Sweep of
pages, engine, and shaders:

| Parameter | Ours | Disposition |
|---|---|---|
| Internal texture size | canvas-matched, 16-snapped, rebuilt on resize | transcribed (plugin.cpp:1851-1852, :1879-1880); was untraced 1024² — FIXED this sweep |
| Texture format | rgba8unorm | maps the source default 8 bits/channel (m_nTexBitsPerCh=8 → X8R8G8B8, plugin.cpp fmt switch :1883-1890); numerical-path mapping the goal doc permits |
| Canvas pixel size | innerWidth·devicePixelRatio | native-substrate mapping of GetWidth() client pixels (pluginshell) |
| Headless viewport default | 1024² in the Engine constructor | implementation default for check runs with no page; every page overwrites it per frame via setViewport |
| Remaining numeric constants | oscillator constants, thresholds, ring sizes, seeds, grid dims, clamps | each carries its file:line citation at its site (swept this window: render-wgsl.mjs, timekeeper.mjs, analysis.mjs, eel.mjs, engine.mjs) |

## Perimeter tracing (the generalized practice)

This ledger is one dimension (GPU state) of a two-dimensional standing
practice. The dataflow dimension — every per-frame variable name classified
against the source's register list and asserted by check data — lives at
sources/VAR-CONTRACT.md with its living table in phosphene-engine/check.mjs.
The shared rule: a window that ships a transcribed element also ships the
perimeter trace of that element's identifiers and render state, with every
crossing implemented or refused.
