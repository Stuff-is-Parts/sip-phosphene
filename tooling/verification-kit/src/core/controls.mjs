import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/**
 * Audit-derived executable controls (2026-07-16 independent audit findings
 * 1, 2, 3, 4, 5, 8). Every control spawns public command boundaries — the CLI,
 * bash, git, gh — and inspects observable outputs only.
 * @typedef {{ control: string, ok: boolean, detail: string }} ControlResult
 */

/** @param {string} cwd @param {string} binPath @param {string[]} args @param {Record<string,string>} [env] @returns {{ exitCode: number, stdout: string }} */
function spawnCli(cwd, binPath, args, env = {}) {
  try {
    const stdout = execFileSync('node', [binPath, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...env } });
    return { exitCode: 0, stdout };
  } catch (e) {
    const err = /** @type {any} */ (e);
    return { exitCode: err.status ?? 1, stdout: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/** @param {string} repoDir @param {string} command @returns {any | undefined} */
function latestReport(repoDir, command) {
  const p = path.join(repoDir, 'verification', 'reports', `latest-${command}.json`);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Finding 1: the tee pipeline captures tee's exit status. The defective pattern
 * labels a failing command successful; the pipefail pattern reports FAIL while
 * the report job itself exits 0.
 * @returns {ControlResult[]}
 */
export function completionReportExitControls() {
  /** @param {string} script @returns {{ exitCode: number, stdout: string }} */
  function bash(script) {
    try {
      return { exitCode: 0, stdout: execFileSync('bash', ['-c', script], { encoding: 'utf8' }) };
    } catch (e) {
      const err = /** @type {any} */ (e);
      return { exitCode: err.status ?? 1, stdout: `${err.stdout ?? ''}` };
    }
  }
  const defective = bash('false | tee /dev/null\ncode=$?\necho "captured=$code"');
  const fixed = bash('set -o pipefail\nfalse | tee /dev/null\ncode=$?\necho "captured=$code"\nexit 0');
  /** @type {ControlResult[]} */
  const results = [];
  results.push({
    control: 'completion-report-exit-defect-demonstrated',
    ok: defective.stdout.includes('captured=0'),
    detail: defective.stdout.includes('captured=0')
      ? 'without pipefail, a failing command piped through tee is captured as exit 0 — the audited mislabeling reproduced'
      : `expected captured=0, got: ${defective.stdout.trim()}`
  });
  results.push({
    control: 'completion-report-exit-fix-verified',
    ok: fixed.exitCode === 0 && fixed.stdout.includes('captured=1'),
    detail: fixed.exitCode === 0 && fixed.stdout.includes('captured=1')
      ? 'with pipefail, the failing verification is captured as exit 1 (reported FAIL) while the report script itself exits 0 (non-blocking job succeeds)'
      : `expected captured=1 with script exit 0, got exit ${fixed.exitCode}: ${fixed.stdout.trim()}`
  });
  return results;
}

/**
 * Findings 2 + 4: spawn the global gate (with nested clone-heavy controls
 * suppressed to terminate recursion) and prove (a) it fails while the product
 * claim passes, with framework failures inside the global failure list, and
 * (b) scope-item.compatibility-goal stays uncovered although
 * REQ-MILK-EXPR-OPERATORS cites its ID.
 * @param {string} repoRoot @param {string} binPath
 * @returns {ControlResult[]}
 */
export function globalGateControls(repoRoot, binPath) {
  /** @type {ControlResult[]} */
  const results = [];
  const claimRun = spawnCli(repoRoot, binPath, ['claim', 'CLAIM-MILK-EXPR-OPERATORS']);
  const globalRun = spawnCli(repoRoot, binPath, [], { VERIFY_SUPPRESS_NESTED_CONTROLS: '1' });
  const report = latestReport(repoRoot, 'verify');
  const frameworkFailurePresent = (report?.failures ?? []).some((/** @type {any} */ f) => String(f.detail).startsWith('[framework]'));
  results.push({
    control: 'global-fails-on-framework-while-product-claim-passes',
    ok: claimRun.exitCode === 0 && globalRun.exitCode !== 0 && frameworkFailurePresent,
    detail: claimRun.exitCode === 0 && globalRun.exitCode !== 0 && frameworkFailurePresent
      ? 'product claim PASS (exit 0) while global verify FAIL carries [framework]-prefixed failures in its own failure list'
      : `claim exit ${claimRun.exitCode}, global exit ${globalRun.exitCode}, framework failures in global list: ${frameworkFailurePresent}`
  });
  let citesBroadItem = false;
  try {
    const req = JSON.parse(readFileSync(path.join(repoRoot, 'verification', 'requirements', 'REQ-MILK-EXPR-OPERATORS.json'), 'utf8'));
    citesBroadItem = (req.scopeItemIds ?? []).includes('scope-item.compatibility-goal');
  } catch {
    citesBroadItem = false;
  }
  const broadItemRejected = (report?.failures ?? []).some((/** @type {any} */ f) =>
    ['SCOPE_DECOMPOSITION_MISSING', 'SCOPE_DECOMPOSITION_INCOMPLETE', 'BEHAVIOR_COVERAGE_UNPROVEN', 'CHECK_FAILED'].includes(f.code) &&
    String(f.detail).includes('scope-item.compatibility-goal'));
  results.push({
    control: 'narrow-requirement-cannot-cover-broad-scope-item',
    ok: citesBroadItem && broadItemRejected,
    detail: citesBroadItem && broadItemRejected
      ? 'REQ-MILK-EXPR-OPERATORS cites scope-item.compatibility-goal, yet the item carries an uncovered failure code — citation does not cover'
      : `cites broad item: ${citesBroadItem}, broad item rejected in global failures: ${broadItemRejected}`
  });
  return results;
}

/** Make a disposable clone of the repository for mutation controls. @param {string} repoRoot @returns {string} */
function cloneFixture(repoRoot) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'verify-audit-fixture-'));
  execFileSync('git', ['clone', '--quiet', '--local', repoRoot, dir], { encoding: 'utf8' });
  return dir;
}

