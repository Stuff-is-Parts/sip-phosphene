# Portable Evidence-Gated Verification Framework

## Document Role

This document specifies a reusable, project-independent mechanical verification layer for software repositories.

It implements the lowest reliable enforcement layer required by the SiP development framework. It does not replace or duplicate strategic planning, backlog management, design approval, task routing, structured review, human judgment, or commit policy.

Its governing derivation is:

- **Form follows function:** every mechanism must serve a defined verification function.
- **Context efficiency:** the core remains small; project-specific machinery is installed only when required.
- **Derivation over inference:** every accepted technical claim must terminate in witnessed evidence and actual execution.
- **Binary standards:** every user-scoped requirement currently passes or the project fails.
- **Externalized reliability:** no producer, model, test author, report, or prose artifact certifies itself.
- **Functional integration:** every maintained verification artifact is consumed by a gate, and every gate traces to a required claim.

The framework is complete only when these rules are executable rather than merely documented.

---

## Known Failure Modes

The framework is designed to prevent the following recurring failures:

- **Plausible substitution:** replacing required or source-defined behavior with familiar, visually similar, or conventionally expected behavior.
- **Self-certification:** accepting work because its producer states that it is correct, complete, tested, or source-faithful.
- **Circular verification:** deriving implementation, expected results, and tests from the same unsupported interpretation.
- **Citation laundering:** attaching an authoritative citation that does not establish the exact technical claim.
- **Status laundering:** relabeling incomplete work as candidate, unresolved, unsupported, deferred, not applicable, or otherwise non-blocking.
- **Scope reduction:** omitting, postponing, subdividing, or redefining user-scoped requirements without explicit user authorization.
- **Partial-completion substitution:** treating a working subsystem, passing subset, successful parser, rendered output, or completed checkpoint as completion.
- **Analysis substitution:** producing inventories, plans, reports, documentation, or framework artifacts instead of the required implementation.
- **Test-presence substitution:** treating the existence or execution of tests as proof that the tests establish the required behavior.
- **Negative-control laundering:** accepting any failure from a defective control instead of proving that the intended check detected the intended defect.
- **Static-check substitution:** using parsing, reflection, compilation, structural inspection, or simulation where actual subject execution is required.
- **Parallel-simulator substitution:** validating a recreation of execution instead of observing the actual implementation.
- **Alternate-path substitution:** proving a toy harness, test path, fallback, reference engine, or hidden runtime instead of the actual product path.
- **Silent skipping:** reporting a required check as passed, optional, unavailable, or ignored when its provider, evidence, instrumentation, or environment is missing.
- **Comparator erosion:** widening tolerances or changing expected results in response to failures rather than from independently established evidence.
- **Environment accommodation:** weakening a requirement because it fails on a particular machine, runner, adapter, platform, locale, or toolchain.
- **Authority-conflict concealment:** selecting among conflicting sources without recording the conflict, authority ordering, evidence, and resolution.
- **Stale-evidence acceptance:** retaining PASS after an authority, fixture, comparator, adapter, implementation, or relevant environment changes.
- **Instrumentation omission:** building the product without the state, trace, resource, or execution-path visibility required to verify it.
- **Orphan machinery:** maintaining records, fixtures, providers, profiles, reports, or gates that are not consumed by a required check or traceable to approved scope.
- **Framework inflation:** expanding verification infrastructure beyond demonstrated project requirements until framework construction displaces product work.
- **Narrative progress substitution:** using commits, reports, summaries, task counts, or claimed effort as evidence of correctness or completion.
- **Correlated review:** treating agreement among models or reviewers sharing the same assumptions as independent verification.
- **Historical-authority substitution:** treating prior code, tests, reports, fixtures, or green runs as current authoritative evidence without revalidation.
- **Failure deferral:** converting a detected defect into future work rather than keeping the governing requirement in FAIL until corrected.
- **Unknown-to-plausible conversion:** filling missing knowledge with an inferred answer instead of retaining a visible failure until the required evidence exists.
- **Red-CI habituation:** making a permanently failing merge gate normal until red no longer communicates an actionable regression.
- **Authorization laundering:** accepting a producer-mintable file, statement, signature, or metadata record as evidence of external human authorization.
- **Profile underbinding:** assigning fewer verification categories, adapter capabilities, or providers than a domain requirement actually needs, producing an incomplete but apparently valid PASS.
- **Trust-root mutation:** changing the authorization allowlist through approval derived from the proposed allowlist, allowing a newly added identity to authorize its own addition.
- **Authorization-attestation laundering:** reusing a stale, mismatched, or merely present verification attestation as current proof of authorization.
- **Semantic drift under citation cover:** using accurate names, constants, comments, or citations while the executed behavior differs from the cited authority.
- **Non-discriminating fixture acceptance:** accepting a fixture that produces the same result for the claimed behavior and a plausible wrong implementation such as identity, copy, no-op, omission, reordering, sign reversal, or default substitution.
- **Equivalence laundering:** omitting source-defined or required behavior because a different implementation is asserted to be equivalent without an authority-derived proof or differential verification over the complete applicable domain.
- **Scaffolding-as-implementation:** treating a field, parameter, helper, class, trace label, configuration path, or method as implementation without proving that the actual product path invokes it and that it produces the required runtime effect.
- **Raw-evidence corruption:** labeling annotated, abridged, normalized, reconstructed, or editorialized content as verbatim authority.
- **Authority blending:** combining facts or behavior from multiple authorities into a synthetic result without preserving the authority identity of each constituent fact or recording an explicit conflict resolution.
- **Alternative-set trimming:** narrowing, replacing, shadowing, or omitting plausible alternatives mandated by an applicable profile or project binding so a weak fixture can pass.
- **Stateless-control substitution:** demonstrating fixture discrimination only against trivial identity or no-op alternatives while omitting required stateful defects such as stale-state reuse, persistence leakage, or reordered updates.
- **Divergence-route laundering:** classifying a changed algorithm, state transition, ordering, or execution path as representation-level numerical variation to avoid an equivalence claim and its proof burden.
- **Expected-value circularity:** deriving implementation, fixtures, alternatives, and expected results from the same interpretation even though a stronger executable or mechanically extractable oracle is available.
- **Stronger-oracle bypass:** using a weaker expectation source because the producer declares a stronger oracle inconvenient or unavailable without independently witnessed evidence.
- **Claim-granularity laundering:** aggregating many distinct behaviors into coarse claims so the registered checks cover the claim label but not every underlying inventory item.
- **Binding-adequacy laundering:** adopting or changing a producer-authored project binding because it is authenticated or structurally complete without an explicit external judgment that its oracle policies, inventories, categories, providers, adapter capabilities, alternatives, fixtures, and controls are sufficient for the approved scope.
- **Administrative-first displacement:** building locks, inventories, reports, and control surfaces before establishing the end-to-end oracle-to-subject verification path they exist to protect.
- **Self-authored-control collusion:** allowing a custom mechanism, its defect control, its expected signature, and its self-test to share the same internal decision logic and certify one another.

These names describe failure mechanisms, not accepted project states. When any occurs, the affected requirement remains FAIL until the underlying condition is corrected and the complete verification chain passes again.

---

## 1. Assignment

Build and fully operationalize a portable verification framework that can be installed before substantive product implementation begins.

The framework must:

1. register the project’s user-defined scope and required technical claims;
2. bind each claim to authoritative evidence or an independently established invariant;
3. execute checks against the actual implementation;
4. compute current PASS or FAIL results;
5. preserve provenance and invalidate stale results;
6. refuse unverified assumptions;
7. expose precise failure reasons without converting them into deferral states;
8. run from a clean checkout;
9. produce machine-readable reports;
10. verify its own mechanisms with positive and negative controls;
11. remain portable through project-specific providers and profiles;
12. require authenticated authorization for scope changes and judgment-dependent acceptance;
13. require a repository-specific project verification binding that prevents per-requirement under-verification;
14. distinguish merge-integrity gates from the sole global completion result;
15. require every behavioral fixture to discriminate the claimed behavior from known plausible alternatives;
16. treat every equivalence assertion as a separate claim requiring independent proof;
17. require runtime-effect witnesses for claims that structure implements behavior;
18. preserve raw authority bytes separately from excerpts, annotations, transformations, and interpretations;
19. preserve the exact authority identity of every expected constituent fact;
20. compute each claim's effective plausible-alternative set as the union of claim additions and all applicable profile and project-binding requirements;
21. require grounded reusable evaluators for every effective plausible alternative, including stateful alternatives where the binding requires them;
22. distinguish evidence-backed representation-level numerical variation from changed behavior or execution paths that require an equivalence claim;
23. require the strongest available oracle class defined by the project binding and reject producer-declared oracle unavailability without evidence;
24. map every mechanically enumerable inventory item to claims, fixtures, and executable checks without allowing coarse claim aggregation to reduce coverage;
25. build the first complete oracle-to-subject vertical verification path before administrative expansion while preserving the obligation to complete the entire framework;
26. test trust-bearing custom mechanisms through public black-box interfaces rather than duplicated internal decision logic;
27. require an authenticated adequacy judgment for every project-binding adoption or change;
28. forbid hand-derived expected values by default unless an applicable rule explicitly authorizes them;
29. avoid becoming a parallel development process or substitute project.

Do not implement project product behavior as part of this assignment except for a deliberately minimal self-test subject used only to prove the framework.

Do not stop after planning, scaffolding, dependency installation, configuration, documentation, a commit, or partial mechanism coverage. Continue until the complete framework specification below is operational.

---

## 2. Framework Boundary

The framework owns:

