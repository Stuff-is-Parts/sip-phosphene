# PHOSPHENE Compatibility Goal

## Goal

Convert Plane9 scenes and MilkDrop presets into editable, portable,
PHOSPHENE-native scenes that reproduce the originals' visual appearance,
animation, audio response, state behavior, and rendering pipeline.

Converted scenes must run entirely through PHOSPHENE. Original engines and
authoritative reimplementations may be used only as technical references and
validation oracles.

## Architecture

PHOSPHENE must use one native execution model capable of representing:

- native PHOSPHENE scenes;
- MilkDrop's complete preset pipeline;
- Plane9's complete node-graph execution model.

Do not create permanent parallel runtimes for the three systems.

Existing simple PHOSPHENE authoring structures may remain as shorthand over
the unified execution model.

## Source Authority

MilkDrop behavior must be derived from released MilkDrop and projectM source
code.

Plane9 behavior must be derived from:

- `.p9c` scene graphs, ports, values, connections, assets, and shaders;
- official Plane9 documentation and developer material;
- corpus-wide evidence;
- native Plane9 rendering or graphics inspection where published evidence is
  insufficient.

## Plan

Execute in this order:

1. Document MilkDrop's complete execution pipeline from authoritative source.
2. Document Plane9's nodes, ports, connections, shader contracts, and runtime
   behavior from the corpus and available evidence.
3. Create controlled reference fixtures:
   - projectM or Butterchurn renders for MilkDrop;
   - native Plane9 renders for Plane9.
4. Specify one unified PHOSPHENE-native execution model capable of
   representing all identified requirements without approximation.
5. Execute existing PHOSPHENE scenes through that model with no behavioral
   regression.
6. Implement MilkDrop and Plane9 importers into that model.
7. Accept each subsystem only after it passes its pre-existing reference
   validation.

## Correctness Standard

A conversion is complete only when it:

- produces editable PHOSPHENE-native data;
- has no runtime dependency on the original engine;
- preserves every source behavior required by the scene;
- matches controlled reference output produced by the native engine or an
  authoritative reimplementation;
- explicitly rejects unsupported behavior instead of approximating it.

Validation tolerance must be defined and committed before implementing the
subsystem it governs. It may not be weakened merely to make an implementation
pass.

## Hard Rules

- Never invent missing semantics, bindings, constants, inputs, helpers, or
  fallback behavior.
- Never substitute plausible output for source-equivalent behavior.
- Never treat parsing, compilation, execution, corpus coverage, or visible
  pixels as evidence of fidelity.
- The only compatibility progress metric is reference-validated conversion.
- Never flatten source behavior merely to fit an inadequate PHOSPHENE
  structure.
- Never substitute foreign-engine playback for native conversion.
- Reuse existing code only when its behavior is independently supported.
- Missing knowledge must remain explicit and unsupported until resolved by
  evidence.
- Do not implement a subsystem before its requirements and validation fixture
  exist.

## Repository Authority

The repository is the sole authority for current project state, but not every
statement stored in it is authoritative.

Current state must be determined from:

- executable source;
- tests and their actual results;
- source fixtures and corpora;
- generated validation evidence;
- explicit unsupported conditions.

Comments, documentation, commit messages, prior model summaries, and
historical reports are claims only. They must not override executable
evidence or authoritative source material.

Known-false or misleading repository artifacts must be corrected or removed
when discovered. They must not be preserved as historical project guidance.

## Model Hydration

Before acting:

1. Read this document.
2. Inspect the current repository, tests, fixtures, corpora, and generated
   validation evidence.
3. Read the authoritative sources governing the assigned subsystem.
4. Treat prior summaries, status reports, commit messages, comments, and
   model claims as untrusted unless independently supported.
5. Perform the assigned work without inventing behavior, redefining success,
   or converting unfinished implementation into prose deferral.
