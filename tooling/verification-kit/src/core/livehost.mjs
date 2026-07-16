import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { abs } from './paths.mjs';
import { witnessObjectHash, attestationSelfHash, allowlistHash } from './authorization.mjs';
import { canonicalJsonHash } from './hash.mjs';
import { git, showAt } from './git.mjs';
import { protectedSurfacePaths, protectedHashesAt } from './lineage.mjs';

/**
 * Live repository-host authorization verification per framework spec §7.9/§7.10
 * (semantic-control-sharing revision). LIVE authentication through the
 * maintained gh CLI against the GitHub API — distinct from lineage and
 * attestation-integrity verification of retained records. The approval binds
 * to the witness's exact REVIEWED revision and the protected artifact hashes
 * at that revision; it never binds to the later commit that retains the
 * attestation (authorization-lineage deadlock is a named failure mode).
 * @param {import('./store.mjs').Store} store
 * @param {any} witness
 * @returns {{ ok: boolean, reasons: string[], attestationPath?: string }}
 */
export function verifyWitnessLive(store, witness) {
  /** @type {string[]} */
  const reasons = [];

  try {
    execFileSync('gh', ['auth', 'status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return { ok: false, reasons: ['gh CLI unavailable or unauthenticated; live host verification cannot run in this environment'] };
  }

  if (!witness.reviewedRevision || !/^[0-9a-f]{40}$/.test(witness.reviewedRevision)) {
    return { ok: false, reasons: [`witness '${witness.witnessId}' lacks an exact reviewed revision — AUTHORIZATION_LINEAGE_INVALID; the reviewed revision is mandatory`] };
  }
  if (witness.verificationMethod !== 'github-approval') {
    return { ok: false, reasons: [`witness '${witness.witnessId}' uses method '${witness.verificationMethod}'; only github-approval is live-verifiable through this path`] };
  }
  const meta = witness.hostMetadata;
  if (!meta || meta.kind !== 'pr-review' || !meta.prNumber || !meta.reviewId) {
    return { ok: false, reasons: [`witness '${witness.witnessId}' lacks pr-review hostMetadata (prNumber, reviewId); nothing to authenticate`] };
  }
  const repoId = store.projectConfig?.repositoryIdentity;

  /** @type {any} */
  let review;
  try {
    const out = execFileSync('gh', ['api', `repos/${repoId}/pulls/${meta.prNumber}/reviews/${meta.reviewId}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    review = JSON.parse(out);
  } catch (e) {
    return { ok: false, reasons: [`host approval event not found: gh api repos/${repoId}/pulls/${meta.prNumber}/reviews/${meta.reviewId} failed (${/** @type {Error} */ (e).message.split('\n')[0]})`] };
  }

  if (review.state !== 'APPROVED') {
    reasons.push(`host review event exists but its state is '${review.state}', not APPROVED`);
  }
  if (review.user?.login !== witness.authorizingIdentity) {
    reasons.push(`host review author '${review.user?.login}' does not match the witness's authorizing identity '${witness.authorizingIdentity}' (wrong identity)`);
  }
  if (review.commit_id !== witness.reviewedRevision) {
    reasons.push(`host review is bound to commit ${String(review.commit_id).slice(0, 12)}…, the witness reviews ${witness.reviewedRevision.slice(0, 12)}… (review against the wrong commit)`);
  }

  let applicableAllowlist = store.allowlist;
  let baseRevision;
  if (witness.authorizationType === 'allowlist-change') {
    // Base-allowlist rule (§7.9/§7.10): a trust-root change is judged against
    // the allowlist at the declared base revision, never the proposed one.
    baseRevision = meta.baseRevision;
    if (!baseRevision) {
      reasons.push('allowlist-change witness lacks hostMetadata.baseRevision; the base-allowlist rule cannot be applied');
    } else {
      const baseText = showAt(store.repoRoot, baseRevision, 'verification/authorization/authorized-identities.json');
      if (!baseText) {
        reasons.push(`base revision '${baseRevision}' carries no identity allowlist`);
      } else {
        applicableAllowlist = JSON.parse(baseText);
      }
    }
  }
  const identities = (applicableAllowlist?.identities ?? []).map((/** @type {any} */ i) => i.value);
  if (identities.length === 0) {
    reasons.push('applicable identity allowlist is empty; authorization root of trust is not bootstrapped (repository-administration action required)');
  } else if (!identities.includes(review.user?.login)) {
    reasons.push(`host review author '${review.user?.login}' is not in the applicable identity allowlist`);
  }

  const expectedHash = witnessObjectHash(witness);
  if (!String(review.body ?? '').includes(expectedHash)) {
    reasons.push(`host review body does not quote the witness object hash ${expectedHash.slice(0, 20)}…; the approval does not bind the exact decision and artifact hashes (see .github/BRANCH-PROTECTION.md witness flow)`);
  }

  const treeAt = git(store.repoRoot, ['rev-parse', `${witness.reviewedRevision}^{tree}`]);
  if (!treeAt.ok) {
    reasons.push(`reviewed revision ${witness.reviewedRevision.slice(0, 12)}… does not exist in this repository`);
  }
  const surfaces = protectedSurfacePaths(witness.authorizationType);
  const protectedAtReviewed = treeAt.ok ? protectedHashesAt(store.repoRoot, witness.reviewedRevision, surfaces) : { ok: false, reason: 'reviewed revision unavailable' };
  if (!protectedAtReviewed.ok) {
    reasons.push(`protected surfaces cannot be hashed at the reviewed revision: ${/** @type {any} */ (protectedAtReviewed).reason}`);
  }

  if (reasons.length > 0) return { ok: false, reasons };

  /** @type {any} */
  const attestation = {
    attestationId: `ATT-${witness.witnessId}-${witness.reviewedRevision.slice(0, 8)}`,
    repositoryIdentity: repoId,
    reviewedCommit: witness.reviewedRevision,
    reviewedTreeHash: /** @type {any} */ (treeAt).stdout.trim(),
    hostEvent: { kind: 'pr-review', prNumber: meta.prNumber, reviewId: meta.reviewId },
    approvingIdentity: review.user.login,
    authorizationType: witness.authorizationType,
    witnessId: witness.witnessId,
    witnessObjectHash: expectedHash,
    decision: witness.decision,
    affectedIds: witness.affectedIds ?? [],
    protectedArtifactHashes: /** @type {any} */ (protectedAtReviewed).hashes,
    baseAllowlistHash: allowlistHash(applicableAllowlist),
    verificationProvider: `gh api pr-review (${ghVersion()})`,
    verificationResult: `APPROVED by ${review.user.login}, review ${meta.reviewId} on PR #${meta.prNumber}, reviewed revision ${witness.reviewedRevision}`,
    verificationTimestamp: new Date().toISOString()
  };
  if (baseRevision) attestation.baseRevision = baseRevision;
  if (String(witness.authorizationType).startsWith('binding') && store.binding) {
    attestation.projectBindingHash = canonicalJsonHash(store.binding);
  }
  attestation.attestationHash = attestationSelfHash(attestation);
  const rel = `${store.tree.attestationsDir}/${attestation.attestationId}.json`;
  writeFileSync(abs(store.repoRoot, rel), JSON.stringify(attestation, null, 2) + '\n');
  return { ok: true, reasons: [], attestationPath: rel };
}

/** @returns {string} */
function ghVersion() {
  try {
    return execFileSync('gh', ['--version'], { encoding: 'utf8' }).split('\n')[0];
  } catch {
    return 'gh (version unknown)';
  }
}
