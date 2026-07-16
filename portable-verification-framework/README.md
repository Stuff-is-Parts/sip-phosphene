# Portable Verification Framework Package

This package separates the verification system into three operational layers plus two independently governed trust artifacts:

1. **Portable core** — `portable-evidence-gated-verification-framework.md`
2. **Reusable profile template** — `reusable-verification-profile.template.json`
3. **Repository-specific binding template** — `project-verification-binding.template.json`
4. **Framework bootstrap-conformance template** — `framework-bootstrap-conformance.template.json`
5. **Canonical framework conformance-suite template** — `framework-conformance-suite.template.json`

The portable core contains no project-, product-, language-, graphics-, or technology-specific verification requirements.

Reusable profiles package maintained mechanisms for recurring technical surfaces. They supply categories, providers, adapter capabilities, controls, evidence-class rules, discriminating-fixture requirements, equivalence-proof rules, runtime-effect controls, and CI jobs. They do not determine a repository's scope or independently establish sufficiency.

The project verification binding maps approved scope and governing specifications to the minimum required verification surface. It selects exact profile versions and hashes, adds repository-specific rules, preserves per-constituent authority identity, and prevents implementing agents from trimming verification categories or plausible-alternative coverage requirement by requirement.

## Newly integrated hardening

The portable core now mechanically requires:

- **Discriminating fixtures:** behavioral fixtures must distinguish required behavior from applicable plausible alternatives such as identity, copy, no-op, omission, reordering, sign reversal, stale-state reuse, and wrong defaults.
- **Equivalence claims as claims:** a different path may replace required behavior only after independent proof or complete-domain differential verification.
- **Runtime-effect witnesses:** fields, helpers, classes, traces, and configuration do not count as implementation until the actual product path invokes them and their effect is observed.
- **Raw-versus-derived evidence separation:** retained authority bytes remain byte-exact; annotations, excerpts, normalization, and interpretation live in separately identified derived artifacts.
- **Per-constituent authority identity:** every expected fact retains the exact authority that produced it; silent authority blending is rejected.
- **Union-enforced plausible alternatives:** the effective set is the union of claim additions, every applicable selected-profile alternative, and every applicable project-binding alternative; claim-level declarations cannot trim or shadow required alternatives.
- **Grounded reusable alternative evaluators:** profiles can supply stateless and stateful defect evaluators with stable IDs, expected divergences, and authority or witnessed-failure grounding.
- **Stateful discrimination:** where the failure model includes stale state, persistence leakage, or reordered updates, a trivial no-op control is insufficient; the required stateful evaluator must execute.
- **Numerical/behavioral boundary:** evidence-backed representation-level variation belongs to comparator profiles; changed algorithms, state transitions, ordering, or execution paths require equivalence claims.
- **Binding adequacy witness:** project-binding adoption or change requires an authenticated judgment that its load-bearing oracle, inventory, category, provider, adapter, alternative, fixture, and product-path rules are sufficient; authorship or generic approval alone does not qualify.
- **Evidence artifact versus expected-value origin:** required evidence classes specify retained artifacts only; oracle-precedence rules exclusively govern acceptable expected-value origins.
- **Hand-derived expectations forbidden by default:** `hand-derived-exact` is absent from default oracle lists and requires an explicit requirement-class rule plus evidence that stronger required oracles are unavailable.

The project binding must be authenticated under the authorization-witness rules in the portable core. Missing or incomplete binding rules produce FAIL.

## Irreducible trust boundary

The package reduces but cannot eliminate shared conceptual error across custom mechanisms, black-box tests, alternative evaluators, and a producer-drafted project binding. It also cannot guarantee that a human meaningfully evaluates a load-bearing binding merely because an authenticated approval exists.

The required countermeasures are outside further specification layering:

- prefer maintained external tools and repository-host controls wherever they already terminate the claim;
- keep the custom trust-bearing core small enough for direct human inspection;
- mechanically extract behavior inventories wherever possible;
- require explicit authenticated adequacy judgment for the binding's oracle and inventory decisions;
- treat the existence of these rules as controls to execute, not proof that the residual risk disappeared.

## Bootstrap and semantic-conformance hardening

The package includes four bootstrap-era controls introduced in the preceding revision:

- **Independent bootstrap conformance:** an initial framework implementation remains FAIL until an authenticated authority outside the correlated producer judges the exact trust-bearing core and canonical suite hashes.
- **Semantic proxy rejection:** every mandatory semantic acceptance contract must establish its complete operative meaning through positive, structurally invalid negative, and structurally valid but semantically inadequate control conditions. Scenarios may be shared across contracts when mappings and failure attribution remain independent; presence, registration, declared roles, unrelated PASS results, and raw fixture counts are insufficient.
- **Authorization lineage:** approvals bind to exact reviewed revisions and protected artifact hashes. Attestations may live in descendant commits only when ancestry and unchanged protected artifacts are mechanically proven.
- **Separately governed canonical conformance suite:** the producer may add stricter tests but may not weaken, remove, reinterpret, or replace canonical controls without authenticated framework-change authorization.

This revision introduces no additional control. It only amends the semantic-proxy control to permit shared scenarios under independent-attribution rules and harmonizes the term **mandatory semantic acceptance contract** throughout the specification.

