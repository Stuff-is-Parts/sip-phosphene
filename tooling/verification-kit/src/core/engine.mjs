import { existsSync, readFileSync } from 'node:fs';
import { abs } from './paths.mjs';
import { hashFile, sha256Hex, canonicalJsonHash } from './hash.mjs';
import { applyComparator } from './compare.mjs';
import { effectiveAlternativeSet } from './union.mjs';
import { resolveCapability, invokeCapability, invokeEvaluator } from './adapters.mjs';
import { witnessStatus } from './authorization.mjs';
import { lockSurfaces, verifyLock } from './locks.mjs';

/** @typedef {{ code: string, detail: string }} Failure */

/** Glob match supporting '*' wildcards only. @param {string} pattern @param {string} id @returns {boolean} */
export function matchPattern(pattern, id) {
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(id);
}

/**
 * Resolve the governing binding and matching requirement class for a requirement.
 * Framework-only requirements are governed by the kit's built-in self-test binding
 * (framework spec §24: self-test evidence is framework-only and never satisfies a
 * host requirement), so the host binding's adoption state does not gate the self-test.
 * @param {import('./store.mjs').Store} store
 * @param {any} requirement
 * @returns {{ binding: any, bindingClass: any, failures: Failure[] }}
 */
export function bindingFor(store, requirement) {
  /** @type {Failure[]} */
  const failures = [];
  const binding = requirement.frameworkOnly ? store.selfTestBinding : store.binding;
  if (!binding) {
    failures.push({ code: 'PROJECT_BINDING_MISSING', detail: requirement.frameworkOnly ? 'self-test binding not found in kit' : 'repository has no project verification binding' });
    return { binding: undefined, bindingClass: undefined, failures };
  }
  const bindingClass = (binding.requirementClasses ?? []).find((/** @type {any} */ rc) =>
    (rc.match?.requirementIdPatterns ?? []).some((/** @type {string} */ p) => matchPattern(p, requirement.requirementId))
  );
  if (!bindingClass) {
    failures.push({ code: 'PROJECT_UNDERBOUND', detail: `no binding requirement class matches '${requirement.requirementId}'` });
  }
  return { binding, bindingClass, failures };
}

/** @param {import('./store.mjs').Store} store @param {string} capabilityOrProviderId @returns {boolean} */
function capabilityOrProviderAvailable(store, capabilityOrProviderId) {
  for (const adapter of store.adapters) {
    const cap = (adapter.capabilities ?? []).find((/** @type {any} */ c) => c.capabilityId === capabilityOrProviderId);
    if (cap) return resolveCapability(store, adapter.adapterId, capabilityOrProviderId).ok;
  }
  return (store.providersConfig?.providers ?? []).some((/** @type {any} */ p) => p.providerId === capabilityOrProviderId);
}

/**
 * Oracle-precedence enforcement per framework spec §7.8B.
 * @param {import('./store.mjs').Store} store @param {any} claim @param {any} bindingClass
 * @returns {{ failures: Failure[], trace: any }}
 */
