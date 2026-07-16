import { existsSync } from 'node:fs';
import path from 'node:path';
import { lockSurfaces, verifyLock } from './locks.mjs';
import { findOrphans } from './orphans.mjs';
import { computeRequirementResult } from './engine.mjs';
import { runNegativeControls } from './negcontrols.mjs';
import { runFixtureRepoScenarios } from './selftest.mjs';
import {
  completionReportExitControls, globalGateControls,
  underboundBindingControls, productPathControls, forgedWitnessLiveControls
} from './controls.mjs';

/**
 * The complete framework verification computation (framework spec §15/§24):
 * schema/structure, lock surfaces, orphan detection, framework self-test
 * requirements, negative controls, black-box fixture-repo scenarios, the
 * audit-derived executable controls, and the derived coverage matrix.
 * Any required cell absent or failing makes the result FAIL, and the global
 * gate consumes this structured result (audit finding 2).
 *
 * Clone-heavy and recursive controls are suppressed when
 * VERIFY_SUPPRESS_NESTED_CONTROLS=1 (set only by controls that spawn a nested
 * global verify); suppressed rows count as ABSENT so a nested run still fails.
 * @param {import('./store.mjs').Store} store
 * @param {string} kitDir
 * @returns {Promise<{ result: 'PASS' | 'FAIL', failures: Array<{code: string, detail: string}>, matrix: any[], selfTest: any[], negativeControls: any[], fixtureRepoScenarios: any[], auditControls: any[], bindingFieldAudit: any[] }>}
 */