- scope integrity;
- authorization-witness verification;
- project verification binding integrity;
- authority registration;
- authority-conflict resolution records;
- requirement and claim registration;
- raw-authority and derived-evidence separation;
- oracle-precedence enforcement and oracle-unavailability evidence;
- mechanically extracted inventory-to-claim completeness;
- evidence provenance and per-constituent authority identity;
- fixture integrity and discrimination adequacy;
- equivalence-claim proof;
- runtime-effect witnessing;
- executable claim checks;
- computed PASS and FAIL results;
- provider execution;
- architecture and dependency gates;
- clean-environment verification;
- framework self-verification;
- structured reports.

The framework does not own:

- project priority;
- task selection;
- backlog state;
- design approval;
- architectural judgment that has not been reduced to a check;
- LLM review;
- human-only decisions;
- commit sequencing;
- project management.

The host development process decides what must be built. This framework decides whether the registered technical claims currently pass.

---

## 3. Scope and Obligation

The user defines project scope.

Every requirement inside the approved scope is mandatory.

The framework must not permit an agent, implementation, test, report, configuration file, or framework command to transform a required item into:

- deferred;
- optional;
- candidate;
- accepted limitation;
- unsupported completion;
- not applicable;
- future work;
- later phase;
- backlog work;
- partial completion.

A scope exclusion is valid only when the user explicitly changes the approved scope. The framework must not infer or self-authorize exclusions.

A specific indispensable external dependency may prevent continued execution only when:

1. the required external action is precisely identified;
2. the action cannot be performed with the available tools;
3. reasonable research, implementation, instrumentation, command-line, emulation, and controlled-observation alternatives have been exhausted;
4. direct evidence of the dependency is retained;
5. the exact human or external action required is named.

An external dependency is a reason the global verification remains FAIL. It is not an accepted status or completion state.

### Controlling Rule

> Classification describes why a required check is failing. It never changes the check from required to deferred, optional, unsupported, or complete.

---

## 4. Binary Result Model

The framework computes only:

- `PASS`
- `FAIL`

These results are never stored as editable declarations in requirement, claim, evidence, fixture, or scope records.

The repository stores the facts from which the result is derived. The framework computes the result from current repository contents and current execution.

A requirement passes only when all of the following are current and valid:

1. the requirement is inside approved scope;
2. the claim is precisely stated;
3. applicable authority and conflict records are complete;
4. every expected constituent fact identifies its exact authority or conflict resolution;
5. raw authority and derived evidence are correctly separated and hash-valid;
6. the expected result originates from the strongest available oracle class required by the applicable project-binding and profile rules;
7. any use of a weaker oracle is supported by independently witnessed evidence that every stronger required oracle class is genuinely unavailable;
8. every mechanically enumerable inventory item maps to one or more claims, fixtures, and executable checks without coverage loss through aggregation;
9. the effective plausible-alternative set is the complete union required by the claim, every applicable selected profile, and every applicable project-binding rule;
10. each behavioral fixture discriminates the claim from every alternative in that effective set through a registered, grounded evaluator;
11. every required stateful alternative is exercised where applicable;
12. every equivalence claim has an independently established proof or complete-domain differential verification;
13. every representation-level numerical allowance has evidence establishing its cause and permitted magnitude;
14. every implementation-effect claim is witnessed through the actual product path;
15. evidence provenance is complete;
16. all referenced artifacts match their locked hashes;
17. the actual subject implementation is exercised;
18. the required checks pass;
19. required providers and instrumentation are available;
20. no relevant dependency, adapter, comparator, fixture, alternative evaluator, oracle policy, inventory mapping, implementation, authority, profile, project binding, or evidence change has invalidated the result.

Anything else is FAIL.

Failure reasons must be precise and machine-readable. Examples include:

- `IMPLEMENTATION_MISSING`
- `AUTHORITY_MISSING`
- `AUTHORITY_CONFLICT_UNRESOLVED`
- `EVIDENCE_MISSING`
- `EVIDENCE_STALE`
- `DERIVATION_NOT_REPRODUCIBLE`
- `STRONGER_ORACLE_BYPASSED`
- `ORACLE_UNAVAILABILITY_UNPROVEN`
- `EXPECTED_VALUE_ORIGIN_UNACCEPTABLE`
- `INVENTORY_ITEM_UNCLAIMED`
- `CLAIM_COVERAGE_COARSE`
- `BEHAVIOR_COVERAGE_UNPROVEN`
- `BINDING_ADEQUACY_UNWITNESSED`
- `SELF_TEST_CIRCULAR`
- `FIXTURE_MISSING`
- `FIXTURE_STALE`
- `COMPARATOR_UNJUSTIFIED`
- `CHECK_MISSING`
- `CHECK_FAILED`
- `NEGATIVE_CONTROL_INVALID`
- `INSTRUMENTATION_MISSING`
- `PROVIDER_UNAVAILABLE`
- `SUBJECT_EXECUTION_UNAVAILABLE`
- `SCOPE_APPROVAL_MISSING`
- `AUTHORIZATION_WITNESS_MISSING`
- `AUTHORIZATION_WITNESS_UNVERIFIED`
- `PROJECT_BINDING_MISSING`
- `PROJECT_UNDERBOUND`
- `IDENTITY_ALLOWLIST_CHANGE_UNAUTHORIZED`
- `AUTHORIZATION_ATTESTATION_INVALID`
- `RAW_AUTHORITY_MUTATED`
- `EVIDENCE_CLASS_MISDECLARED`
- `AUTHORITY_SOURCE_AMBIGUOUS`
- `FIXTURE_NONDISCRIMINATING`
- `ALTERNATIVE_SET_UNDERBOUND`
- `ALTERNATIVE_EVALUATOR_MISSING`
- `ALTERNATIVE_EVALUATOR_UNGROUNDED`
- `STATEFUL_ALTERNATIVE_MISSING`
- `DIVERGENCE_CLASSIFICATION_UNJUSTIFIED`
- `EQUIVALENCE_UNPROVEN`
- `RUNTIME_EFFECT_UNWITNESSED`
- `REGRESSION_UNAUTHORIZED`
- `EXTERNAL_DEPENDENCY`

Failure codes explain the active failure. They do not authorize stopping or deferral.

Project completion is computed:

> The project passes only when every requirement inside approved scope has a current PASS result.

There is no separate editable project-complete flag.

---

## 5. Portability Architecture

Implement the framework as a repository-local Node.js and TypeScript orchestration package so the same mechanical layer operates on Windows, Linux, and macOS.

The host product may use any language, runtime, build system, or deployment model.

The core framework must not assume that the host product is written in JavaScript or TypeScript.

Use an isolated structure:

```text
tooling/
  verification-kit/
    package.json
    package-lock.json
    tsconfig.json
    src/
      core/
      cli/
      schemas/
      locks/
      adapters/
      providers/
      profiles/
      reporters/
      self-test/
    templates/
    bin/
    tests/
```

The host repository receives:

```text
verification/
  config/
    project.json
    providers.json
  scope/
    scope.json
    scope.lock.json
  authorization/
    authorized-identities.json
    bootstrap-record.json
    witnesses/
    attestations/
    authorization.lock.json
  authorities/
    authorities.json
    authorities.lock.json
    conflicts/
  requirements/
  claims/
  evidence/
  fixtures/
    inputs/
    expected/
    records/
  comparators/
  adapters/
  checks/
  profiles/
    selected.json
    overrides/
  binding/
    project-verification-binding.json
    project-verification-binding.lock.json
  reports/
```

Generated reports must be ignored by version control unless a project explicitly retains selected run artifacts.

### Honest Portability Contract

The initializer supports any Git workspace in which the framework’s declared Node runtime can execute.

It may create and operate its own isolated package beneath `tooling/verification-kit/`.

It must not claim automatic integration with an arbitrary host build system. Host integration occurs only through an installed and tested provider or profile.

Unsupported or ambiguous integration must be refused with a precise error. It must not be guessed.

---

## 6. Initializer

Expose:

```text
node tooling/verification-kit/bin/verify.mjs init
```

The initializer must:

1. locate the repository root;
2. preserve unrelated files and configuration;
3. create only absent framework artifacts;
4. update only framework-owned configuration;
5. refuse destructive or ambiguous edits;
6. be idempotent;
7. work in paths containing spaces;
8. use no Unix-only commands;
9. work in an empty Git repository;
10. work in an existing repository without assuming its language;
11. maintain its own lockfile;
12. install only the portable core until a profile is explicitly selected;
13. report every created, changed, preserved, and refused path.

The initializer must be tested against exactly the repository classes the framework claims to support.

Do not claim broader initializer compatibility than the automated test matrix demonstrates.

### 6.1 Risk-First Vertical Implementation Order

Implementation order must establish the smallest complete verification path that terminates in independent expected values and actual subject execution before expanding administrative surfaces.

The first vertical path is:

```text
raw authority or authoritative executable
→ strongest available oracle output
→ evidence-bound expected result
→ discriminating fixture
→ actual subject execution
→ comparator
→ computed PASS or FAIL
→ clean reproduction
```

For a repository whose highest semantic risk requires a reference adapter, that adapter and its reproducible output path precede locks, dashboards, broad inventories, and reporting conveniences that do not yet protect an executable claim.

This is an implementation order, not a phase model, reduced scope, checkpoint, or stopping permission. The first vertical path does not complete the framework. After it operates, implementation continues until every required mechanism in this specification passes.

Administrative machinery may be built earlier only when it is indispensable to the first vertical path. A mechanism that cannot yet trace to an executing claim remains unfinished infrastructure and cannot be represented as progress toward product compatibility.

---

## 7. Core Records

Use strict JSON Schemas. Use `additionalProperties: false` unless a deliberate extension point is defined.

Record schemas must reject unknown fields, missing provenance, invalid references, and identifiers that do not resolve.

### 7.1 Scope Record

The scope record defines:

- approved product, format, protocol, or interface boundaries;
- accepted versions;
- required subsystems;
- required environments;
- required corpora or datasets;
- explicit user-authorized exclusions;
- the source of each user authorization;
- completion conditions.

A scope change must:

