# PHOSPHENE STUDIO

WebGPU scene-authoring environment for audio-reactive visualization.
Scenes are portable JSON carrying WGSL layer shaders (background × foreground × post
with real ping-pong feedback), `//@param` annotation-driven sliders, and a modulation
matrix routing audio features into any parameter.

## Requirements

- A WebGPU-capable browser (Chrome or Edge on Windows work out of the box).
- Node.js 20+ for development.

## Quick start (Windows)

```
cd phosphene-studio
npm install
npm run dev
```

Open the printed localhost URL in Chrome or Edge.

`dist\index.html` is the production build — a single self-contained file you can
double-click, copy to another machine, or host anywhere. The single file is a
**build target** of this project, not its architecture.

## Commands

| command | what |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run typecheck` | strict TypeScript, no emit |
| `npm test` | unit tests + static WGSL validation of every shipped shader |
| `npm run build` | typecheck, bundle, inline into `dist\index.html` |

## Architecture

```
src/
  core/    scene format (v3), //@param parser, uniform packing, mod matrix
  gpu/     WGSL assembly (Ctx contract, noise/palette lib), WebGPU renderer
           (device-loss recovery, additive FG blend, feedback ping-pong,
            line-mapped diagnostics via getCompilationInfo)
  audio/   sources (demo synth / mic / decoded file), analysis
           (bands, flux beat detection, median BPM, 64-bin spectrum + waveform)
  shaders/ built-in WGSL library and templates
  ai/      generation with compile-error repair loop (Anthropic API)
  ui/      CodeMirror 6 editor with WGSL highlighting + lint gutter
tests/     param parser, packing layout, mod matrix, WGSL parse of all shaders
```

Authoring contract: a stage body implements `fn render(c : Ctx) -> vec3f`.
Declare sliders with `//@param name min max default` and read them as `name()`.
POST stages additionally get `srcTex(uv)`, `prevTex(uv)`, and `c.fb`.

## Known limits

- Browser platform: no system-audio loopback (mic/file/demo only) and no OS
  screensaver hook. Those two features are the native-shell milestone
  (Tauri wrapper reusing this exact codebase and scene format).
- WGSL validation in CI is syntactic (parser), not a full GPU compile; the
  editor performs real compilation with device diagnostics at runtime.