export function oracleCheck(store, claim, bindingClass) {
  /** @type {Failure[]} */
  const failures = [];
  const policy = bindingClass?.oraclePrecedencePolicy;
  if (!policy) return { failures, trace: { policy: null } };
  if (claim.oraclePrecedencePolicyId !== policy.policyId) {
    failures.push({ code: 'PROJECT_UNDERBOUND', detail: `claim '${claim.claimId}' cites oracle policy '${claim.oraclePrecedencePolicyId}' but its binding class requires '${policy.policyId}'` });
  }
  const actual = claim.actualExpectedValueOrigin;
  if (actual === 'hand-derived-exact') {
    // No explicit requirement-class authorization rule for hand-derived-exact exists in this
    // repository; per §7.8B its absence means the class is prohibited outright.
    failures.push({ code: 'EXPECTED_VALUE_ORIGIN_UNACCEPTABLE', detail: `claim '${claim.claimId}' uses hand-derived-exact, which is forbidden without an explicit user-authorized requirement-class rule` });
    return { failures, trace: { policy: policy.policyId, actual } };
  }
  const ordered = policy.orderedOracleClassesStrongestFirst ?? [];
  const actualIndex = ordered.indexOf(actual);
  if (actualIndex === -1) {
    failures.push({ code: 'EXPECTED_VALUE_ORIGIN_UNACCEPTABLE', detail: `claim '${claim.claimId}' origin '${actual}' is not in the binding class's required oracle ordering` });
    return { failures, trace: { policy: policy.policyId, actual } };
  }
  /** @type {any[]} */
  const bypassed = [];
  for (let i = 0; i < actualIndex; i++) {
    const cls = ordered[i];
    const required = (policy.requiredProviderOrCapabilityByClass ?? {})[cls];
    const availability = required === undefined
      ? 'unknown'
      : required.every((/** @type {string} */ r) => capabilityOrProviderAvailable(store, r)) ? 'available' : 'capability-missing';
    const evidenceCovers = (claim.oracleUnavailabilityEvidenceIds ?? []).some((/** @type {string} */ id) => {
      const hit = store.byId.get(id);
      return hit?.kind === 'evidence' && (hit.record.unavailabilityEvidenceForBypassedClasses ?? []).some((/** @type {any} */ u) => u.bypassedOracleClass === cls);
    });
    bypassed.push({ cls, availability, evidenceCovers });
    if (availability === 'available' && !evidenceCovers) {
      failures.push({ code: 'STRONGER_ORACLE_BYPASSED', detail: `stronger oracle class '${cls}' is available (its required capabilities resolve) but claim '${claim.claimId}' uses '${actual}' without unavailability evidence` });
    } else if (availability !== 'available' && !evidenceCovers) {
      failures.push({ code: 'ORACLE_UNAVAILABILITY_UNPROVEN', detail: `claim '${claim.claimId}' bypasses stronger oracle class '${cls}' without independently retained unavailability evidence` });
    }
  }
  const expectedEvidence = (claim.evidenceIds ?? [])
    .map((/** @type {string} */ id) => store.byId.get(id)?.record)
    .filter((/** @type {any} */ e) => e && e.expectedResultArtifact);
  for (const ev of expectedEvidence) {
    if (ev.evidenceClass !== actual) {
      failures.push({ code: 'EVIDENCE_CLASS_MISDECLARED', detail: `claim '${claim.claimId}' declares origin '${actual}' but expected-result evidence '${ev.evidenceId}' has class '${ev.evidenceClass}'` });
    }
  }
  return { failures, trace: { policy: policy.policyId, actual, bypassed } };
}

/**
 * Authority integrity per §7.2: references resolve, raw artifacts remain byte-exact, conflicts resolved.
 * @param {import('./store.mjs').Store} store @param {any} claim
 * @returns {Failure[]}
 */
export function authoritiesCheck(store, claim) {
  /** @type {Failure[]} */
  const failures = [];
  for (const id of claim.authorityIds ?? []) {
    const hit = store.byId.get(id);
    if (!hit || hit.kind !== 'authority') {
      failures.push({ code: 'AUTHORITY_MISSING', detail: `claim '${claim.claimId}' references unregistered authority '${id}'` });
      continue;
    }
    const raw = hit.record.rawArtifact;
    if (raw) {
      const fileAbs = abs(store.repoRoot, raw.retainedPath);
      if (!existsSync(fileAbs)) {
        failures.push({ code: 'RAW_AUTHORITY_MUTATED', detail: `raw authority artifact missing: ${raw.retainedPath}` });
      } else {
        const { sha256, bytes } = hashFile(fileAbs);
        if (sha256 !== raw.sha256 || bytes !== raw.byteLength) {
          failures.push({ code: 'RAW_AUTHORITY_MUTATED', detail: `raw authority artifact does not match registered exact bytes: ${raw.retainedPath}` });
        }
      }
    }
  }
  for (const id of claim.conflictIds ?? []) {
    const hit = store.byId.get(id);
    if (!hit || hit.kind !== 'conflict') {
      failures.push({ code: 'AUTHORITY_CONFLICT_UNRESOLVED', detail: `claim '${claim.claimId}' references missing conflict record '${id}'` });
    } else if (hit.record.status !== 'resolved') {
      failures.push({ code: 'AUTHORITY_CONFLICT_UNRESOLVED', detail: `conflict '${id}' is unresolved` });
    }
  }
  for (const pca of claim.perConstituentAuthority ?? []) {
    const hit = store.byId.get(pca.authorityId);
    if (!hit || hit.kind !== 'authority') {
      failures.push({ code: 'AUTHORITY_SOURCE_AMBIGUOUS', detail: `constituent '${pca.constituent}' maps to unregistered authority '${pca.authorityId}'` });
    }
  }
  return failures;
}