1. be explicit;
2. include a reason;
3. identify an authenticated authorization witness defined by §7.9;
4. update the scope lock;
5. invalidate affected results;
6. trigger global re-verification.

The framework must not claim a scope change is user-authorized unless an authenticated authorization witness defined by §7.9 is verified. A repository file that the producer can create is not authorization.

### 7.2 Authority Record

Each authority record includes:

- stable authority ID;
- authority type;
- source name;
- exact version, revision, commit, binary version, artifact version, or content hash;
- retained local path or reproducible locator;
- SHA-256 where applicable;
- acquisition or extraction method;
- date recorded;
- license or usage note where known.

An authority record identifies a source. It does not prove that a claim follows from that source.

#### Raw Authority Artifacts

When authority content is retained in the repository, it must be registered as a `raw-authority` artifact containing the exact acquired bytes.

A raw-authority record includes:

- authority ID;
- exact upstream locator;
- pinned version, revision, or commit;
- acquisition command or reproducible retrieval procedure;
- acquired byte length;
- SHA-256 of the exact bytes;
- local retained path;
- acquisition date and tool version.

Raw authority artifacts must not contain inserted comments, headings, annotations, omissions, normalization, line-ending conversion, formatting changes, or reconstructed content unless the authoritative source itself supplied those bytes.

Excerpts, annotations, normalized copies, translations, extracted tables, and interpretations are `derived-evidence` artifacts. They must live separately and reference the raw authority artifact from which they derive.

The framework must be able to compare a retained raw artifact against the pinned source when that source remains reproducibly available. A mismatch produces `RAW_AUTHORITY_MUTATED`.

### 7.3 Authority-Conflict Record

When authorities disagree, create a conflict record containing:

- stable conflict ID;
- affected requirement and claim IDs;
- each conflicting authority ID;
- exact source locations;
- the incompatible technical conclusions;
- authority priority or tier;
- the evidence used to resolve the disagreement;
- the selected conclusion;
- affected fixtures, comparators, and checks;
- the retained reason when the conflict remains unresolved.

An unresolved conflict produces FAIL.

A prose note outside this record does not resolve the conflict.

### 7.4 Requirement Record

Each requirement includes:

- stable requirement ID;
- approved scope reference;
- exact required behavior or condition;
- applicability conditions;
- source or authority references;
- completion relevance;
- required verification categories;
- associated claim IDs;
- implementation surfaces;
- required providers.

Requirement records contain no editable completion status.

Every registered requirement is required unless the approved scope is changed by the user.

### 7.5 Claim Record

A claim is a specific mechanically testable assertion about the current implementation.

Each claim includes:

- stable claim ID;
- requirement IDs;
- claim kind: `behavior`, `equivalence`, `runtime-effect`, or another profile-defined mechanically checkable kind;
- exact assertion;
- actual subject operation;
- actual product-path entry point where applicable;
- required inputs;
- expected-result references;
- per-constituent authority mapping for every expected field, value, ordering rule, or behavior;
- authority IDs;
- conflict IDs where applicable;
- evidence IDs;
- fixture IDs;
- comparator IDs;
- check IDs;
- adapter capabilities;
- provider IDs;
- implementation paths;
- source-inventory item IDs covered by the claim;
- oracle-precedence rule ID and actual expected-value origin;
- any oracle-unavailability evidence IDs;
- claim-declared plausible alternatives, which may add to but never narrow the effective alternative set;
- runtime-effect witness requirements where the claim asserts that structure implements behavior.

The effective plausible-alternative set is computed as the union of:

1. claim-declared additions;
2. every alternative required by every applicable selected reusable profile; and
3. every alternative required by every applicable project-binding rule.

Claim-level declarations may add alternatives but may not remove, replace, narrow, shadow, or override profile- or binding-required alternatives. Duplicate stable alternative IDs may be deduplicated only when their definitions and evaluator requirements are identical.

An `equivalence` claim additionally includes:

- the two behaviors or paths claimed equivalent;
- the complete applicable input domain;
- independently established expectations for both paths;
- the authority-derived proof or differential check that establishes equivalence;
- any excluded domain, authorized only through approved scope.

A `runtime-effect` claim additionally includes:

- the structure or mechanism asserted to implement behavior;
- the actual product path that invokes it;
- the observable state or output it must change;
- a controlled intervention, removal, perturbation, or trace condition capable of proving that the mechanism has the asserted effect.

Claim records contain no editable PASS, FAIL, verified, candidate, unsupported, unresolved, or not-applicable field.

### 7.6 Evidence Record

Each evidence record includes:

- stable evidence ID;
- evidence class: `reference-execution`, `mechanical-extraction`, `formal-derivation`, `controlled-observation`, `hand-derived-exact`, `derived-evidence`, or another profile-defined class;
- requirement and claim IDs;
- authority IDs;
- raw-authority artifact IDs where applicable;
- exact source locations;
- per-constituent authority mapping for every expected field, value, ordering rule, or behavior;
- the precise technical fact established;
- extraction, observation, or derivation procedure;
- retained derived artifact or excerpt where appropriate;
- expected-result artifact;
- comparator ID;
- tool and version used for mechanical extraction;
- reproducibility command or procedure;
- oracle-precedence rule ID;
- stronger oracle classes considered;
- evidence establishing unavailability of every bypassed stronger oracle class, where applicable;
- content hash.

Evidence must establish the exact claim. Adjacent, generally relevant, or merely plausible material is insufficient.

No derived artifact may be represented as raw authority. No expected result may silently blend multiple authorities. Where multiple authorities supply different constituents, the evidence record must preserve the authority identity of each constituent. Where they disagree, §7.3 applies.

### 7.7 Fixture Record

Each fixture record includes:

- stable fixture ID;
- requirement and claim IDs;
- input artifact;
- expected artifact;
- authority IDs;
- evidence IDs;
- comparator ID;
- fixture hash;
- creation, extraction, or observation procedure;
- the effective plausible-alternative IDs it must distinguish from;
- the alternative-evaluator ID used for each alternative;
- the expected divergence produced by each alternative;
- the check that proves the fixture is discriminating.

A behavioral fixture is valid only when its inputs produce a different expected result for the claimed behavior than for every alternative in the effective plausible-alternative union. Applicable alternatives include identity, copy, no-op, omission, reordering, sign reversal, stale-state reuse, wrong default, and other domain-specific defects named by the claim, project binding, or selected profile.

A fixture that cannot distinguish the claim from an applicable plausible alternative produces `FIXTURE_NONDISCRIMINATING` even when the fixture's expected result is otherwise correct.

Fixtures are correctable. Changes must be explicit, locked, reviewed, and followed by re-verification.

### 7.8 Comparator Record

Each comparator record includes:

- stable comparator ID;
- exact comparison rule;
- data type and units;
- equality mode;
- permitted tolerance, if any;
- the specific demonstrated numerical or representation path justifying the tolerance;
- applicable environment or arithmetic profiles;
- evidence references;
- failure-reporting rule.

Exact equality is the default.

A tolerance may not be widened because CI failed.

Adapter or environment metadata may select only among pre-authorized, evidence-backed comparison profiles.

An unknown environment/profile combination fails.

Representation-level numerical variation belongs in a comparator profile only when the underlying algorithm, state transitions, operation ordering, and execution path remain the same and independent evidence establishes both the cause and permitted magnitude of the variation. Observing different results across platforms, adapters, compilers, or runtimes does not itself justify a tolerance. A changed algorithm, state transition, ordering, or execution path is behavioral divergence and must be represented as an equivalence claim under §14.2 rather than routed through a comparator. Misclassification produces `DIVERGENCE_CLASSIFICATION_UNJUSTIFIED`.

Every comparator change:

1. passes through the evidence lock;
2. records the exact change and reason;
3. invalidates all affected prior results;
4. reruns all affected checks.

### 7.8A Plausible-Alternative Evaluator Record

Each plausible-alternative evaluator record includes:

- stable evaluator ID;
- stable alternative ID;
- defect class modeled;
- statefulness: `stateless` or `stateful`;
- applicable requirement classes, categories, or claim kinds;
- evaluator implementation or provider entry point;
- input preconditions;
- expected divergence path, field, event, or value;
- the authority, formal defect model, retained witnessed failure, or other grounded reason establishing that the alternative is plausible;
- the negative-control signature proving that the evaluator itself detects the intended alternative.

An evaluator models a plausible defect; it does not supply the authoritative expected result. An evaluator without a grounded defect class produces `ALTERNATIVE_EVALUATOR_UNGROUNDED`. A required alternative without an operational evaluator produces `ALTERNATIVE_EVALUATOR_MISSING`.

Reusable profiles should supply evaluators for recurring alternatives so implementation cost does not encourage omission. Cost does not authorize removing a required alternative. Project bindings may require additional repository-specific evaluators.

### 7.8B Oracle-Precedence Rule

Each requirement class must resolve to an oracle-precedence rule supplied by an applicable reusable profile, the project verification binding, or both.

Each rule includes:

- stable oracle-precedence rule ID;
- applicable requirement and behavior classes;
- ordered required oracle classes from strongest to weakest;
- required provider and adapter capabilities for each oracle class;
- the conditions under which each weaker required class may be used;
- the evidence required to establish unavailability of every bypassed stronger class;
- any optional oracle classes separately from the required ordered list;
- an explicit applicability rule for every optional class;
- the independent review or authorization requirement for any interpretive expectation;
- failure codes for unacceptable origin or unsupported bypass.

The strongest available required oracle class must be used. Availability is determined by executable capability and retained evidence, not producer preference, convenience, task size, implementation cost, or a statement that an oracle would be difficult to build.

`hand-derived-exact` is forbidden by default and must not appear in a generated default ordered oracle list. It may be enabled only by an explicit applicable profile or project-binding rule that:

