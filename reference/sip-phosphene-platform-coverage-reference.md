# PHOSPHENE Platform Capability Map {#top}

---

### DOCUMENT ROLE

Layer 4 reference opened when selecting an established browser, WebGPU,
library, or native-shell capability for a source-derived product feature.
Responsibility: maps the product inventory to candidate standard mechanisms and
identifies platform gaps. Each mechanism must be reverified when implemented;
this document does not establish current browser support or project status.

---

### 1. PLATFORM MAPPING {#platform-mapping}

#### I. WHAT

Most inventoried viewer and Studio capabilities have a standard browser API or
mature-library path; desktop integration and true HDR output require separate
platform decisions.

#### II. HOW

Method: each feature in the product capability reference maps to a candidate
modern API or admitted library. Features are capabilities rather than proof of
source behavior, so this is a selection aid and gap list, not a compatibility
check.

Candidate tags:

- **[NATIVE]** a browser/platform API candidate exists; support and semantics
  must be checked at implementation time.
- **[LIB]** a mature-library candidate exists; it still requires admission,
  pinning, licensing, and source-contract review.
- **[TAURI]** likely requires a native-shell capability.
- **[GAP]** no clean established path was identified in this audit.

═══════════════════════════════════════════════════════════════════
## PLAYER / VIEWER
═══════════════════════════════════════════════════════════════════

| Feature | Web API / mechanism | Verdict |
|---|---|---|
| Render the visuals | WebGPU | [NATIVE] |
| Next/prev/random scene | app state + keyboard events | [NATIVE] |
| Auto-advance timer | setTimeout/rAF | [NATIVE] |
| Auto-advance on silence | source-specific audio analysis output + app timer | [NATIVE] host control; source threshold semantics still require evidence |
| Hard cut / soft blend / transitions | render graph containing both scene states and an evidenced transition component | [NATIVE] substrate; source transition semantics remain implementation |
| Fullscreen | Fullscreen API (requestFullscreen) | [NATIVE] |
| Windowed mode | it's a web page | [NATIVE] |
| Audio: file playback | Web Audio decodeAudioData | [NATIVE] |
| Audio: microphone / line-in | getUserMedia(audio) | [NATIVE] |
| Audio: system "what you hear" | getDisplayMedia({audio}) — tab/system audio | [LIB]/[NATIVE] partial: browser captures TAB audio reliably, full system audio is [TAURI] |
| Audio: multi-channel (18ch→L/R) | Web Audio channel splitter | [NATIVE] |
| Beat detection | source-specific MilkDrop/Plane9 analysis component over raw PCM | [GAP] no generic onset API establishes either source contract |
| Waveform / spectrum | raw PCM capture through Web Audio/AudioWorklet; source-specific transforms remain explicit | [NATIVE] capture only |
| FFT | source-compatible implementation or admitted library configured to the cited algorithm | [LIB] candidate; `AnalyserNode` is not MilkDrop's FFT chain |
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
| Node-graph editor | SVG/Canvas + an admitted graph-UI library | [LIB] |
| Insert node on connection, icons, pan/zoom | same graph lib | [LIB] |
| Shader editor (search/replace, intellisense, undo) | **CodeMirror 6** or **Monaco** | [LIB] — Monaco is VS Code's editor; intellisense-grade |
| WGSL live diagnostics | naga (wasm) or device.createShaderModule getCompilationInfo | [NATIVE] real compiler errors |
| Expression editor | CodeMirror/Monaco plus the existing parser diagnostics | [LIB] |
| Unlimited undo/redo | editor lib built-in + command-stack for graph | [NATIVE]/[LIB] |
| Live edit → running visual | recompile pipeline on IR change (debounced) | [NATIVE] |
| Camera control (WASDEC) | pointer/keyboard events | [NATIVE] |
| Color picker on ports | <input type=color> or a picker lib | [NATIVE]/[LIB] |
| Texture picker dropdown | DOM + resource list | [NATIVE] |
| Templates | bundled IR files | [NATIVE] |
| Dirty indicator / close-confirm | app state + beforeunload | [NATIVE] |
| Save / load | File System Access API (showSaveFilePicker) + IndexedDB | [NATIVE] (Chromium; Firefox = download fallback) |
| Export to share (.phos file) | Blob download / File System Access | [NATIVE] |
| Metadata (author/desc/tags/warmup) | native document fields + form UI | [NATIVE] UI; `.phos/1` currently lacks several Plane9 root fields |
| Standalone vs layered scenes | subgraphs in the IR | [NATIVE] |
| Timeline / choreography | custom timeline UI over IR + keyframes | [LIB] custom build |
| Video record scene-set-to-song | MediaRecorder + offline scheduling | [NATIVE] |
| CLI record mode | — (browser has no CLI) | [TAURI] |

═══════════════════════════════════════════════════════════════════
## THE GAP LIST (what the stack does NOT give cleanly)
═══════════════════════════════════════════════════════════════════

The audit identified these platform decisions; this list is not a statement
that source-semantic work is complete or that no other gap can emerge:

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

## USE OF THIS MAP

The map supports WebGPU, Web Audio capture, established editor components, and
a native shell as candidate substrate choices. It does not establish exact
source behavior, current cross-browser support, implementation cost, or
completion. Reverify the selected API or library against its current primary
documentation and the complete source contract when the corresponding
inventory row enters scope.

#### III. WHY

Mapping product needs to established capabilities bounds custom-code surface
and makes genuine platform gaps explicit without turning a technology survey
into another implementation roadmap.

[Back to Top](#top)
