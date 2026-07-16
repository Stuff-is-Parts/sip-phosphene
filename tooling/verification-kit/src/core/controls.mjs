import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, mkdirSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { canonicalJsonHash } from './hash.mjs';

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
 * Authorization-lineage controls (spec §7.10, semantic-control-sharing
 * revision): fixture-crafted witnesses and attestations prove the LINEAGE
 * ALGORITHM through the public `verify authorization-lineage` command. These
 * are fixture-based controls of the lineage mechanics; they are NOT a real
 * live-host approval and are never represented as one.
 * @param {string} repoRoot @param {string} binPath
 * @returns {ControlResult[]}
 */
export function lineageControls(repoRoot, binPath) {
  /** @type {ControlResult[]} */
  const results = [];
  const fixture = cloneFixture(repoRoot);
  try {
    /** @param {string[]} args */
    const fgit = (args) => execFileSync('git', ['-C', fixture, '-c', 'user.email=fixture@example.invalid', '-c', 'user.name=fixture', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

    // Reviewed revision R: the fixture allowlist carries the approving identity.
    const allowlistPath = path.join(fixture, 'verification', 'authorization', 'authorized-identities.json');
    writeFileSync(allowlistPath, JSON.stringify({ identities: [{ identityId: 'identity.fixture-admin', kind: 'github-account', value: 'fixture-admin' }] }, null, 2) + '\n');
    fgit(['add', '-A']);
    fgit(['commit', '-q', '-m', 'fixture: allowlist for lineage controls']);
    const reviewedCommit = fgit(['rev-parse', 'HEAD']);
    const reviewedTree = fgit(['rev-parse', 'HEAD^{tree}']);

    const witness = {
      witnessId: 'AUTH-WITNESS-LINEAGE-FIXTURE',
      authorizationType: 'scope-approval',
      reviewedRevision: reviewedCommit,
      decision: 'fixture lineage-control decision',
      affectedIds: ['scope.phosphene'],
      authorizingIdentity: 'fixture-admin',
      verificationMethod: 'github-approval',
      hostMetadata: { kind: 'pr-review', prNumber: 1, reviewId: 1 },
      timestamp: '2026-07-16T00:00:00Z'
    };
    const witnessHash = canonicalJsonHash(witness);
    const protectedPaths = [
      'verification/authorization/authorized-identities.json',
      'verification/authorization/bootstrap-record.json',
      'verification/scope/scope.json',
      'verification/scope/decomposition.json'
    ];
    /** @type {Array<{path: string, sha256: string}>} */
    const protectedHashes = [];
    const { createHash } = cryptoModule;
    for (const p of protectedPaths) {
      const bytes = execFileSync('git', ['-C', fixture, 'show', `${reviewedCommit}:${p}`], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
      protectedHashes.push({ path: p, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    const allowlistNow = JSON.parse(readFileSync(allowlistPath, 'utf8'));
    /** @type {any} */
    const attestation = {
      attestationId: 'ATT-LINEAGE-FIXTURE',
      repositoryIdentity: JSON.parse(readFileSync(path.join(fixture, 'verification', 'config', 'project.json'), 'utf8')).repositoryIdentity,
      reviewedCommit,
      reviewedTreeHash: reviewedTree,
      hostEvent: { kind: 'pr-review', prNumber: 1, reviewId: 1 },
      approvingIdentity: 'fixture-admin',
      authorizationType: 'scope-approval',
      witnessId: witness.witnessId,
      witnessObjectHash: witnessHash,
      decision: witness.decision,
      affectedIds: witness.affectedIds,
      protectedArtifactHashes: protectedHashes,
      baseAllowlistHash: canonicalJsonHash(allowlistNow),
      verificationProvider: 'fixture-crafted (lineage-algorithm control; NOT a live host approval)',
      verificationResult: 'fixture',
      verificationTimestamp: '2026-07-16T00:00:00Z'
    };
    attestation.attestationHash = canonicalJsonHash((({ attestationHash, ...rest }) => rest)(attestation));

    const witnessesDir = path.join(fixture, 'verification', 'authorization', 'witnesses');
    const attestationsDir = path.join(fixture, 'verification', 'authorization', 'attestations');
    mkdirSync(witnessesDir, { recursive: true });
    mkdirSync(attestationsDir, { recursive: true });
    writeFileSync(path.join(witnessesDir, 'AUTH-WITNESS-LINEAGE-FIXTURE.json'), JSON.stringify(witness, null, 2) + '\n');
    writeFileSync(path.join(attestationsDir, 'ATT-LINEAGE-FIXTURE.json'), JSON.stringify(attestation, null, 2) + '\n');
    fgit(['add', '-A']);
    fgit(['commit', '-q', '-m', 'fixture: retain attestation in descendant commit']);
    appendFileSync(path.join(fixture, 'UNRELATED.txt'), 'unrelated descendant change\n');
    fgit(['add', '-A']);
    fgit(['commit', '-q', '-m', 'fixture: unrelated descendant']);

    const accept = spawnCli(fixture, binPath, ['authorization-lineage']);
    results.push({
      control: 'lineage-unchanged-descendant-accepted',
      ok: accept.exitCode === 0 && accept.stdout.includes('PASS'),
      detail: accept.exitCode === 0
        ? 'attestation retained two descendant commits after the reviewed revision is accepted: ancestry holds and every protected artifact is unchanged (retention itself does not invalidate)'
        : `expected acceptance, got exit ${accept.exitCode}: ${accept.stdout.slice(0, 300)}`
    });

    const scopePath = path.join(fixture, 'verification', 'scope', 'scope.json');
    const scopeOriginal = readFileSync(scopePath, 'utf8');
    writeFileSync(scopePath, scopeOriginal.replace('"scopeId": "scope.phosphene"', '"scopeId": "scope.phosphene-tampered"'));
    fgit(['add', '-A']);
    fgit(['commit', '-q', '-m', 'fixture: tamper protected artifact']);
    const tampered = spawnCli(fixture, binPath, ['authorization-lineage']);
    results.push({
      control: 'lineage-protected-artifact-change-invalidates',
      ok: tampered.exitCode !== 0 && tampered.stdout.includes('AUTHORIZATION_LINEAGE_INVALID') && tampered.stdout.includes('scope.json'),
      detail: tampered.exitCode !== 0
        ? 'changing a protected artifact after approval invalidates the attestation with AUTHORIZATION_LINEAGE_INVALID naming the changed file'
        : 'tampered protected artifact was NOT rejected'
    });
    fgit(['reset', '--hard', 'HEAD~1']);

    const wrongRepo = { ...attestation, attestationId: 'ATT-LINEAGE-WRONG-REPO', repositoryIdentity: 'someone-else/other-repo' };
    wrongRepo.attestationHash = canonicalJsonHash((({ attestationHash, ...rest }) => rest)(wrongRepo));
    writeFileSync(path.join(attestationsDir, 'ATT-LINEAGE-WRONG-REPO.json'), JSON.stringify(wrongRepo, null, 2) + '\n');
    const wrongRepoRun = spawnCli(fixture, binPath, ['authorization-lineage']);
    unlinkSync(path.join(attestationsDir, 'ATT-LINEAGE-WRONG-REPO.json'));
    results.push({
      control: 'lineage-wrong-repository-rejected',
      ok: wrongRepoRun.exitCode !== 0 && wrongRepoRun.stdout.includes('wrong repository'),
      detail: wrongRepoRun.exitCode !== 0 ? 'attestation bound to a different repository identity is rejected' : 'wrong-repository attestation was NOT rejected'
    });

    const sideBase = fgit(['rev-parse', 'HEAD']);
    fgit(['checkout', '-q', '-b', 'lineage-side', reviewedCommit]);
    appendFileSync(path.join(fixture, 'SIDE.txt'), 'side branch\n');
    fgit(['add', '-A']);
    fgit(['commit', '-q', '-m', 'fixture: side commit']);
    const sideCommit = fgit(['rev-parse', 'HEAD']);
    const sideTree = fgit(['rev-parse', 'HEAD^{tree}']);
    fgit(['checkout', '-q', '-']);
    void sideBase;
    const nonAncestor = { ...attestation, attestationId: 'ATT-LINEAGE-NON-ANCESTOR', reviewedCommit: sideCommit, reviewedTreeHash: sideTree };
    nonAncestor.attestationHash = canonicalJsonHash((({ attestationHash, ...rest }) => rest)(nonAncestor));
    writeFileSync(path.join(attestationsDir, 'ATT-LINEAGE-NON-ANCESTOR.json'), JSON.stringify(nonAncestor, null, 2) + '\n');
    const nonAncestorRun = spawnCli(fixture, binPath, ['authorization-lineage']);
    unlinkSync(path.join(attestationsDir, 'ATT-LINEAGE-NON-ANCESTOR.json'));
    results.push({
      control: 'lineage-non-ancestor-reviewed-revision-rejected',
      ok: nonAncestorRun.exitCode !== 0 && nonAncestorRun.stdout.includes('not an ancestor'),
      detail: nonAncestorRun.exitCode !== 0 ? 'a reviewed revision that is not an ancestor of the consuming revision is rejected' : 'non-ancestor reviewed revision was NOT rejected'
    });

    const wrongCommit = { ...attestation, attestationId: 'ATT-LINEAGE-WRONG-COMMIT', reviewedCommit: fgit(['rev-parse', 'HEAD']) , reviewedTreeHash: fgit(['rev-parse', 'HEAD^{tree}']) };
    wrongCommit.attestationHash = canonicalJsonHash((({ attestationHash, ...rest }) => rest)(wrongCommit));
    writeFileSync(path.join(attestationsDir, 'ATT-LINEAGE-WRONG-COMMIT.json'), JSON.stringify(wrongCommit, null, 2) + '\n');
    const wrongCommitRun = spawnCli(fixture, binPath, ['authorization-lineage']);
    unlinkSync(path.join(attestationsDir, 'ATT-LINEAGE-WRONG-COMMIT.json'));
    results.push({
      control: 'lineage-review-against-wrong-commit-rejected',
      ok: wrongCommitRun.exitCode !== 0 && wrongCommitRun.stdout.includes('wrong commit'),
      detail: wrongCommitRun.exitCode !== 0 ? 'an attestation whose reviewed revision differs from the witness declaration is rejected (review against the wrong commit)' : 'wrong-commit review was NOT rejected'
    });

    const noRevisionWitness = { ...witness, witnessId: 'AUTH-WITNESS-NO-REVISION' };
    delete (/** @type {any} */ (noRevisionWitness)).reviewedRevision;
    writeFileSync(path.join(witnessesDir, 'AUTH-WITNESS-NO-REVISION.json'), JSON.stringify(noRevisionWitness, null, 2) + '\n');
    const noRevisionRun = spawnCli(fixture, binPath, ['authorization-lineage']);
    unlinkSync(path.join(witnessesDir, 'AUTH-WITNESS-NO-REVISION.json'));
    results.push({
      control: 'lineage-missing-reviewed-revision-rejected',
      ok: noRevisionRun.exitCode !== 0 && (noRevisionRun.stdout.includes('reviewedRevision') || noRevisionRun.stdout.includes('reviewed revision')),
      detail: noRevisionRun.exitCode !== 0 ? 'a witness without an exact reviewed revision fails (schema and lineage both reject it)' : 'missing reviewed revision was NOT rejected'
    });

    writeFileSync(allowlistPath, JSON.stringify({ identities: [{ identityId: 'identity.someone-new', kind: 'github-account', value: 'someone-new' }] }, null, 2) + '\n');
    fgit(['add', '-A']);
    fgit(['commit', '-q', '-m', 'fixture: change allowlist after approval']);
    const allowlistChanged = spawnCli(fixture, binPath, ['authorization-lineage']);
    results.push({
      control: 'lineage-allowlist-change-invalidates',
      ok: allowlistChanged.exitCode !== 0 && allowlistChanged.stdout.includes('allowlist'),
      detail: allowlistChanged.exitCode !== 0 ? 'changing the applicable identity allowlist after approval invalidates the attestation' : 'allowlist change after approval was NOT rejected'
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true, maxRetries: 3 });
  }
  return results;
}

import cryptoModule from 'node:crypto';

/**
 * Semantic-negative controls (spec §14.5/§7.10B): structurally valid but
 * semantically inadequate records rejected with independently attributable
 * signatures. Each mutation edits a cloned fixture and runs the public CLI.
 * @param {string} repoRoot @param {string} binPath
 * @returns {ControlResult[]}
 */
export function semanticNegativeControls(repoRoot, binPath) {
  /** @type {ControlResult[]} */
  const results = [];
  const fixture = cloneFixture(repoRoot);
  const bindingPath = path.join(fixture, 'verification', 'binding', 'project-verification-binding.json');
  const claimPath = path.join(fixture, 'verification', 'claims', 'CLAIM-MILK-EXPR-OPERATORS.json');
  const comparatorPath = path.join(fixture, 'verification', 'comparators', 'CMP-EXACT-JSON.json');
  const evidencePath = path.join(fixture, 'verification', 'evidence', 'EV-MILK-EXPR-EXPECTED.json');
  const fixtureRecordPath = path.join(fixture, 'verification', 'fixtures', 'records', 'FIX-MILK-EXPR-OPERATORS.json');
  const adapterPath = path.join(fixture, 'verification', 'adapters', 'ADP-PHOSPHENE-SUBJECT.json');

  /** @param {string} name @param {() => void} mutate @param {string} code @param {string} needle @param {string[]} [args] */
  function scenario(name, mutate, code, needle, args = ['requirement', 'REQ-MILK-EXPR-OPERATORS']) {
    mutate();
    const run = spawnCli(fixture, binPath, args);
    restoreFixture(fixture);
    const present = run.stdout.includes(code) && run.stdout.includes(needle);
    results.push({
      control: `semantic-negative:${name}`,
      ok: run.exitCode !== 0 && present,
      detail: run.exitCode !== 0 && present
        ? `structurally valid but semantically inadequate record rejected with ${code} naming '${needle}'`
        : `exit ${run.exitCode}, intended signature present: ${present}`
    });
  }

  try {
    scenario('positive-control-not-consumed', () => {
      const b = JSON.parse(readFileSync(bindingPath, 'utf8'));
      const rc = b.requirementClasses.find((/** @type {any} */ c) => c.requirementClassId === 'requirement-class.milkdrop-expression');
      rc.mandatoryPositiveControls = ['CHK-SELFTEST-CRC32-EXEC'];
      writeFileSync(bindingPath, JSON.stringify(b, null, 2) + '\n');
    }, 'SEMANTIC_PROXY_SUBSTITUTION', 'does not register positive control');

    scenario('product-path-dependence-unregistered', () => {
      const b = JSON.parse(readFileSync(bindingPath, 'utf8'));
      const rc = b.requirementClasses.find((/** @type {any} */ c) => c.requirementClassId === 'requirement-class.milkdrop-expression');
      rc.productPathDependenceControls = [];
      writeFileSync(bindingPath, JSON.stringify(b, null, 2) + '\n');
    }, 'SEMANTIC_PROXY_SUBSTITUTION', 'no registered product-path dependence control');

    scenario('authority-coverage-omitted-constituent', () => {
      const c = JSON.parse(readFileSync(claimPath, 'utf8'));
      c.perConstituentAuthority = [{ constituent: 'partial', authorityId: 'AUTH-MILKDROP-EEL-PARSER', coversPaths: ['pools[].a'] }];
      writeFileSync(claimPath, JSON.stringify(c, null, 2) + '\n');
    }, 'AUTHORITY_SOURCE_AMBIGUOUS', 'has no authority assignment');

    scenario('authority-coverage-unrelated-substitution', () => {
      const c = JSON.parse(readFileSync(claimPath, 'utf8'));
      c.perConstituentAuthority = [{ constituent: 'bogus', authorityId: 'AUTH-MILKDROP-EEL-PARSER', coversPaths: ['bogus'] }];
      writeFileSync(claimPath, JSON.stringify(c, null, 2) + '\n');
    }, 'AUTHORITY_SOURCE_AMBIGUOUS', 'unrelated substitution');

    scenario('authority-coverage-conflicting-duplicate', () => {
      const c = JSON.parse(readFileSync(claimPath, 'utf8'));
      c.perConstituentAuthority.push({ constituent: 'duplicate', authorityId: 'AUTH-RFC1952', coversPaths: ['pools[].a'] });
      writeFileSync(claimPath, JSON.stringify(c, null, 2) + '\n');
    }, 'AUTHORITY_SOURCE_AMBIGUOUS', 'duplicate conflicting assignment');

    scenario('divergence-evidence-does-not-justify', () => {
      const cmp = JSON.parse(readFileSync(comparatorPath, 'utf8'));
      cmp.equalityMode = 'toleranced';
      cmp.tolerance = 0.5;
      cmp.toleranceJustification = 'cites real evidence that does not establish this magnitude';
      cmp.evidenceRefs = ['EV-MILK-EXPR-EXPECTED'];
      writeFileSync(comparatorPath, JSON.stringify(cmp, null, 2) + '\n');
    }, 'DIVERGENCE_CLASSIFICATION_UNJUSTIFIED', 'no cited record establishes');

    scenario('evidence-class-present-but-unconsumed', () => {
      const ev = JSON.parse(readFileSync(evidencePath, 'utf8'));
      ev.expectedResultArtifact = 'verification/fixtures/inputs/FIX-MILK-EXPR-OPERATORS.input.json';
      writeFileSync(evidencePath, JSON.stringify(ev, null, 2) + '\n');
    }, 'EVIDENCE_MISSING', 'no claim fixture consumes its artifact');

    scenario('stronger-oracle-bypass', () => {
      const c = JSON.parse(readFileSync(claimPath, 'utf8'));
      c.actualExpectedValueOrigin = 'controlled-observation';
      writeFileSync(claimPath, JSON.stringify(c, null, 2) + '\n');
    }, 'STRONGER_ORACLE_BYPASSED', 'reference-execution');

    scenario('inventory-item-unclaimed', () => {
      const c = JSON.parse(readFileSync(claimPath, 'utf8'));
      c.inventoryItemIds = c.inventoryItemIds.filter((/** @type {string} */ id) => id !== 'STMT-4');
      writeFileSync(claimPath, JSON.stringify(c, null, 2) + '\n');
    }, 'INVENTORY_ITEM_UNCLAIMED', 'STMT-4');

    scenario('inventory-coverage-coarse', () => {
      const f = JSON.parse(readFileSync(fixtureRecordPath, 'utf8'));
      f.inventoryItemIds = f.inventoryItemIds.filter((/** @type {string} */ id) => id !== 'STMT-3');
      writeFileSync(fixtureRecordPath, JSON.stringify(f, null, 2) + '\n');
    }, 'CLAIM_COVERAGE_COARSE', 'STMT-3');

    scenario('capability-unavailable', () => {
      const a = JSON.parse(readFileSync(adapterPath, 'utf8'));
      a.capabilities[0].module = 'phosphene/adapters/does-not-exist.mjs';
      writeFileSync(adapterPath, JSON.stringify(a, null, 2) + '\n');
    }, 'SUBJECT_EXECUTION_UNAVAILABLE', 'does-not-exist.mjs');

    scenario('non-discriminating-fixture', () => {
      const evPath = path.join(fixture, 'verification', 'evaluators', 'EVAL-MILK-IDENTITY.json');
      const ev = JSON.parse(readFileSync(evPath, 'utf8'));
      ev.entryPoint = { module: 'tooling/reference-adapters/milkdrop-eel/adapter.mjs', export: 'referenceEelOperators' };
      writeFileSync(evPath, JSON.stringify(ev, null, 2) + '\n');
    }, 'FIXTURE_NONDISCRIMINATING', 'ALT-COMPAT-IDENTITY-COPY');

    scenario('oracle-hand-derived-rejected', () => {
      const c = JSON.parse(readFileSync(claimPath, 'utf8'));
      c.actualExpectedValueOrigin = 'hand-derived-exact';
      writeFileSync(claimPath, JSON.stringify(c, null, 2) + '\n');
    }, 'EXPECTED_VALUE_ORIGIN_UNACCEPTABLE', 'hand-derived-exact');

    scenario('category-uncovered', () => {
      const b = JSON.parse(readFileSync(bindingPath, 'utf8'));
      const rc = b.requirementClasses.find((/** @type {any} */ x) => x.requirementClassId === 'requirement-class.milkdrop-expression');
      rc.mandatoryVerificationCategories.push('nonexistent-category');
      writeFileSync(bindingPath, JSON.stringify(b, null, 2) + '\n');
    }, 'PROJECT_UNDERBOUND', "'nonexistent-category'");

    scenario('provider-unconfigured', () => {
      const b = JSON.parse(readFileSync(bindingPath, 'utf8'));
      const rc = b.requirementClasses.find((/** @type {any} */ x) => x.requirementClassId === 'requirement-class.milkdrop-expression');
      rc.mandatoryProviders.push('PROVIDER-DOES-NOT-EXIST');
      writeFileSync(bindingPath, JSON.stringify(b, null, 2) + '\n');
    }, 'PROVIDER_UNAVAILABLE', "'PROVIDER-DOES-NOT-EXIST'");

    // Product-path bypass: adapter keeps the 'product' role label but its
    // module computes results without the graph/executor. The removal
    // intervention exposes the lie: deleting the executor no longer changes
    // the claim result.
    {
      const a = JSON.parse(readFileSync(adapterPath, 'utf8'));
      a.capabilities = a.capabilities.map((/** @type {any} */ cap) => cap.capabilityId === 'phosphene-execute-graph-step'
        ? { ...cap, module: 'tooling/verification-kit/src/self-test/mutants/bypass-product-adapter.mjs', export: 'executeMilkExprBypassingGraph' }
        : cap);
      writeFileSync(adapterPath, JSON.stringify(a, null, 2) + '\n');
      const bypassPasses = spawnCli(fixture, binPath, ['claim', 'CLAIM-MILK-EXPR-OPERATORS']);
      unlinkSync(path.join(fixture, 'phosphene', 'src', 'exec', 'executor.mjs'));
      const afterRemoval = spawnCli(fixture, binPath, ['claim', 'CLAIM-MILK-EXPR-OPERATORS']);
      restoreFixture(fixture);
      const bypassDetected = bypassPasses.exitCode === 0 && afterRemoval.exitCode === 0;
      results.push({
        control: 'semantic-negative:product-path-bypass-detected-by-removal',
        ok: bypassDetected,
        detail: bypassDetected
          ? "an adapter labelled 'product' that bypasses the graph/executor still passes after the executor is deleted — the removal intervention detects exactly this, which is why the role label alone is never accepted"
          : `expected bypass to survive executor removal (bypass run exit ${bypassPasses.exitCode}, post-removal exit ${afterRemoval.exitCode})`
      });
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true, maxRetries: 3 });
  }
  return results;
}

/**
 * Conformance-governance controls (spec §7.10A/§7.10B): tampering with the
 * canonical suite manifest is rejected, and a bootstrap record cannot
 * self-certify.
 * @param {string} repoRoot @param {string} binPath
 * @returns {ControlResult[]}
 */
export function conformanceGovernanceControls(repoRoot, binPath) {
  /** @type {ControlResult[]} */
  const results = [];
  const fixture = cloneFixture(repoRoot);
  const manifestPath = path.join(fixture, 'verification', 'framework-conformance', 'canonical-suite', 'manifest.json');
  const bootstrapPath = path.join(fixture, 'verification', 'framework-conformance', 'bootstrap-conformance.json');
  try {
    if (existsSync(manifestPath)) {
      const original = readFileSync(manifestPath, 'utf8');
      const weakened = JSON.parse(original);
      const anyNegative = (weakened.controlScenarios ?? []).find((/** @type {any} */ s) => s.condition !== 'positive');
      if (anyNegative) anyNegative.expectedOutcomes[0].expectedFailureCode = 'CHECK_FAILED';
      writeFileSync(manifestPath, JSON.stringify(weakened, null, 2) + '\n');
      const run = spawnCli(fixture, binPath, ['framework-conformance-suite']);
      restoreFixture(fixture);
      results.push({
        control: 'conformance-suite-weakening-rejected',
        ok: run.exitCode !== 0 && run.stdout.includes('CONFORMANCE_SUITE_UNAUTHORIZED'),
        detail: run.exitCode !== 0 && run.stdout.includes('CONFORMANCE_SUITE_UNAUTHORIZED')
          ? 'changing a canonical control expected signature without authenticated authorization is rejected (manifest hash mismatch)'
          : `expected CONFORMANCE_SUITE_UNAUTHORIZED, got exit ${run.exitCode}`
      });
    } else {
      results.push({ control: 'conformance-suite-weakening-rejected', ok: false, detail: 'canonical suite manifest absent in fixture' });
    }

    if (existsSync(bootstrapPath)) {
      const b = JSON.parse(readFileSync(bootstrapPath, 'utf8'));
      b.status = 'established';
      b.independentBootstrapWitnessId = null;
      writeFileSync(bootstrapPath, JSON.stringify(b, null, 2) + '\n');
      const run = spawnCli(fixture, binPath, ['framework-bootstrap-conformance']);
      restoreFixture(fixture);
      results.push({
        control: 'bootstrap-self-certification-rejected',
        ok: run.exitCode !== 0 && run.stdout.includes('FRAMEWORK_BOOTSTRAP_UNWITNESSED'),
        detail: run.exitCode !== 0 && run.stdout.includes('FRAMEWORK_BOOTSTRAP_UNWITNESSED')
          ? "a bootstrap record marked 'established' without an authenticated independent witness is rejected — the implementation cannot certify itself"
          : `expected FRAMEWORK_BOOTSTRAP_UNWITNESSED, got exit ${run.exitCode}`
      });

      const b2 = JSON.parse(readFileSync(bootstrapPath, 'utf8'));
      if (b2.frameworkImplementation?.trustBearingArtifactHashes?.[0]) {
        b2.frameworkImplementation.trustBearingArtifactHashes[0].sha256 = '0'.repeat(64);
        writeFileSync(bootstrapPath, JSON.stringify(b2, null, 2) + '\n');
        const run2 = spawnCli(fixture, binPath, ['framework-bootstrap-conformance']);
        restoreFixture(fixture);
        results.push({
          control: 'bootstrap-core-hash-mismatch-rejected',
          ok: run2.exitCode !== 0 && run2.stdout.includes('trust-bearing core changed'),
          detail: run2.exitCode !== 0 && run2.stdout.includes('trust-bearing core changed')
            ? 'a bootstrap record bound to different trust-bearing core hashes is rejected; a material core change invalidates the prior judgment'
            : `expected trust-core mismatch rejection, got exit ${run2.exitCode}`
        });
      }
    } else {
      results.push({ control: 'bootstrap-self-certification-rejected', ok: false, detail: 'bootstrap-conformance record absent in fixture' });
      results.push({ control: 'bootstrap-core-hash-mismatch-rejected', ok: false, detail: 'bootstrap-conformance record absent in fixture' });
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
    const fixtureHead = execFileSync('git', ['-C', fixture, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const forged = {
      witnessId: 'AUTH-WITNESS-FORGED-CONTROL',
      authorizationType: 'scope-approval',
      reviewedRevision: fixtureHead,
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
