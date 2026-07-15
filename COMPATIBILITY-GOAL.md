# PHOSPHENE Compatibility Goal

## Goal

Convert Plane9 scenes and MilkDrop presets into editable, portable,
PHOSPHENE-native graphs that execute the source formats' defined semantics
without approximation, omission, or foreign-runtime playback.

Converted scenes must run entirely through PHOSPHENE's native execution
model. Original engines and authoritative reimplementations may be used as
references for understanding source behavior. They must not be used at
runtime and must not be treated as automated validation oracles that steer
implementation by rendered-output similarity.

## Architecture

PHOSPHENE uses one native execution model capable of representing:

- native PHOSPHENE scenes;
- MilkDrop's complete preset pipeline;
- Plane9's complete node-graph execution model.

Do not create permanent parallel runtimes for the three systems.

Existing simple PHOSPHENE authoring structures may remain as shorthand over
the unified execution model.

## Source Authority

MilkDrop behavior is derived from released MilkDrop and projectM source
code (evidence retained under `docs/evidence/`), including the Butterchurn
JavaScript reimplementation where its source carries witnessed behavior.

Plane9 behavior is derived from:

- `.p9c` scene graphs, ports, values, connections, assets, and shaders;
- extracted DLL string tables and helper libraries (`fixtures/plane9/`);
- official Plane9 documentation and developer material;
- corpus-wide evidence;
- controlled observations of the installed engine where necessary to
  determine node behavior no other evidence resolves.

## Method

Work proceeds format-by-format through the same sequence for each subsystem:

1. **Inventory** — enumerate every source-file field, node type, port,
   expression, shader, resource, and connection that appears in the corpus
   or that the source runtime defines. Record each item in a semantic
   inventory living alongside the parser and executor.
2. **Determine behavior** — for each item, cite the authoritative source
   that defines its behavior (specific file and function in
   Butterchurn/projectM for MilkDrop; specific DLL string, helper
   function, or observed native behavior for Plane9). Where no evidence
   exists, mark the item unresolved and refuse to implement it.
3. **Represent** — express each item explicitly in the PHOSPHENE graph
   representation so the source structure is visible and editable.
4. **Implement** — port each item into the native executor with behavior
   traceable to the cited source. Nothing is approximated to fit a
   simpler PHOSPHENE structure.
5. **Test** — assert exact semantics through direct checks (see
   Correctness Standard below). Add tests before or with the
   implementation.

Complete MilkDrop semantics include equation lifecycle, variable
persistence, random draw order, audio processing, warp mesh, custom
shapes, custom waves, motion vectors, decay, feedback, blur, noise,
composite, and shader translation.

Complete Plane9 semantics include node behavior, expressions, shaders,
CPU dataflow, audio nodes, textures, render targets, transforms,
instancing, and render state.

Unify both under one native graph execution model. Editable and portable
output remains the required product. Replace the product path with the
unified path only after semantic coverage is complete for the subsystem
in question.

## Execution Standard

Complete the assigned goal in one pull.

The model has no authority to reduce scope, divide the work, declare
partial completion sufficient, or move work into future phases, tasks,
roadmaps, or follow-up pulls.

Only the user may change the assigned goal or authorize incomplete
delivery.

An unavailable external dependency may prevent the specific work that
requires it, but does not authorize stopping. Complete all remaining work
and report the unresolved dependency with direct evidence.

## Correctness Standard

A conversion is complete for a given item only when it:

- produces editable PHOSPHENE-native data for that item;
- has no runtime dependency on the original engine;
- executes the source-defined behavior for that item;
- has a direct semantic test that pins the behavior — the required test
  forms are enumerated below;
- explicitly rejects source items whose behavior has not been established
  from evidence, rather than approximating them.

The valid direct-semantic-test forms are:

| Concern | Direct semantic test |
|---|---|
| Parsed representation | assert the parsed data structure exactly matches the source file's declared fields, defaults, and connections for a known input |
| Defaults and initialization | assert initial pool state contains every source-defined default at the source-defined value |
| Variable lifecycle | assert user variables persist across frames per the source rule (init-defined keys persist; frame-first-assigned keys do not) with a controlled per-frame check |
| Random behavior | assert the seeded RNG produces the source-witnessed draw sequence at each context boundary (visualizer construction, preset load, per-frame stages) |
| Audio processing | assert audio band, level, and time state match butterchurn's chain for a controlled synthetic PCM input at every processed frame |
| Equation results | assert the pool state after a fixed program run matches the source runtime's pool state for that program and input |
| Generated geometry | assert warp UVs, custom-shape vertex buffers, custom-wave vertex buffers, and motion-vector line lists match witnessed source math for controlled inputs |
| Uniforms and pass ordering | assert graph.order and per-pass uniform packing match the source-defined sequence and value set |
| Render targets and feedback | assert front/back rotation, sampler configuration, and feedback semantics match the source rule per pass |
| Shader translation | assert the WGSL translation of each source shader form (MilkDrop 2 warp/comp shaders, glsl-p9 forms) produces the expected output for controlled sample-point inputs |
| Blend, depth, raster state | assert per-node pipeline state matches the source-declared enum values |

Screenshots are not a semantic test. A rendered comparison may exist as
an integration smoke check that catches gross wiring failures (missing
pass, wrong orientation, blank output). It is not an acceptance gate,
does not drive per-item implementation decisions, and does not count as
evidence of fidelity.

Every direct semantic test cites the source location it verifies against,
either inline in the test or in the cited item's inventory row.

Validation tolerance is defined per test form and committed before the
implementation it governs. Numerical tests use exact equality by default;
floating-point tolerances that admit anything above float epsilon require
an explicit justification tied to the specific rounding path.

## Hard Rules

- Never invent missing semantics, bindings, constants, inputs, helpers,
  or fallback behavior.
- Never substitute plausible output for source-equivalent behavior.
- Never treat parsing, compilation, execution, corpus coverage, or
  rendered similarity as evidence of fidelity.
- The only compatibility progress metric is source-witnessed direct
  semantic coverage.
- Never flatten source behavior merely to fit an inadequate PHOSPHENE
  structure.
- Never substitute foreign-engine playback for native conversion.
- Reuse existing code only when its behavior is independently supported
  by a semantic test.
- Missing knowledge remains explicit and unsupported until resolved by
  evidence.
- Do not implement a source item before its semantic inventory row and
  its direct semantic test exist.
- Do not expand rendered-comparison infrastructure. Retain only a small
  integration smoke check for gross wiring failures.

## Repository Authority

The repository is the sole authority for current project state, but not
every statement stored in it is authoritative.

Current state is determined from:

- executable source;
- direct-semantic tests and their actual results;
- source fixtures and corpora;
- semantic inventories citing authoritative source locations;
- explicit unsupported conditions.

Comments, documentation, commit messages, prior model summaries,
historical reports, and rendered-comparison outputs are claims only. They
must not override executable evidence, direct semantic tests, or
authoritative source material.

Known-false or misleading repository artifacts are corrected or removed
when discovered. They are not preserved as historical project guidance.

## Model Hydration

Before acting:

1. Read this document.
2. Inspect the current repository, tests, fixtures, corpora, and
   semantic inventories.
3. Read the authoritative sources governing the assigned subsystem.
4. Treat prior summaries, status reports, commit messages, comments,
   and model claims as untrusted unless independently supported.
5. Perform the assigned work without inventing behavior, redefining
   success, or converting unfinished implementation into prose deferral.
