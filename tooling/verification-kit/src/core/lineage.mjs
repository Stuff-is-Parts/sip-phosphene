import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { abs } from './paths.mjs';
import { hashFile } from './hash.mjs';
import { git, showAt } from './git.mjs';
import { witnessObjectHash, attestationSelfHash, allowlistHash } from './authorization.mjs';

/**
 * Authorization lineage per framework spec §7.10 (semantic-control-sharing
 * revision): an approval binds to the exact REVIEWED revision and the hashes of
 * every protected artifact and governing authorization surface at that
 * revision. An attestation retained in a descendant commit stays valid exactly
 * while (1) the reviewed revision is an ancestor of the consuming revision and
 * (2) every protected artifact is byte-identical at the consuming revision.
 * Current-HEAD equality is never a lineage criterion — binding an attestation
 * to the commit that contains it is the named failure mode
 * "authorization-lineage deadlock".
 */

/**
 * The protected artifact and governing-authorization surfaces per decision type.
 * Every decision type protects the governing authorization surfaces; each type
 * adds the artifacts its decision touches.
 * @param {string} authorizationType
 * @returns {string[]} repo-relative file paths (directories not allowed — hashes are per file)
 */
export function protectedSurfacePaths(authorizationType) {
  const governing = [
    'verification/authorization/authorized-identities.json',
    'verification/authorization/bootstrap-record.json'
  ];
  /** @type {Record<string, string[]>} */
  const byType = {
    'scope-approval': ['verification/scope/scope.json', 'verification/scope/decomposition.json'],
    'scope-change': ['verification/scope/scope.json', 'verification/scope/decomposition.json'],
    'scope-exclusion': ['verification/scope/scope.json'],
    'binding-adoption': ['verification/binding/project-verification-binding.json'],
    'binding-adequacy': ['verification/binding/project-verification-binding.json'],
    'allowlist-change': [],
    'framework-bootstrap-conformance': ['verification/framework-conformance/bootstrap-conformance.json', 'verification/framework-conformance/canonical-suite/manifest.json'],
    'framework-change': ['verification/framework-conformance/canonical-suite/manifest.json'],
    'regression-authorization': [],
    'interpretive-judgment': [],
    'residual-completeness': ['verification/scope/decomposition.json'],
    'other-reserved-action': []
  };
  return [...governing, ...(byType[authorizationType] ?? [])];
}

/** @param {string} repoRoot @param {string} rev @param {string} ofRev @returns {boolean} */
export function isAncestor(repoRoot, rev, ofRev) {
  const r = git(repoRoot, ['merge-base', '--is-ancestor', rev, ofRev]);
  return r.ok;
}

/**
 * Compute protected artifact hashes at a specific revision.
 * @param {string} repoRoot @param {string} rev @param {string[]} paths
 * @returns {{ ok: true, hashes: Array<{path: string, sha256: string}> } | { ok: false, reason: string }}
 */
export function protectedHashesAt(repoRoot, rev, paths) {
  /** @type {Array<{path: string, sha256: string}>} */
  const hashes = [];
  for (const p of paths) {
    const content = showAt(repoRoot, rev, p);
    if (content === undefined) {
      return { ok: false, reason: `protected artifact '${p}' does not exist at revision ${rev.slice(0, 12)}…` };
    }
    hashes.push({ path: p, sha256: createHash('sha256').update(content).digest('hex') });
  }
  return { ok: true, hashes };
}

/**
 * Verify one retained attestation's complete lineage per §7.10 against the
 * CURRENT worktree as the consuming revision.
 * @param {import('./store.mjs').Store} store
 * @param {any} attestation
 * @returns {{ ok: boolean, reasons: string[] }}
 */
export function verifyAttestationLineage(store, attestation) {
  /** @type {string[]} */
  const reasons = [];

  if (attestation.attestationHash !== attestationSelfHash(attestation)) {
    reasons.push('attestation hash does not match its content');
  }
  const expectedRepo = store.projectConfig?.repositoryIdentity;
  if (expectedRepo && attestation.repositoryIdentity !== expectedRepo) {
    reasons.push(`attestation is bound to repository '${attestation.repositoryIdentity}', this repository is '${expectedRepo}' (wrong repository)`);
  }
  if (!attestation.reviewedCommit || !/^[0-9a-f]{40}$/.test(attestation.reviewedCommit)) {
    reasons.push('attestation lacks an exact reviewed revision (AUTHORIZATION_LINEAGE_INVALID: reviewed revision is mandatory)');
    return { ok: false, reasons };
  }

  const witness = store.byId.get(attestation.witnessId)?.record;
  if (!witness) {
    reasons.push(`witness '${attestation.witnessId}' is not retained`);
  } else {
    if (attestation.witnessObjectHash !== witnessObjectHash(witness)) {
      reasons.push('attestation is bound to a different witness object (witness changed after approval)');
    }
    if (witness.reviewedRevision && witness.reviewedRevision !== attestation.reviewedCommit) {
      reasons.push(`witness declares reviewed revision ${String(witness.reviewedRevision).slice(0, 12)}… but the attestation records ${attestation.reviewedCommit.slice(0, 12)}… (review against the wrong commit)`);
    }
  }

  const treeAt = git(store.repoRoot, ['rev-parse', `${attestation.reviewedCommit}^{tree}`]);
  if (!treeAt.ok) {
    reasons.push(`reviewed revision ${attestation.reviewedCommit.slice(0, 12)}… does not exist in this repository`);
    return { ok: false, reasons };
  }
  if (treeAt.stdout.trim() !== attestation.reviewedTreeHash) {
    reasons.push('reviewed tree hash does not match the reviewed revision');
  }

  const head = git(store.repoRoot, ['rev-parse', 'HEAD']);
  if (head.ok && !isAncestor(store.repoRoot, attestation.reviewedCommit, head.stdout.trim())) {
    reasons.push(`reviewed revision ${attestation.reviewedCommit.slice(0, 12)}… is not an ancestor of the consuming revision (AUTHORIZATION_LINEAGE_INVALID)`);
  }

  for (const entry of attestation.protectedArtifactHashes ?? []) {
    const fileAbs = abs(store.repoRoot, entry.path);
    if (!existsSync(fileAbs)) {
      reasons.push(`protected artifact missing at consuming revision: ${entry.path}`);
      continue;
    }
    const current = hashFile(fileAbs).sha256;
    if (current !== entry.sha256) {
      reasons.push(`protected artifact changed after approval: ${entry.path} (reviewed ${entry.sha256.slice(0, 12)}…, consuming ${current.slice(0, 12)}…) — a new live approval is required`);
    }
  }

  if (attestation.authorizationType === 'allowlist-change') {
    if (!attestation.baseRevision) {
      reasons.push('trust-root change attestation lacks the applicable base revision');
    }
  } else {
    const currentAllowlist = allowlistHash(store.allowlist);
    if (attestation.baseAllowlistHash !== currentAllowlist) {
      reasons.push('the applicable identity allowlist changed after approval');
    }
  }

  return { ok: reasons.length === 0, reasons };
}
