import { existsSync, readFileSync } from 'node:fs';
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
 * @param {Array<{claimId: string, result: string, checks: any[]}>} claimResults computed results for those claims, including per-check execution traces
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

  // mandatoryEvidenceClasses — every claim retains at least one evidence
  // artifact of each mandatory class AND that artifact is CONSUMED by the
  // claim's verification chain (§14.5): an expected-result evidence record
  // counts only when a claim fixture actually compares against its artifact;
  // presence without consumption is semantically inadequate.
  {
    /** @type {string[]} */
    const problems = [];
    for (const claim of claims) {
      const fixtureExpectedArtifacts = new Set(
        (claim.fixtureIds ?? []).map((/** @type {string} */ id) => store.byId.get(id)?.record?.expectedArtifact).filter(Boolean)
      );
      const hasRawAuthority = (claim.authorityIds ?? [])
        .map((/** @type {string} */ id) => store.byId.get(id)?.record)
        .some((/** @type {any} */ a) => a?.rawArtifact);
      for (const required of bindingClass.mandatoryEvidenceClasses ?? []) {
        if (required === 'raw-authority') {
          if (!hasRawAuthority) problems.push(`claim '${claim.claimId}' of '${rid}' references no authority with a registered raw artifact (mandatory class 'raw-authority')`);
          continue;
        }
        const ofClass = (claim.evidenceIds ?? [])
          .map((/** @type {string} */ id) => store.byId.get(id)?.record)
          .filter((/** @type {any} */ ev) => ev && ev.evidenceClass === required);
        if (ofClass.length === 0) {
          problems.push(`claim '${claim.claimId}' of '${rid}' retains no evidence artifact of mandatory class '${required}'`);
          continue;
        }
        const consumed = ofClass.some((/** @type {any} */ ev) =>
          (ev.expectedResultArtifact && fixtureExpectedArtifacts.has(ev.expectedResultArtifact)) ||
          (ev.derivedArtifactPath && existsSync(abs(store.repoRoot, ev.derivedArtifactPath))));
        if (!consumed) {
          problems.push(`claim '${claim.claimId}' retains evidence of mandatory class '${required}' but no claim fixture consumes its artifact — presence without consumption is semantically inadequate (mandatory class '${required}')`);
        }
      }
    }
    audit('mandatoryEvidenceClasses', 'every mandatory class has a retained evidence artifact that the claim verification chain actually consumes', 'EVIDENCE_MISSING', problems);
  }

  // mandatoryPositiveControls — the named control is an EXECUTABLE check whose
  // own retained execution result passes on every class claim. Aggregate claim
  // success or unrelated checks never substitute (§14.5: semantic proxy).
  {
    /** @type {string[]} */
    const problems = [];
    for (const controlId of bindingClass.mandatoryPositiveControls ?? []) {
      const check = store.byId.get(controlId)?.record;
      if (!check || store.byId.get(controlId)?.kind !== 'check') {
        problems.push(`positive control '${controlId}' resolves to no executable check record — a control name without an executor is semantic proxy substitution`);
        continue;
      }
      if (claims.length === 0) {
        problems.push(`positive control '${controlId}' has no claims to exercise it`);
        continue;
      }
      for (const claim of claims) {
        if (!(claim.checkIds ?? []).includes(controlId)) {
          problems.push(`claim '${claim.claimId}' does not register positive control '${controlId}'; passing by other means does not execute the named control`);
          continue;
        }
        const result = claimResults.find((r) => r.claimId === claim.claimId);
        const executions = (result?.checks ?? []).filter((/** @type {any} */ c) => c.checkId === controlId && (c.executed === true || c.note));
        if (executions.length === 0) {
          problems.push(`positive control '${controlId}' produced no retained execution result on claim '${claim.claimId}' this run`);
        } else if (executions.some((/** @type {any} */ c) => c.pass === false)) {
          problems.push(`positive control '${controlId}' executed on claim '${claim.claimId}' and failed`);
        }
      }
    }
    audit('mandatoryPositiveControls', 'the named control resolves to an executable check, is registered on every class claim, and its OWN retained execution result passes', 'SEMANTIC_PROXY_SUBSTITUTION', problems);
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

  // mandatoryProductPathChecks — a role label is never proof the product path
  // executed (§14.5). Each claim needs the matching check AND a registered
  // runtime dependence control (removal intervention or equivalent black-box
  // dependence proof) that the framework control suite executes.
  {
    /** @type {string[]} */
    const problems = [];
    const dependenceControls = bindingClass.productPathDependenceControls ?? [];
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
        const dependence = dependenceControls.find((/** @type {any} */ d) => d.claimId === claim.claimId);
        if (!dependence) {
          problems.push(`claim '${claim.claimId}' has no registered product-path dependence control (removal targets); the adapter's role label alone is semantic proxy substitution`);
        } else {
          for (const target of dependence.removalTargets) {
            if (!existsSync(abs(store.repoRoot, target))) {
              problems.push(`dependence control for '${claim.claimId}' names a removal target that does not exist: ${target}`);
            }
          }
        }
      }
    }
    audit('mandatoryProductPathChecks', 'each claim registers the matching role=product check AND a registered runtime dependence control whose removal targets exist; the control suite executes the interventions', 'SEMANTIC_PROXY_SUBSTITUTION', problems);
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

  // divergenceClassificationPolicy — every operative clause (§14.5): a
  // toleranced comparator needs resolving evidence whose representationVariation
  // names the cause AND establishes a permitted magnitude covering the actual
  // tolerance. Evidence that exists but does not justify the tolerance is the
  // structurally valid, semantically inadequate case and is rejected.
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
        if (cmp.equalityMode !== 'toleranced') continue;
        const evidenceRecords = (cmp.evidenceRefs ?? [])
          .map((/** @type {string} */ id) => store.byId.get(id))
          .filter((/** @type {any} */ h) => h?.kind === 'evidence')
          .map((/** @type {any} */ h) => h.record);
        if (evidenceRecords.length === 0) {
          problems.push(`comparator '${cmp.comparatorId}' carries a tolerance without resolving evidence of the representation-level cause and magnitude`);
          continue;
        }
        const justifying = evidenceRecords.filter((/** @type {any} */ ev) =>
          ev.representationVariation &&
          typeof ev.representationVariation.permittedMagnitude === 'number' &&
          ev.representationVariation.permittedMagnitude >= cmp.tolerance &&
          String(ev.representationVariation.cause ?? '').length > 0);
        if (justifying.length === 0) {
          problems.push(`comparator '${cmp.comparatorId}' cites evidence, but no cited record establishes a representation-level cause with a permitted magnitude covering tolerance ${cmp.tolerance} — evidence presence without justification is semantically inadequate`);
        }
      }
    }
    audit('divergenceClassificationPolicy', 'every toleranced comparator cites evidence whose representationVariation names the cause and establishes permittedMagnitude >= the actual tolerance', 'DIVERGENCE_CLASSIFICATION_UNJUSTIFIED', problems);
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

  // authorityIdentityRule — a nonempty map is never enough (§14.5). The
  // complete constituent set is DERIVED from each expected artifact's top-level
  // structure; every derived constituent must be covered exactly once by a
  // coversPaths entry whose authority resolves, with no omission, no unrelated
  // substitution, and no duplicate conflicting assignment.
  {
    /** @type {string[]} */
    const problems = [];
    if (bindingClass.authorityIdentityRule === 'per-expected-constituent') {
      for (const claim of claims) {
        const expectedArtifacts = (claim.fixtureIds ?? [])
          .map((/** @type {string} */ id) => store.byId.get(id)?.record?.expectedArtifact)
          .filter(Boolean);
        for (const artifactRel of expectedArtifacts) {
          const fileAbs = abs(store.repoRoot, artifactRel);
          if (!existsSync(fileAbs)) continue;
          /** @type {string[]} */
          let derived;
          try {
            derived = deriveConstituents(JSON.parse(readFileSync(fileAbs, 'utf8')));
          } catch {
            problems.push(`expected artifact '${artifactRel}' of claim '${claim.claimId}' is not readable JSON; the constituent set cannot be derived`);
            continue;
          }
          /** @type {Map<string, string>} */
          const covered = new Map();
          for (const entry of claim.perConstituentAuthority ?? []) {
            for (const p of entry.coversPaths ?? []) {
              const existing = covered.get(p);
              if (existing && existing !== entry.authorityId && !entry.conflictId) {
                problems.push(`claim '${claim.claimId}': constituent path '${p}' is assigned to both '${existing}' and '${entry.authorityId}' with no conflict record (duplicate conflicting assignment)`);
              }
              covered.set(p, entry.authorityId);
              if (!derived.includes(p)) {
                problems.push(`claim '${claim.claimId}': coversPaths names '${p}' which is not a derived constituent of '${artifactRel}' (unrelated substitution)`);
              }
              const authority = store.byId.get(entry.authorityId);
              if (!authority || authority.kind !== 'authority') {
                problems.push(`claim '${claim.claimId}': constituent path '${p}' maps to unregistered authority '${entry.authorityId}'`);
              }
            }
          }
          for (const c of derived) {
            if (!covered.has(c)) {
              problems.push(`claim '${claim.claimId}': derived constituent '${c}' of '${artifactRel}' has no authority assignment (omitted constituent — a nonempty map covering something else is semantic proxy substitution)`);
            }
          }
        }
        for (const ev of (claim.evidenceIds ?? []).map((/** @type {string} */ id) => store.byId.get(id)?.record).filter(Boolean)) {
          if (ev.expectedResultArtifact && (ev.perConstituentAuthority ?? []).length === 0) {
            problems.push(`expected-result evidence '${ev.evidenceId}' carries an empty perConstituentAuthority map`);
          }
        }
      }
    }
    audit('authorityIdentityRule', 'the derived constituent set of every expected artifact is covered exactly, with resolving authorities, no omissions, no unrelated paths, and no conflicting duplicates', 'AUTHORITY_SOURCE_AMBIGUOUS', problems);
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

/**
 * Mechanically derive the constituent set of an expected-result value:
 * top-level keys, with arrays of plain objects expanded to '<key>[].<subkey>'
 * over the union of element keys. This is the set every per-constituent
 * authority map must cover completely.
 * @param {unknown} value
 * @returns {string[]}
 */
export function deriveConstituents(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return ['(root)'];
  /** @type {string[]} */
  const out = [];
  for (const [key, v] of Object.entries(value)) {
    if (Array.isArray(v) && v.length > 0 && v.every((el) => el !== null && typeof el === 'object' && !Array.isArray(el))) {
      const subkeys = new Set();
      for (const el of v) for (const sk of Object.keys(el)) subkeys.add(sk);
      for (const sk of [...subkeys].sort()) out.push(`${key}[].${sk}`);
    } else {
      out.push(key);
    }
  }
  return out;
}
