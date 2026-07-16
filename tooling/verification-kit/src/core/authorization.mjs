import { canonicalJsonHash } from './hash.mjs';
import { repoState } from './git.mjs';

/**
 * Hash of a witness object for attestation binding: canonical JSON of the full record.
 * @param {any} witness @returns {string}
 */
export function witnessObjectHash(witness) {
  return canonicalJsonHash(witness);
}

/**
 * Hash of an attestation record excluding its own attestationHash field.
 * @param {any} attestation @returns {string}
 */
export function attestationSelfHash(attestation) {
  const { attestationHash, ...rest } = attestation;
  void attestationHash;
  return canonicalJsonHash(rest);
}

/** @param {any} allowlist @returns {string} */
export function allowlistHash(allowlist) {
  return canonicalJsonHash(allowlist);
}

/**
 * Determine a witness's verification status from retained records.
 * 'verified-attested' means a hash-valid attestation binds the witness to the
 * current commit, repository, and allowlist. It is integrity verification of a
 * previously live-verified attestation, not live re-authentication (§7.10).
 * @param {import('./store.mjs').Store} store
 * @param {string | null | undefined} witnessId
 * @returns {{ status: 'missing' | 'unverified' | 'verified-attested', reasons: string[] }}
 */
export function witnessStatus(store, witnessId) {
  if (!witnessId) return { status: 'missing', reasons: ['no witness referenced'] };
  const hit = store.byId.get(witnessId);
  if (!hit || hit.kind !== 'witness') return { status: 'missing', reasons: [`witness '${witnessId}' not found`] };
  const witness = hit.record;
  /** @type {string[]} */
  const reasons = [];

  const identities = (store.allowlist?.identities ?? []).map((/** @type {any} */ i) => i.value);
  if (identities.length === 0) {
    reasons.push('authorization allowlist is empty; bootstrap pending (see verification/authorization/bootstrap-record.json)');
  } else if (!identities.includes(witness.authorizingIdentity)) {
    reasons.push(`authorizing identity '${witness.authorizingIdentity}' is not in the allowlist`);
  }

  const attestation = store.attestations.find((a) => a.witnessId === witnessId);
  if (!attestation) {
    reasons.push('no authorization verification attestation retained for this witness');
    return { status: 'unverified', reasons };
  }
  if (attestation.attestationHash !== attestationSelfHash(attestation)) {
    reasons.push('attestation hash does not match its content');
  }
  if (attestation.witnessObjectHash !== witnessObjectHash(witness)) {
    reasons.push('attestation is bound to a different witness object (witness changed after attestation)');
  }
  if (attestation.baseAllowlistHash !== allowlistHash(store.allowlist)) {
    reasons.push('attestation is bound to a different identity allowlist');
  }
  const { commit } = repoState(store.repoRoot);
  if (attestation.commit !== commit) {
    reasons.push(`attestation is bound to commit ${String(attestation.commit).slice(0, 12)}…, current HEAD is ${commit.slice(0, 12)}… (live re-verification required)`);
  }
  const expectedRepo = store.projectConfig?.repositoryIdentity;
  if (expectedRepo && attestation.repositoryIdentity !== expectedRepo) {
    reasons.push('attestation is bound to a different repository identity');
  }
  if (reasons.length > 0) return { status: 'unverified', reasons };
  return { status: 'verified-attested', reasons: [] };
}