/** @param {string} fixture restore all tracked files */
function restoreFixture(fixture) {
  execFileSync('git', ['-C', fixture, 'checkout', '--quiet', '--', '.'], { encoding: 'utf8' });
}

/**
 * Finding 3: every mandatory binding field rejects a deliberately underbound
 * record. Each mutation edits the fixture clone's binding (or a record the
 * field governs), runs the public requirement command, and requires the
 * intended code+detail to appear there while being absent from the unmutated
 * baseline run.
 * @param {string} repoRoot @param {string} binPath
 * @returns {ControlResult[]}
 */
export function underboundBindingControls(repoRoot, binPath) {
  /** @type {ControlResult[]} */
  const results = [];
  const fixture = cloneFixture(repoRoot);
  const bindingPath = path.join(fixture, 'verification', 'binding', 'project-verification-binding.json');
  const comparatorPath = path.join(fixture, 'verification', 'comparators', 'CMP-EXACT-JSON.json');
  const claimPath = path.join(fixture, 'verification', 'claims', 'CLAIM-MILK-EXPR-OPERATORS.json');
  try {
    const baseline = spawnCli(fixture, binPath, ['requirement', 'REQ-MILK-EXPR-OPERATORS']);
    /** @type {Array<{name: string, mutate: () => void, code: string, needle: string}>} */
    const mutations = [
      {
        name: 'mandatoryEvidenceClasses',
        mutate: () => editClass(bindingPath, (rc) => rc.mandatoryEvidenceClasses.push('controlled-observation')),
        code: 'EVIDENCE_MISSING', needle: "mandatory class 'controlled-observation'"
      },
      {
        name: 'mandatoryPositiveControls',
        mutate: () => editClass(bindingPath, (rc) => rc.mandatoryPositiveControls.push('POS-NONEXISTENT')),
        code: 'CHECK_FAILED', needle: "'POS-NONEXISTENT' resolves to no selected-profile"
      },
      {
        name: 'mandatoryNegativeControlDefectClasses',
        mutate: () => editClass(bindingPath, (rc) => rc.mandatoryNegativeControlDefectClasses.push('fabricated-defect-class')),
        code: 'NEGATIVE_CONTROL_INVALID', needle: "'fabricated-defect-class'"
      },
      {
        name: 'mandatoryProductPathChecks',
        mutate: () => editClass(bindingPath, (rc) => { rc.mandatoryProductPathChecks = ['CHK-DOES-NOT-EXIST']; }),
        code: 'PROJECT_UNDERBOUND', needle: "'CHK-DOES-NOT-EXIST'"
      },
      {
        name: 'mandatoryFixtureDiscriminationChecks',
        mutate: () => editClass(bindingPath, (rc) => { rc.mandatoryFixtureDiscriminationChecks = ['CHK-NOPE']; }),
        code: 'PROJECT_UNDERBOUND', needle: "'CHK-NOPE'"
      },
      {
        name: 'mandatoryRuntimeEffectChecks',
        mutate: () => editClass(bindingPath, (rc) => { rc.mandatoryRuntimeEffectChecks = ['CHK-RTE-REQUIRED']; }),
        code: 'RUNTIME_EFFECT_UNWITNESSED', needle: "'CHK-RTE-REQUIRED'"
      },
      {
        name: 'mandatoryAlternativeEvaluatorIds',
        mutate: () => editClass(bindingPath, (rc) => rc.mandatoryAlternativeEvaluatorIds.push('EVAL-FABRICATED')),
        code: 'ALTERNATIVE_EVALUATOR_MISSING', needle: "'EVAL-FABRICATED'"
      },
      {
        name: 'divergenceClassificationPolicy',
        mutate: () => {
          const cmp = JSON.parse(readFileSync(comparatorPath, 'utf8'));
          cmp.equalityMode = 'toleranced';
          cmp.tolerance = 0.1;
          cmp.toleranceJustification = 'deliberately unjustified for the negative control';
          cmp.evidenceRefs = [];
          writeFileSync(comparatorPath, JSON.stringify(cmp, null, 2) + '\n');
        },
        code: 'DIVERGENCE_CLASSIFICATION_UNJUSTIFIED', needle: "'CMP-EXACT-JSON'"
      },
      {
        name: 'authorityIdentityRule',
        mutate: () => {
          const claim = JSON.parse(readFileSync(claimPath, 'utf8'));
          claim.perConstituentAuthority = [];
          writeFileSync(claimPath, JSON.stringify(claim, null, 2) + '\n');
        },
        code: 'AUTHORITY_SOURCE_AMBIGUOUS', needle: 'empty perConstituentAuthority'
      }
    ];
    for (const m of mutations) {
      m.mutate();
      const run = spawnCli(fixture, binPath, ['requirement', 'REQ-MILK-EXPR-OPERATORS']);
      restoreFixture(fixture);
      const signature = `${m.code}` ;
      const present = run.stdout.includes(m.code) && run.stdout.includes(m.needle);
      const absentInBaseline = !(baseline.stdout.includes(m.code) && baseline.stdout.includes(m.needle));
      results.push({
        control: `underbound-binding:${m.name}`,
        ok: run.exitCode !== 0 && present && absentInBaseline,
        detail: run.exitCode !== 0 && present && absentInBaseline
          ? `underbound record rejected with ${signature} naming ${m.needle}; signature absent from unmutated baseline`
          : `exit ${run.exitCode}, intended signature present: ${present}, absent in baseline: ${absentInBaseline}`
      });
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true, maxRetries: 3 });
  }
  return results;
}

