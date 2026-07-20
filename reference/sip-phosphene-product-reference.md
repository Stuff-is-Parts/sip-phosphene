# PHOSPHENE Product Capability Reference {#top}

---

### DOCUMENT ROLE

Layer 4 reference opened for player, Studio, scene management, audio controls,
or platform-surface work. Responsibility: inventories source-derived viewer and
creation capabilities without cloning either source UI or claiming current
implementation status. Candidate browser/native mechanisms live in the
platform-coverage reference.

---

### 1. SOURCE-DERIVED PRODUCT SURFACE {#product-surface}

#### I. WHAT

The required product surface is the union of MilkDrop and Plane9 viewer,
creation, scene-management, output, and platform capabilities, constrained by
PHOSPHENE's editable native graph goal.

#### II. HOW

Evidence tiers, tagged per feature:
- **[MD-SRC]** MilkDrop, extracted from source (pluginshell.cpp key handler, plugin.cpp).
- **[P9-DOC]** Plane9, extracted from the distribution's own history.txt / plane9.txt (author's changelog — authoritative, retained in corpus).
- **[REPORT]** general knowledge, weaker — verify before relying.

Purpose: not to clone either UI, but to enumerate the real capability set so
PHOSPHENE's feature list is chosen from evidence, not invented.

═══════════════════════════════════════════════════════════════════
## PLAYER / VIEWER FEATURES
═══════════════════════════════════════════════════════════════════

### Scene/preset navigation
| Feature | MilkDrop | Plane9 |
|---|---|---|
| Next / prev scene | [MD-SRC] arrow keys, space | [P9-DOC] space (windowed) / right-arrow (screensaver) |
| Random / shuffle | [MD-SRC] 'R' toggle repeat, shuffle via Winamp | [P9-DOC] randomize setting |
| Auto-advance on timer | [MD-SRC] preset duration | [P9-DOC] scene min/max runtime |
| Auto-advance on silence | — | [P9-DOC] "auto change scene when silent for a specific amount of time" |
| Hard cut vs soft blend | [MD-SRC] hardcut on beat, softcut blend | [P9-DOC] transition scenes (35 of them) |
| Lock current scene | [MD-SRC] scroll-lock holds preset | [REPORT] |
| Playlist | [MD-SRC] TogglePlaylist, 'P'/'J' | [P9-DOC] playlists, VR/windowed start |
| Rating presets | [MD-SRC] +/- rating, affects shuffle weight | [REPORT] |

### Display / output
| Feature | MilkDrop | Plane9 |
|---|---|---|
| Fullscreen | [MD-SRC] ToggleFullScreen | [P9-DOC] full-screen windowed mode |
| Desktop mode (behind icons) | [MD-SRC] ToggleDesktop | — |
| Windowed mode | [MD-SRC] | [P9-DOC] standalone window mode |
| Always-on-top | — | [P9-DOC] F2/Ctrl+A toggle |
| Multi-monitor | [REPORT] | [REPORT] |
| Screensaver | [REPORT] (.scr) | [P9-DOC] native screensaver |
| VR (Oculus/OpenVR/Vive) | — | [P9-DOC] full VR, layered scenes in VR |
| HDR render target | — | [P9-DOC] HDR compositing, ACES tone mapping |
| Video recording | — | [P9-DOC] Studio records scene sets to video w/ song |

### Audio
| Feature | MilkDrop | Plane9 |
|---|---|---|
| Audio source | [MD-SRC] Winamp stream | [P9-DOC] default recording device OR "what you hear"; up to 18 channels→L/R |
| Beat detection | [MD-SRC] beat-driven hardcut | [P9-DOC] Beat node, sound-reactive editor |
| Waveform/spectrum | [MD-SRC] built-in wave modes | [P9-DOC] waveform damping/rate, SoundTexture |

### On-screen / help
| Feature | MilkDrop | Plane9 |
|---|---|---|
| Help overlay | [MD-SRC] ToggleHelp F1 | [P9-DOC] F1 help in windowed/VR |
| Preset name display | [MD-SRC] | [P9-DOC] scene description shown |
| FPS display | [MD-SRC] | [P9-DOC] status bar FPS |

═══════════════════════════════════════════════════════════════════
## STUDIO / EDITOR FEATURES
═══════════════════════════════════════════════════════════════════

MilkDrop's "studio" is the built-in preset editor (live equation/shader
editing overlaid on the running visual). Plane9 has a separate full Studio app.

### Editing model
| Feature | MilkDrop | Plane9 |
|---|---|---|
| Live edit while running | [MD-SRC] in-visual menu, edit per-frame/per-vertex eqs + shaders | [P9-DOC] engine reflects edits live (0.5s debounce on strings) |
| Node-graph editing | — (fixed pipeline) | [P9-DOC] full node editor: insert node on a connection, icons, camera restore |
| Shader editor | [MD-SRC] edit warp/comp HLSL inline | [P9-DOC] "search & replace, intellisense, snippets, goto, unlimited undo" |
| Expression editor | [MD-SRC] per-frame/per-vertex eqs | [P9-DOC] math editor, undo/redo, color-highlighted ports |
| Undo/redo | [MD-SRC] limited | [P9-DOC] unlimited undo in shader+expr |
| Camera control | — | [P9-DOC] WASDEC when RenderObject selected |
| Color picker on ports | — | [P9-DOC] color ports show swatch + picker dialog |
| Texture picker | — | [P9-DOC] textures as dropdown |
| Templates | — | [P9-DOC] select template on new scene |

### Scene management
| Feature | MilkDrop | Plane9 |
|---|---|---|
| Save/load | [MD-SRC] .milk files | [P9-DOC] scene files, FormatVersion |
| Export to share | [MD-SRC] copy .milk | [P9-DOC] export to .p9d "easily sent to others" |
| Metadata | [MD-SRC] preset name | [P9-DOC] description, author, warmup time, tags |
| Dirty indicator | — | [P9-DOC] * on changed scene, close-confirm dialog |
| Standalone vs layered | — | [P9-DOC] scenes default standalone; layered (bg+fg) compositions |

### Timeline / choreography (Plane9-only)
| Feature | MilkDrop | Plane9 |
|---|---|---|
| Timeline | — | [P9-DOC] studio timeline, per-scene play button |
| Video recording | — | [P9-DOC] record scene set to video with a song, progress display |
| Command-line record | — | [P9-DOC] set transition/min/max runtime from CLI in record mode |
| Post-processing scenes | — | [P9-DOC] config how often a postproc scene is used |

## USE OF THE INVENTORY

Select capability work from an authentic scene or ordinary product-path need
and follow its typed dependencies. The graph architecture may make layered
scenes, live editing, serialization, and transition components representable,
but it does not make their source semantics, UI, or platform integration free
or implemented. This reference supplies the denominator; it does not impose
delivery tiers or a parallel roadmap.

#### III. WHY

The engine translation is complete only when users can exercise the preserved
behavior through the ordinary viewer and creation surfaces. A source-derived
capability inventory prevents both UI cloning and agent-invented product scope.

[Back to Top](#top)
