import { existsSync } from 'node:fs';
import { abs } from './paths.mjs';
import { matchPattern } from './engine-util.mjs';

/**
 * Mechanical enforcement of every load-bearing mandatory/policy field in a
 * project-binding requirement class (audit finding 3): a mandatory field with
 * no operational reader is an orphan write, so each field here has a named
 * reader, an exact PASS condition, and a precise failure code.
 *
 * @param {import('./store.mjs').Store} store
 * @param {any} requirement
 * @param {any} bindingClass
 * @param {any[]} claims registered claims of this requirement
 * @param {Array<{claimId: string, result: string}>} claimResults computed results for those claims
 * @returns {{ failures: Array<{code: string, detail: string}>, fieldAudit: Array<{field: string, reader: string, passCondition: string, failureCode: string, status: string}> }}
 */
export function enforceBindingClassFields(store, requirement, bindingClass, claims, claimResults) {
  /** @type {Array<{code: string, detail: string}>} */
  const failures = [];
  /** @type {Array<{field: string, reader: string, passCondition: string, failureCode: string, status: string}>} */
  const fieldAudit = [];
  const rid = requirement.requirementId;

  /** @param {string} field @param {string} passCondition @param {string} failureCode @param {string[]} problems */
  function audit(field, passCondition, failureCode, problems) {
    for (const p of problems) failures.push({ code: failureCode, detail: `[binding:${field}] ${p}` });
    fieldAudit.push({
      field,
      reader: 'bindingfields.enforceBindingClassFields',
      passCondition,
      failureCode,
      status: problems.length === 0 ? 'PASS' : 'FAIL'
    });
  }

  // mandatoryEvidenceClasses — every claim retains at least one evidence record of each class.
  {
    /** @type {string[]} */
    const problems = [];
    for (const claim of claims) {
      const classes = new Set(
        (claim.evidenceIds ?? []).map((/** @type {string} */ id) => store.byId.get(id)?.record?.evidenceClass).filter(Boolean)
      );
      const authorityRawClasses = (claim.authorityIds ?? [])
        .map((/** @type {string} */ id) => store.byId.get(id)?.record)
        .some((/** @type {any} */ a) => a?.rawArtifact) ? ['raw-authority'] : [];
      for (const c of authorityRawClasses) classes.add(c);
      for (const required of bindingClass.mandatoryEvidenceClasses ?? []) {
        if (!classes.has(required)) {
          problems.push(`claim '${claim.claimId}' of '${rid}' retains no evidence artifact of mandatory class '${required}'`);
        }
      }
    }
    audit('mandatoryEvidenceClasses', 'every claim retains ≥1 evidence artifact of each mandatory class (raw-authority satisfied by registered raw artifacts)', 'EVIDENCE_MISSING', problems);
  }

  // mandatoryPositiveControls — each control resolves (in a selected profile when any are selected) and every claim of the class currently passes.
  {
    /** @type {string[]} */
    const problems = [];
    for (const controlId of bindingClass.mandatoryPositiveControls ?? []) {
      const profileControls = store.profiles.flatMap((p) => p.positiveControls ?? []);
      if (profileControls.length > 0 && !profileControls.some((/** @type {any} */ c) => c.controlId === controlId) && !requirement.frameworkOnly) {
        problems.push(`positive control '${controlId}' resolves to no selected-profile positiveControls entry`);
      }
      const failing = claimResults.filter((r) => r.result !== 'PASS');
      if (claims.length === 0) {
        problems.push(`positive control '${controlId}' has no claims to exercise it`);
      } else if (failing.length > 0) {
        problems.push(`positive control '${controlId}' unmet: claims failing (${failing.map((f) => f.claimId).join(', ')})`);
      }
    }
    audit('mandatoryPositiveControls', 'control resolves and every claim of the class computes PASS', 'CHECK_FAILED', problems);
  }

  // mandatoryNegativeControlDefectClasses — every defect class has a registered evaluator used by a fixture of this class's claims.
  {
    /** @type {string[]} */
    const problems = [];
    const usedEvaluators = claims
      .flatMap((c) => (c.fixtureIds ?? []).map((/** @type {string} */ id) => store.byId.get(id)?.record))
      .filter(Boolean)
      .flatMap((f) => (f.discriminates ?? []).map((/** @type {any} */ d) => store.byId.get(d.evaluatorId)?.record))
      .filter(Boolean);
    for (const defectClass of bindingClass.mandatoryNegativeControlDefectClasses ?? []) {
      if (!usedEvaluators.some((e) => e.defectClass === defectClass)) {
        problems.push(`mandatory negative-control defect class '${defectClass}' has no registered evaluator exercised by '${rid}' fixtures`);
      }
    }
    audit('mandatoryNegativeControlDefectClasses', 'each defect class has a registered evaluator exercised by a fixture of the class', 'NEGATIVE_CONTROL_INVALID', problems);
  }

  // mandatoryProductPathChecks — patterns; each claim registers ≥1 matching check whose adapter role is 'product'.
  {
    /** @type {string[]} */
    const problems = [];
    for (const pattern of bindingClass.mandatoryProductPathChecks ?? []) {
      for (const claim of claims) {
        const matching = (claim.checkIds ?? [])
          .map((/** @type {string} */ id) => store.byId.get(id)?.record)
          .filter((/** @type {any} */ chk) => chk && matchPattern(pattern, chk.checkId));
        if (matching.length === 0) {
          problems.push(`claim '${claim.claimId}' registers no check matching mandatory product-path pattern '${pattern}'`);
          continue;
        }
        for (const chk of matching) {
          const adapter = store.adapters.find((a) => a.adapterId === chk.adapterId);
          if (adapter?.role !== 'product') {
            problems.push(`check '${chk.checkId}' satisfies product-path pattern '${pattern}' but its adapter '${chk.adapterId}' has role '${adapter?.role ?? 'missing'}', not 'product'`);
          }
        }
      }
    }
    audit('mandatoryProductPathChecks', 'each claim registers a matching check backed by a role=product adapter', 'PROJECT_UNDERBOUND', problems);
  }

  // mandatoryFixtureDiscriminationChecks — patterns; each behavior claim registers a matching fixture-discrimination check.
  {
    /** @type {string[]} */
    const problems = [];
    for (const pattern of bindingClass.mandatoryFixtureDiscriminationChecks ?? []) {
      for (const claim of claims.filter((c) => c.kind === 'behavior')) {
        const matching = (claim.checkIds ?? [])
          .map((/** @type {string} */ id) => store.byId.get(id)?.record)
          .filter((/** @type {any} */ chk) => chk && chk.checkType === 'fixture-discrimination' && matchPattern(pattern, chk.checkId));
        if (matching.length === 0) {
          problems.push(`behavior claim '${claim.claimId}' registers no fixture-discrimination check matching mandatory pattern '${pattern}'`);
        }
      }
    }
    audit('mandatoryFixtureDiscriminationChecks', 'each behavior claim registers a matching fixture-discrimination check', 'PROJECT_UNDERBOUND', problems);
  }

  // mandatoryRuntimeEffectChecks — patterns; when non-empty the class must carry runtime-effect claims with matching checks.
  {
    /** @type {string[]} */
    const problems = [];
    for (const pattern of bindingClass.mandatoryRuntimeEffectChecks ?? []) {
      const satisfied = claims.some((c) =>
        c.kind === 'runtime-effect' &&
        (c.checkIds ?? []).some((/** @type {string} */ id) => {
          const chk = store.byId.get(id)?.record;
          return chk && chk.checkType === 'runtime-effect' && matchPattern(pattern, chk.checkId);
        })
      );
      if (!satisfied) {
        problems.push(`no runtime-effect claim of '${rid}' registers a check matching mandatory pattern '${pattern}'`);
      }
    }
    audit('mandatoryRuntimeEffectChecks', 'each mandatory pattern is met by a runtime-effect claim with a matching runtime-effect check', 'RUNTIME_EFFECT_UNWITNESSED', problems);
  }

  // mandatoryAlternativeEvaluatorIds — patterns; each resolves to a registered evaluator whose module exists and that a class fixture uses.
  {
    /** @type {string[]} */
    const problems = [];
    const fixtureEvaluatorIds = new Set(
      claims
        .flatMap((c) => (c.fixtureIds ?? []).map((/** @type {string} */ id) => store.byId.get(id)?.record))
        .filter(Boolean)
        .flatMap((f) => (f.discriminates ?? []).map((/** @type {any} */ d) => d.evaluatorId))
    );
    for (const pattern of bindingClass.mandatoryAlternativeEvaluatorIds ?? []) {
      const registered = store.evaluators.filter((e) => matchPattern(pattern, e.evaluatorId));
      if (registered.length === 0) {
        problems.push(`mandatory alternative evaluator '${pattern}' resolves to no registered evaluator`);
        continue;
      }
      for (const evaluator of registered) {
        if (!existsSync(abs(store.repoRoot, evaluator.entryPoint.module))) {
          problems.push(`mandatory evaluator '${evaluator.evaluatorId}' module missing: ${evaluator.entryPoint.module}`);
        }
        if (![...fixtureEvaluatorIds].some((id) => id === evaluator.evaluatorId)) {
          problems.push(`mandatory evaluator '${evaluator.evaluatorId}' is not exercised by any fixture of '${rid}'`);
        }
      }
    }
    audit('mandatoryAlternativeEvaluatorIds', 'each mandatory evaluator resolves, its module exists, and a class fixture exercises it', 'ALTERNATIVE_EVALUATOR_MISSING', problems);
  }

  // divergenceClassificationPolicy — toleranced comparators on class claims need resolving evidence references.
  {
    /** @type {string[]} */
    const problems = [];
    const policy = bindingClass.divergenceClassificationPolicy;
    if (policy?.representationLevelRequiresEvidence) {
      const comparators = claims
        .flatMap((c) => [...(c.comparatorIds ?? []), ...(c.fixtureIds ?? []).map((/** @type {string} */ id) => store.byId.get(id)?.record?.comparatorId)])
        .filter(Boolean)
        .map((id) => store.byId.get(id)?.record)
        .filter(Boolean);
      for (const cmp of comparators) {
        if (cmp.equalityMode === 'toleranced') {
          const resolving = (cmp.evidenceRefs ?? []).filter((/** @type {string} */ id) => store.byId.get(id)?.kind === 'evidence');
          if (resolving.length === 0) {
            problems.push(`comparator '${cmp.comparatorId}' carries a tolerance without resolving evidence of the representation-level cause and magnitude`);
          }
        }
      }
    }
    audit('divergenceClassificationPolicy', 'every toleranced comparator on class claims carries resolving representation-level evidence', 'DIVERGENCE_CLASSIFICATION_UNJUSTIFIED', problems);
  }

  // equivalenceClaimPolicy — allowed:false rejects equivalence claims outright; allowed:true defers to engine proof enforcement.
  {
    /** @type {string[]} */
    const problems = [];
    const policy = bindingClass.equivalenceClaimPolicy;
    if (policy && policy.allowed === false) {
      for (const claim of claims.filter((c) => c.kind === 'equivalence')) {
        problems.push(`equivalence claim '${claim.claimId}' registered but requirement class '${bindingClass.requirementClassId}' forbids equivalence claims`);
      }
    }
    audit('equivalenceClaimPolicy', 'no equivalence claims when allowed=false; proof enforcement in engine when allowed=true', 'EQUIVALENCE_UNPROVEN', problems);
  }

  // authorityIdentityRule — per-expected-constituent requires non-empty constituent maps on claims and expected-result evidence.
  {
    /** @type {string[]} */
    const problems = [];
    if (bindingClass.authorityIdentityRule === 'per-expected-constituent') {
      for (const claim of claims) {
        if ((claim.perConstituentAuthority ?? []).length === 0) {
          problems.push(`claim '${claim.claimId}' carries an empty perConstituentAuthority map`);
        }
        for (const ev of (claim.evidenceIds ?? []).map((/** @type {string} */ id) => store.byId.get(id)?.record).filter(Boolean)) {
          if (ev.expectedResultArtifact && (ev.perConstituentAuthority ?? []).length === 0) {
            problems.push(`expected-result evidence '${ev.evidenceId}' carries an empty perConstituentAuthority map`);
          }
        }
      }
    }
    audit('authorityIdentityRule', 'claims and expected-result evidence carry non-empty per-constituent authority maps', 'AUTHORITY_SOURCE_AMBIGUOUS', problems);
  }

  // evidenceClassSemantics — structural constants are schema-enforced; the operational reader is the oracle
  // check, which derives expected-value origin exclusively from oraclePrecedencePolicy (engine.oracleCheck).
  fieldAudit.push({
    field: 'evidenceClassSemantics',
    reader: 'engine.oracleCheck (expected-value origin) + schema consts',
    passCondition: 'expected-value origin judged only against oraclePrecedencePolicy; artifact presence never authorizes origin',
    failureCode: 'EXPECTED_VALUE_ORIGIN_UNACCEPTABLE',
    status: 'PASS'
  });

  return { failures, fieldAudit };
}
