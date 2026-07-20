# PHOSPHENE Compatibility Guidelines {#top}

---

### DOCUMENT ROLE

Layer 4 guideline read during every PHOSPHENE hydration. Responsibility: owns
the repository's compatibility goal and native-runtime boundary (§1), source
authority (§2), exactness and implementation rules (§3), evidence and
validation standard (§4), and completion condition (§5). The repository entry
point maps where these rules act; reference documents provide task-specific
evidence without amending this guideline.

---

### 1. GOAL AND NATIVE BOUNDARY {#goal}

#### I. WHAT

PHOSPHENE converts Plane9 scenes and MilkDrop presets into portable, editable
`.phos` graphs that reproduce source-defined behavior through one PHOSPHENE
native execution model.

#### II. HOW

> **1A. Required outcome**
>
> A converted scene preserves the source structure and behavior as explicit
> graph data. It remains visible, editable, saveable, reloadable, and portable.
> Native PHOSPHENE scenes and both imported formats execute through the same
> graph, resource, expression, and render-plan machinery.

> **1B. Foreign-runtime boundary**
>
> PHOSPHENE does not embed or invoke Butterchurn, projectM, Plane9, MilkDrop,
> or another foreign renderer to produce imported output. A narrowly bounded
> non-rendering reference component is permitted only when it is represented
> through the native graph contract and cannot bypass editable state or the
> native executor. Reimplemented behavior may use such a component as a
> comparison oracle.

> **1C. Architecture change boundary**
>
> The graph, resource, and executor foundation changes only when a cited
> source requirement cannot be represented. Convenience, implementation
> difficulty, document order, or a model-proposed roadmap does not reopen the
> foundation or create a parallel runtime.

#### III. WHY

The graph is the durable translation product, not an adapter around three
engines. One native model keeps imported behavior inspectable and prevents a
source-specific playback path from hiding mechanics the Studio cannot edit or
save.