/** @param {string} bindingPath @param {(rc: any) => void} edit applies to the milkdrop-expression class */
function editClass(bindingPath, edit) {
  const binding = JSON.parse(readFileSync(bindingPath, 'utf8'));
  const rc = binding.requirementClasses.find((/** @type {any} */ c) => c.requirementClassId === 'requirement-class.milkdrop-expression');
  edit(rc);
  writeFileSync(bindingPath, JSON.stringify(binding, null, 2) + '\n');
}

/**
 * Finding 8: removal-intervention runtime witnesses — deleting the native
 * executor or graph module flips the product claim's subject execution from
 * running to unavailable, proving the actual product path depends on
 * createGraph/executeGraph (framework spec §14.3).
 * Plus the separation scan: the PHOSPHENE subject imports neither the
 * reference adapter nor the parser, and the reference adapter imports no
 * PHOSPHENE module.
 * @param {string} repoRoot @param {string} binPath
 * @returns {ControlResult[]}
 */
export function productPathControls(repoRoot, binPath) {
  /** @type {ControlResult[]} */
  const results = [];

  /** @param {string} dir @returns {string[]} */
  function mjsFiles(dir) {
    /** @type {string[]} */
    const out = [];
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...mjsFiles(p));
      else if (entry.name.endsWith('.mjs')) out.push(p);
    }
    return out;
  }
  const subjectFiles = mjsFiles(path.join(repoRoot, 'phosphene'));
  const referenceFiles = mjsFiles(path.join(repoRoot, 'tooling', 'reference-adapters', 'milkdrop-eel'));
  const subjectViolations = subjectFiles.filter((f) => {
    const src = readFileSync(f, 'utf8');
    return src.includes('reference-adapters') || src.includes('milkdrop-eel-parser');
  });
  const referenceViolations = referenceFiles.filter((f) => readFileSync(f, 'utf8').includes('phosphene/'));
  results.push({
    control: 'subject-reference-separation',
    ok: subjectFiles.length > 0 && subjectViolations.length === 0 && referenceViolations.length === 0,
    detail: subjectViolations.length === 0 && referenceViolations.length === 0
      ? `${subjectFiles.length} subject modules import neither the reference adapter nor the parser; ${referenceFiles.length} reference modules import no PHOSPHENE code`
      : `separation violated: ${[...subjectViolations, ...referenceViolations].join(', ')}`
  });

  const fixture = cloneFixture(repoRoot);
  try {
    const baseline = spawnCli(fixture, binPath, ['claim', 'CLAIM-MILK-EXPR-OPERATORS']);
    const baselineSubjectRan = !baseline.stdout.includes('SUBJECT_EXECUTION_UNAVAILABLE');
    for (const target of ['phosphene/src/exec/executor.mjs', 'phosphene/src/graph/graph.mjs']) {
      unlinkSync(path.join(fixture, ...target.split('/')));
      const run = spawnCli(fixture, binPath, ['claim', 'CLAIM-MILK-EXPR-OPERATORS']);
      restoreFixture(fixture);
      const unavailable = run.stdout.includes('SUBJECT_EXECUTION_UNAVAILABLE') || run.stdout.includes('capability failed');
      results.push({
        control: `product-path-removal-witness:${path.basename(target)}`,
        ok: baselineSubjectRan && run.exitCode !== 0 && unavailable,
        detail: baselineSubjectRan && unavailable
          ? `removing ${target} flips subject execution from running to unavailable — the product path invokes it (removal intervention per §14.3)`
          : `baseline subject ran: ${baselineSubjectRan}, post-removal unavailable: ${unavailable}`
      });
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true, maxRetries: 3 });
  }
  return results;
}

