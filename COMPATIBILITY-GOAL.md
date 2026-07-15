# PHOSPHENE Compatibility Goal

## Goal

Convert Plane9 scenes and MilkDrop presets into editable, portable,
PHOSPHENE-native graphs that reproduce the source formats' defined behavior
without approximation, omission, or foreign-runtime playback.

Converted scenes must execute entirely through PHOSPHENE's native graph
execution model. The graph must preserve the source structure closely enough
that imported behavior remains visible, editable, saveable, reloadable, and
portable.

PHOSPHENE must use one native execution model capable of representing:

- native PHOSPHENE scenes;
- MilkDrop's complete preset pipeline;
- Plane9's complete node-graph execution model.

Permanent parallel runtimes for the three systems are not acceptable.
Existing PHOSPHENE authoring structures may remain as shorthand over the
unified model.

## Source Authority

Behavior must be derived from authoritative evidence, in this order.

### MilkDrop

1. Released MilkDrop source and format documentation.
2. projectM source where it implements or documents MilkDrop behavior.
3. Butterchurn source as a secondary corroborating implementation.
4. Controlled runtime observations only where the published sources leave a
   material ambiguity.

### Plane9

1. `.p9c` scene graphs, ports, values, connections, assets, and shaders.
2. Retained Plane9 binaries, helper libraries, shader libraries, string
   tables, and other extracted implementation evidence.
3. Official Plane9 documentation and developer material.
4. Corpus-wide structural evidence.
5. Targeted observation of the installed engine where no retained evidence
   resolves the behavior.

Pinned source snapshots may be retained for research and citation. They must
not become runtime dependencies.

When authoritative sources disagree, the conflict must be documented and
resolved from stronger evidence. Missing knowledge must remain explicit; it
must never be filled with plausible behavior.

## Exactness Standard

Exact reproduction means preserving the source-defined:

- parsed fields, defaults, nodes, ports, resources, and connections;
- initialization, state, persistence, and update lifecycles;
- expressions, random behavior, audio processing, and timing;
- generated geometry, uniforms, transforms, and instancing;
- shader behavior and helper-library semantics;
- execution and pass order;
- textures, render targets, feedback, sampling, and auxiliary resources;
- blend, depth, raster, and other render state.

Exactness does not mean forcing pixel identity between different graphics
APIs, drivers, or numerical paths. Rendered similarity is neither the target
nor proof of correctness.

Nothing may be flattened, silently omitted, or aesthetically approximated to
fit an inadequate PHOSPHENE abstraction. The graph and executor must be
extended when the source behavior requires it.

## Implementation Rule

For each source behavior:

1. Determine what the source runtime actually does.
2. Represent that behavior explicitly in the PHOSPHENE graph.
3. Implement it in the native executor.
4. Verify it with a direct, reliable semantic check.
5. Record unresolved or unsupported behavior explicitly until it is
   implemented.

Research, representation, implementation, and testing may proceed together.
Semantic inventories are tracking aids, not work-unit boundaries,
prerequisites, phases, or authority to stop.

During development, behavior whose semantics are not yet established must be
refused rather than approximated. The project is not complete while ordinary
source-defined behavior remains unsupported.

## Validation Rule

Validation must test the behavior itself, not its approximate visual result.

Valid checks include direct assertions over:

- parsed structures and defaults;
- state before and after controlled execution steps;
- variable and buffer lifecycles;
- random draw order and values;
- audio, timing, and equation results;
- generated geometry and uniforms;
- shader translation on controlled inputs;
- pass and resource ordering;
- render-target and feedback transitions;
- texture and sampler behavior;
- blend, depth, raster, and other pipeline state;
- graph save, reload, and portable re-execution.

Expected results must be derived from authoritative source semantics or
retained direct evidence. A second implementation that merely repeats the
same assumptions is not an independent oracle.

Use exact equality where the source and representation permit it. Any
floating-point tolerance must be justified by the specific rounding or
precision path being tested.

A small rendered smoke check may catch gross integration failures such as a
blank frame, missing pass, or inverted output. Screenshots, SSIM, visual
ranking, and full-scene output matching are not fidelity gates and must not
drive implementation.

Parsing, compilation, execution, corpus coverage, and visible pixels alone
are not evidence of compatibility.

## Completion Condition

The assignment is complete only when:

- native PHOSPHENE scenes, MilkDrop presets, and Plane9 scenes execute through
  the unified native graph model;
- all source-defined behavior required by the accepted formats is represented
  and implemented;
- direct semantic tests cover the implemented behavior and pass;
- no supported behavior depends on the original engine at runtime;
- imported graphs remain editable, saveable, reloadable, and portable;
- unsupported behavior is limited to genuinely malformed or externally
  unresolvable input and is identified with direct evidence;
- the product uses the completed native graph path;
- the complete build and test suite passes from a clean checkout.

Partial subsystem success, parser coverage, lit pixels, visual resemblance,
commit count, or progress documentation do not satisfy completion.

## Execution Standard

Complete the assigned goal in one pull.

The model has no authority to reduce scope, divide the assignment into future
phases or pulls, or declare partial completion sufficient. Only the user may
change the goal or authorize incomplete delivery.

Commits and pushes are durability operations, not stopping points, approval
checkpoints, phase boundaries, or occasions for progress reports. After each
durability operation, continue the assignment.

Task size, a useful checkpoint, a completed subsystem, a self-defined work
window, or the availability of another invocation are not reasons to stop.

Stopping before completion is justified only when a specific external action
is indispensable and cannot be performed with the available tools. Before
claiming such a dependency, exhaust reasonable research, implementation,
instrumentation, command-line, and targeted-observation alternatives; retain
the direct evidence; and identify the precise action required.

## Repository Authority

The repository is the authority for current project state, but prose inside
it is not automatically authoritative.

Current state must be determined from:

- executable source;
- direct semantic tests and their actual results;
- retained authoritative source evidence;
- source fixtures and corpora;
- semantic inventories;
- explicit refusal paths.

Comments, inventories, documentation, commit messages, status reports, and
prior model summaries are claims. They must not override executable evidence
or authoritative source material.

Known-false or misleading artifacts must be corrected or removed when
discovered.
