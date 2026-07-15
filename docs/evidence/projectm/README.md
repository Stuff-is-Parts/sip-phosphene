# projectM Evidence — Retained Verbatim Source

**Repository:** github.com/projectM-visualizer/projectm
**Pinned commit SHA:** `2f244141320f6b97b09bf99964cc72a4efdfcfd3`
**License:** LGPL-2.1-or-later (see `LICENSE.txt` in the upstream release)
**Retrieval date:** 2026-07-15

Every `.cpp`, `.hpp`, `.frag`, and `.inc` file in this directory is a
byte-for-byte copy of the upstream file at the pinned SHA above. No
edits, elisions, or PHOSPHENE annotations appear in the retained files —
they exist so PHOSPHENE's port can be verified against the exact source
it claims to derive from.

## Path mapping

| Retained file | Upstream path (at pinned SHA) |
|---|---|
| `MilkdropPreset.cpp` | `src/libprojectM/MilkdropPreset/MilkdropPreset.cpp` |
| `MilkdropShader.cpp` | `src/libprojectM/MilkdropPreset/MilkdropShader.cpp` |
| `MilkdropShader.hpp` | `src/libprojectM/MilkdropPreset/MilkdropShader.hpp` |
| `BlurTexture.cpp` | `src/libprojectM/MilkdropPreset/BlurTexture.cpp` |
| `BlurTexture.hpp` | `src/libprojectM/MilkdropPreset/BlurTexture.hpp` |
| `MilkdropNoise.cpp` | `src/libprojectM/Renderer/MilkdropNoise.cpp` |
| `MilkdropNoise.hpp` | `src/libprojectM/Renderer/MilkdropNoise.hpp` |
| `PresetShaderHeaderGlsl330.inc` | `src/libprojectM/MilkdropPreset/Shaders/PresetShaderHeaderGlsl330.inc` |
| `Blur1FragmentShaderGlsl330.frag` | `src/libprojectM/MilkdropPreset/Shaders/Blur1FragmentShaderGlsl330.frag` |
| `Blur2FragmentShaderGlsl330.frag` | `src/libprojectM/MilkdropPreset/Shaders/Blur2FragmentShaderGlsl330.frag` |
| `PerPixelMesh.cpp` | `src/libprojectM/MilkdropPreset/PerPixelMesh.cpp` |
| `projectm-warp-fragment.frag` | preset-shader fragment excerpt |
| `projectm-warp-vertex.vert` | preset-shader vertex excerpt |

## Provenance and use in PHOSPHENE

PHOSPHENE has directly ported behavior from these files. The port lives
under `src/gpu/` and `src/core/` — specifically `milk-shader-instance.ts`,
`milk-noise.ts`, `milk-blur.ts`, `milk-session.ts`, and the shader-contract
population in `milk-pipeline.ts`. This directory is the citation surface
for that port; a reviewer verifying PHOSPHENE's semantics reads the
retained file, not the PHOSPHENE code.

PHOSPHENE interpretation, deviation notes, and mapping decisions live in
`docs/projectm-notes.md`. They are NOT in this directory.

## Refetching or updating

To refresh the pin against a newer upstream commit, replace the SHA
above with the new one and re-fetch each file with the raw URL pattern:

```
https://raw.githubusercontent.com/projectM-visualizer/projectm/{SHA}/{upstream-path}
```

A refresh MUST update every retained file at the same time so the
directory remains internally consistent with the recorded SHA.
