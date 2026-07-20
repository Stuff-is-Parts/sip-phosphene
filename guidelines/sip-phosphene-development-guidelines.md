# PHOSPHENE Development Guidelines {#top}

---

### DOCUMENT ROLE

Layer 4 guideline read during every PHOSPHENE hydration. Responsibility: owns
repo-specific context reconstruction (§1), the transpiler-centered work loop
(§2), the bounded mechanical gate and implementation choices (§3), and the
standing review discipline (§4). Universal SiP standards supply `/execute` and
general code/document rules; this guideline adds no repo-specific review,
commit, backlog, or verification framework.

---

### 1. CONTEXT RECONSTRUCTION {#context}

#### I. WHAT

Every implementation or review begins from the exact checkout, the repository
entry point, both PHOSPHENE guidelines, and task-specific primary evidence.

#### II. HOW

> **1A. Hydrate before work**
>
> Record `git rev-parse HEAD` and `git status --short`. Read
> `claude-phosphene-repo.md`, this guideline, and
> `sip-phosphene-compatibility-guidelines.md`. Then open the reference documents
> mapped by entry-point §2A and the primary artifacts mapped by the source-
> locations reference. `/execute` remains the edit-authorization boundary.

> **1B. Reconstruct after compaction**
>
> A compaction summary, handoff, audit, roadmap, commit message, or model report
> is a queue of claims to inspect, not inherited repository knowledge. Reopen
> the exact checkout and rebuild the architecture and evidence basis before
> resuming a plan. If the checkout and primary evidence do not support the
> inherited plan, discard it.

> **1C. Scope disclosure**
>
> Before prescribing or accepting substantive work, name the exact commit,
> source behavior or interdependent subsystem, primary evidence opened,
> importer/transpiler/native-executor/product paths traced, and unavailable
> evidence. The disclosure bounds the claim; it does not certify correctness.

#### III. WHY

Recent defect detail survives compaction more readily than architecture and
goal context. Reconstructing from the repository prevents a coherent generic
roadmap from displacing the established inventories, source locator,
transpilers, and native path.

