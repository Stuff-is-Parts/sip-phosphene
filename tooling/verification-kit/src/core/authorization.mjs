import { canonicalJsonHash } from './hash.mjs';
import { verifyAttestationLineage } from './lineage.mjs';

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
 * 'verified-attested' means a hash-valid attestation binds the witness to its
 * exact REVIEWED revision, and lineage verification proves the reviewed
 * revision is an ancestor of the consuming revision with every protected
 * artifact unchanged (framework spec §7.10). This is integrity + lineage
 * verification of a previously live-verified attestation, never live
 * re-authentication, and never current-HEAD equality — binding an attestation
 * to the commit that retains it is the authorization-lineage deadlock the
 * spec names as a failure mode.
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

  if (!witness.reviewedRevision) {
    reasons.push(`witness '${witnessId}' lacks an exact reviewed revision (AUTHORIZATION_LINEAGE_INVALID: reviewed revision is mandatory)`);
  }

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
  const lineage = verifyAttestationLineageRef(store, attestation);
  reasons.push(...lineage.reasons);
  if (reasons.length > 0) return { status: 'unverified', reasons };
  return { status: 'verified-attested', reasons: [] };
}

/**
 * Late-bound reference to lineage verification (lineage.mjs and this module
 * import each other's pure functions; the call is resolved at invocation time).
 * @param {import('./store.mjs').Store} store @param {any} attestation
 * @returns {{ ok: boolean, reasons: string[] }}
 */
function verifyAttestationLineageRef(store, attestation) {
  return verifyAttestationLineage(store, attestation);
}
