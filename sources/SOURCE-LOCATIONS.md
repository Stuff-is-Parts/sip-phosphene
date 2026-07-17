# Source-Location Registry — where authoritative data lives

Policy: NO retained evidence copies in this repo (retained-copy corruption is
witnessed failure mode #6). This registry records where each engine's
authoritative data lives and how to open it. Sources are opened LIVE at
transcription/audit time; every citation names the location + revision (SHA for
fetched files, install version for local artifacts) actually read. "Unresolved"
is a legal conclusion only after the relevant sources below were opened and
searched, with the search named.

## MilkDrop

| Source | Location | Access | Authority tier (PHOSPHENE-GOAL.md) |
|---|---|---|---|
| projectM (active reimplementation) | github.com/projectM-visualizer/projectm | raw.githubusercontent.com fetch at a pinned commit SHA | 2 |
| MilkDrop 2 original source (vis_milk2: milkdropfs.cpp, pluginshell.cpp, fft.cpp, state.cpp) | Winamp/MilkDrop2 source release; mirrors on GitHub | locate mirror, pin SHA, fetch per file — not yet consulted this audit; consult when projectM and classic behavior may diverge | 1 |
| projectm-eval (EEL expression language reimplementation) | github.com/projectM-visualizer/projectm-eval — projectm-eval/TreeFunctions.c holds the function implementations | raw fetch at pinned SHA | 2 |
| ns-eel2 original (EEL as MilkDrop embedded it) | WDL repo (github.com/justinfrankel/WDL, WDL/eel2/) and the ns-eel2 copy inside the MilkDrop 2 source release | locate, pin, fetch — not yet consulted; tier-1 resolution path for EEL divergences (e.g., the invsqrt float-vs-double magic in sources/EEL-FUNCTIONS.md) | 1 |
| Butterchurn (JS reimplementation) | github.com/jberg/butterchurn | raw fetch at pinned SHA | 3 |
| .milk preset corpus | `source-scenes/milkdrop/` (local, gitignored) | direct read | corpus |

## Plane9 (closed source)

| Source | Location | Access | Authority tier |
|---|---|---|---|
| .p9c scene corpus (252 scenes) | `source-scenes/plane9/` (local, gitignored) | .p9c is a ZIP: `unzip -p file.p9c scene.xml` → node/port/connection XML | 1 |
| Local installation | `C:\Program Files (x86)\Plane9\` | direct read: `plane9.txt` (author doc), `history.txt` (author changelog — authoritative), `nodedata/*.glsl` (actual shader implementations incl. ls_jacobi.glsl), `data/` (textures), shipped `scenes/`, `Plane9Engine.dll` (searchable strings) | 2 |
| Official docs/site | plane9.com, `Plane9Doc.url` in the install | web fetch | 3 |
| expreval (Plane9's expression evaluator, credited in plane9.txt) | expreval.sourceforge.net; mirrors on GitHub | locate, pin, fetch — settles evaluator-core vs Plane9-extension provenance for expression functions | 2 |
| Targeted observation | `Plane9.exe` / `Plane9.Studio.exe` in the install | run and observe, only where the above leave a material ambiguity | 5 |

## Corpus format note (established this audit)

A `.p9c` is a zip archive containing `scene.xml` (the node graph: `<Node
Type=.. Name=..><Port Id=.. Value=../></Node>` + `<Connection Out="Node.Port"
In="Node.Port"/>`), `scene.jpg`, `preview.jpg`. Text search across the corpus
must unzip first — a plain grep over .p9c files matches nothing and proves
nothing.