/**
 * Evidence integrity per §7.6: records resolve, classes coherent, content hashes current.
 * The contentHash covers the expected-result artifact bytes when present, else the
 * derived artifact bytes, else the canonical JSON of the record's fact and procedure.
 * @param {import('./store.mjs').Store} store @param {any} claim
 * @returns {Failure[]}
 */
export function evidenceCheck(store, claim) {
  /** @type {Failure[]} */
  const failures = [];
  for (const id of claim.evidenceIds ?? []) {
    const hit = store.byId.get(id);
    if (!hit || hit.kind !== 'evidence') {
      failures.push({ code: 'EVIDENCE_MISSING', detail: `claim '${claim.claimId}' references missing evidence '${id}'` });
      continue;
    }
    const ev = hit.record;
    if (ev.evidenceClass === 'derived-evidence' && (ev.rawAuthorityArtifactIds ?? []).length === 0) {
      failures.push({ code: 'EVIDENCE_CLASS_MISDECLARED', detail: `derived evidence '${id}' does not reference the raw authority it derives from` });
    }
    let currentHash;
    const artifactPath = ev.expectedResultArtifact ?? ev.derivedArtifactPath;
    if (artifactPath) {
      const fileAbs = abs(store.repoRoot, artifactPath);
      if (!existsSync(fileAbs)) {
        failures.push({ code: 'EVIDENCE_MISSING', detail: `evidence '${id}' artifact missing: ${artifactPath}` });
        continue;
      }
      currentHash = `sha256:${hashFile(fileAbs).sha256}`;
    } else {
      currentHash = canonicalJsonHash({ fact: ev.fact, procedure: ev.procedure });
    }
    if (ev.contentHash !== currentHash) {
      failures.push({ code: 'EVIDENCE_STALE', detail: `evidence '${id}' contentHash does not match current artifact` });
    }
  }
  return failures;
}

/**
 * Inventory-to-claim completeness per §7.12.
 * @param {import('./store.mjs').Store} store @param {any} requirement @param {any} bindingClass
 * @returns {Failure[]}
 */
export function inventoryCheck(store, requirement, bindingClass) {
  /** @type {Failure[]} */
  const failures = [];
  for (const proc of bindingClass?.requiredInventoryProcedures ?? []) {
    const inv = store.inventories.find((i) => i.procedureId === proc.procedureId);
    if (!inv) {
      failures.push({ code: 'BEHAVIOR_COVERAGE_UNPROVEN', detail: `required inventory procedure '${proc.procedureId}' has no retained output` });
      continue;
    }
    if (inv.outputHash !== canonicalJsonHash(inv.items)) {
      failures.push({ code: 'EVIDENCE_STALE', detail: `inventory '${proc.procedureId}' outputHash does not match its items` });
    }
    if (!inv.mechanicallyComplete) {
      const ws = witnessStatus(store, inv.residualCompletenessWitnessId);
      if (ws.status !== 'verified-attested') {
        failures.push({ code: 'BEHAVIOR_COVERAGE_UNPROVEN', detail: `inventory '${proc.procedureId}' is not mechanically complete and lacks an authenticated residual-completeness witness (${ws.reasons.join('; ')})` });
      }
    }
    const requirementClaims = store.claims.filter((c) => (c.requirementIds ?? []).includes(requirement.requirementId));
    for (const item of inv.items ?? []) {
      const coveringClaims = requirementClaims.filter((c) => (c.inventoryItemIds ?? []).includes(item.inventoryItemId));
      if (coveringClaims.length === 0) {
        failures.push({ code: 'INVENTORY_ITEM_UNCLAIMED', detail: `inventory item '${item.inventoryItemId}' (${item.behavior}) maps to no claim of '${requirement.requirementId}'` });
        continue;
      }
      const fixtureCovers = store.fixtures.some((f) => (f.inventoryItemIds ?? []).includes(item.inventoryItemId));
      const checkCovers = coveringClaims.some((c) => (c.checkIds ?? []).length > 0);
      if (!fixtureCovers || !checkCovers) {
        failures.push({ code: 'CLAIM_COVERAGE_COARSE', detail: `inventory item '${item.inventoryItemId}' is claimed but not independently exercised (fixture mapping: ${fixtureCovers}, executable check: ${checkCovers})` });
      }
    }
  }
  return failures;
}

