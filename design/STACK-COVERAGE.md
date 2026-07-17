# Stack Coverage Audit — does the web stack support every player/studio feature?

Method: each feature from PLAYER-STUDIO-FEATURES.md → the specific modern web
API that provides it → coverage verdict. Unlike the primitive audit, features
are capabilities, not diffable behaviors — so the "check" here is "does a robust
standard API exist," and the deliverable is a GAP LIST, not reference/check files.

Verdict tags:
- **[NATIVE]** first-class web API, robust, standard. No work beyond wiring.
- **[LIB]** solved by a mature library, not a raw browser API.
- **[TAURI]** browser can't do it; the Tauri native shell can, same codebase.
- **[GAP]** no clean standard path — flagged as real risk / scope decision.

═══════════════════════════════════════════════════════════════════
## PLAYER / VIEWER
═══════════════════════════════════════════════════════════════════

| Feature | Web API / mechanism | Verdict |
|---|---|---|
| Render the visuals | WebGPU | [NATIVE] |
| Next/prev/random scene | app state + keyboard events | [NATIVE] |
| Auto-advance timer | setTimeout/rAF | [NATIVE] |
| Auto-advance on silence | AnalyserNode RMS threshold | [NATIVE] |
| Hard cut / soft blend / transitions | render-graph (two subgraphs + mix node) | [NATIVE] (falls out of the graph) |
| Fullscreen | Fullscreen API (requestFullscreen) | [NATIVE] |
| Windowed mode | it's a web page | [NATIVE] |
| Audio: file playback | Web Audio decodeAudioData | [NATIVE] |
| Audio: microphone / line-in | getUserMedia(audio) | [NATIVE] |
| Audio: system "what you hear" | getDisplayMedia({audio}) — tab/system audio | [LIB]/[NATIVE] partial: browser captures TAB audio reliably, full system audio is [TAURI] |
| Audio: multi-channel (18ch→L/R) | Web Audio channel splitter | [NATIVE] |
| Beat detection | AnalyserNode + onset algorithm | [LIB] (algorithm, not an API) |
| Waveform / spectrum | AnalyserNode getFloatTimeDomainData / getFloatFrequencyData | [NATIVE] |
| FFT | AnalyserNode has FFT built in | [NATIVE] |
| Help overlay / scene name / FPS | DOM overlay | [NATIVE] |
| Playlist | app state + IndexedDB | [NATIVE] |
| Rating presets | app state + storage | [NATIVE] |
| Lock scene | app state flag | [NATIVE] |
| HDR render target | WebGPU rgba16float targets; **display** HDR = [GAP] (canvas HDR is nascent) | [GAP] compositing yes, true HDR *output* limited |
| Video recording | MediaRecorder (canvas.captureStream → WebM) | [NATIVE] |
| Screensaver (.scr) | — | [TAURI] |
| Multi-monitor | Window Management API (getScreenDetails) is [GAP]-ish in-browser; reliable = [TAURI] | [TAURI] |
| Desktop mode (behind icons) | — | [TAURI] |
| Always-on-top | — | [TAURI] |
| VR (Oculus/OpenVR/Vive) | WebXR | [LIB] — WebXR is native but a large surface; scope decision |

═══════════════════════════════════════════════════════════════════
## STUDIO / EDITOR
═══════════════════════════════════════════════════════════════════

| Feature | Web API / mechanism | Verdict |
|---|---|---|
| Node-graph editor | SVG/Canvas + a graph-UI lib (Rete/litegraph/custom) | [LIB] |
| Insert node on connection, icons, pan/zoom | same graph lib | [LIB] |
| Shader editor (search/replace, intellisense, undo) | **CodeMirror 6** or **Monaco** | [LIB] — Monaco is VS Code's editor; intellisense-grade |
| WGSL live diagnostics | naga (wasm) or device.createShaderModule getCompilationInfo | [NATIVE] real compiler errors |
| Expression editor | CodeMirror/Monaco + custom lint | [LIB] |
| Unlimited undo/redo | editor lib built-in + command-stack for graph | [NATIVE]/[LIB] |
| Live edit → running visual | recompile pipeline on IR change (debounced) | [NATIVE] |
| Camera control (WASDEC) | pointer/keyboard events | [NATIVE] |
| Color picker on ports | <input type=color> or a picker lib | [NATIVE]/[LIB] |
| Texture picker dropdown | DOM + resource list | [NATIVE] |
| Templates | bundled IR files | [NATIVE] |
| Dirty indicator / close-confirm | app state + beforeunload | [NATIVE] |
| Save / load | File System Access API (showSaveFilePicker) + IndexedDB | [NATIVE] (Chromium; Firefox = download fallback) |
| Export to share (.phos file) | Blob download / File System Access | [NATIVE] |
| Metadata (author/desc/tags/warmup) | IR fields + form UI | [NATIVE] |
| Standalone vs layered scenes | subgraphs in the IR | [NATIVE] |
| Timeline / choreography | custom timeline UI over IR + keyframes | [LIB] custom build |
| Video record scene-set-to-song | MediaRecorder + offline scheduling | [NATIVE] |
| CLI record mode | — (browser has no CLI) | [TAURI] |

═══════════════════════════════════════════════════════════════════
## THE GAP LIST (what the stack does NOT give cleanly)
═══════════════════════════════════════════════════════════════════

Only four real gaps, all known, none blocking the core product:

1. **True system audio capture** ("what you hear", all apps) — browser gives
   tab audio via getDisplayMedia; full system loopback needs [TAURI]. The
   visualizer works fine on file/mic/tab audio in-browser; system-wide is a
   native-shell feature.

2. **HDR display output** — WebGPU composites in HDR internally (rgba16float),
   but pushing true HDR to the monitor is nascent in browsers. Internal quality
   is fine; HDR *output* is [TAURI]/future-web.

3. **Native platform integration** — screensaver, multi-monitor, desktop mode,
   always-on-top, CLI record. All [TAURI], all the same web codebase wrapped.
   None affect the in-browser experience.

4. **VR** — WebXR exists and is native, so not a gap technically, but it's a
   large implementation surface. Plane9-unique. Explicit scope decision, not a
   stack limitation.

## VERDICT
The web stack (WebGPU + Web Audio + File System Access + CodeMirror/Monaco +
a graph-UI lib + MediaRecorder) covers the ENTIRE in-browser player and studio
feature set of both engines with NATIVE or mature-LIB standards. Every gap is
either a native-platform feature (→ Tauri, same code) or a scope decision (VR),
never a missing capability that forces acrobatics in the core product.

This confirms the stack in SCENE-ANATOMY.md is sufficient for the full feature
set, not just the rendering primitives. One addition to that stack, made
explicit here: a code-editor component (CodeMirror 6 or Monaco) and a graph-UI
library for the studio — both mature, neither load-bearing on the engine.