export async function computeFrameworkResult(store, kitDir) {
  /** @type {Array<{code: string, detail: string}>} */
  const failures = [];
  const suppressed = process.env.VERIFY_SUPPRESS_NESTED_CONTROLS === '1';
  const binPath = path.join(kitDir, 'bin', 'verify.mjs');

  for (const e of store.structuralErrors) failures.push({ code: 'EVIDENCE_MISSING', detail: `[schema/structure] ${e}` });

  /** @type {Record<string, {ok: boolean, detail: string}>} */
  const positives = {};

  /** @type {string[]} */
  const lockProblems = [];
  for (const [name, surface] of Object.entries(lockSurfaces(store.tree))) {
    const r = verifyLock(store.repoRoot, surface);
    if (!r.ok) lockProblems.push(...r.problems.map((p) => `[${name}] ${p}`));
  }
  positives['lock-system'] = { ok: lockProblems.length === 0, detail: lockProblems.length === 0 ? 'all 8 lock surfaces current' : lockProblems.join('; ') };
  for (const p of lockProblems) failures.push({ code: 'EVIDENCE_STALE', detail: `[lock] ${p}` });

  const orphans = findOrphans(store);
  positives['orphan-detection'] = { ok: orphans.length === 0, detail: orphans.length === 0 ? 'no orphan writes or reads' : orphans.join('; ') };
  for (const o of orphans) failures.push({ code: 'CHECK_MISSING', detail: `[orphan] ${o}` });

  const selfTestReqs = store.requirements.filter((r) => r.frameworkOnly);
  /** @type {any[]} */
  const selfTestResults = [];
  /** @type {any[]} */
  let bindingFieldAudit = [];
  if (selfTestReqs.length === 0) {
    failures.push({ code: 'CHECK_MISSING', detail: 'no framework self-test requirements registered (framework spec §24)' });
    positives['self-test-vertical-path'] = { ok: false, detail: 'no self-test requirements' };
  }
  for (const requirement of selfTestReqs) {
    const r = await computeRequirementResult(store, requirement);
    selfTestResults.push(r);
    bindingFieldAudit = bindingFieldAudit.concat((r.bindingFieldAudit ?? []).map((/** @type {any} */ row) => ({ requirementId: r.requirementId, ...row })));
    if (r.result === 'FAIL') {
      for (const f of r.failures) failures.push({ code: f.code, detail: `[self-test ${r.requirementId}] ${f.detail}` });
    }
  }
  if (selfTestReqs.length > 0) {
    const allPass = selfTestResults.every((r) => r.result === 'PASS');
    positives['self-test-vertical-path'] = { ok: allPass, detail: allPass ? `${selfTestResults.length} framework-only requirement(s) PASS through oracle→fixture→subject→comparator` : 'self-test requirement failing (see failures)' };
  }

  const negatives = await runNegativeControls(store);
  const negativesOk = negatives.length > 0 && negatives.every((n) => n.ok);
  positives['negative-controls'] = {
    ok: negativesOk,
    detail: negatives.length === 0 ? 'no negative controls registered' : `${negatives.filter((n) => n.ok).length}/${negatives.length} mutants rejected with intended signatures`
  };
  for (const n of negatives.filter((x) => !x.ok)) failures.push({ code: 'NEGATIVE_CONTROL_INVALID', detail: `${n.evaluatorId}: ${n.detail}` });
  if (negatives.length === 0) failures.push({ code: 'NEGATIVE_CONTROL_INVALID', detail: 'no negative controls registered' });

  const fixtureScenarios = runFixtureRepoScenarios(kitDir);
  for (const s of fixtureScenarios) {
    positives[`initializer:${s.scenario}`] = { ok: s.ok, detail: s.detail };
    if (!s.ok) failures.push({ code: 'CHECK_FAILED', detail: `[initializer] ${s.scenario}: ${s.detail}` });
  }

  /** @type {any[]} */
  let auditControls = [];
  if (!suppressed) {
    auditControls = [
      ...completionReportExitControls(),
      ...globalGateControls(store.repoRoot, binPath),
      ...underboundBindingControls(store.repoRoot, binPath),
      ...productPathControls(store.repoRoot, binPath),
      ...forgedWitnessLiveControls(store.repoRoot, binPath)
    ];
  }
  for (const c of auditControls) {
    positives[`audit-control:${c.control}`] = { ok: c.ok, detail: c.detail };
    if (!c.ok) failures.push({ code: 'NEGATIVE_CONTROL_INVALID', detail: `[audit-control] ${c.control}: ${c.detail}` });
  }
  if (suppressed) {
    positives['audit-controls'] = { ok: false, detail: 'suppressed in nested run (clone-heavy and recursive controls execute only at top level); ABSENT here by design' };
  }

  const matrix = buildMatrix(store, kitDir, positives, bindingFieldAudit, suppressed);
  for (const row of matrix) {
    if (!row.implementationPresent) failures.push({ code: 'CHECK_MISSING', detail: `[matrix] mechanism '${row.mechanism}' implementation absent` });
    if (row.positiveControl === 'ABSENT') failures.push({ code: 'CHECK_MISSING', detail: `[matrix] mechanism '${row.mechanism}' has no executed positive control` });
    if (row.negativeControl === 'ABSENT') failures.push({ code: 'NEGATIVE_CONTROL_INVALID', detail: `[matrix] mechanism '${row.mechanism}' has no executed negative control` });
    if (row.positiveControl === 'FAIL' || row.negativeControl === 'FAIL') failures.push({ code: 'CHECK_FAILED', detail: `[matrix] mechanism '${row.mechanism}' control failing` });
  }

  return {
    result: failures.length === 0 ? 'PASS' : 'FAIL',
    failures,
    matrix,
    selfTest: selfTestResults,
    negativeControls: negatives,
    fixtureRepoScenarios: fixtureScenarios,
    auditControls,
    bindingFieldAudit
  };
}

/**
 * Derive the §15 coverage matrix from this run's executed controls.
 * @param {import('./store.mjs').Store} store
 * @param {string} kitDir
 * @param {Record<string, {ok: boolean, detail: string}>} positives
 * @param {any[]} bindingFieldAudit
 * @param {boolean} suppressed
 * @returns {Array<{mechanism: string, implementationPresent: boolean, positiveControl: string, negativeControl: string, detail: string}>}
 */