1. identifies the exact requirement classes for which it is permitted;
2. states the authoritative premises and reproducible calculation procedure;
3. requires independently retained evidence that every stronger required oracle class is unavailable; and
4. requires any additional authenticated judgment specified by the governing project documents.

Absence of that explicit rule means `hand-derived-exact` is prohibited. A general evidence-class declaration, a derived-evidence artifact, or a producer statement does not authorize it.

Where an authoritative executable, mechanically extractable result, formal derivation, or controlled source-runtime observation is available and required by the rule, producer-derived expectations do not satisfy the claim.

Bypassing a stronger oracle, using an optional oracle without explicit authorization, or supplying only producer-authored unavailability claims produces `STRONGER_ORACLE_BYPASSED`, `ORACLE_UNAVAILABILITY_UNPROVEN`, or `EXPECTED_VALUE_ORIGIN_UNACCEPTABLE` as applicable.

### 7.9 Authorization-Witness Record

The framework distinguishes two witness classes.

A **mechanical witness** establishes that an operation occurred or produced a result. Its authority comes from reproducibility and actual execution.

An **authorization witness** establishes that a decision was made by an authority outside the producer's control. It is required for:

- user-approved scope changes;
- user-approved exclusions;
- acceptance of an irreducibly interpretive judgment;
- authorization of a regression in previously passing behavior;
- definition or change of the repository's project verification binding;
- explicit adequacy judgment for adoption or change of the repository's project verification binding;
- changes to the authorization identity allowlist;
- any other action the governing project documents reserve to the user or a configured human authority.

Each authorization-witness record includes:

- stable witness ID;
- authorization type;
- exact decision authorized;
- affected scope, requirement, claim, authority, evidence, fixture, comparator, adapter, profile, project-binding, or identity-allowlist IDs;
- configured authorizing identity or key;
- verification method;
- repository-host or signature metadata;
- timestamp;
- retained verification result.

Valid mechanically verifiable authorization classes are limited to:

- approval or review from an allowlisted human repository-host account, verified through the host API;
- a cryptographic signature from an allowlisted key whose private key is unavailable to the producer, agent, and CI process;
- another repository-host-enforced approval mechanism explicitly configured by the user and verified through its API.

A signed commit is not external authorization when the producer or agent controls the signing key. A file, comment, front-matter field, lock reason, or claimed user statement is not external authorization merely because it says that approval occurred.

#### Authorization Root of Trust

The initial `authorized-identities.json` is established through a repository-administration action or another out-of-band user-controlled bootstrap action. The bootstrap record must identify:

- the initial allowlist hash;
- the repository identity;
- the establishing mechanism;
- the external actor or administration event;
- the time established;
- the verification method available to the framework.

After bootstrap, an allowlist change is valid only when authorized by:

- a witness verified against the **base revision's allowlist**; or
- a repository-administration event outside the producer's control.

The proposed revision's allowlist cannot authorize its own adoption. A newly added identity cannot authorize its own addition. An identity being removed cannot be the sole authorizer of a replacement allowlist when that authorization was created after the proposed change.

Updating `authorization.lock.json`, supplying a reason, or retaining a diff makes the change visible; none authorizes it.

`verify change-integrity` must reject any identity-allowlist or bootstrap-record change that lacks valid base-allowlist or repository-administration authorization.

Where the available environment can verify only witness presence and linkage, the framework must state that limit explicitly. Presence without authenticated origin does not authorize the action; the affected requirement remains FAIL until repository administration or a human authority supplies a verifiable witness.

### 7.10 Authorization Verification Attestation Record

Live repository-host or signature verification produces an authorization verification attestation.

Each attestation includes:

- stable attestation ID;
- repository identity;
- exact commit or tree hash;
- witness ID and witness-object hash;
- exact authorized decision and affected artifact IDs;
- base identity-allowlist hash;
- project-binding hash when the decision affects project verification;
- verification provider and version;
- repository-host event or signature-verification result;
- verification timestamp;
- attestation hash.

An attestation is valid only for the exact repository, commit, witness, decision, affected artifacts, and base allowlist recorded in it.

It is invalidated when any bound value changes, including:

- commit or tree;
- witness object;
- authorized decision;
- affected scope or project binding;
- identity allowlist;
- repository identity;
- verification-provider interpretation.

A clean or network-isolated run may verify the hash, linkage, and exact binding of a previously live-verified attestation. It may not claim that it independently re-authenticated the external actor.

Final authorization-dependent PASS requires both:

1. a live authenticated verification job producing or refreshing the attestation; and
2. the clean-environment job verifying the retained attestation's integrity and exact linkage.

A stale, mismatched, merely present, or producer-authored attestation produces `AUTHORIZATION_ATTESTATION_INVALID`.

### 7.11 Reusable Profile Record

A reusable profile packages maintained verification machinery for a technology, product form, or recurring technical domain.

Examples include a language library, command-line application, HTTP service, database application, web application, browser integration, hardware integration, compatibility port, or other reusable technical surface.

Each profile record includes:

- stable profile ID;
- profile version and hash;
- technical domain or product form;
- categories supplied;
- providers supplied or required;
- adapter capabilities supplied or required;
- positive controls;
- negative-control defect classes;
- plausible-alternative catalog entries;
- reusable alternative evaluators, including stateful evaluators where the profile's failure model requires them;
- mandatory fixture-discrimination checks;
- CI jobs;
- applicability predicates;
- limitations and unsupported integrations.

A reusable profile supplies mechanisms. It does not define a repository's scope and does not independently decide which mechanisms are sufficient for that repository.

A profile may not weaken a core evidence rule, authorize a scope change, or convert a missing capability into PASS.

### 7.12 Project Verification Binding Record

A portable core cannot infer the complete verification surface of every repository. Each repository therefore requires one authoritative project verification binding.

The project binding maps approved project scope and governing specifications to the minimum verification surface. It may select reusable profiles and add repository-specific requirements, providers, adapter capabilities, and controls.

Each project-binding record includes:

- stable project-binding ID;
- repository identity;
- approved scope hash;
- governing specification locations;
- requirement classes or source-behavior classes;
- selected reusable profile IDs and hashes;
- mandatory verification categories per requirement class;
- mandatory adapter capabilities per requirement class;
- mandatory providers per requirement class;
- mandatory positive controls;
- mandatory negative-control defect classes;
- mandatory plausible-alternative classes per requirement class;
- mandatory alternative-evaluator IDs per requirement class;
- mandatory stateful alternative classes where applicable;
- mandatory fixture-discrimination checks;
- mandatory product-path checks;
- mandatory oracle-precedence rules per requirement class;
- an explicit statement that mandatory evidence classes govern retained artifact presence while expected-value origin is governed exclusively by the oracle-precedence rules;
- required inventory or extraction procedures and their machine-readable stable-ID outputs;
- inventory-to-claim, fixture, and executable-check coverage rules;
- claim-aggregation rules preventing any reduction of required control surface;
- repository-specific additions or overrides;
- authenticated authorship or adoption witness for initial adoption or change;
- authenticated binding-adequacy witness explicitly judging the sufficiency of oracle policies, inventory procedures, verification categories, providers, adapter capabilities, plausible alternatives, evaluators, fixture-discrimination checks, product-path checks, and other controls for the approved scope.

The binding establishes the minimum verification surface for every scoped requirement. An individual requirement may add checks or plausible alternatives but may not remove, weaken, shadow, or bypass a mandatory binding.

For each requirement, the framework must compute the effective plausible-alternative set as the union of claim additions, all applicable selected-profile alternatives, and all applicable project-binding alternatives. The project binding must also name the mandatory evaluator and fixture-discrimination surface for those alternatives.

Project-binding adoption or modification requires an authenticated adequacy witness distinct from mere authorship, file approval, or lock acceptance. The same external authorization event may satisfy both adoption and adequacy only when its retained decision explicitly evaluates every required adequacy surface named above. A generic approval, producer-authored checklist, or signature over the file without that explicit judgment does not establish adequacy. Absence of a valid adequacy witness produces `BINDING_ADEQUACY_UNWITNESSED`.

`BEHAVIOR_COVERAGE_UNPROVEN` applies when the completeness of the behavior inventory itself has not been mechanically established and the remaining completeness judgment lacks a valid authenticated witness. It is distinct from `INVENTORY_ITEM_UNCLAIMED`, which applies when a known extracted inventory item lacks claim, fixture, or executable-check coverage.

A requirement fails when:

- the repository has no project verification binding;
- no binding rule applies to the requirement;
- its selected categories, capabilities, providers, controls, plausible alternatives, evaluators, or fixture-discrimination checks omit any mandatory binding or applicable selected-profile requirement;
- a claim-level alternative declaration narrows, replaces, shadows, or omits a profile- or binding-required alternative;
- the binding does not map each governing specification category to a concrete mechanism;
- the binding permits a weaker expected-value origin while a stronger required oracle is available;
- oracle unavailability is producer-declared rather than evidence-backed;
- a mechanically enumerated inventory item has no claim, fixture, or executable-check mapping;
- claim aggregation reduces the fixture, alternative, oracle, or execution surface required for any mapped inventory item;
- behavior-inventory completeness is not mechanically established and lacks an authenticated residual-completeness witness;
- initial adoption or change of the project binding lacks an authenticated adequacy witness explicitly covering the required adequacy surfaces;
- a selected reusable profile is missing, stale, or incompatible;
- the binding change lacks authenticated authorization.

The framework must mechanically compare each requirement against the project binding. Category selection is not left to the implementing agent on a requirement-by-requirement basis.

Where required behavior can be mechanically enumerated from specifications, schemas, code, binaries, metadata, or corpora, the binding must require that extraction and produce stable inventory IDs. Every inventory ID must map to one or more claims, fixtures, and executable checks. A claim spanning multiple inventory items satisfies coverage only when each mapped item is independently exercised by the required oracle, fixture, alternative, and execution surface. Aggregation may organize records but may not reduce verification coverage.

