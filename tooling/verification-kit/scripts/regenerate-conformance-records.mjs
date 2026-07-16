#!/usr/bin/env node
// Deterministic regeneration of the conformance-era governed records
// (framework spec §7.10A/§7.10B/§14.5): binding semantic-acceptance contracts,
// the canonical conformance-suite manifest, and the bootstrap-conformance
// record. The bootstrap record is regenerated ONLY while its status is
// 'pending' — once an independent judgment exists, changing the trust core
// invalidates it and this script refuses to paper over that.
//   node tooling/verification-kit/scripts/regenerate-conformance-records.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('no .git found');
    dir = parent;
  }
}
const repoRoot = findRepoRoot(process.cwd());
const R = (rel) => path.join(repoRoot, ...rel.split('/'));

function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortValue(v[k]);
    return o;
  }
  return v;
}
const canonicalHash = (v) => 'sha256:' + createHash('sha256').update(JSON.stringify(sortValue(v))).digest('hex');
const fileSha = (rel) => createHash('sha256').update(readFileSync(R(rel))).digest('hex');
const readJson = (rel) => JSON.parse(readFileSync(R(rel), 'utf8'));
const writeJson = (rel, v) => writeFileSync(R(rel), JSON.stringify(v, null, 2) + '\n');

// ---------------------------------------------------------------- suite map
// contract → executable control IDs (or PENDING:<reason>) per condition.
const CONTRACTS = [
  ['evidence-classes', 'Every mandatory evidence class has a retained artifact that the claim verification chain actually consumes', 'EVIDENCE_MISSING', 'self-test-vertical-path', 'underbound-binding:mandatoryEvidenceClasses', 'semantic-negative:evidence-class-present-but-unconsumed'],
  ['positive-controls', 'Every mandatory positive control resolves to an executable check registered on every class claim whose own retained execution result passes', 'SEMANTIC_PROXY_SUBSTITUTION', 'self-test-vertical-path', 'underbound-binding:mandatoryPositiveControls', 'semantic-negative:positive-control-not-consumed'],
  ['negative-control-defects', 'Every mandatory negative-control defect class has a registered evaluator exercised by class fixtures and rejected with its intended signature', 'NEGATIVE_CONTROL_INVALID', 'negcontrol:EVAL-MILK-STALE-STATE', 'underbound-binding:mandatoryNegativeControlDefectClasses', 'underbound-binding:mandatoryAlternativeEvaluatorIds'],
  ['product-path', 'Every claim executes through the declared native product path, proven by runtime dependence interventions rather than an adapter role label', 'SEMANTIC_PROXY_SUBSTITUTION', 'product-path-removal-witness:executor.mjs', 'underbound-binding:mandatoryProductPathChecks', 'semantic-negative:product-path-bypass-detected-by-removal'],
  ['fixture-discrimination', 'Every behavior claim registers the mandatory discrimination check and every effective alternative diverges at its declared path', 'FIXTURE_NONDISCRIMINATING', 'self-test-vertical-path', 'underbound-binding:mandatoryFixtureDiscriminationChecks', 'semantic-negative:non-discriminating-fixture'],
  ['runtime-effect', 'Structure counts as implementation only with a witnessed runtime effect through the product path', 'RUNTIME_EFFECT_UNWITNESSED', 'product-path-removal-witness:graph.mjs', 'underbound-binding:mandatoryRuntimeEffectChecks', 'PENDING:registered-runtime-effect-claim-kind'],
  ['alternative-evaluators', 'Every mandatory alternative evaluator resolves, its module exists, and class fixtures exercise it', 'ALTERNATIVE_EVALUATOR_MISSING', 'negcontrol:EVAL-MILK-IDENTITY', 'underbound-binding:mandatoryAlternativeEvaluatorIds', 'semantic-negative:non-discriminating-fixture'],
  ['divergence-classification', 'Every toleranced comparator cites evidence establishing the representation-level cause and a permitted magnitude covering the actual tolerance', 'DIVERGENCE_CLASSIFICATION_UNJUSTIFIED', 'self-test-vertical-path', 'underbound-binding:divergenceClassificationPolicy', 'semantic-negative:divergence-evidence-does-not-justify'],
  ['equivalence-policy', 'Equivalence claims establish the defined domain with complete coverage, independent executions, and no circular proof', 'EQUIVALENCE_UNPROVEN', 'PENDING:first-equivalence-claim', 'PENDING:first-equivalence-claim', 'PENDING:incomplete-domain-disproof-scenario'],
  ['authority-identity', 'The derived constituent set of every expected artifact is covered exactly by resolving authorities with no omission, substitution, or conflicting duplicate', 'AUTHORITY_SOURCE_AMBIGUOUS', 'self-test-vertical-path', 'underbound-binding:authorityIdentityRule', 'semantic-negative:authority-coverage-omitted-constituent'],
  ['oracle-precedence', 'Expected values originate from the strongest available required oracle class; hand-derived expectations are rejected without explicit authorization', 'STRONGER_ORACLE_BYPASSED', 'self-test-vertical-path', 'semantic-negative:oracle-hand-derived-rejected', 'semantic-negative:stronger-oracle-bypass'],
  ['inventory-coverage', 'Every mechanically enumerated inventory item maps to claims, fixtures, and executable checks without coverage loss through aggregation', 'INVENTORY_ITEM_UNCLAIMED', 'self-test-vertical-path', 'semantic-negative:inventory-item-unclaimed', 'semantic-negative:inventory-coverage-coarse'],
  ['verification-categories', 'Every mandatory verification category is covered by a class claim', 'PROJECT_UNDERBOUND', 'self-test-vertical-path', 'semantic-negative:category-uncovered', 'PENDING:per-category-exercise-attribution'],
  ['adapter-capabilities', 'Every mandatory adapter capability resolves to an existing executable module', 'SUBJECT_EXECUTION_UNAVAILABLE', 'self-test-vertical-path', 'semantic-negative:capability-unavailable', 'semantic-negative:product-path-bypass-detected-by-removal'],
  ['providers', 'Every mandatory provider is configured and resolvable', 'PROVIDER_UNAVAILABLE', 'self-test-vertical-path', 'semantic-negative:provider-unconfigured', 'PENDING:provider-version-probe'],
  ['authorization-lineage', 'Approvals bind to exact reviewed revisions and protected artifact hashes; descendants consume them only with proven ancestry and unchanged artifacts', 'AUTHORIZATION_LINEAGE_INVALID', 'lineage-unchanged-descendant-accepted', 'lineage-missing-reviewed-revision-rejected', 'lineage-review-against-wrong-commit-rejected'],
  ['bootstrap-conformance', 'The initial framework implementation has an independently authenticated conformance judgment over the exact trust-bearing core and suite hashes', 'FRAMEWORK_BOOTSTRAP_UNWITNESSED', 'PENDING:independent-bootstrap-judgment (user-side action, blocked until the lineage path can retain it)', 'bootstrap-core-hash-mismatch-rejected', 'bootstrap-self-certification-rejected'],
  ['conformance-governance', 'The canonical suite cannot be removed, weakened, reinterpreted, or replaced without authenticated framework-change authorization', 'CONFORMANCE_SUITE_UNAUTHORIZED', 'PENDING:suite-green-after-scenario-buildout', 'conformance-suite-weakening-rejected', 'PENDING:reinterpretation-without-hash-change-detection']
];

