import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { abs } from './paths.mjs';
import { witnessObjectHash, attestationSelfHash, allowlistHash } from './authorization.mjs';
import { canonicalJsonHash } from './hash.mjs';
import { repoState, showAt } from './git.mjs';

/**
 * Live repository-host authorization verification per framework spec §7.9/§7.10
 * (audit finding 5). This is LIVE authentication through the maintained gh CLI
 * against the GitHub API — distinct from attestation-integrity verification,
 * which only checks previously produced attestations. A repository file,
 * comment, or producer statement claiming approval never verifies here; only
 * an actual host approval event does.
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

  let applicableAllowlist = store.allowlist;
  if (witness.authorizationType === 'allowlist-change') {
    // Base-allowlist rule (§7.9): the change is judged against the allowlist at
    // the declared base revision, never the proposed one.
    if (!meta.baseRevision) {
      reasons.push('allowlist-change witness lacks hostMetadata.baseRevision; the base-allowlist rule cannot be applied');
    } else {
      const baseText = showAt(store.repoRoot, meta.baseRevision, 'verification/authorization/authorized-identities.json');
      if (!baseText) {
        reasons.push(`base revision '${meta.baseRevision}' carries no identity allowlist`);
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

  if (meta.commitId && review.commit_id !== meta.commitId) {
    reasons.push(`host review is bound to commit ${String(review.commit_id).slice(0, 12)}…, witness declares ${String(meta.commitId).slice(0, 12)}… (wrong revision)`);
  }
  const expectedHash = witnessObjectHash(witness);
  if (!String(review.body ?? '').includes(expectedHash)) {
    reasons.push(`host review body does not quote the witness object hash ${expectedHash.slice(0, 20)}…; the approval is not bound to this exact decision (see .github/BRANCH-PROTECTION.md witness flow)`);
  }

  if (reasons.length > 0) return { ok: false, reasons };

  const { commit } = repoState(store.repoRoot);
  /** @type {any} */
  const attestation = {
    attestationId: `ATT-${witness.witnessId}-${commit.slice(0, 8)}`,
    repositoryIdentity: repoId,
    commit,
    witnessId: witness.witnessId,
    witnessObjectHash: expectedHash,
    decision: witness.decision,
    affectedIds: witness.affectedIds ?? [],
    baseAllowlistHash: allowlistHash(store.allowlist),
    verificationProvider: `gh api pr-review (${ghVersion()})`,
    verificationResult: `APPROVED by ${review.user.login}, review ${meta.reviewId} on PR #${meta.prNumber}, review commit ${review.commit_id}`,
    verificationTimestamp: new Date().toISOString()
  };
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
