<p align="center">
  <img src="assets/banner.svg" alt="PHOSPHENE — the light you see with your eyes closed" width="900">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/WebGPU-native-7df2c8?style=flat-square&labelColor=0f0e18">
  <img src="https://img.shields.io/badge/shaders-WGSL-c87df2?style=flat-square&labelColor=0f0e18">
  <img src="https://img.shields.io/badge/TypeScript-strict-7dbdf2?style=flat-square&labelColor=0f0e18">
  <img src="https://img.shields.io/badge/tests-36%20passing-7df2c8?style=flat-square&labelColor=0f0e18">
  <img src="https://img.shields.io/badge/dist-one%20file-f2d97d?style=flat-square&labelColor=0f0e18">
</p>

<p align="center">
  <a href="https://stuff-is-parts.github.io/sip-phosphene/"><b>▶ &nbsp;RUN PHOSPHENE</b></a>
  &nbsp;·&nbsp;
  <a href="https://stuff-is-parts.github.io/sip-phosphene/studio.html">open the Studio</a>
</p>

<p align="center"><sub>Nothing to install — it runs in Chrome or Edge. Click START and watch it react.</sub></p>

```
██████╗ ██╗  ██╗ ██████╗ ███████╗██████╗ ██╗  ██╗███████╗███╗   ██╗███████╗
██╔══██╗██║  ██║██╔═══██╗██╔════╝██╔══██╗██║  ██║██╔════╝████╗  ██║██╔════╝
██████╔╝███████║██║   ██║███████╗██████╔╝███████║█████╗  ██╔██╗ ██║█████╗
██╔═══╝ ██╔══██║██║   ██║╚════██║██╔═══╝ ██╔══██║██╔══╝  ██║╚██╗██║██╔══╝
██║     ██║  ██║╚██████╔╝███████║██║     ██║  ██║███████╗██║ ╚████║███████╗
╚═╝     ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝     ╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝╚══════╝
```

**PHOSPHENE** is a WebGPU authoring environment for audio-reactive visualization —
a modern successor to the Plane9 / MilkDrop lineage. Scenes are layered
(background × foreground × post with real feedback), written in WGSL, driven by
live audio analysis, and saved as portable JSON.

A *phosphene* is the light you see with your eyes closed — light your visual
system synthesizes with no image coming in. That is what this does with sound.

<p align="center">
  <img src="assets/hero.png" alt="DEEP FIELD scene" width="900"><br>
  <sub>DEEP FIELD — the built-in nebula + spectrum-ring scene, rendered offline with the same fbm/palette math the WGSL runs live.</sub>
</p>

## Phosphene origin story

The 3D music-visualizer/screensaver niche froze around 2016: Plane9 stopped
shipping, MilkDrop's heirs maintain engines rather than products, and nothing
modern took their place. PHOSPHENE restarts the lineage on current standards:
WGSL instead of a dead proprietary shader format, scenes as open JSON instead
of an opaque database, real compiler diagnostics instead of guesswork, and AI
generation built in — because content volume is no longer the barrier it was.

## The guts

<p align="center">
  <img src="assets/pipeline.svg" alt="render pipeline" width="900">
</p>

Every frame: audio analysis (bands, flux beat detection, median BPM, 64-bin
log spectrum + waveform) feeds a **modulation matrix** that routes any feature
into any parameter — then three WGSL stages render through ping-pong feedback.
Layer combinations multiply: a handful of stages per slot yields hundreds of
distinct scenes.

## Visualization authoring

A stage is one function:

```wgsl
//@param radius 0.1 0.45 0.26
fn render(c : Ctx) -> vec3f {
  let v = spec(i32((atan2(c.q.y, c.q.x) / 6.2831 + 0.5) * 64.0));
  let d = abs(length(c.q) - radius() - v * 0.2);
  return pal(0.45 + v * 0.5) * smoothstep(0.01, 0.0, d) * c.intensity;
}
```

- `Ctx` carries uv, aspect-corrected coords, time, bass/mid/treble/beat/energy.
- `//@param name min max default` materializes a slider — no UI code.
- POST stages get `srcTex(uv)`, `prevTex(uv)`, and `c.fb` for trails.
- Compile errors land in the editor gutter on the exact line, via
  `getCompilationInfo()` — real diagnostics from the real compiler.
- **✦ GENERATE WITH AI** turns a description into a stage; on compile failure
  the WGSL error is fed back for an automatic repair pass.
- GPU device loss (sleep/resume, driver reset, TDR) is a designed event:
  reinitialize, recompile, resume. The crash that killed the old tools is a
  log line here.

## Run it yourself

Despite the name, Node.js is a program that runs JavaScript (`.js`) script files —
not a `.js` script itself. Install it once: download the installer from
[nodejs.org](https://nodejs.org) and run it.

Once Node.js is installed, you can run `npm install` in any folder with a
`package.json` — the project's list of what it needs. That downloads those tools
into a `node_modules/` folder there.

To do that here: open this folder in File Explorer and type `cmd` in the address
bar (or right-click → "Open in Terminal"), then:

```
npm install
npm run dev
```

`npm run dev` starts a local server and prints a web address (like
`http://localhost:5173`) — open it in Chrome or Edge and the app is running.
Those two browsers specifically: PHOSPHENE draws with WebGPU, which Firefox and
Safari don't fully support yet.

| command | what |
|---|---|
| `npm run dev` | local dev server with live reload |
| `npm test` | 22 tests: parser, packing, mod matrix, static WGSL validation of every shipped shader |
| `npm run build` | typecheck + bundle the site (player + studio) → `dist/` |
| `npm run build:portable` | single self-contained `studio.html` you can copy anywhere and double-click |

## Layout

```
src/
  core/     scene format v3 · //@param parser · uniform packing · mod matrix
  gpu/      WGSL assembly (Ctx contract, noise/palette lib) · WebGPU renderer
  audio/    demo synth / mic / file · bands, beat, BPM, spectrum, waveform
  shaders/  built-in WGSL library and templates
  ai/       generation with compile-error repair loop
  ui/       CodeMirror 6 editor · WGSL highlighting · lint gutter
tests/
assets/
```

## Community scenes

Scenes are portable `.phos.json` files. Merged PRs to [`scenes/`](scenes/) appear
in the hosted player **without a rebuild** — the player fetches the manifest from
`main` at runtime. CI validates every submitted scene's WGSL before a human ever
looks at it. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

- [ ] Native shell (Tauri, same codebase): system-audio loopback, OS screensaver
- [ ] Multi-monitor output

---

<p align="center"><sub>a <b>Stuff is Parts</b> project</sub></p>