const scId = (name) => `SC-${name.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`;
const csId = (name, cond) => `CS-${name.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}-${cond.toUpperCase()}`;

const semanticContracts = CONTRACTS.map(([name, property]) => ({
  semanticContractId: scId(name),
  semanticProperty: property,
  requiredControlConditions: ['positive', 'structural-negative', 'semantic-negative'],
  controlScenarioIds: [csId(name, 'POS'), csId(name, 'STRUCT'), csId(name, 'SEM')],
  trustBearingImplementationSurfaces: [
    'tooling/verification-kit/src/core/engine.mjs',
    'tooling/verification-kit/src/core/bindingfields.mjs',
    'tooling/verification-kit/src/core/conformance.mjs',
    'tooling/verification-kit/src/core/lineage.mjs'
  ]
}));

const controlScenarios = CONTRACTS.flatMap(([name, _property, failureCode, pos, struct, sem]) => [
  {
    scenarioId: csId(name, 'POS'), condition: 'positive', fixtureOrMutationId: pos,
    coversSemanticContractIds: [scId(name)],
    expectedOutcomes: [{ semanticContractId: scId(name), expectedResult: 'PASS', expectedFailureCode: null, expectedFirstFailureOrDivergence: null }]
  },
  {
    scenarioId: csId(name, 'STRUCT'), condition: 'structural-negative', fixtureOrMutationId: struct,
    coversSemanticContractIds: [scId(name)],
    expectedOutcomes: [{ semanticContractId: scId(name), expectedResult: 'FAIL', expectedFailureCode: failureCode, expectedFirstFailureOrDivergence: 'per-scenario declared signature (see the executed control detail)' }]
  },
  {
    scenarioId: csId(name, 'SEM'), condition: 'semantic-negative', fixtureOrMutationId: sem,
    coversSemanticContractIds: [scId(name)],
    expectedOutcomes: [{ semanticContractId: scId(name), expectedResult: 'FAIL', expectedFailureCode: failureCode === 'STRONGER_ORACLE_BYPASSED' || failureCode === 'FRAMEWORK_BOOTSTRAP_UNWITNESSED' || failureCode === 'AUTHORIZATION_LINEAGE_INVALID' || failureCode === 'CONFORMANCE_SUITE_UNAUTHORIZED' ? failureCode : (name === 'positive-controls' || name === 'product-path' ? 'SEMANTIC_PROXY_SUBSTITUTION' : failureCode), expectedFirstFailureOrDivergence: 'per-scenario declared signature (see the executed control detail)' }]
  }
]);

