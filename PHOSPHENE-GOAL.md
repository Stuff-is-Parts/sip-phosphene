# PHOSPHENE Compatibility Goal

## Initial Idea

Essentially the idea is to create a modern visualization viewer and creator
studio that matches the features and capabilities of MilkDrop and Plane9. The
practical approach to achieving this is doing a thorough technical analysis of
the source code and scene files for both of those engines and creating the new
tool in such a way that its architecture and features allow the scene files to
be converted so that they are technically identical to the sources.

This is not an aesthetic, interpretive, or approximate recreation. The source
runtime's exact technical behavior must be identified and reproduced using
modern technology. The visual result must emerge from the translated
mechanics; it must never be recreated by interpreting what the output appears
to depict.

In order to do this, the steps would be audits of the specific graphical tech
each tool uses and the scene and overall viewer sequence framework each
employs. Then the creation of a tool that clones that tech using modern web
standards and that has scene and viewer sequence architecture that allows for
the direct translation of the source engines' scene files.

## Formal Goal

Convert Plane9 scenes and MilkDrop presets into editable, portable,
PHOSPHENE-native graphs that reproduce the source formats' defined behavior
without approximation, omission, or foreign-runtime playback.

Converted scenes must execute entirely through PHOSPHENE's native graph
execution model. The graph must preserve the source structure such
that imported behavior remains visible, editable, saveable, reloadable, and
portable.

PHOSPHENE must use one native execution model capable of representing:

- native PHOSPHENE scenes;
- MilkDrop's complete preset pipeline;
- Plane9's complete node-graph execution model.

Permanent parallel runtimes for the three systems are not acceptable.

### Native Implementation Boundary

Foreign-runtime playback means embedding or invoking another engine's
rendering or playback path to produce output (for example, running
Butterchurn, projectM, or the original engines as the renderer).

A reference component (for example, the MilkDrop expression evaluator
compiled to run inside the native executor) is permitted only when narrowly
bounded, non-rendering, represented through the native graph contract, and
incapable of bypassing PHOSPHENE's editable state or execution model. It is
subject to the same evidence and validation requirements as any other
implementation. If a behavior is reimplemented instead, the reference
component serves as the comparison oracle for its results.

This boundary is a project decision and may be revised only by the user.

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

When authoritative sources disagree, the conflict must be documented and
resolved from stronger evidence. Missing knowledge must remain explicit; it
must never be filled with plausible behavior.

### Authority and Oracle Distinction

Authority priority determines what behavior is required. Oracle precedence
determines how expected values are obtained. An executable lower-tier
implementation may provide measurements but does not supersede a stronger
authority. Any disagreement must enter an authority-conflict record and keep
the affected requirement at FAIL until resolved from stronger evidence.

## Scope of Accepted Formats

The accepted format versions and their authoritative specifications define
required behavior. A retained, versioned corpus of presets and scenes provides
regression and bulk-coverage evidence; it exercises the scope but does not
define completeness.

For Plane9, which has no published specification, scope is bounded by the
tier 1 and tier 2 evidence above. Behavior that no retained evidence resolves
remains required and produces FAIL with a precise missing-evidence or
external-dependency reason. It must never be approximated or treated as
complete.

## Exactness Standard

Exact reproduction means preserving the source-defined:

- parsed fields, defaults, nodes, ports, resources, and connections;
- initialization, state, persistence, and update lifecycles;
- expressions, random behavior, audio processing, and timing;
- generated geometry, uniforms, transforms, and instancing;
- shader behavior and helper-library;
- execution and pass order;
- textures, render targets, feedback, sampling, and auxiliary resources;
- blend, depth, raster, and other render state.

Exactness does not mean forcing pixel identity between different graphics
APIs, drivers, or numerical paths. Rendered similarity is neither the target
nor proof of correctness.

Nothing may be flattened, silently omitted, or aesthetically approximated to
fit an inadequate PHOSPHENE abstraction. The graph and executor must be
extended when the source behavior requires it.

## LLM Reliability and Acceptance Standard

An LLM may research source code, extract technical behavior, propose
architecture, generate implementation code, write tests, execute tools,
diagnose failures, and produce other technical artifacts.

All such output is unaccepted until independently verified.

An LLM's statement that it examined the source, preserved the source behavior,
completed an implementation, passed validation, or satisfied this goal is not
evidence that it did so.

No behavior may be accepted as implemented solely because:

- an LLM describes it as correct;
- the implementation resembles the source structurally;
- model-authored tests pass;
- compilation, rendering, or corpus execution succeeds;
- another LLM agrees with the implementation;
- a review, status report, commit message, inventory, or summary claims
  completion.

Acceptance requires external, inspectable evidence establishing both:

1. what the authoritative source actually does; and
2. that the PHOSPHENE implementation reproduces that behavior.

The evidence must be independent of the implementation's unsupported
assumptions. It may consist of:

- directly cited authoritative source code or documentation;
- retained source-runtime instrumentation or controlled observations;
- mechanically extracted source data;
- expected values fixed before or independently from implementation;
- tests whose assertions are traceable to that evidence;
- direct comparison of source and PHOSPHENE state, geometry, uniforms,
  resources, execution order, or other technical behavior.

Evidence must demonstrate the exact claimed behavior. A citation, fixture, or
test is invalid when its derivation cannot be reproduced from the cited
authority or when it establishes only adjacent behavior.

A test generated from the same unverified interpretation as the
implementation is not independent validation. Running it in a clean
environment verifies reproducibility, not correctness.

An LLM may produce technical work, but it may not certify its own work.
Correctness and completion exist only where the repository contains
independently inspectable evidence that demonstrates them.

When adequate external verification has not been established, the affected
requirement remains FAIL with the precise missing evidence, implementation,
instrumentation, execution capability, or external dependency recorded. It
must not be accepted on the basis of model confidence, plausibility,
consensus, or apparent visual success.

## Behavior Verification Controls

The Portable Evidence-Gated Verification Framework is normative for
verification mechanism details. This section states PHOSPHENE-specific
obligations and may strengthen, but may not weaken, narrow, replace, or
independently redefine the framework's controls.

Every behavioral fixture must distinguish the required behavior from the
complete applicable union of registered plausible alternatives. Claim-level
alternatives may add coverage but may not remove, replace, narrow, or shadow
alternatives required by an applicable profile or the project binding.

Structural presence does not prove runtime effect. Acceptance requires a
runtime-effect witness showing that the actual product path reaches the
implementation and that a controlled intervention produces the expected
change in observed state or result.

Any claim that a different algorithm, execution path, ordering, state
transition, or implementation is equivalent to the source is itself a
required claim. It must be established by an authority-derived proof or by
differential checks over the complete applicable input domain before the
source-defined path may be omitted.

Raw authority artifacts must remain byte-exact and separate from excerpts,
annotations, normalization, commentary, and other derived evidence. Every
expected constituent must retain the identity, version or hash, and exact
location of the authority from which it derives. Facts from multiple
authorities may not be silently combined; disagreements require an explicit
authority-conflict record.

Every mechanically enumerable source behavior must receive a stable inventory
ID mapped to sufficient claims, fixtures, checks, oracle outputs, and actual
PHOSPHENE-executor execution. Aggregating behaviors into broader claims may
organize records but may not reduce the required verification surface.

## Implementation Rule

Every source-defined behavior in the accepted formats must be converted. The
following steps are acceptance criteria for each behavior, not permission to
isolate, defer, or omit it. Interdependent behaviors should be understood and
implemented together as their complete source-defined subsystem.

For each source behavior:

1. Determine what the source runtime actually does.
2. Represent that behavior explicitly in the PHOSPHENE graph.
3. Implement it in the native executor.
4. Verify it with a direct, reliable semantic check.
5. Retain precise evidence for any missing knowledge, implementation,
   instrumentation, or execution capability; the behavior remains FAIL until
   the condition is corrected.

Research, representation, implementation, and testing may proceed together.

During development, behavior whose exact technical basis is not yet
established must be refused rather than approximated. The project is not
complete while any required source-defined behavior remains at FAIL.

Failure reasons describe why a required behavior does not yet pass. They do
not authorize deferral, omission, unsupported completion, or a change in
scope. Stopping is permitted only when the specific indispensable external
dependency defined in the Execution Standard actually exists.

## Validation Rule

Validation must test the behavior itself, not its approximate visual result.

Checks of runtime behavior must execute the actual PHOSPHENE native executor,
and checks of generated shaders must compile them through a real
target-language implementation. Static inspection and model-authored
simulators do not verify executable behavior.

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