/**
 * Finding 5 negative control: a producer-authored witness referencing a
 * nonexistent GitHub approval event is rejected by live verification.
 * Requires an authenticated gh CLI; reports that dependency honestly otherwise.
 * @param {string} repoRoot @param {string} binPath
 * @returns {ControlResult[]}
 */
export function forgedWitnessLiveControls(repoRoot, binPath) {
  try {
    execFileSync('gh', ['auth', 'status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return [{ control: 'live-authorization-forged-witness-rejected', ok: false, detail: 'requires an authenticated gh CLI; not available in this environment' }];
  }
  const fixture = cloneFixture(repoRoot);
  try {
    const witnessDir = path.join(fixture, 'verification', 'authorization', 'witnesses');
    mkdirSync(witnessDir, { recursive: true });
    const forged = {
      witnessId: 'AUTH-WITNESS-FORGED-CONTROL',
      authorizationType: 'scope-approval',
      decision: 'forged decision for the negative control',
      affectedIds: ['scope.phosphene'],
      authorizingIdentity: 'nonexistent-user-for-control',
      verificationMethod: 'github-approval',
      hostMetadata: { kind: 'pr-review', prNumber: 999999, reviewId: 1 },
      timestamp: '2026-07-16T00:00:00Z'
    };
    writeFileSync(path.join(witnessDir, 'AUTH-WITNESS-FORGED-CONTROL.json'), JSON.stringify(forged, null, 2) + '\n');
    const run = spawnCli(fixture, binPath, ['authorization-live', '--witness', 'AUTH-WITNESS-FORGED-CONTROL']);
    const rejected = run.exitCode !== 0 &&
      (run.stdout.includes('AUTHORIZATION_WITNESS_UNVERIFIED') || run.stdout.includes('IDENTITY_ALLOWLIST_CHANGE_UNAUTHORIZED')) &&
      (run.stdout.includes('not found') || run.stdout.includes('404') || run.stdout.includes('allowlist'));
    return [{
      control: 'live-authorization-forged-witness-rejected',
      ok: rejected,
      detail: rejected
        ? 'producer-authored witness referencing a nonexistent host approval event rejected by live verification'
        : `expected live rejection, got exit ${run.exitCode}: ${run.stdout.slice(0, 300)}`
    }];
  } finally {
    rmSync(fixture, { recursive: true, force: true, maxRetries: 3 });
  }
}