const suiteBase = {
  suiteId: 'framework-conformance-suite.phosphene',
  version: '0.1.0',
  manifestHash: 'sha256:SELF',
  governingSpecificationHash: 'sha256:' + fileSha('portable-verification-framework/portable-evidence-gated-verification-framework.md'),
  publicExecutionBoundary: 'node tooling/verification-kit/bin/verify.mjs framework-conformance-suite',
  governance: {
    producerMayAddStricterControls: true,
    removalWeakeningReinterpretationOrReplacementRequiresAuthenticatedAuthorization: true,
    adoptionOrChangeWitnessId: null
  },
  semanticContracts,
  controlScenarios,
  sharingRules: {
    sharedScenariosPermitted: true,
    everyCoveredContractMustBeExplicitlyMapped: true,
    expectedOutcomeMustBeIndependentlyAttributablePerContract: true,
    weakeningOneContractMustBreakItsDesignatedControl: true,
    aggregateFixtureCountsMayNotSubstituteForContractCoverage: true
  }
};
const suite = { ...suiteBase, manifestHash: canonicalHash(suiteBase) };
mkdirSync(R('verification/framework-conformance/canonical-suite/fixtures'), { recursive: true });
mkdirSync(R('verification/framework-conformance/canonical-suite/expected'), { recursive: true });
writeJson('verification/framework-conformance/canonical-suite/manifest.json', suite);
console.log('canonical suite manifest:', suite.manifestHash);

// ------------------------------------------------------- bootstrap record
const trustBearingPaths = [
  'tooling/verification-kit/bin/verify.mjs',
  ...readdirSync(R('tooling/verification-kit/src/core')).filter((f) => f.endsWith('.mjs')).map((f) => `tooling/verification-kit/src/core/${f}`),
  'tooling/verification-kit/src/cli/main.mjs',
  ...readdirSync(R('tooling/verification-kit/src/schemas')).filter((f) => f.endsWith('.schema.json')).map((f) => `tooling/verification-kit/src/schemas/${f}`)
].sort();