Residual inventory completeness that cannot be mechanically established remains FAIL until an authenticated human judgment witness resolves it. A producer-authored assertion that the inventory is complete is insufficient.

No project, technology, product, or domain-specific verification requirement belongs in the portable core. Such requirements belong in reusable profiles or the repository's project verification binding.

---

## 8. Evidence, Authorization, Project-Binding, Profile, and Scope Locks

Implement lockfiles for:

- approved scope;
- authorization identities, bootstrap record, witnesses, and attestations;
- selected reusable profiles;
- the project verification binding;
- authorities;
- authority conflicts;
- evidence;
- fixtures;
- comparators.

Expose commands equivalent to:

```text
verify scope-lock --reason "..." --authorization-witness "..."
verify authorization-lock --reason "..." --authorization-witness "..."
verify project-binding-lock --reason "..." --authorization-witness "..."
verify evidence-lock --reason "..."
```

A lock check must fail when:

- a registered artifact changed without a corresponding lock update;
- a hash is stale;
- an artifact is missing;
- a reference does not resolve;
- provenance is incomplete;
- a comparator changed without invalidation;
- a raw-authority artifact changed or no longer matches its registered exact bytes;
- a derived artifact is mislabeled as raw authority;
- a per-constituent authority mapping is missing or ambiguous;
- a fixture's discriminating alternatives, evaluator assignments, or divergence expectations changed without invalidation;
- an effective alternative set, profile alternative catalog, project-binding alternative rule, or evaluator changed without invalidation;
- an equivalence proof or applicable domain changed without invalidation;
- a divergence was reclassified between comparator variation and behavioral equivalence without evidence and invalidation;
- a runtime-effect witness changed without invalidation;
- an authority changed without re-derivation;
- a conflict resolution changed without affected fixture and check review;
- a scope change lacks a verified authorization witness;
- an authorization witness is producer-mintable or cannot be authenticated;
- an identity-allowlist or bootstrap-record change lacks base-allowlist or repository-administration authorization;
- an authorization attestation is stale, mismatched, or unbound;
- the repository lacks a project verification binding;
- a requirement is underbound relative to the project binding;
- a selected reusable profile is missing or stale;
- the project binding changed without authenticated authorization;
- an oracle-precedence rule changed without invalidating and rerunning affected expectations and claims;
- an inventory extraction or inventory-to-claim mapping changed without invalidating affected coverage results;
- a current PASS relies on stale inputs.

A lock-update command must:

- require a nonempty reason;
- show every changed artifact;
- show old and new hashes;
- record commit and dirty-worktree state;
- record the command and time;
- update lock metadata only;
- never rewrite evidence, fixtures, expected results, comparators, or scope content;
- produce a structured report.

Updating a lock makes a change visible. It does not establish that the changed content is correct.

---

## 9. Evidence Validity Boundary

The framework can mechanically verify:

- source identity;
- source version and hashes;
- raw-authority byte integrity;
- raw-versus-derived artifact classification;
- exact source locations;
- per-constituent authority identity;
- provenance completeness;
- effective plausible-alternative union computation;
- fixture discrimination against every alternative in that union;
- alternative-evaluator identity, grounding, and statefulness;
- mechanically extracted expected values;
- reference-executor outputs;
- reproducible derivation procedures;
- artifact linkage;
- check execution;
- subject execution;
- result freshness;
- comparison results.

The framework does not prove the substantive correctness of an interpretive derivation merely because the derivation was recorded.

When a derivation can be made executable, it must be made executable. The applicable oracle-precedence rule, not producer discretion, defines which evidence class is required.

An expected result may originate from reference execution, mechanical extraction, formal derivation, controlled observation, or another independently justified procedure selected by the applicable oracle-precedence rule. Reference execution is not universally required. However, when an applicable profile or project binding identifies an authoritative executable, mechanically extractable result, formal derivation, or controlled source-runtime observation as a stronger available oracle, that stronger source is mandatory.

`mandatoryEvidenceClasses` or equivalent artifact-presence fields govern which evidence artifacts must be retained. They do not determine or authorize the expected-value origin. Expected-value origin is governed exclusively by the applicable oracle-precedence rule.

Hand-derived expectations are forbidden unless explicitly enabled under §7.8B for the exact requirement class. Discriminating fixtures protect against wrong implementations given an expectation; they do not establish that the expectation itself is correct. Oracle precedence prevents the implementation, fixture, alternatives, and expected result from collapsing onto one unsupported interpretation.

When a conclusion remains genuinely interpretive after reasonable mechanization, it must terminate in the host process's structured review or human judgment. Acceptance requires an authenticated authorization witness under §7.9 identifying the decision and affected claims. A producer-authored record of alleged approval is insufficient. Until the judgment and its verifiable witness exist, the requirement remains FAIL.

This boundary must appear in generated documentation and verification reports.

---

## 10. Adapter Contracts and Product Instrumentation

The framework must exercise the actual implementation, not a parallel simulator.

### 10.1 Subject Adapter

The subject adapter provides applicable operations such as:

- build;
- initialize;
- parse;
- execute a controlled operation;
- inspect state;
- inspect intermediate values;
- expose events and traces;
- expose resource and side-effect activity;
- save;
- reload;
- migrate;
- invoke external interfaces;
- invoke the actual product path;
- classify corpus items;
- expose explicit errors and refusals.

A required adapter capability that is unavailable produces FAIL.

### 10.2 Reference Adapter

The reference adapter obtains independently established results from:

- an authoritative executable;
- a source-derived extractor;
- a specification-derived calculator;
- a controlled observation;
- a retained dataset;
- another independently justified source.

It must not fabricate expected behavior.

When the reference adapter produces an expectation, it must retain the exact authority identity, tool version, input, output, and reproduction procedure. A value generated from one authority must not be attributed to another.

### 10.3 Product Adapter

The product adapter exercises the actual user-facing or externally consumed entry point.

A toy harness, alternate implementation, hidden fallback, or test-only path does not prove the product uses the verified implementation.

The existence of a field, parameter, helper, class, planner, trace label, configuration path, or method does not prove implementation. Claims that such structure implements behavior require a runtime-effect witness showing that the actual product path invokes the structure and that a controlled intervention or trace demonstrates its required effect.

### 10.4 Instrumentation Is Product Architecture

If a required claim depends on state, order, resources, intermediate values, side effects, or execution-path identity, the actual product must expose the corresponding instrumentation.

Instrumentation required for verification is an architectural requirement, not optional test glue.

Adapter contracts may be revised as the real product architecture develops, but every change must:

1. identify affected requirements and claims;
2. invalidate their prior results;
3. preserve or deliberately replace required observability;
4. update checks and evidence;
5. run the affected suite again.

An adapter change must never silently remove the framework’s ability to witness a required claim.

---

## 11. Providers and Profiles

The portable core contains only mechanisms required by every project:

- schema validation;
- scope and evidence locks;
- authority conflicts;
- requirement and claim linkage;
- computed PASS and FAIL;
- provider invocation;
- clean execution;
- structured reporting;
- orphan detection;
- framework self-verification.

Project-specific mechanics are installed through providers and reusable profiles, then made mandatory through the repository's project verification binding.

### Provider Examples

- build provider;
- unit-test provider;
- static-analysis provider;
- schema provider;
- API provider;
- browser provider;
- database provider;
- migration provider;
- concurrency provider;
- security provider;
- mutation provider;
- dependency-boundary provider;
- performance provider;
- container provider;
- hardware provider.

### Profile Examples

- TypeScript library;
- Python package;
- command-line tool;
- HTTP service;
- web application;
- database application;
- data pipeline;
- desktop application;
- embedded system;
- compatibility port;

A profile may:

- install providers;
- define adapter capabilities;
- add schemas;
- add check helpers;
- add CI jobs;
- add self-tests;
- define oracle-precedence rules;
- define inventory extraction and minimum per-item coverage rules.

A profile may not:

- weaken a core evidence rule;
- mark a required check optional;
- convert an unavailable provider into PASS;
- silently widen a comparator;
- narrow, replace, shadow, or omit an effective plausible alternative;
- route behavioral divergence through a comparator without independent evidence;
- hide a failure;
- accept a non-discriminating fixture;
- assert equivalence without proof;
- accept structure without a runtime-effect witness;
- blur raw authority and derived evidence;
- bypass a stronger available oracle;
- permit coarse claims to reduce inventory-item coverage;
- change approved scope.

Provider and profile selection must be traceable to actual project requirements.

Every repository must have a project verification binding under §7.12 before any host requirement can pass. Reusable profiles supply maintained mechanisms; the project binding decides which mechanisms are mandatory for the repository's approved scope.

A requirement that needs a provider fails until a suitable provider is installed and operational. A requirement that omits any mechanism mandated by the project binding fails `PROJECT_UNDERBOUND`.

---

## 12. Verification Categories

Categories are requirement-driven, not universally installed.

Each scoped requirement names the categories and providers needed to verify it, but that selection must include every category mandated by the repository's project verification binding. The implementing agent may add categories; it may not trim the binding.

Selected categories may include:

- input parsing and defaults;
- initialization and lifecycle;
- data transformation;
- deterministic randomness;
- clocks and scheduling;
- serialization;
- persistence;
- migration;
- APIs and protocols;
- workflow and transaction ordering;
- concurrency;
- resource and side-effect lifecycles;
- errors and refusals;
- authentication and authorization;
- dependency and architecture boundaries;
- product-path integration;
- corpus or dataset coverage;
- portability;
- performance budgets;
- observability;
- graphics or hardware behavior;
- domain-specific compatibility.

A category is operational only when it has:

