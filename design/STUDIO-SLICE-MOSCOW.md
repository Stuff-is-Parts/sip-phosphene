# Studio Vertical Slice — MoSCoW feature buckets

Scope rule (your definition): the slice = the FULL must-have feature set that
APPLIES TO THE CONTENT. Content = 101-per_frame.milk (static vars, one per_frame
equation, feedback+box render). Features are bucketed so "do it all in one pull"
has a fixed denominator that can't be shrunk after the fact.

Derived from PLAYER-STUDIO-FEATURES.md, restricted to what THIS content exercises.
You adjust the buckets; then one pull builds every MUST.

## What the content contains (bounds the list)
- static preset variables with defaults (fDecay, zoom, rot, warp, ob_*, ib_*)
- one per_frame equation: ib_r = 0.7+0.4*sin(3*time)
- feedback/decay, inner+outer box, composite to screen
- runs live, animates on time
- (NOT present in this content: warp/wave/shapes/custom shaders/audio-reactivity)

═══════════════════════════════════════════════════════════════════
## MUST HAVE — the slice is incomplete without these
═══════════════════════════════════════════════════════════════════
| Feature | Why it's a Must for THIS content |
|---|---|
| Render the running visual (canvas) | the studio must show what it edits |
| Load the sample preset into the IR | the content has to get in |
| Show the IR as a node graph (nodes + ports + wiring) | "studio" = the IR made visible; this is the core |
| Show each node's port values (the vars + the equation) | you can't edit what you can't see |
| Edit a port value / the equation, live | the core studio loop: change → re-render → see it |
| Live re-render on edit (recompile expr, keep running) | proves edit→engine→visual works |
| Play/pause | minimum transport to observe |
| Show current variable values as they update per-frame | see ib_r pulse in numbers, not just pixels — the structural frame-diff |

═══════════════════════════════════════════════════════════════════
## SHOULD HAVE — real value, not required to prove the slice
═══════════════════════════════════════════════════════════════════
| Feature | Note |
|---|---|
| Reset to preset defaults | undo experimentation without reload |
| Dirty indicator (* on change) | from Plane9 audit; cheap |
| FPS / frame counter display | Plane9 audit; trivial |
| Metadata view (preset name) | trivial; content has [preset00] |

═══════════════════════════════════════════════════════════════════
## COULD HAVE — nice, defer without loss
═══════════════════════════════════════════════════════════════════
| Feature | Note |
|---|---|
| Syntax highlight on the equation | cosmetic for one equation |
| Save edited IR back to a .phos/.milk file | real, but this content doesn't require it to prove the loop |
| Add/remove/rewire nodes | pulls in graph-executor generality this fixed-pipeline content doesn't force — a SEAM |
| Color picker on ib_r/ob_r ports | Plane9 had it; overkill for one preset |

═══════════════════════════════════════════════════════════════════
## WON'T HAVE (this slice) — explicitly out
═══════════════════════════════════════════════════════════════════
| Feature | Why out |
|---|---|
| Shader editor w/ intellisense | no custom shader in this content |
| Timeline / choreography | single scene, no sequencing |
| Video recording | output feature, not core loop |
| Templates / new-scene | there's one scene |
| Multi-scene playlist / transitions | single content sample |
| Undo/redo stack | Should-Have for a real editor; not needed to prove the slice |
| VR / multi-monitor / native | Tauri-tier, far out of slice |
| Node add/wire/delete | (also in Could) — the generality seam; explicitly deferred to keep engine honest |

## The one real judgment call for you
Node add/wire/delete sits in Could/Won't because this content is a fixed
pipeline — supporting arbitrary topology means building graph-executor
generality the sample never exercises, which is the classic scope-creep seam.
If you want it in MUST, that's legitimate — but know it widens the ENGINE, not
just the studio, and the widening won't be checkable against this content
(nothing in one preset forces it). That's the only bucket line where "applies
to the content" is genuinely ambiguous.