const bootstrapPath = 'verification/framework-conformance/bootstrap-conformance.json';
const existing = existsSync(R(bootstrapPath)) ? readJson(bootstrapPath) : null;
if (existing && existing.status === 'established') {
  console.log('bootstrap record is established; NOT regenerating (a core change must invalidate it, not silently rewrite it)');
} else {
  const { execFileSync } = await import('node:child_process');
  const commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  writeJson(bootstrapPath, {
    bootstrapRecordId: 'framework-bootstrap.phosphene',
    frameworkSpecificationHash: 'sha256:' + fileSha('portable-verification-framework/portable-evidence-gated-verification-framework.md'),
    frameworkImplementation: {
      repositoryIdentity: readJson('verification/config/project.json').repositoryIdentity,
      reviewedCommit: commit,
      reviewedTreeHash: tree,
      trustBearingArtifactHashes: trustBearingPaths.map((p) => ({ path: p, sha256: fileSha(p) }))
    },
    canonicalConformanceSuite: {
      suiteId: suite.suiteId,
      version: suite.version,
      manifestHash: suite.manifestHash
    },
    independentBootstrapWitnessId: null,
    decision: 'PENDING — the independent conformance judgment must come from an authenticated authority outside the correlated producer (framework spec §7.10A); the producing agent may not issue it',
    reviewedLimitationsOrDeviations: [],
    status: 'pending'
  });
  console.log('bootstrap-conformance record regenerated (status pending, hashes current at', commit.slice(0, 12) + '…)');
}

// ------------------------------------------------------- binding updates
function contractsForClass(publicCommand) {
  return CONTRACTS.map(([name, property, failureCode]) => ({
    propertyId: scId(name),
    operativeMeaning: property,
    publicReaderOrCommand: publicCommand,
    mechanicalAcceptanceCondition: 'engine + bindingfields readers named in the framework matrix row for this contract; see verify framework bindingFieldAudit',
    expectedFailureCode: failureCode,
    expectedFirstFailureOrDivergence: 'per-scenario declared signature',
    residualJudgmentWitnessRequired: name === 'bootstrap-conformance' || name === 'conformance-governance' || name === 'equivalence-policy',
    residualJudgmentDescription: name === 'bootstrap-conformance'
      ? 'the independent conformance judgment itself (§7.10A)'
      : name === 'conformance-governance'
        ? 'authenticated framework-change authorization for any canonical-control change'
        : name === 'equivalence-policy'
          ? 'authenticated exclusions when complete-domain coverage is impossible'
          : null,
    requiredControlConditions: ['positive', 'structural-negative', 'semantic-negative'],
    controlScenarioRefs: {
      positive: [csId(name, 'POS')],
      structuralNegative: [csId(name, 'STRUCT')],
      semanticNegative: [csId(name, 'SEM')]
    },
    sharedControlScenariosPermitted: true,
    independentAttributionRequired: true,
    weakeningThisContractMustBreakDesignatedControl: true
  }));
}

const lineagePolicy = {
  reviewedRevisionRequired: true,
  reviewedTreeHashRequired: true,
  hostEventIdentityRequired: true,
  affectedArtifactHashesRequired: true,
  descendantConsumptionAllowedOnlyWhenReviewedRevisionIsAncestor: true,
  descendantConsumptionAllowedOnlyWhenProtectedArtifactsAreUnchanged: true,
  attestationContainerCommitNeedNotEqualReviewedRevision: true,
  baseRevisionRequiredForTrustRootChanges: true
};
const bootstrapBlock = {
  bootstrapRecordId: 'framework-bootstrap.phosphene',
  canonicalConformanceSuiteId: suite.suiteId,
  canonicalConformanceSuiteManifestHash: suite.manifestHash,
  independentBootstrapWitnessId: null
};

const hostBindingPath = 'verification/binding/project-verification-binding.json';
const hostBinding = readJson(hostBindingPath);
hostBinding.frameworkBootstrapConformance = bootstrapBlock;
hostBinding.authorizationLineagePolicy = lineagePolicy;
hostBinding.bindingAuthorization.adequacyCriteriaExplicitlyJudged = [
  'oracle-policies', 'inventory-procedures', 'verification-categories', 'providers',
  'adapter-capabilities', 'plausible-alternatives', 'alternative-evaluators',
  'fixture-discrimination-checks', 'product-path-checks', 'other-binding-controls',
  'semantic-acceptance-contracts', 'authorization-lineage',
  'framework-bootstrap-conformance', 'canonical-conformance-suite-governance'
];
for (const rc of hostBinding.requirementClasses) {
  rc.semanticAcceptanceContracts = contractsForClass(`verify requirement <${rc.match.requirementIdPatterns[0]}>`);
  if (rc.requirementClassId === 'requirement-class.milkdrop-expression') {
    rc.mandatoryPositiveControls = ['CHK-MILK-EXPR-EXEC'];
    rc.productPathDependenceControls = [
      { claimId: 'CLAIM-MILK-EXPR-OPERATORS', removalTargets: ['phosphene/src/exec/executor.mjs', 'phosphene/src/graph/graph.mjs'] }
    ];
  }
}
writeJson(hostBindingPath, hostBinding);
console.log('host binding regenerated with semantic acceptance contracts, lineage policy, dependence controls');