1. a provider or check mechanism;
2. a subject adapter path;
3. independently derived expectations;
4. discriminating fixtures for behavioral claims;
5. effective-alternative union support;
6. grounded alternative evaluators for all profile- or binding-required defect classes;
7. at least one stateful evaluator when the applicable defect model includes stateful failure;
8. equivalence-proof support when the category permits equivalence claims;
9. runtime-effect witnessing when the category verifies implementation effects;
10. at least one positive self-test;
11. at least one negative control;
12. intended-failure matching;
13. structured reports;
14. a trace to requirements that need it.

Installing a category without a requirement creates an orphan mechanism and fails Functional Integration.

A requirement naming a category without an operational mechanism remains FAIL. A requirement without a complete applicable project-binding rule remains FAIL even when its selected checks pass.

---

## 13. Actual Execution Rule

Checks must execute the actual subject operation relevant to the claim.

Static inspection may verify static properties. It cannot substitute for required runtime execution.

A trace must observe and forward the actual implementation. It must not recreate behavior in a parallel simulator.

A parser, mock, model-authored emulator, reflection library, or test-only implementation cannot prove the real subject behaves correctly unless the claim itself is specifically about that artifact.

---

## 14. Discriminating Checks, Equivalence, Runtime Effects, and Negative Controls

### 14.1 Discriminating Fixtures

Every behavioral check must use inputs capable of distinguishing the claimed behavior from every alternative in the effective plausible-alternative set.

The effective set is the union of:

1. claim-declared additions;
2. every applicable alternative required by every selected reusable profile; and
3. every applicable alternative required by the project binding.

No source is optional. Claim-level declarations may add alternatives but may not remove, replace, narrow, shadow, or override profile- or binding-required alternatives. The framework must expose the complete computed union in reports and fail `ALTERNATIVE_SET_UNDERBOUND` when any applicable member is absent.

The fixture-discrimination check must execute or mechanically evaluate each alternative in the union against the same input through its registered evaluator and prove that the alternative diverges from the authoritative expected result at the declared path or value. Every evaluator must identify its stable alternative ID, defect class, statefulness, implementation, expected divergence, and grounding authority or witnessed failure.

Profiles should supply reusable evaluators for recurring alternatives, including stateful alternatives such as stale-state reuse, persistence leakage, or reordered updates. Project bindings add repository-specific evaluators. Required alternatives are not subject to a discretionary budget: implementation cost does not authorize omission.

A fixture is not valid merely because it has an expected result. It must make the behavior under test observable and distinguishable.

### 14.2 Equivalence Claims

Representation-level numerical variation and behavioral equivalence are distinct. Representation-level variation belongs to an evidence-backed comparator profile only when the underlying algorithm, state transitions, operation ordering, and execution path are unchanged and independent evidence establishes the cause and permitted magnitude. A changed algorithm, state transition, ordering, or execution path belongs to an equivalence claim. Observed cross-platform or cross-adapter disagreement alone does not establish representation-level variation.

An assertion that a different implementation, ordering, representation, or path is equivalent to the required behavior is a separate required claim.

Equivalence may be accepted only when:

1. both paths are independently specified or executed;
2. the complete applicable input domain is declared;
3. an authority-derived proof establishes equivalence over that domain, or a differential check covers the complete finite domain;
4. any excluded domain is explicitly authorized through approved scope;
5. the equivalence result remains current after relevant changes.

An internally consistent argument based on the implementation being justified is circular and produces `EQUIVALENCE_UNPROVEN`.

### 14.3 Runtime-Effect Witnesses

A structural artifact counts as implementation only when the actual product path invokes it and its required effect is observed.

The witness must identify:

- the product-path entry point;
- the structure or mechanism under test;
- the invocation or trace event;
- the state or output it affects;
- the controlled intervention or comparison that demonstrates causation rather than mere presence.

Where safe and practical, the check should prove that removing, disabling, perturbing, or replacing the mechanism changes the observed result in the expected direction. Where direct intervention is unsafe, an authority-derived trace relation may serve the same function.

A structure that exists but feeds nothing, is unreachable, is always defaulted, or has no observed effect produces `RUNTIME_EFFECT_UNWITNESSED`.

### 14.4 Negative Controls

Every framework mechanism and every installed provider/profile must include deliberately defective negative controls.

A negative control counts only when:

1. the precise defect is declared;
2. the intended check is declared;
3. the expected failure code is declared;
4. the expected requirement and claim IDs are declared;
5. the expected first divergence or failure path is declared;
6. the actual failure matches that signature;
7. unrelated failures are excluded.

Examples of invalid negative-control success:

- the mutant fails to import;
- a dependency is missing;
- compilation fails before the intended check;
- the test process crashes;
- a timeout occurs before the relevant operation;
- a different check fails first;
- any nonzero exit is accepted without matching the intended defect.

A negative control that fails for the wrong reason is itself FAIL.

---

## 15. Framework Coverage Matrix

`verify framework` must derive, not manually maintain, a machine-readable coverage matrix.

For every core mechanism, provider, profile, and selected category, report:

- implementation present;
- schema present;
- positive control present;
- positive control passes;
- negative control present;
- intended failure signature declared;
- negative control rejected for intended reason;
- raw-authority and derived-evidence classification valid;
- per-constituent authority mapping complete;
- strongest required oracle used or every stronger oracle has evidence-backed unavailability;
- every mechanically enumerable inventory item maps to claims, fixtures, and executable checks;
- claim aggregation preserves the full required per-item verification surface;
- effective plausible-alternative union complete;
- no claim-level trimming or shadowing of profile- or binding-required alternatives;
- every effective alternative has a grounded operational evaluator;
- required stateful alternatives are exercised;
- behavioral fixtures discriminate every effective alternative;
- numerical-versus-behavioral divergence classification valid;
- equivalence proof complete where applicable;
- runtime-effect witness complete where applicable;
- report generated;
- requirement trace present;
- orphan status.

Any required cell that is absent or failing makes `verify framework` fail.

Partial framework construction must appear as a failed matrix, not a progress narrative.

---

## 16. Orphan and Integration Checks

The framework must fail when:

- a requirement has no claim;
- a claim has no executable check;
- a claim references missing authority, evidence, fixture, comparator, adapter, or provider artifacts;
- evidence is referenced by no required claim;
- a derived-evidence artifact lacks a raw-authority or independently justified source where one is required;
- a raw-authority artifact is silently annotated, abridged, normalized, or reconstructed;
- an expected constituent fact lacks a unique authority mapping or conflict record;
- an expected result bypasses a stronger required oracle;
- oracle unavailability lacks retained independent evidence;
- a mechanically enumerable inventory item has no claim, fixture, or executable-check mapping;
- a coarse claim reduces required coverage for any mapped inventory item;
- a fixture is unused;
- a behavioral fixture has no computed effective alternative set or discrimination check;
- an effective alternative set omits an applicable profile- or binding-required alternative;
- a claim-level declaration narrows, shadows, replaces, or removes a required alternative;
- an effective alternative lacks a grounded operational evaluator;
- a required stateful alternative has no stateful evaluator or exercised fixture;
- an alternative evaluator is unused or maps to no grounded defect class;
- a behavioral divergence is routed through a comparator without evidence that it is representation-level;
- an equivalence claim has no proof or complete-domain differential check;
- a runtime-effect claim has no product-path witness;
- a comparator is unused;
- a check maps to no requirement;
- a provider is installed but used by no requirement or selected profile;
- a profile installs machinery unused by project requirements;
- the repository has no project verification binding;
- a requirement has no applicable project-binding rule;
- a requirement omits a category, capability, provider, or control mandated by the project binding;
- the project binding contains a governing specification category with no concrete mechanism;
- a selected reusable profile is not consumed by the project binding;
- a report category affects no completion decision;
- a maintained framework artifact has no gate that reads it;
- a gate reads data with no maintained source.

These checks implement Functional Integration: every write has a read, and every read has a maintained source.

---

## 17. Property-Based and Mutation Testing

Property-based and mutation testing are providers, not universal core requirements.

Use them when the host requirements justify them.

### Property-Based Testing

Generated inputs are valid only when the expected invariant is independently established.

Appropriate uses include:

- round trips;
- deterministic replay;
- schema-valid combinations;
- state-machine invariants;
- boundary conditions;
- idempotency;
- serialization;
- migration preservation.

Generated inputs must not invent product requirements or source semantics.

Persist every failing seed and minimized counterexample.

### Mutation Testing

Use a maintained host-language mutation engine where one exists.

Mutation reports must distinguish:

- provider not selected;
- provider unavailable;
- provider executed;
- threshold passed;
- surviving mutations;
- acceptance-critical surviving mutations.

A missing or unavailable required mutation provider is FAIL.

Do not report unexecuted mutation coverage as passing.

Thresholds must derive from project requirements or initial witnessed baselines. Do not invent arbitrary universal thresholds.

---

## 18. Clean-Environment Verification

Expose a clean verification path that:

1. creates a clean temporary checkout or isolated equivalent;
2. installs strictly from lockfiles;
3. supplies only declared environment variables;
4. uses only declared tools;
5. runs framework integrity checks;
6. runs all scoped requirement checks;
7. records platform and tool versions;
8. produces structured reports;
9. fails on hidden global dependencies, undeclared generated files, path assumptions, locale assumptions, timezone assumptions, or unavailable required capabilities.

A container may be used but is not mandatory when an equivalent clean isolation method exists.

### Authorization in Clean Environments

A clean or network-isolated environment is not required to hold repository-host credentials or signing secrets. It may consume a locked authorization verification attestation produced by the authenticated CI job under §7.10.

The clean run must verify:

- attestation hash;
- repository and commit binding;
- witness-object hash;
- exact authorized decision;
- affected artifact IDs;
- base identity-allowlist hash;
- project-binding hash where applicable.

The clean run must not describe this as live authentication. Final authorization-dependent PASS requires the separate live authenticated verification job and the clean attestation-integrity result.

A missing or invalid required attestation fails with `AUTHORIZATION_ATTESTATION_INVALID`; the clean runner must not silently relax authorization because network access is unavailable.