/**
 * Fixture integrity, effective-alternative union, and discrimination execution per §7.7/§14.1.
 * @param {import('./store.mjs').Store} store @param {any} claim @param {any} bindingClass
 * @returns {Promise<{ failures: Failure[], trace: any }>}
 */
export async function fixturesCheck(store, claim, bindingClass) {
  /** @type {Failure[]} */
  const failures = [];
  /** @type {any[]} */
  const trace = [];
  if (claim.kind === 'behavior' && (claim.fixtureIds ?? []).length === 0) {
    failures.push({ code: 'FIXTURE_MISSING', detail: `behavior claim '${claim.claimId}' has no fixtures` });
  }
  const { union, problems } = effectiveAlternativeSet(store, claim, bindingClass);
  for (const p of problems) failures.push({ code: 'ALTERNATIVE_SET_UNDERBOUND', detail: p });

  for (const fixtureId of claim.fixtureIds ?? []) {
    const hit = store.byId.get(fixtureId);
    if (!hit || hit.kind !== 'fixture') {
      failures.push({ code: 'FIXTURE_MISSING', detail: `claim '${claim.claimId}' references missing fixture '${fixtureId}'` });
      continue;
    }
    const fixture = hit.record;
    const inputAbs = abs(store.repoRoot, fixture.inputArtifact);
    const expectedAbs = abs(store.repoRoot, fixture.expectedArtifact);
    if (!existsSync(inputAbs) || !existsSync(expectedAbs)) {
      failures.push({ code: 'FIXTURE_MISSING', detail: `fixture '${fixtureId}' input or expected artifact missing` });
      continue;
    }
    const combined = sha256Hex(Buffer.concat([readFileSync(inputAbs), readFileSync(expectedAbs)]));
    if (fixture.fixtureHash !== `sha256:${combined}`) {
      failures.push({ code: 'FIXTURE_STALE', detail: `fixture '${fixtureId}' hash does not match current input+expected bytes` });
    }
    const comparator = store.byId.get(fixture.comparatorId)?.record;
    if (!comparator) {
      failures.push({ code: 'COMPARATOR_UNJUSTIFIED', detail: `fixture '${fixtureId}' references missing comparator '${fixture.comparatorId}'` });
      continue;
    }
    if (comparator.equalityMode === 'toleranced' && (comparator.evidenceRefs ?? []).length === 0) {
      failures.push({ code: 'COMPARATOR_UNJUSTIFIED', detail: `comparator '${comparator.comparatorId}' carries a tolerance without evidence references` });
    }

    const declared = new Map((fixture.discriminates ?? []).map((/** @type {any} */ d) => [d.alternativeId, d]));
    for (const member of union) {
      if (!declared.has(member.alternativeId)) {
        failures.push({ code: 'ALTERNATIVE_SET_UNDERBOUND', detail: `fixture '${fixtureId}' does not discriminate required alternative '${member.alternativeId}' (${member.source})` });
      }
    }
    const requiredStateful = bindingClass?.mandatoryStatefulAlternativeClasses ?? [];
    for (const statefulId of requiredStateful) {
      if (!declared.has(statefulId)) {
        failures.push({ code: 'STATEFUL_ALTERNATIVE_MISSING', detail: `fixture '${fixtureId}' does not exercise required stateful alternative '${statefulId}'` });
      }
    }

    const input = JSON.parse(readFileSync(inputAbs, 'utf8'));
    const expected = JSON.parse(readFileSync(expectedAbs, 'utf8'));
    for (const d of fixture.discriminates ?? []) {
      const evaluator = store.byId.get(d.evaluatorId)?.record;
      if (!evaluator || store.byId.get(d.evaluatorId)?.kind !== 'evaluator') {
        failures.push({ code: 'ALTERNATIVE_EVALUATOR_MISSING', detail: `fixture '${fixtureId}' alternative '${d.alternativeId}' has no registered evaluator '${d.evaluatorId}'` });
        continue;
      }
      if (!evaluator.grounding?.reference) {
        failures.push({ code: 'ALTERNATIVE_EVALUATOR_UNGROUNDED', detail: `evaluator '${d.evaluatorId}' lacks a grounded defect-class reference` });
      }
      const run = await invokeEvaluator(store, evaluator, input);
      if (!run.ok) {
        failures.push({ code: 'ALTERNATIVE_EVALUATOR_MISSING', detail: `evaluator '${d.evaluatorId}' failed to execute: ${run.reason}` });
        continue;
      }
      const cmp = applyComparator(comparator, expected, run.result);
      if (cmp.equal) {
        failures.push({ code: 'FIXTURE_NONDISCRIMINATING', detail: `fixture '${fixtureId}' cannot distinguish the claim from alternative '${d.alternativeId}': evaluator output equals the expected result` });
      } else if (cmp.firstDivergence !== d.expectedDivergence) {
        failures.push({ code: 'FIXTURE_NONDISCRIMINATING', detail: `fixture '${fixtureId}' alternative '${d.alternativeId}' diverges at '${cmp.firstDivergence}' but its record declares '${d.expectedDivergence}'` });
      }
      trace.push({ fixtureId, alternativeId: d.alternativeId, evaluatorId: d.evaluatorId, diverged: !cmp.equal, firstDivergence: cmp.firstDivergence });
    }
  }
  return { failures, trace };
}