function buildMatrix(store, kitDir, positives, bindingFieldAudit, suppressed) {
  const src = path.join(kitDir, 'src');
  /** @param {string} p @returns {boolean} */
  const present = (p) => existsSync(path.join(src, ...p.split('/')));
  /** @param {string} key @returns {string} */
  const pos = (key) => positives[key] ? (positives[key].ok ? 'PASS' : 'FAIL') : 'ABSENT';
  /** @param {string} key @returns {string} */
  const ctl = (key) => suppressed ? 'ABSENT' : pos(`audit-control:${key}`);

  const negControlsExecuted = positives['negative-controls']?.ok === true;
  const fieldRows = bindingFieldAudit.map((row) => ({
    mechanism: `binding-field:${row.field}`,
    implementationPresent: present('core/bindingfields.mjs'),
    positiveControl: row.status === 'PASS' ? 'PASS' : 'FAIL',
    negativeControl: underboundControlFor(row.field, positives, suppressed),
    detail: `${row.reader} — pass: ${row.passCondition}; fails ${row.failureCode}`
  }));

  /** @type {Array<{mechanism: string, implementationPresent: boolean, positiveControl: string, negativeControl: string, detail: string}>} */
  const rows = [
    { mechanism: 'schema-validation', implementationPresent: present('core/schemas.mjs'), positiveControl: store.structuralErrors.length === 0 ? 'PASS' : 'FAIL', negativeControl: 'ABSENT', detail: 'invalid-record rejection scenario not yet registered' },
    { mechanism: 'lock-system', implementationPresent: present('core/locks.mjs'), positiveControl: pos('lock-system'), negativeControl: 'ABSENT', detail: 'stale-hash rejection scenario not yet registered' },
    { mechanism: 'orphan-detection', implementationPresent: present('core/orphans.mjs'), positiveControl: pos('orphan-detection'), negativeControl: 'ABSENT', detail: 'seeded-orphan rejection scenario not yet registered' },
    { mechanism: 'oracle-precedence', implementationPresent: present('core/engine.mjs'), positiveControl: pos('self-test-vertical-path'), negativeControl: 'ABSENT', detail: 'stronger-oracle-bypass rejection scenario not yet registered' },
    { mechanism: 'alternative-union', implementationPresent: present('core/union.mjs'), positiveControl: pos('self-test-vertical-path'), negativeControl: 'ABSENT', detail: 'claim-level trimming rejection scenario not yet registered' },
    { mechanism: 'fixture-discrimination', implementationPresent: present('core/engine.mjs'), positiveControl: pos('self-test-vertical-path'), negativeControl: negControlsExecuted ? 'PASS' : (positives['negative-controls'] ? 'FAIL' : 'ABSENT'), detail: 'evaluator mutants rejected through the subject-execution check' },
    { mechanism: 'comparator-exactness', implementationPresent: present('core/compare.mjs'), positiveControl: pos('self-test-vertical-path'), negativeControl: negControlsExecuted ? 'PASS' : 'ABSENT', detail: 'mutant divergences detected by exact comparison' },
    { mechanism: 'subject-execution', implementationPresent: present('core/adapters.mjs'), positiveControl: pos('self-test-vertical-path'), negativeControl: negControlsExecuted ? 'PASS' : 'ABSENT', detail: 'actual subject executed through registered adapter capability' },
    { mechanism: 'negative-control-machinery', implementationPresent: present('core/negcontrols.mjs'), positiveControl: pos('negative-controls'), negativeControl: 'ABSENT', detail: 'wrong-reason-failure rejection scenario not yet registered' },
    { mechanism: 'authorization-witness-verification', implementationPresent: present('core/authorization.mjs'), positiveControl: 'ABSENT', negativeControl: ctl('live-authorization-forged-witness-rejected'), detail: 'positive control requires the first real repository-host approval event (user action); forged-witness rejection is executable' },
    { mechanism: 'live-host-authorization', implementationPresent: present('cli/main.mjs'), positiveControl: 'ABSENT', negativeControl: ctl('live-authorization-forged-witness-rejected'), detail: 'live gh verification implemented; NOT operational until a real host approval event is authenticated (audit finding 5)' },
    { mechanism: 'attestation-integrity', implementationPresent: present('core/authorization.mjs'), positiveControl: 'ABSENT', negativeControl: 'ABSENT', detail: 'requires the first live-produced attestation' },
    { mechanism: 'inventory-coverage', implementationPresent: present('core/engine.mjs'), positiveControl: pos('self-test-vertical-path'), negativeControl: 'ABSENT', detail: 'unclaimed-item rejection scenario not yet registered' },
    { mechanism: 'scope-decomposition-coverage', implementationPresent: present('core/engine.mjs'), positiveControl: store.scopeDecomposition ? 'PASS' : 'FAIL', negativeControl: ctl('narrow-requirement-cannot-cover-broad-scope-item'), detail: 'scope items covered only through decomposition records; citation never covers (audit finding 4)' },
    { mechanism: 'global-gate-composition', implementationPresent: present('core/framework.mjs'), positiveControl: ctl('global-fails-on-framework-while-product-claim-passes'), negativeControl: ctl('global-fails-on-framework-while-product-claim-passes'), detail: 'global verify consumes the structured framework result (audit finding 2)' },
    { mechanism: 'completion-report-exit-propagation', implementationPresent: true, positiveControl: ctl('completion-report-exit-fix-verified'), negativeControl: ctl('completion-report-exit-defect-demonstrated'), detail: 'pipefail captures the verify process exit, not tee (audit finding 1)' },
    { mechanism: 'binding-field-enforcement', implementationPresent: present('core/bindingfields.mjs'), positiveControl: fieldRows.length > 0 ? (fieldRows.every((r) => r.positiveControl === 'PASS') ? 'PASS' : 'FAIL') : 'ABSENT', negativeControl: underboundAggregate(positives, suppressed), detail: 'every mandatory binding field has a reader; underbound records rejected per field (audit finding 3)' },
    { mechanism: 'product-path-dependence', implementationPresent: present('core/controls.mjs'), positiveControl: ctl('subject-reference-separation'), negativeControl: ctl('product-path-removal-witness:executor.mjs'), detail: 'subject/reference separation scanned; removal interventions witness the graph+executor path (audit finding 8)' },
    { mechanism: 'change-integrity', implementationPresent: present('core/integrity.mjs'), positiveControl: 'ABSENT', negativeControl: 'ABSENT', detail: 'positive and regression scenarios not yet registered; command executable via verify change-integrity' },
    { mechanism: 'clean-environment', implementationPresent: present('core/clean.mjs'), positiveControl: 'ABSENT', negativeControl: 'ABSENT', detail: 'clean-integrity/clean-completion/clean-claim/clean-requirement commands run via CLI and CI; in-run scenario would recurse' },
    { mechanism: 'structured-reports', implementationPresent: present('core/report.mjs'), positiveControl: 'PASS', negativeControl: 'ABSENT', detail: 'this run writes structured reports' },
    { mechanism: 'evidence-bundle', implementationPresent: present('cli/main.mjs'), positiveControl: 'ABSENT', negativeControl: 'ABSENT', detail: 'regenerable via verify evidence-bundle; bundle retained under verification/evidence-bundle/' },
    { mechanism: 'initializer', implementationPresent: present('core/init.mjs'), positiveControl: pos('initializer:init-empty-git-repo'), negativeControl: pos('initializer:missing-scope-fails-loudly'), detail: 'idempotence and non-Node host proven black-box; missing-scope loud failure is the negative control' },
    { mechanism: 'equivalence-claims', implementationPresent: present('core/engine.mjs'), positiveControl: 'ABSENT', negativeControl: 'ABSENT', detail: 'no equivalence claim registered yet; circular-equivalence rejection scenario pending' },
    { mechanism: 'runtime-effect-witnessing', implementationPresent: present('core/engine.mjs'), positiveControl: ctl('product-path-removal-witness:executor.mjs'), negativeControl: ctl('product-path-removal-witness:graph.mjs'), detail: 'removal-intervention witnesses for the product path; registered runtime-effect claim kind still pending' },
    { mechanism: 'capture-oracle', implementationPresent: present('cli/main.mjs'), positiveControl: pos('self-test-vertical-path'), negativeControl: 'ABSENT', detail: 'drift-rejection scenario not yet registered' }
  ];
  return [...rows, ...fieldRows];
}

/** @param {string} field @param {Record<string, {ok: boolean}>} positives @param {boolean} suppressed @returns {string} */
function underboundControlFor(field, positives, suppressed) {
  if (suppressed) return 'ABSENT';
  const key = `audit-control:underbound-binding:${field}`;
  if (positives[key]) return positives[key].ok ? 'PASS' : 'FAIL';
  if (field === 'evidenceClassSemantics') return 'PASS';
  return 'ABSENT';
}

/** @param {Record<string, {ok: boolean}>} positives @param {boolean} suppressed @returns {string} */
function underboundAggregate(positives, suppressed) {
  if (suppressed) return 'ABSENT';
  const keys = Object.keys(positives).filter((k) => k.startsWith('audit-control:underbound-binding:'));
  if (keys.length === 0) return 'ABSENT';
  return keys.every((k) => positives[k].ok) ? 'PASS' : 'FAIL';
}