---

## 19. Commands

Expose a cross-platform CLI equivalent to:

```text
verify init
verify framework
verify scope
verify authorization
verify authorization-attestations
verify profiles
verify project-binding
verify authorities
verify conflicts
verify evidence
verify oracles
verify inventory-coverage
verify requirements
verify claims
verify providers
verify requirement <requirement-id>
verify claim <claim-id>
verify change-integrity --base <ref> --head <ref>
verify clean
verify
```

Command rules:

- `verify framework` proves the framework's own mechanisms and controls.
- Targeted commands support implementation work but do not define project completion.
- `verify change-integrity` is a merge-integrity comparison. It makes no claim that the project is complete or healthy.
- `verify` is the sole global completion gate.
- `verify` fails until every user-scoped requirement currently passes.
- There is no alternate green command that represents an incomplete project as healthy.
- Missing required providers, instrumentation, evidence, reusable profiles, project binding, authorization, attestations, or execution capabilities fail.
- No command may silently skip a required check.
- No command may convert a failure to a warning merely to make output green.

`verify change-integrity` must compare a base and head revision and fail on:

- removal or weakening of a scoped requirement without authenticated scope authorization;
- removal or weakening of a check, provider, adapter capability, negative control, plausible-alternative catalog entry, alternative evaluator, project-binding rule, selected profile, or evidence chain required by the base revision;
- a base PASS becoming head FAIL without an authenticated authorization witness covering the exact invalidating change;
- an expected result, comparator, divergence classification, authority resolution, selected profile, profile alternative catalog, alternative evaluator, or project binding changing without the required witness and invalidation record;
- any head effective alternative set that is narrower than the base set without authenticated authorization grounded in the base revision;
- an identity-allowlist or bootstrap-record change lacking authorization verified against the base revision's allowlist or a repository-administration event;
- hidden, omitted, or falsely reported regressions;
- a head result represented as completion when global `verify` still fails.

The gate must not reject newly discovered truthful failure detail inside a requirement that was already FAIL merely because the report became more precise. It must reject concealment, weakening, unauthorized regression, and loss of previously established behavior.

---

## 20. Reports

Every verification command must emit structured JSON.

Where supported, also emit JUnit XML and SARIF.

Reports must include:

- command;
- repository commit;
- dirty-worktree state;
- operating system;
- runtime and tool versions;
- selected providers and reusable profiles;
- project-binding ID and hash;
- applicable project-binding rule IDs;
- authorization-witness IDs and verification results;
- authorization-attestation IDs and hashes;
- approved scope hash;
- requirement ID;
- claim ID;
- authority IDs;
- raw-authority artifact IDs and hashes;
- conflict IDs;
- evidence IDs and evidence classes;
- applicable oracle-precedence rule ID;
- strongest required oracle class, actual oracle class, and bypass evidence where applicable;
- source-inventory item IDs and their claim, fixture, and check mappings;
- claim-aggregation coverage result;
- per-constituent authority mappings;
- fixture IDs;
- claim-declared plausible alternatives;
- applicable selected-profile alternatives;
- applicable project-binding alternatives;
- complete effective alternative union;
- alternative-evaluator IDs, defect classes, statefulness, grounding references, and discrimination results;
- numerical-versus-behavioral divergence classification and supporting evidence;
- equivalence-claim proof or differential coverage where applicable;
- runtime-effect witness details where applicable;
- comparator IDs;
- check ID;
- PASS or FAIL;
- precise failure code;
- duration;
- expected result;
- actual result;
- first meaningful divergence;
- reproduction inputs;
- environment or arithmetic profile;
- provider diagnostics;
- base and head revisions plus regression classification for change-integrity runs;
- property-test seed and path where applicable.

A report proves that a command ran and produced the recorded result. It does not independently establish that the expected value was substantively correct.

---

## 21. Proximity and Context Hydration

The framework must surface the applicable rule at the point where the action occurs.

When an agent or developer:

- adds a requirement;
- records an authority;
- retains raw authority bytes;
- creates an excerpt, annotation, normalization, or other derived evidence;
- resolves a conflict;
- creates evidence;
- selects an expected-value origin;
- declares an oracle unavailable;
- creates or aggregates source-inventory mappings;
- creates a fixture, registers a plausible alternative, or assigns an alternative evaluator;
- changes an effective alternative set or attempts to narrow a profile or binding requirement;
- classifies a divergence as numerical representation variation or behavioral equivalence;
- asserts equivalence;
- claims that structure implements behavior;
- changes an expected value;
- changes a comparator;
- adds a check;
- changes an adapter;
- selects a provider;
- selects or changes a reusable profile;
- defines or changes the project verification binding;
- changes the authorization identity allowlist;
- supplies or relies on an authorization witness;
- changes scope;
- claims completion;

the CLI, generated template, schema error, or gate output must present the required fields, consequences, and invalidation rules.

The framework must not depend on remembering a distant root document.

Generated guidance should be concise and local. It should point to the authoritative rule rather than duplicating it extensively.

---

## 22. Mechanism Economy

Every mechanism must trace:

```text
mechanism → checkable standard → required claim → approved scope
```

A repository-specific mechanism must additionally trace through the project verification binding and any selected reusable profile:

```text
repository-specific mechanism → project verification binding → selected reusable profile or repository-specific rule → checkable standard → required claim → approved scope
```

Reject mechanisms that do not complete the applicable chain.

Apply these rules:

1. Prefer maintained proven tools over custom replacements.
2. Wrap host tools through providers rather than duplicating them.
3. Do not duplicate a check that already terminates reliably in a maintained tool.
4. Do not create inventories as substitutes for implementation.
5. Keep metadata adjacent to the artifact it governs where practical.
6. Do not measure what is easy merely because the actual requirement is hard.
7. Do not invent arbitrary thresholds.
8. Do not add a category merely because another project might need it.
9. Unknown must fail loudly.
10. A check whose result can be fabricated without performing the claimed work is invalid.
11. A fixture that cannot distinguish the required behavior from a plausible wrong implementation is invalid.
12. An equivalence argument cannot replace implementation or differential proof.
13. Structure, naming, configuration, and tracing cannot replace a witnessed runtime effect.
14. Raw authority and derived interpretation must never share an artifact identity.
15. Reports describe results; they do not replace execution.
16. Framework construction must not become a substitute for the product work it exists to verify.
17. Reusable profiles should centralize recurring alternative evaluators so discrimination cost does not encourage per-project omission; required alternatives remain mandatory regardless of cost.
18. Use maintained external tools and repository-host controls wherever they already terminate the claim; custom code should bind, normalize, and verify rather than reimplement them.
19. Trust-bearing custom mechanisms must be explicitly inventoried, justified, and small enough for direct human inspection without imposing an arbitrary numeric threshold.
20. Critical custom self-tests must invoke public commands or process boundaries and inspect observable outputs; they must not import or reproduce the internal decision logic being tested.
21. Build the oracle-to-subject vertical path before administrative expansion, but do not treat that order as phased acceptance or permission to stop.

---

## 23. DNA Integrity Checks

The framework must verify its own adherence to the governing DNA.

### Form Follows Function

Fail when a mechanism has no required function or a requirement lacks the mechanism needed to verify it.

### Context Efficiency

Fail on unused profiles, providers, fixtures, comparators, reports, duplicate records, and redundant parallel mechanisms.

### Derivation Over Inference

Fail when an accepted claim lacks a complete authority-to-strongest-available-oracle-to-expectation-to-execution chain, when mechanically enumerable inventory items are missing or hidden by coarse claims, when the effective plausible-alternative union is incomplete, when an alternative evaluator lacks grounding, when a fixture does not discriminate every required alternative, when behavioral divergence is mislabeled as representation-level variation, when an equivalence assertion lacks independent proof, or when derived evidence is presented as raw authority.

### Binary Standards

Compute PASS or FAIL. Do not admit borderline, candidate, provisional, unsupported, or accepted-incomplete results.

### Reflexive Application

Apply every enforceable framework rule to the framework’s own implementation and self-tests.

### No Shortcuts

Require full scoped coverage. Sampling, corpus success, compilation, startup, or a nonempty result may not substitute for the actual claim.

### Work Over Analysis

Framework completion requires executable mechanisms, not reports describing planned mechanisms. Product implementation claims require witnessed runtime effects; scaffolding and abstractions alone do not satisfy them.

### Witness Before Claim

Completion and verification reports must name the exact artifacts, commands, and results that support each claim.

### Proximity

Surface rules at the decision point through schemas, templates, CLI errors, and gates.

### Current State Only

Compute from current artifacts and current execution. Historical reports cannot override current failure.

### Positive Specification

Define the valid chain and valid behavior first; use negative language only where a necessary boundary remains ambiguous.

### Functional Integration

Fail on orphan writes, orphan reads, unused artifacts, and ungrounded gates.

### Externalized Reliability

No model, producer, reviewer, or report is the terminal authority for a mechanically decidable claim. No producer-mintable artifact is accepted as external authorization.

---

## 24. Framework Self-Test

Create a deliberately minimal deterministic self-test subject.

Its function is only to prove the portable core.

It must exercise:

- scope locking;
- authenticated authorization-witness verification and forgery rejection;
- reusable-profile selection and project-binding underbinding rejection;
- project-binding adequacy-witness enforcement and rejection of generic authorship-only approval;
- residual behavior-inventory completeness enforcement and distinction from known-item coverage failure;
- base-allowlist authorization for identity changes;
- authorization-attestation invalidation and clean-run linkage;
- authority locking;
- raw-authority byte integrity and derived-evidence separation;
- authority conflict resolution;
- per-constituent authority identity and authority-blending rejection;
- requirement and claim linkage;
- evidence and fixture linkage;
- strongest-oracle selection and stronger-oracle bypass rejection;
- evidence-backed oracle-unavailability handling;
- inventory extraction, stable inventory IDs, and inventory-to-claim/fixture/check completeness;
- coarse-claim coverage-loss rejection;
- effective-alternative union computation and claim-level trimming rejection;
- discriminating-fixture acceptance and non-discriminating-fixture rejection;
- one stateless alternative evaluator and one stateful alternative evaluator, each rejected for its intended divergence;
- missing, ungrounded, and unused alternative-evaluator rejection;
- numerical-versus-behavioral divergence classification and comparator-route laundering rejection;
- equivalence-claim proof and circular-equivalence rejection;
- runtime-effect witnessing and scaffolding-only rejection;
- exact comparison;
- justified numeric comparison;
- adapter execution;
- provider execution;
- current-result computation;
- stale-result invalidation;
- change-integrity regression detection;
- negative-control signature matching;
- orphan detection;
- clean execution;
- structured reporting;
- black-box execution of every trust-bearing custom mechanism through its public CLI or process boundary;
- rejection of a self-test that duplicates or imports the mechanism's internal decision logic.

For every mechanism include:

- one positive control;
- one isolated defect;
- the expected failure signature;
- a test proving the mechanism rejects that defect for the intended reason.

Self-test evidence must be clearly identified as framework-only and may never satisfy a host-product requirement.

---

## 25. CI

Create GitHub Actions templates using immutable action revisions where practical.

### 25.1 Required Pull-Request Integrity Jobs

The generic merge-blocking jobs are:

```text
framework-self-test
scope-integrity
authorization-integrity
authorization-live-verification
authorization-attestation-integrity
profile-integrity
project-binding-integrity
authority-integrity
raw-authority-integrity
authority-conflicts
evidence-integrity
oracle-precedence
inventory-coverage
plausible-alternative-integrity
fixture-discrimination
divergence-classification
equivalence-claims
runtime-effect-integrity
requirement-coverage
provider-health
orphan-detection
clean-environment
change-integrity
```

These jobs establish only that the proposed change preserves the verification system, authenticated scope, authorization root of trust, reusable profiles, project binding, evidence integrity, and previously established behavior. They do not claim that the project is complete.

Profiles may add merge-blocking jobs required by their host domain.

### 25.2 Global Completion Reporting

The global `verify` command must run on every pull request and publish its complete PASS or FAIL report. While the project is incomplete, that result is expected to be FAIL and must not be configured as a required merge-blocking job.

The workflow surface must distinguish:

- whether the completion command executed and its report was published; and
- whether the project result was PASS or FAIL.

A report-publication job may succeed only in the narrow sense that the report was generated. It must be named and presented as `completion-report`, not `verification-passed`, `project-healthy`, or another green health claim. Its artifact and summary must display the actual global PASS or FAIL prominently.

The non-blocking completion report is not an alternate verification gate. Only the global `verify` result establishes completion. Branch protection must never substitute `completion-report` for `verify` when completion itself is required.

This separation prevents permanent-red merge gates and red-CI habituation without allowing incomplete work to be represented as globally passing.

### 25.3 CI Requirements

CI must:

- install strictly from lockfiles;
- run the current framework package, not a globally installed copy;
- verify authorization witnesses live through the configured repository-host or signature mechanism;
- produce hash-bound authorization attestations;
- verify clean-run attestation integrity and linkage;
- reject identity-allowlist changes not authorized by the base revision's allowlist or repository administration;
- compare the project verification binding against every applicable requirement;
- require an authenticated project-binding adequacy witness that explicitly covers the binding's load-bearing verification surfaces;
- verify selected reusable profile hashes and compatibility;
- reject raw-authority mutation and derived-evidence misclassification;
- reject incomplete per-constituent authority mappings;
- reject stronger-oracle bypass and unsupported oracle-unavailability claims;
- compare mechanically extracted inventories with claim, fixture, and executable-check mappings;
- distinguish known unclaimed inventory items from residual inventory-completeness judgments and require authenticated resolution of the latter;
- reject coarse claim aggregation that reduces any inventory item's required coverage;
- compute and report the union of claim, selected-profile, and project-binding plausible alternatives;
- reject claim-level trimming, replacement, shadowing, or omission of required alternatives;
- reject missing, ungrounded, or unevaluated alternative evaluators, including required stateful alternatives;
- reject non-discriminating fixtures;
- reject unjustified routing of behavioral divergence through comparator profiles;
- reject unproven equivalence claims;
- reject structure-only implementation claims without runtime-effect witnesses;
- upload structured reports on failure;
- upload minimized reproductions where available;
- publish the actual global completion result on every pull request;
- fail required integrity jobs on missing required capabilities;
- preserve exact job names for branch-protection configuration.

Create:

- `.github/CODEOWNERS.template`;
- required-status-check documentation;
- branch-protection setup instructions;
- allowlisted authorization-identity configuration and bootstrap procedure;
- a script that inspects configured controls when authenticated GitHub access exists.

Do not claim that CODEOWNERS, branch protection, authorization identities, signatures, or required checks are active unless the repository host confirms they are configured and the framework verifies them.

Scope, identity-allowlist, project-binding, selected-profile, expected-result, comparator, authority-conflict, evidence, and authorized-regression changes must be routed to configured authenticated human review where repository administration supports it. Where no authenticating mechanism is available, the affected action remains FAIL rather than accepting a producer-authored approval artifact.

---

## 26. Existing Repository Migration

When installing into an existing repository:

1. preserve the existing state in version control before replacement;
2. retain authoritative sources and mechanically extracted artifacts;
3. classify prior implementation code as historical implementation, not authority;
4. classify prior reports and tests as historical claims until revalidated;
5. do not import an expected result merely because it already exists;
6. do not treat previous green tests as current evidence;
7. re-register every retained artifact through the current authority and evidence rules;
8. establish the strongest available oracle and first end-to-end verification path before migrating broad administrative machinery;
9. remove obsolete framework machinery only after its replacement is operational.

Archiving preserves evidence. It does not confer authority.

---

## 27. Required Demonstration

Before declaring this framework complete:

1. remove generated dependency and build directories;
2. install strictly from the framework lockfile;
3. initialize the current repository;
4. initialize it again and prove idempotence;
5. initialize a new empty Git repository;
6. initialize a non-Node host repository fixture;
7. run the framework self-test in both;
8. run every core command;
9. generate the framework coverage matrix;
10. demonstrate rejection of a producer-mintable authorization witness;
11. demonstrate acceptance of a configured authenticated witness in a controlled test;
12. demonstrate profile-underbinding rejection;
13. demonstrate rejection of an annotated or abridged artifact labeled as raw authority;
14. demonstrate rejection of an expected result with ambiguous or blended authority identity;
15. demonstrate rejection of a claim that trims an alternative required by an applicable profile or project-binding rule;
16. demonstrate a complete effective alternative union from claim additions, a selected profile, and a project binding;
17. demonstrate rejection of a non-discriminating fixture and acceptance of a discriminating replacement;
18. demonstrate one stateless and one stateful alternative evaluator failing for their intended divergences;
19. demonstrate rejection of an ungrounded or missing alternative evaluator;
20. demonstrate rejection of behavioral divergence mislabeled as representation-level numerical variation;
21. demonstrate rejection of an unproven equivalence claim;
22. demonstrate rejection of a structure-only implementation claim and acceptance of a valid runtime-effect witness;
23. demonstrate rejection of a hand-derived expectation when a stronger required executable or mechanical oracle is available;
24. demonstrate acceptance of a weaker oracle only after independently proving every stronger required oracle unavailable;
25. demonstrate extraction of stable inventory IDs and rejection of an unclaimed inventory item;
26. demonstrate `BEHAVIOR_COVERAGE_UNPROVEN` when inventory completeness is not mechanically established and no authenticated residual-completeness witness exists;
27. demonstrate `BINDING_ADEQUACY_UNWITNESSED` when a binding has authorship or adoption approval but no explicit adequacy judgment;
28. demonstrate acceptance when one authenticated authorization event explicitly covers both adoption and every required adequacy criterion;
29. demonstrate rejection of a coarse claim whose fixtures or checks do not independently exercise every mapped inventory item;
30. demonstrate rejection of `hand-derived-exact` when it appears without an explicit applicable authorization rule;
31. demonstrate a trust-bearing custom mechanism tested through its public command boundary and rejection of a circular internal-logic self-test;
32. demonstrate the first complete oracle-to-subject vertical path before administrative expansion without representing it as framework completion;
33. demonstrate `change-integrity` passing an honest non-regressing incomplete change and rejecting an unauthorized PASS-to-FAIL regression;
34. activate every deliberate negative control;
35. prove each intended gate fails for the intended reason;
36. restore the correct implementation;
37. rerun the complete framework suite successfully;
38. run the clean-environment gate;
39. inspect the final diff;
40. remove accidental, generated, redundant, misleading, unused, or unrelated artifacts;
41. run the global `verify` command and retain its result.

The framework assignment is complete only when the framework itself passes.

The host project remains FAIL until every user-scoped host requirement passes.

---

## 28. Completion Response

Do not provide a progress narrative.

Report only:

- final commit hash;
- files created or materially changed;
- core mechanisms implemented;
- raw-authority, effective-alternative-union, alternative-evaluator, discriminating-fixture, divergence-classification, equivalence-proof, and runtime-effect mechanisms implemented;
- reusable profiles, project binding, and providers implemented;
- authorization mechanisms configured and their verification status;
- commands executed;
- PASS or FAIL result of each command;
- framework coverage matrix location;
- change-integrity report location;
- global completion report location and actual PASS or FAIL result;
- structured report locations;
- configured and unconfigured external repository controls;
- any indispensable external action that could not be performed;
- explicit statement that the framework proves only the registered mechanically checkable claims;
- explicit statement that every user-scoped host requirement remains mandatory until it passes.

The repository, executable checks, and retained artifacts are the authority for completion.
