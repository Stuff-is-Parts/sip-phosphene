import { existsSync } from 'node:fs';
import { abs } from './paths.mjs';
import { hashFile, canonicalJsonHash } from './hash.mjs';
import { witnessStatus } from './authorization.mjs';

/**
 * Framework bootstrap conformance per spec §7.10A: the initial implementation
 * may not establish its own conformance. Until an authenticated authority
 * OUTSIDE the correlated producer judges the exact trust-bearing core hashes
 * and canonical suite manifest hash, framework verification stays FAIL with
 * FRAMEWORK_BOOTSTRAP_UNWITNESSED — internal self-tests passing changes nothing.
 * @param {import('./store.mjs').Store} store
 * @returns {{ failures: Array<{code: string, detail: string}>, status: string }}
 */
export function bootstrapConformanceStatus(store) {
  /** @type {Array<{code: string, detail: string}>} */
  const failures = [];
  const record = store.bootstrapConformance;
  if (!record) {
    failures.push({ code: 'FRAMEWORK_BOOTSTRAP_UNWITNESSED', detail: 'no framework bootstrap-conformance record retained (verification/framework-conformance/bootstrap-conformance.json)' });
    return { failures, status: 'missing' };
  }
  for (const entry of record.frameworkImplementation?.trustBearingArtifactHashes ?? []) {
    const fileAbs = abs(store.repoRoot, entry.path);
    if (!existsSync(fileAbs)) {
      failures.push({ code: 'FRAMEWORK_BOOTSTRAP_UNWITNESSED', detail: `trust-bearing artifact missing: ${entry.path}` });
      continue;
    }
    const current = hashFile(fileAbs).sha256;
    if (current !== entry.sha256) {
      failures.push({ code: 'FRAMEWORK_BOOTSTRAP_UNWITNESSED', detail: `trust-bearing core changed since the bootstrap record was drawn: ${entry.path} (recorded ${entry.sha256.slice(0, 12)}…, current ${current.slice(0, 12)}…) — a material core change invalidates the prior judgment (§7.10A)` });
    }
  }
  const suite = store.conformanceSuite;
  if (suite && record.canonicalConformanceSuite?.manifestHash !== suite.manifestHash) {
    failures.push({ code: 'FRAMEWORK_BOOTSTRAP_UNWITNESSED', detail: 'bootstrap record is bound to a different canonical conformance-suite manifest hash' });
  }
  if (record.status !== 'established') {
    failures.push({ code: 'FRAMEWORK_BOOTSTRAP_UNWITNESSED', detail: `bootstrap-conformance status is '${record.status}': the independent judgment from an authority outside the correlated producer does not exist yet; internal self-test success does not substitute (§7.10A)` });
    return { failures, status: record.status };
  }
  const ws = witnessStatus(store, record.independentBootstrapWitnessId);
  if (ws.status !== 'verified-attested') {
    failures.push({ code: 'FRAMEWORK_BOOTSTRAP_UNWITNESSED', detail: `independent bootstrap witness ${ws.status}: ${ws.reasons.join('; ')}` });
  }
  return { failures, status: record.status };
}

/**
 * Canonical conformance-suite verification per spec §7.10B: the suite is a
 * governed artifact separate from the implementation. Every mandatory semantic
 * acceptance contract must demonstrate its positive, structural-negative, and
 * semantic-negative conditions through executed public-boundary controls with
 * independently attributable outcomes.
 * @param {import('./store.mjs').Store} store
 * @param {Map<string, {ok: boolean, detail: string}>} executedControls control results keyed by fixtureOrMutationId
 * @returns {{ failures: Array<{code: string, detail: string}>, scenarioResults: any[], contractCoverage: any[] }}
 */
export function runConformanceSuite(store, executedControls) {
  /** @type {Array<{code: string, detail: string}>} */
  const failures = [];
  const suite = store.conformanceSuite;
  if (!suite) {
    failures.push({ code: 'CONFORMANCE_SUITE_UNAUTHORIZED', detail: 'no canonical conformance-suite manifest retained (verification/framework-conformance/canonical-suite/manifest.json)' });
    return { failures, scenarioResults: [], contractCoverage: [] };
  }
  const selfHash = canonicalJsonHash({ ...suite, manifestHash: 'sha256:SELF' });
  if (suite.manifestHash !== selfHash) {
    failures.push({ code: 'CONFORMANCE_SUITE_UNAUTHORIZED', detail: `canonical suite manifestHash does not match its content (expected ${selfHash}); an unauthorized suite change or a producer-local substitute produces this code (§7.10B)` });
  }

  /** @type {any[]} */
  const scenarioResults = [];
  /** @type {Map<string, {positive: boolean, structural: boolean, semantic: boolean}>} */
  const conditionByContract = new Map();
  for (const contract of suite.semanticContracts ?? []) {
    conditionByContract.set(contract.semanticContractId, { positive: false, structural: false, semantic: false });
  }

  for (const scenario of suite.controlScenarios ?? []) {
    if (String(scenario.fixtureOrMutationId).startsWith('PENDING:')) {
      scenarioResults.push({ scenarioId: scenario.scenarioId, executed: false, ok: false, detail: scenario.fixtureOrMutationId });
      failures.push({ code: 'CHECK_MISSING', detail: `canonical scenario '${scenario.scenarioId}' has no executor yet (${scenario.fixtureOrMutationId}); the suite result stays FAIL until it runs` });
      continue;
    }
    const executed = executedControls.get(scenario.fixtureOrMutationId);
    if (!executed) {
      scenarioResults.push({ scenarioId: scenario.scenarioId, executed: false, ok: false, detail: `no executed control named '${scenario.fixtureOrMutationId}' in this run` });
      failures.push({ code: 'CHECK_MISSING', detail: `canonical scenario '${scenario.scenarioId}' maps to control '${scenario.fixtureOrMutationId}' which did not execute in this run` });
      continue;
    }
    scenarioResults.push({ scenarioId: scenario.scenarioId, executed: true, ok: executed.ok, detail: executed.detail });
    if (!executed.ok) {
      failures.push({ code: 'CHECK_FAILED', detail: `canonical scenario '${scenario.scenarioId}' (${scenario.fixtureOrMutationId}) failed: ${executed.detail}` });
      continue;
    }
    for (const outcome of scenario.expectedOutcomes ?? []) {
      const bucket = conditionByContract.get(outcome.semanticContractId);
      if (!bucket) {
        failures.push({ code: 'CONFORMANCE_SUITE_UNAUTHORIZED', detail: `scenario '${scenario.scenarioId}' maps to unknown semantic contract '${outcome.semanticContractId}'` });
        continue;
      }
      if (scenario.condition === 'positive') bucket.positive = true;
      if (scenario.condition === 'structural-negative') bucket.structural = true;
      if (scenario.condition === 'semantic-negative') bucket.semantic = true;
    }
  }

  /** @type {any[]} */
  const contractCoverage = [];
  for (const contract of suite.semanticContracts ?? []) {
    const bucket = /** @type {{positive: boolean, structural: boolean, semantic: boolean}} */ (conditionByContract.get(contract.semanticContractId));
    contractCoverage.push({ semanticContractId: contract.semanticContractId, ...bucket });
    for (const [condition, met] of Object.entries(bucket)) {
      if (!met) {
        failures.push({ code: 'SEMANTIC_PROXY_SUBSTITUTION', detail: `mandatory semantic acceptance contract '${contract.semanticContractId}' lacks a demonstrated ${condition} control condition this run (§7.10B: presence, registration, and declared roles are insufficient)` });
      }
    }
  }

  return { failures, scenarioResults, contractCoverage };
}
