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

- **Plane9** (`.p9c`): FROM PLANE9… parses the container, ports the GLSL,
  carries `credit`/`license` through (stock corpus is CC BY-NC-SA).
- **MilkDrop** (`.milk`): FROM MILKDROP… maps preset base values + per-frame
  equations onto `expr` routes and the `warpUV`/`waveLine` render templates.
  MilkDrop 2 HLSL shader blocks are detected and reported, not executed.

## Future capability blocks

Reserved for parity items the capability matrix marks 🟡: named render passes
beyond bg/fg/post (arbitrary render-to-texture graphs), a separable bloom
pass, instance buffers with per-instance expressions, and text rendering.
Each will be introduced as an optional field with these semantics: absent
field = current behavior, so every v3 scene remains valid.
