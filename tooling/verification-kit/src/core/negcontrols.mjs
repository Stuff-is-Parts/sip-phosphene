import { computeClaimResult } from './engine.mjs';

/**
 * Run every registered negative control per framework spec §14.4: install the
 * evaluator's defective implementation as the subject for its intended check's
 * claim and prove the intended check rejects it with the intended signature.
 * A control that fails for the wrong reason is itself FAIL.
 * @param {import('./store.mjs').Store} store
 * @returns {Promise<Array<{ evaluatorId: string, ok: boolean, detail: string }>>}
 */
export async function runNegativeControls(store) {
  /** @type {Array<{ evaluatorId: string, ok: boolean, detail: string }>} */
  const results = [];
  for (const evaluator of store.evaluators) {
    const sig = evaluator.negativeControlSignature;
    const check = store.byId.get(sig.intendedCheckId)?.record;
    if (!check) {
      results.push({ evaluatorId: evaluator.evaluatorId, ok: false, detail: `intended check '${sig.intendedCheckId}' not registered` });
      continue;
    }
    const claim = store.claims.find((c) => (check.claimIds ?? []).includes(c.claimId));
    if (!claim) {
      results.push({ evaluatorId: evaluator.evaluatorId, ok: false, detail: `intended check '${sig.intendedCheckId}' maps to no claim` });
      continue;
    }
    const mutantResult = await computeClaimResult(store, claim, [], { subjectOverride: evaluator.entryPoint });
    if (mutantResult.result !== 'FAIL') {
      results.push({ evaluatorId: evaluator.evaluatorId, ok: false, detail: `mutant subject was ACCEPTED: check '${sig.intendedCheckId}' did not reject defect '${evaluator.defectClass}'` });
      continue;
    }
    const matching = mutantResult.failures.find((f) =>
      f.code === sig.expectedFailureCode &&
      f.detail.includes(sig.intendedCheckId) &&
      f.detail.includes(sig.expectedFirstDivergence)
    );
    if (!matching) {
      const codes = [...new Set(mutantResult.failures.map((f) => f.code))].join(', ');
      results.push({
        evaluatorId: evaluator.evaluatorId, ok: false,
        detail: `mutant rejected but not with the intended signature (expected ${sig.expectedFailureCode} at ${sig.expectedFirstDivergence} from ${sig.intendedCheckId}; observed codes: ${codes})`
      });
      continue;
    }
    results.push({ evaluatorId: evaluator.evaluatorId, ok: true, detail: `rejected with intended signature: ${sig.expectedFailureCode} at ${sig.expectedFirstDivergence}` });
  }
  return results;
}