/**
 * Execute the claim's registered checks against the actual subject per §13.
 * @param {import('./store.mjs').Store} store @param {any} claim
 * @param {{ subjectOverride?: { module: string, export: string } }} [opts] Used only by negative-control runs.
 * @returns {Promise<{ failures: Failure[], trace: any[] }>}
 */
export async function checksRun(store, claim, opts = {}) {
  /** @type {Failure[]} */
  const failures = [];
  /** @type {any[]} */
  const trace = [];
  if ((claim.checkIds ?? []).length === 0) {
    failures.push({ code: 'CHECK_MISSING', detail: `claim '${claim.claimId}' has no executable checks` });
    return { failures, trace };
  }
  for (const checkId of claim.checkIds) {
    const check = store.byId.get(checkId)?.record;
    if (!check || store.byId.get(checkId)?.kind !== 'check') {
      failures.push({ code: 'CHECK_MISSING', detail: `claim '${claim.claimId}' references missing check '${checkId}'` });
      continue;
    }
    if (check.checkType === 'fixture-discrimination') {
      trace.push({ checkId, kind: 'fixture-discrimination', note: 'executed by fixturesCheck' });
      continue;
    }
    if (check.checkType === 'subject-execution') {
      const resolved = resolveCapability(store, check.adapterId, check.capabilityId);
      if (!resolved.ok) {
        failures.push({ code: 'SUBJECT_EXECUTION_UNAVAILABLE', detail: `check '${checkId}': ${resolved.reason}` });
        continue;
      }
      for (const fixtureId of claim.fixtureIds ?? []) {
        const fixture = store.byId.get(fixtureId)?.record;
        if (!fixture) continue;
        const input = JSON.parse(readFileSync(abs(store.repoRoot, fixture.inputArtifact), 'utf8'));
        const expected = JSON.parse(readFileSync(abs(store.repoRoot, fixture.expectedArtifact), 'utf8'));
        const comparator = store.byId.get(fixture.comparatorId)?.record;
        let run;
        if (opts.subjectOverride) {
          run = await invokeEvaluator(store, { entryPoint: opts.subjectOverride }, input);
        } else {
          run = await invokeCapability(store, check.adapterId, check.capabilityId, input);
        }
        if (!run.ok) {
          failures.push({ code: 'SUBJECT_EXECUTION_UNAVAILABLE', detail: `check '${checkId}' on '${fixtureId}': ${run.reason}` });
          continue;
        }
        const cmp = applyComparator(comparator, expected, run.result);
        if (!cmp.equal) {
          failures.push({ code: 'CHECK_FAILED', detail: `check '${checkId}' on fixture '${fixtureId}': first divergence at ${cmp.firstDivergence} (expected ${JSON.stringify(cmp.expectedAt)}, actual ${JSON.stringify(cmp.actualAt)})` });
        }
        trace.push({ checkId, fixtureId, executed: true, pass: cmp.equal, firstDivergence: cmp.firstDivergence });
      }
      continue;
    }
    if (check.checkType === 'equivalence-differential' || check.checkType === 'runtime-effect') {
      const run = await invokeCapability(store, check.adapterId, check.capabilityId, { claimId: claim.claimId, claim });
      if (!run.ok) {
        failures.push({ code: check.checkType === 'runtime-effect' ? 'RUNTIME_EFFECT_UNWITNESSED' : 'EQUIVALENCE_UNPROVEN', detail: `check '${checkId}': ${run.reason}` });
        continue;
      }
      const result = /** @type {any} */ (run.result);
      if (result?.pass !== true) {
        failures.push({ code: check.checkType === 'runtime-effect' ? 'RUNTIME_EFFECT_UNWITNESSED' : 'EQUIVALENCE_UNPROVEN', detail: `check '${checkId}': ${result?.detail ?? 'check reported failure'}` });
      }
      trace.push({ checkId, kind: check.checkType, executed: true, pass: result?.pass === true });
      continue;
    }
    if (check.checkType === 'provider') {
      const provider = (store.providersConfig?.providers ?? []).find((/** @type {any} */ p) => p.providerId === check.providerId);
      if (!provider) {
        failures.push({ code: 'PROVIDER_UNAVAILABLE', detail: `check '${checkId}' requires unconfigured provider '${check.providerId}'` });
      }
      continue;
    }
  }
  return { failures, trace };
}

