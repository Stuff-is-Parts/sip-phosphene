# PHOSPHENE scene format (v3)

A scene is one portable JSON file. Everything a visualization needs — shader
code, parameters, modulation, attribution — travels in it. This document is
the format's standard; `src/core/types.ts` is its implementation.

## Shape

```jsonc
{
  "version": 3,
  "name": "DEEP FIELD",              // unique; the player dedupes by name
  "layers": {
    "bg":   { "code": "…WGSL…" },    // fn render(c: Ctx) -> vec3f
    "fg":   { "code": "…WGSL…" },    // additive over bg (black = transparent)
    "post": { "code": "…WGSL…" }     // gets srcTex()/prevTex() + c.fb feedback
  },
  "params":  { "hue": 0, "speed": 1, "int": 1, "fb": 0.3 },
  "custom":  { "radius": 0.26 },     // values for //@param declarations
  "mods":    [ /* ModRoute[] — see Modulation */ ],
  "thumb":   null,                    // JPEG data-URL preview or null
  "assets":  { "image": null },       // optional embedded image, img(uv)
  "credit":  "…",                     // attribution for ported/derived scenes
  "license": "…"                      // license of THIS file when it differs
}
```

## Shader contract

Each layer body implements `fn render(c : Ctx) -> vec3f` in WGSL.
`Ctx` carries uv, aspect-corrected `q`, `t` (speed-scaled), audio features
(bass/mid/treble/beat/energy), and hue/speed/intensity/fb. The stdlib provides
`spec(i)`/`wav(i)` (64-bin spectrum / waveform), `pal`/`hue3`, `hash`/`noise`/
`fbm`/`ridge`, `img(uv)`, SDF 3D helpers (`sdSphere`, `sdBox`, `sdTorus`,
`sdCylinder`, `smin`, `opRep`, `rot2`, `camRay`), MilkDrop-style `warpUV`, and
`waveLine`. POST additionally gets `srcTex(uv)` and `prevTex(uv)`.

`//@param name min max default` declares a slider and a `name()` accessor.
One 16-slot buffer serves the whole scene: stages that share params declare
the identical block in the identical order.

## Modulation

A `ModRoute` drives any param (built-in or //@param) from a source:

```jsonc
{ "target": "radius", "source": "bass", "gain": 0.4, "base": 0.0 }
```

Sources: `bass mid treble beat energy bpmPhase specLow specHigh lfoSlow
lfoFast beatRamp beatRand midi1..4 expr`.

`expr` routes run a per-frame equation program (MilkDrop's EEL dialect —
statements `name = expr;`, functions `sin cos tan atan2 pow abs min max floor
frac int sign sqrt exp log rand sigmoid above below equal band bor bnot if
sqr`, persistent variables across frames):

```jsonc
{
  "target": "mdZoom", "source": "expr", "gain": 1, "base": 0,
  "expr": "zoom = 1.01; zoom = zoom + 0.02*sin(time*0.8) + q1*0.05;",
  "readVar": "zoom",                  // env var read as the route value
  "init": "q1 = 0.5;"                 // runs once before the first frame
}
```

The environment provides `time frame fps bass mid treb bass_att mid_att
treb_att beat energy bpm` each frame; everything else (q-vars, accumulators)
persists between frames. Routes sharing one program run it once per frame.

## Interop

Faithful conversion of Plane9 scenes and MilkDrop presets is governed by
[`COMPATIBILITY-GOAL.md`](../COMPATIBILITY-GOAL.md); no current import path
meets that standard.

- **Plane9** (`.p9c`): FROM PLANE9… extracts the first Shader node's fragment
  GLSL onto a fullscreen stage and carries `credit`/`license` through (stock
  corpus is CC BY-NC-SA). The scene's node graph, connections, vertex
  shaders, meshes, cameras, and additional shaders are not translated — the
  result approximates neither Plane9's execution model nor its rendering.
- **MilkDrop** (`.milk`): FROM MILKDROP… maps a subset of preset base values
  and the per-frame/per-pixel equations onto `expr` routes, a warp mesh, and
  generic `warpUV`/`waveLine`/`sdNgon` render templates; HLSL shader blocks
  are transpiled to WGSL where the compiler accepts them. Custom-wave
  per-point equations, waves/shapes beyond two, most preset variables, the
  blur cascade, noise textures, and MilkDrop's state semantics are not
  reproduced — the result does not reproduce MilkDrop's rendering pipeline.

## Capability blocks (all optional; absent field = base behavior)

- **`passes`** — `[{ id, code }]`: extra render passes run in order after
  POST. Each is a post-contract body: `srcTex` = previous chain output,
  `prevTex` = this pass's own last frame (per-pass feedback).
- **`mesh`** — `{ primitive, count, code }`: rasterized depth-tested layer
  between BG and FG. `code` defines `instancePos(idx, t) -> vec4f` (xyz +
  scale) and `meshColor(idx, n, wp, t) -> vec3f`. Primitives: cube, sphere,
  plane, cylinder, torus; up to 1024 instances.
- **`particles`** — `{ count, code }`: stateful CPU particles (up to 4096)
  drawn as additive billboards. `code` is a per-particle EEL program run
  each frame with x/y/z, vx/vy/vz, size, idx, count, time, dt and audio
  vars in scope; velocity integrates after it runs.
- **`text`** — `{ value, size? }`: rendered into the scene image slot at
  load; sample with `img(uv)`.
- **`bloom`** — number 0..1: built-in bright/blur/composite pass.
- **`warpMesh`** — per-vertex warp program (see Interop, MilkDrop).

The built-in scene `PRISM RIG` (`scenes/prism-rig.phos.json`) exercises all
of these at once and doubles as the GPU smoke test's coverage scene.