Expected results must be derived from authoritative source, and each expected
value must originate from the strongest available oracle class required by the
project verification binding. Hand-derived expectations are forbidden unless
the binding explicitly authorizes them for a named requirement class with
retained evidence that every stronger required oracle is unavailable. Each
expected value must identify its provenance: the authority it derives from,
the version or hash of that authority, and how it was obtained. Fixtures are
correctable under review; provenance, not immutability, is what protects them.
The chain from source evidence to expected result to test to actual executor
result is machine-checked through the verification framework and its
authenticated project binding.

Use exact equality. Any floating-point tolerance must be justified by the
specific rounding or precision path being tested. A changed algorithm, state
transition, ordering, or execution path is behavioral divergence requiring an
equivalence claim; it must not be routed through a numerical tolerance.

Screenshots, SSIM, visual ranking, and full-scene output matching are not
fidelity gates and must not drive implementation.

Parsing, compilation, execution, corpus coverage, and visible pixels
are not evidence of compatibility.

## Completion Condition

The assignment is complete only when:

- native PHOSPHENE scenes, MilkDrop presets, and Plane9 scenes execute through
  the unified native graph model;
- all source-defined behavior required by the accepted formats is represented
  and implemented;
- direct tests cover the implemented behavior and pass;
- no required behavior depends on the original engine at runtime;
- imported graphs remain editable, saveable, reloadable, and portable;
- malformed input is rejected according to the source-defined format
  behavior and covered by direct tests;
- no scoped requirement remains at FAIL because of an indispensable external
  dependency; such a dependency keeps the global project result at FAIL unless
  the user explicitly changes the approved scope;
- the product uses the completed native graph path;
- the complete build and test suite passes from a clean checkout.

Partial subsystem success, parser coverage, lit pixels, visual resemblance,
commit count, or progress documentation do not satisfy completion.

## Required Starting Artifacts and Implementation Order

Before product implementation begins, the repository must contain:

1. the installed Portable Evidence-Gated Verification Framework;
2. authenticated reusable compatibility-port and graphics/runtime profiles
   containing the mandatory domain-specific verification mechanisms;
3. an authenticated, adequacy-witnessed PHOSPHENE project verification
   binding;
4. mechanically extracted MilkDrop and Plane9 behavior inventories to the
   extent supported by the retained evidence;
5. operational reference adapters for every behavior class whose strongest
   binding-required oracle is executable.

Implementation begins by establishing one complete vertical path:

```text
authority → reference oracle → expected result → discriminating fixture
→ PHOSPHENE executor → comparator → PASS/FAIL
```

This order ensures that independent expected values and actual-executor
verification exist before broader product translation. It is implementation
order, not a phase boundary, reduced assignment, accepted partial framework,
or permission to stop before every scoped requirement passes.

## Execution Standard

The model has no authority to reduce scope, divide the assignment into future
phases or pulls, or declare partial completion sufficient. Only the user may
change the goal or authorize incomplete delivery.

Commits and pushes are durability operations, not stopping points, approval
checkpoints, phase boundaries, or occasions for progress reports. After each
durability operation, continue the assignment.

Task size, a useful checkpoint, a completed subsystem, a self-defined work
window, or the availability of another invocation are not reasons to stop.

Stopping before completion is justified only when a specific external action
is indispensable and cannot be performed with the available tools. A required
evidence artifact that cannot be produced with the available tools — such as
an instrumented run of the original engine on hardware the model cannot
reach — is such an external dependency. Before claiming such a dependency,
exhaust reasonable research, implementation, instrumentation, command-line,
and targeted-observation alternatives; retain the direct evidence; and
identify the precise action required.

## Enforcement

This document is operationalized by the Portable Evidence-Gated Verification
Framework, the authenticated reusable profiles selected by the project, and
an authenticated, adequacy-witnessed project verification binding.

Precedence: this document defines required behavior and approved scope; the
framework defines acceptance mechanics; reusable profiles define mandatory
domain-specific mechanisms; and the binding maps this document's requirements
to the complete applicable verification surface. Profiles and the binding may
add rigor but may not weaken, narrow, or bypass any governing document.

Changes to this document's goal or scope, and adoption or change of the
binding, require the framework's authenticated authorization and adequacy
witnesses. A producer-authored artifact claiming approval does not satisfy
this requirement.

Completion additionally requires that the framework's global verification
gate computes PASS for every scoped requirement derived from this document.

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

LLM-generated code, tests, analyses, source interpretations, reviews, and
completion claims have no special authority. They remain unaccepted until
they satisfy the same evidence and execution requirements as every other
technical claim. The fact that an artifact was generated, reviewed, or
endorsed by multiple models does not constitute independent verification.