/**
 * Compute one claim's current result per §4. Lock problems for evidence-bearing
 * surfaces are injected so a stale surface fails every claim that leans on it.
 * @param {import('./store.mjs').Store} store @param {any} claim @param {Failure[]} surfaceFailures
 * @param {{ subjectOverride?: { module: string, export: string } }} [opts]
 * @returns {Promise<{ claimId: string, result: 'PASS' | 'FAIL', failures: Failure[], trace: any }>}
 */
export async function computeClaimResult(store, claim, surfaceFailures, opts = {}) {
  /** @type {Failure[]} */
  const failures = [...surfaceFailures];
  /** @type {any} */
  const trace = { requirementIds: claim.requirementIds };

  const requirements = (claim.requirementIds ?? []).map((/** @type {string} */ id) => store.byId.get(id)?.record).filter(Boolean);
  if (requirements.length !== (claim.requirementIds ?? []).length) {
    failures.push({ code: 'CHECK_MISSING', detail: `claim '${claim.claimId}' references unregistered requirements` });
  }
  for (const requirement of requirements) {
    const b = bindingFor(store, requirement);
    failures.push(...b.failures);
    if (!b.bindingClass) continue;
    const oracle = oracleCheck(store, claim, b.bindingClass);
    failures.push(...oracle.failures);
    trace.oracle = oracle.trace;
    const fx = await fixturesCheck(store, claim, b.bindingClass);
    failures.push(...fx.failures);
    trace.discrimination = fx.trace;
  }
  failures.push(...authoritiesCheck(store, claim));
  failures.push(...evidenceCheck(store, claim));

  if (claim.kind === 'equivalence') {
    const eq = claim.equivalence;
    if (eq.proofKind === 'authority-derived-proof') {
      const hit = store.byId.get(eq.proofRef);
      if (!hit || hit.kind !== 'evidence') {
        failures.push({ code: 'EQUIVALENCE_UNPROVEN', detail: `equivalence claim '${claim.claimId}' proofRef '${eq.proofRef}' does not resolve to evidence` });
      }
    } else {
      const hasDifferential = (claim.checkIds ?? []).some((/** @type {string} */ id) => store.byId.get(id)?.record?.checkType === 'equivalence-differential');
      if (!hasDifferential) {
        failures.push({ code: 'EQUIVALENCE_UNPROVEN', detail: `equivalence claim '${claim.claimId}' declares complete-domain-differential proof but registers no equivalence-differential check` });
      }
    }
  }
  if (claim.kind === 'runtime-effect') {
    const hasWitnessCheck = (claim.checkIds ?? []).some((/** @type {string} */ id) => store.byId.get(id)?.record?.checkType === 'runtime-effect');
    if (!hasWitnessCheck) {
      failures.push({ code: 'RUNTIME_EFFECT_UNWITNESSED', detail: `runtime-effect claim '${claim.claimId}' registers no runtime-effect check` });
    }
  }

  const checks = await checksRun(store, claim, opts);
  failures.push(...checks.failures);
  trace.checks = checks.trace;

  return { claimId: claim.claimId, result: failures.length === 0 ? 'PASS' : 'FAIL', failures, trace };
}