const selfBindingPath = 'tooling/verification-kit/src/self-test/self-test-binding.json';
const selfBinding = readJson(selfBindingPath);
selfBinding.frameworkBootstrapConformance = bootstrapBlock;
selfBinding.authorizationLineagePolicy = lineagePolicy;
for (const rc of selfBinding.requirementClasses) {
  rc.semanticAcceptanceContracts = contractsForClass('verify requirement REQ-SELFTEST-CRC32');
  rc.mandatoryPositiveControls = ['CHK-SELFTEST-CRC32-EXEC'];
}
writeJson(selfBindingPath, selfBinding);
console.log('self-test binding regenerated');

// ------------------------------------------------- claim/evidence coversPaths
const milkClaim = readJson('verification/claims/CLAIM-MILK-EXPR-OPERATORS.json');
milkClaim.perConstituentAuthority = [{
  constituent: 'expected pools[].{a,b,q1,c,d} values (measurement; ns-eel2 tier-1 sources define the required behavior and stay in authorityIds)',
  authorityId: 'AUTH-MILKDROP-EEL-PARSER',
  coversPaths: ['pools[].a', 'pools[].b', 'pools[].q1', 'pools[].c', 'pools[].d']
}];
writeJson('verification/claims/CLAIM-MILK-EXPR-OPERATORS.json', milkClaim);
const milkEv = readJson('verification/evidence/EV-MILK-EXPR-EXPECTED.json');
milkEv.perConstituentAuthority = milkClaim.perConstituentAuthority;
writeJson('verification/evidence/EV-MILK-EXPR-EXPECTED.json', milkEv);

const stClaim = readJson('verification/claims/CLAIM-SELFTEST-CRC32.json');
stClaim.perConstituentAuthority = [{
  constituent: 'expected CRC-32 results (measurement; RFC 1952 defines the algorithm and stays in authorityIds)',
  authorityId: 'AUTH-NODE-ZLIB',
  coversPaths: ['results']
}];
writeJson('verification/claims/CLAIM-SELFTEST-CRC32.json', stClaim);
const stEv = readJson('verification/evidence/EV-SELFTEST-CRC32-EXPECTED.json');
stEv.perConstituentAuthority = stClaim.perConstituentAuthority;
writeJson('verification/evidence/EV-SELFTEST-CRC32-EXPECTED.json', stEv);
console.log('claim/evidence per-constituent coverage maps regenerated');

// ------------------------------------------------- profile rehash (new selftest rule fields)
for (const rel of ['verification/profiles/profile.phosphene-compatibility-port.json', 'verification/profiles/profile.phosphene-graphics-runtime.json']) {
  const p = readJson(rel);
  p.customMechanismSelfTestRules.structurallyValidSemanticallyInadequateControlRequired = true;
  p.customMechanismSelfTestRules.proxyRequiresIndependentEquivalenceProof = true;
  p.hash = canonicalHash({ ...p, hash: 'sha256:SELF' });
  writeJson(rel, p);
  console.log('profile rehashed:', p.profileId, p.hash);
}
const selected = readJson('verification/profiles/selected.json');
for (const sel of selected.selected) {
  sel.hash = readJson(sel.path).hash;
}
writeJson('verification/profiles/selected.json', selected);
const binding2 = readJson(hostBindingPath);
for (const bp of binding2.selectedProfiles) {
  const match = selected.selected.find((s) => s.profileId === bp.profileId);
  if (match) bp.hash = match.hash;
}
writeJson(hostBindingPath, binding2);
console.log('selected.json and binding profile hashes synchronized');