[Back to Top](#top)

---

### 2. SOURCE AUTHORITY {#source-authority}

#### I. WHAT

Behavioral claims follow an engine-specific evidence hierarchy; inventories
and repository prose route the investigation but never replace primary
evidence.

#### II. HOW

> **2A. MilkDrop authority order**
>
> 1. Released MilkDrop source and format documentation.
> 2. projectM source where it implements or documents MilkDrop behavior.
> 3. Butterchurn as a secondary corroborating implementation.
> 4. Controlled runtime observation only where published sources leave a
>    material ambiguity.

> **2B. Plane9 authority order**
>
> 1. Authentic `.p9c` graph structure, ports, values, connections, assets, and
>    shaders.
> 2. Retained Plane9 binaries, helper libraries, shader libraries, string
>    tables, and other extracted implementation evidence.
> 3. Official Plane9 documentation and developer material.
> 4. Corpus-wide structural evidence.
> 5. Targeted observation of the installed engine where retained evidence does
>    not resolve behavior.

> **2C. Use of evidence**
>
> `reference/sip-phosphene-source-locations-reference.md` identifies current
> access paths and pinned revisions. Open the mapped primary artifacts during
> the task. Record conflicts between authorities and resolve them from the
> stronger tier. A failed search establishes only that the search method did
> not recover the answer; other mapped surfaces remain live until examined.

> **2D. Format scope**
>
> Accepted MilkDrop format specifications and released source define required
> behavior. Plane9 scope is bounded by authentic scene graphs and retained
> implementation evidence because no published complete specification exists.
> A retained corpus supplies regression and structural coverage; it does not
> narrow the accepted format to the examples it happens to contain.

#### III. WHY

Authority ordering stops convenient reimplementations from silently defining
the behavior being translated. Live access and pinned citations avoid a second,
hand-maintained evidence corpus becoming an intermediary authority that can be
abridged, annotated, or corrupted.

[Back to Top](#top)

---

### 3. EXACTNESS AND TRANSLATION {#exactness}

#### I. WHAT

Exact reproduction preserves source-defined structure, state, execution, and
rendering semantics; visual resemblance and successful parsing are not
substitutes.

#### II. HOW

> **3A. Preserved behavior**
>
> Translation preserves, where the source defines them:
>
> - parsed fields, defaults, nodes, ports, resources, and connections;
> - initialization, persistence, update, random, audio, and timing lifecycles;
> - equations, geometry, uniforms, transforms, and instancing;
> - shaders, helper-library behavior, execution order, and pass order;
> - textures, render targets, feedback, sampling, and resource lifetimes;
> - blend, depth, raster, load/store, and other pipeline state.

> Different graphics APIs, drivers, and numerical paths do not require pixel
> identity. A changed algorithm, state transition, order, or resource contract
> requires an explicit equivalence claim supported by evidence.

> **3B. Transpiler ownership**
>
> Each source-defined behavior is understood from primary evidence and encoded
> once in `milkToPhos()` or `p9ToPhos()`. Every parsed source record is consumed
> by an evidenced mapping or reaches a precise refusal. The converter emits
> explicit `.phos` nodes, ports, edges, expressions, and resources; it does not
> flatten, omit, or aesthetically approximate behavior to fit an inadequate
> abstraction.

> **3C. Compatibility granularity**
>
> Compatibility is variant-level. A node or behavior passes only when evidence
> covers its scene/root metadata, serialized scalar fields, nested payloads,
> input and output types, incident source connections, execution semantics,
> and resource, state, and output lifecycle. Evidence for one field cannot
> promote the enclosing node or scene.
> An authentic source artifact or mechanically extracted closed subgraph must
> retain all facts relevant to the claimed variant.

> **3D. Unsupported behavior**
>
> A behavior whose technical basis or complete native path is not established
> remains `UNRESOLVED` or `UNVERIFIED` and refuses conversion. `PASS`, `FAIL`,
> `SKIP`, `UNVERIFIED`, and `UNRESOLVED` remain distinct through aggregation
> and reporting. Missing evidence never contributes truth to compatibility.

#### III. WHY

The straightforward project unit is a source behavior mapped once into the
transpiler. Variant-level scope prevents a locally correct field, synthetic
fixture, or native operation from authorizing a broader source claim. Explicit
refusal preserves truth while the translation accumulates.

[Back to Top](#top)

---

### 4. EVIDENCE AND VALIDATION {#validation}

#### I. WHAT

Acceptance requires an inspectable chain from authoritative source fact to
expected result to the actual PHOSPHENE runtime path.

#### II. HOW

> **4A. Candidate-work rule**
>
> Model-produced research, interpretation, code, tests, fixtures, reviews, and
> completion reports are candidate artifacts. Agreement between models and a
> producer-authored green test do not independently establish correctness.

> **4B. Acceptable evidence**
>
> Evidence may include directly cited source code or documentation, retained
> instrumentation or controlled observation, mechanically extracted source
> data, expectations fixed independently of implementation, and direct
> comparison of source and PHOSPHENE state, geometry, uniforms, resources,
> execution order, or other technical behavior. Each expected value names its
> provenance and reproducible extraction method.

> **4C. Runtime-path requirement**
>
> Behavioral checks execute the actual native engine path they claim to test.
> Shader checks compile through a real target-language implementation. Static
> shape inspection and simulators do not establish executable behavior. Valid
> checks can assert parsing, defaults, state transitions, variables, buffers,
> random draws, audio, timing, expressions, geometry, uniforms, shader results,
> pass/resource order, texture/sampler behavior, pipeline state, and scene
> save/reload/re-execution.

> **4D. Equality and human judgment**
>
> Use exact equality unless a cited precision or rounding path requires a
> stated tolerance. Screenshots, SSIM, visual ranking, lit pixels, successful
> compilation, and corpus execution are not fidelity gates. Where no external
> technical reference exists, the user judges rendered behavior without that
> judgment being promoted into proof of general source compatibility.

#### III. WHY

A producer can reproduce one mistaken interpretation consistently across code,
fixture, expectation, and PASS label. Evidence earns authority only when its
origin and observation path can falsify that interpretation.

[Back to Top](#top)

---

### 5. COMPLETION AND CONTINUITY {#completion}

#### I. WHAT

The assignment completes when the accepted source formats execute through the
unified native product path with all source-defined behavior represented,
implemented, and supported by appropriate evidence.

#### II. HOW

> **5A. Completion condition**
>
> Completion requires all of the following:
>
> - native PHOSPHENE scenes, MilkDrop presets, and Plane9 scenes use the same
>   native graph execution model;
> - all source-defined behavior in scope is represented and implemented;
> - direct evidence-backed checks cover claims that can be checked and pass;
> - no supported behavior depends on a source renderer at runtime;
> - imported graphs remain editable, saveable, reloadable, and portable;
> - unsupported input is limited to malformed or genuinely externally
>   unresolvable behavior and is identified with direct evidence;
> - the ordinary player and Studio use the completed native path;
> - the build and test suite passes from a clean checkout.

> **5B. Continuity rule**
>
> Commits, pushes, documentation, context windows, and completed subsystems are
> durability events, not goal reductions or stopping conditions. Work follows
> typed source dependencies and complete interdependent subsystems rather than
> agent-invented phases. Only the user changes the goal or authorizes an
> incomplete delivery.

> **5C. External dependency rule**
>
> Stopping before completion requires one precise indispensable external
> action that available tools cannot perform. Before asserting that state,
> exhaust mapped research, implementation, instrumentation, command-line, and
> targeted-observation paths; retain the evidence and name the exact action
> still required.

#### III. WHY

Partial parsers, scaffolding, documentation, visual resemblance, and commit
count can all look like progress while leaving the translation incomplete.
The completion condition holds the project to its functional product outcome
and prevents process artifacts from becoming substitutes for source behavior.

[Back to Top](#top)