/**
 * Lock problems mapped to §4 failure codes for injection into claim results.
 * @param {import('./store.mjs').Store} store
 * @returns {Failure[]}
 */
export function surfaceLockFailures(store) {
  /** @type {Failure[]} */
  const failures = [];
  const surfaces = lockSurfaces(store.tree);
  /** @type {Record<string, string>} */
  const codeBySurface = {
    evidence: 'EVIDENCE_STALE',
    fixtures: 'FIXTURE_STALE',
    comparators: 'EVIDENCE_STALE',
    authorities: 'EVIDENCE_STALE'
  };
  for (const [name, code] of Object.entries(codeBySurface)) {
    const r = verifyLock(store.repoRoot, surfaces[name]);
    if (!r.ok) {
      for (const p of r.problems) failures.push({ code, detail: `[${name} lock] ${p}` });
    }
  }
  return failures;
}

/**
 * Compute one requirement's result per §4: requirement-level conditions plus every claim.
 * @param {import('./store.mjs').Store} store @param {any} requirement
 * @returns {Promise<{ requirementId: string, result: 'PASS' | 'FAIL', failures: Failure[], claims: any[] }>}
 */
export async function computeRequirementResult(store, requirement) {
  /** @type {Failure[]} */
  const failures = [];

  for (const e of store.structuralErrors) failures.push({ code: 'EVIDENCE_MISSING', detail: `[structural] ${e}` });

  if (requirement.frameworkOnly) {
    const specAbs = abs(store.repoRoot, 'portable-verification-framework/portable-evidence-gated-verification-framework.md');
    if (!existsSync(specAbs)) {
      failures.push({ code: 'SCOPE_APPROVAL_MISSING', detail: 'framework specification not found; the self-test requirement derives its scope from framework spec §24' });
    }
  } else {
    if (!store.scope) {
      failures.push({ code: 'SCOPE_APPROVAL_MISSING', detail: 'no scope record' });
    } else {
      const scopeItemsKnown = (requirement.scopeItemIds ?? []).every((/** @type {string} */ id) =>
        (store.scope.approvedScopeItems ?? []).some((/** @type {any} */ s) => s.scopeItemId === id)
      );
      if (!scopeItemsKnown) failures.push({ code: 'SCOPE_APPROVAL_MISSING', detail: `requirement '${requirement.requirementId}' references scope items outside the approved scope record` });
      const ws = witnessStatus(store, store.scope.authorizationWitnessId);
      if (ws.status === 'missing') {
        failures.push({ code: 'SCOPE_APPROVAL_MISSING', detail: `scope approval has no authorization witness (${ws.reasons.join('; ')})` });
      } else if (ws.status === 'unverified') {
        failures.push({ code: 'AUTHORIZATION_WITNESS_UNVERIFIED', detail: `scope approval witness unverified (${ws.reasons.join('; ')})` });
      }
    }
  }

  const b = bindingFor(store, requirement);
  failures.push(...b.failures);

  if (!requirement.frameworkOnly && b.binding) {
    const adoption = witnessStatus(store, b.binding.bindingAuthorization?.adoptionOrChangeWitnessId);
    if (adoption.status !== 'verified-attested') {
      failures.push({ code: adoption.status === 'missing' ? 'AUTHORIZATION_WITNESS_MISSING' : 'AUTHORIZATION_WITNESS_UNVERIFIED', detail: `project-binding adoption witness ${adoption.status} (${adoption.reasons.join('; ')})` });
    }
    const adequacy = witnessStatus(store, b.binding.bindingAuthorization?.adequacyWitnessId);
    if (adequacy.status !== 'verified-attested') {
      failures.push({ code: 'BINDING_ADEQUACY_UNWITNESSED', detail: `project-binding adequacy witness ${adequacy.status} (${adequacy.reasons.join('; ')})` });
    }
  }

  const claims = store.claims.filter((c) => (c.requirementIds ?? []).includes(requirement.requirementId));
  if (claims.length === 0) {
    failures.push({ code: 'CHECK_MISSING', detail: `requirement '${requirement.requirementId}' has no registered claims` });
  }

  if (b.bindingClass) {
    const claimCategories = new Set(claims.flatMap((c) => c.verificationCategories ?? []));
    for (const cat of b.bindingClass.mandatoryVerificationCategories ?? []) {
      if (!claimCategories.has(cat)) {
        failures.push({ code: 'PROJECT_UNDERBOUND', detail: `mandatory verification category '${cat}' is covered by no claim of '${requirement.requirementId}'` });
      }
    }
    for (const capId of b.bindingClass.mandatoryAdapterCapabilities ?? []) {
      if (!capabilityOrProviderAvailable(store, capId)) {
        failures.push({ code: 'SUBJECT_EXECUTION_UNAVAILABLE', detail: `mandatory adapter capability '${capId}' is unavailable` });
      }
    }
    for (const provId of b.bindingClass.mandatoryProviders ?? []) {
      if (!(store.providersConfig?.providers ?? []).some((/** @type {any} */ p) => p.providerId === provId)) {
        failures.push({ code: 'PROVIDER_UNAVAILABLE', detail: `mandatory provider '${provId}' is not configured` });
      }
    }
    failures.push(...inventoryCheck(store, requirement, b.bindingClass));
  }

  const surfaceFailures = surfaceLockFailures(store);
  /** @type {any[]} */
  const claimResults = [];
  for (const claim of claims) {
    const r = await computeClaimResult(store, claim, surfaceFailures);
    claimResults.push(r);
    if (r.result === 'FAIL') {
      failures.push({ code: 'CHECK_FAILED', detail: `claim '${claim.claimId}' fails (${r.failures.length} failure${r.failures.length === 1 ? '' : 's'})` });
    }
  }

  return { requirementId: requirement.requirementId, result: failures.length === 0 ? 'PASS' : 'FAIL', failures, claims: claimResults };
}