[Back to Top](#top)

---

### 2. SOURCE-PORT WORK LOOP {#work-loop}

#### I. WHAT

The accumulating work product is an evidenced source mapping in a strict
transpiler that executes through the ordinary `.phos` product path.

#### II. HOW

> **2A. Select by source dependency**
>
> Select an existing inventory row and follow the authentic scene's typed
> producer, consumer, and execution dependencies. Text order, XML order,
> implementation ease, and context-window size do not define the next
> subsystem.

> **2B. Establish the complete contract**
>
> Open the mapped primary evidence and determine the full serialized shape,
> defaults, ports, nested payloads, incident connections, execution semantics,
> dataflow perimeter, render state, and resource/state/output lifecycle for the
> claimed variant. A failed search method does not close another mapped source.

> **2C. Transcribe once**
>
> Map the complete behavior onto existing `.phos` and native APIs. Extend the
> native model only for a cited source requirement it cannot represent. Put the
> mapping in `milkToPhos()` or `p9ToPhos()` so every future source instance uses
> the same mechanical translation. Every source record is consumed or reaches
> an exact refusal.

> **2D. Exercise the product path**
>
> Run an authentic source artifact through import, transpilation, canonical
> `.phos` serialization and parse, `Engine`, the shared render executor, and the
> ordinary player or Studio path. A hand-authored source-shaped fixture can
> test native mechanics but cannot establish source compatibility.

> **2E. Preserve the changed truth**
>
> Update the owning inventory or contract in the same change. Record evidence
> where its unique role places it; do not add a parallel roadmap, source map,
> completion report, or verification surface. Complete the interdependent
> subsystem instead of stopping at scaffolding, a helper, or a documentation
> checkpoint.

> **2F. Fix before documenting a limit**
>
> A known limit is documentation-only only when no current scene, editor
> surface, authentic fixture, or direct evidence can falsify its closure. If a
> current surface can expose the fix, implement the complete scoped behavior or
> keep its converter disposition explicitly unresolved; do not substitute a
> limit note for comparable due work.

#### III. WHY

The transpiler is executable documentation: one established mapping applies to
all instances and can be inspected beside its source evidence. Keeping the
loop on this path limits custom code and process surface while moving the
actual compatibility denominator.

[Back to Top](#top)

---

### 3. MECHANICAL QUALITY AND IMPLEMENTATION {#mechanical}

#### I. WHAT

PHOSPHENE uses five standard language-level tools for code quality and
established platform or library APIs for implementation; neither mechanism
certifies source behavior.

#### II. HOW

> **3A. Mechanical gate**
>
> Run `npm run gate` before code is submitted for review. It runs:
>
> | Step | Tool | Establishes |
> |---|---|---|
> | syntax | `node --check` | JavaScript parses |
> | typecheck | strict TypeScript checking | declared types connect |
> | lint | ESLint | configured code rules hold |
> | style | Stylelint | configured stylesheet rules hold |
> | deadcode | Knip | configured entry/dependency reachability holds |
>
> The gate does not establish intended behavior, source compatibility, visual
> correctness, test independence, or completeness.

> **3B. Gate boundary**
>
> Repo-specific behavioral assertions, coverage thresholds, semantic status
> aggregators, verifier-verification, and project-specific intended-behavior
> checks do not enter `npm run gate`. A new gate member requires the user to
> ratify a named standard, off-the-shelf, language-level tool.

> **3C. APIs over custom machinery**
>
> Use browser standards and admitted mature libraries where they supply the
> required capability. Admit a pinned, vendored, licensed library when an
> existing API is missing; do not build a custom imitation. Custom behavior
> remains only when no admitted API answers the source requirement, and its
> code states that boundary.

> **3D. Shared native behavior**
>
> Derive shared timing, audio, rendering, and expression machinery only after
> both source contracts are known. Source-specific semantics convert into
> explicit graph components over raw browser substrates. Ambient runtime modes
> selected by `sourceEngine` are parallel runtimes and do not belong in the
> native executor.

#### III. WHY

Standard tools make syntactic, type, lint, style, and reachability failures
hard to introduce without turning project semantics into a second software
system. Established APIs reduce custom defect surface. The remaining source-
fidelity judgment stays visible instead of being laundered through a green
mechanical label.

[Back to Top](#top)

---

### 4. REVIEW DISCIPLINE {#review}

#### I. WHAT

Review attempts to falsify the submitted compatibility claim against the
exact checkout and primary evidence, using the witnessed failure history as a
search taxonomy rather than a certification checklist.

#### II. HOW

> **4A. Required review depth**
>
> Open `reference/sip-phosphene-failure-modes-reference.md` for every
> substantive source-port review. Trace the claimed source variant through
> evidence, converter, `.phos`, native operation, render realization, authentic
> fixture, status surfaces, and product consumer. Report scope limits as
> `NOT INSPECTED`; they never inherit PASS.

> **4B. Standing falsification targets**
>
> Actively test for:
>
> - evidence-scope inflation and source-fixture substitution;
> - speculative behavior retained under a generic name;
> - negative-evidence overreach and dependency-order substitution;
> - producer-controlled expectations or correlated-review agreement;
> - dirty-worktree, ignored-corpus, cache, or unavailable-check dependence;
> - drift among converter tables, inventories, contracts, comments, output,
>   and code;
> - collapse of PASS, FAIL, SKIP, UNVERIFIED, and UNRESOLVED;
> - process, documentation, scaffolding, or verification work substituted for
>   a transpiler and product-path result.

> **4C. Review authority**
>
> A model review is candidate analysis. Executed facts, primary evidence, and
> user judgment settle the claim. An unexecuted check, unread source surface,
> or unavailable corpus is a finding about review scope, not a reason to
> describe the remaining implementation as sound.

#### III. WHY

The recurring failures are substitutions that remain fluent and internally
consistent. Review is useful when it searches for those substitutions at the
actual evidence and runtime seams, not when it produces another green status
surface.

[Back to Top](#top)
