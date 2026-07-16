import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Locate the repository root by walking up from startDir until a .git entry is found.
 * @param {string} startDir
 * @returns {string}
 */
export function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`No .git found walking up from ${startDir}; the framework requires a Git workspace.`);
    dir = parent;
  }
}

/**
 * Convert a repo-relative forward-slash path to an absolute OS path.
 * @param {string} repoRoot
 * @param {string} rel
 * @returns {string}
 */
export function abs(repoRoot, rel) {
  return path.join(repoRoot, ...rel.split('/'));
}

/**
 * Convert an absolute OS path to a repo-relative forward-slash path.
 * @param {string} repoRoot
 * @param {string} absolute
 * @returns {string}
 */
export function rel(repoRoot, absolute) {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

/** @param {string} repoRoot @returns {Record<string, string>} repo-relative paths of the host verification tree */
export function hostTree(repoRoot) {
  void repoRoot;
  return {
    root: 'verification',
    config: 'verification/config',
    projectConfig: 'verification/config/project.json',
    providersConfig: 'verification/config/providers.json',
    scope: 'verification/scope/scope.json',
    scopeLock: 'verification/scope/scope.lock.json',
    authorizationDir: 'verification/authorization',
    allowlist: 'verification/authorization/authorized-identities.json',
    bootstrap: 'verification/authorization/bootstrap-record.json',
    witnessesDir: 'verification/authorization/witnesses',
    attestationsDir: 'verification/authorization/attestations',
    authorizationLock: 'verification/authorization/authorization.lock.json',
    frameworkConformanceDir: 'verification/framework-conformance',
    bootstrapConformance: 'verification/framework-conformance/bootstrap-conformance.json',
    canonicalSuiteDir: 'verification/framework-conformance/canonical-suite',
    canonicalSuiteManifest: 'verification/framework-conformance/canonical-suite/manifest.json',
    frameworkConformanceLock: 'verification/framework-conformance/framework-conformance.lock.json',
    authorities: 'verification/authorities/authorities.json',
    authoritiesLock: 'verification/authorities/authorities.lock.json',
    rawDir: 'verification/authorities/raw',
    conflictsDir: 'verification/authorities/conflicts',
    requirementsDir: 'verification/requirements',
    claimsDir: 'verification/claims',
    evidenceDir: 'verification/evidence',
    evidenceDerivedDir: 'verification/evidence/derived',
    evidenceLock: 'verification/evidence/evidence.lock.json',
    fixturesDir: 'verification/fixtures',
    fixtureInputsDir: 'verification/fixtures/inputs',
    fixtureExpectedDir: 'verification/fixtures/expected',
    fixtureRecordsDir: 'verification/fixtures/records',
    fixturesLock: 'verification/fixtures/fixtures.lock.json',
    comparatorsDir: 'verification/comparators',
    comparatorsLock: 'verification/comparators/comparators.lock.json',
    adaptersDir: 'verification/adapters',
    checksDir: 'verification/checks',
    evaluatorsDir: 'verification/evaluators',
    inventoryDir: 'verification/inventory',
    profilesDir: 'verification/profiles',
    selectedProfiles: 'verification/profiles/selected.json',
    profilesLock: 'verification/profiles/profiles.lock.json',
    profileOverridesDir: 'verification/profiles/overrides',
    binding: 'verification/binding/project-verification-binding.json',
    bindingLock: 'verification/binding/project-verification-binding.lock.json',
    reportsDir: 'verification/reports'
  };
}