/**
 * The sole global completion computation per §4: the project passes only when
 * every host (non-framework-only) requirement inside approved scope has a current PASS.
 * @param {import('./store.mjs').Store} store
 * @returns {Promise<{ result: 'PASS' | 'FAIL', failures: Failure[], requirements: any[] }>}
 */
export async function computeGlobalResult(store) {
  /** @type {Failure[]} */
  const failures = [];
  const hostRequirements = store.requirements.filter((r) => !r.frameworkOnly);

  for (const item of store.scope?.approvedScopeItems ?? []) {
    const covered = hostRequirements.some((r) => (r.scopeItemIds ?? []).includes(item.scopeItemId));
    if (!covered) {
      failures.push({ code: 'PROJECT_UNDERBOUND', detail: `approved scope item '${item.scopeItemId}' (${item.title}) has no registered requirements` });
    }
  }

  /** @type {any[]} */
  const results = [];
  for (const requirement of hostRequirements) {
    const r = await computeRequirementResult(store, requirement);
    results.push(r);
    if (r.result === 'FAIL') {
      failures.push({ code: 'CHECK_FAILED', detail: `requirement '${r.requirementId}' fails` });
    }
  }
  return { result: failures.length === 0 ? 'PASS' : 'FAIL', failures, requirements: results };
}
