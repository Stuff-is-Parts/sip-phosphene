/**
 * Compute a claim's effective plausible-alternative set per framework spec §14.1:
 * the union of claim-declared additions, every applicable selected-profile
 * alternative, and every applicable project-binding alternative. Claim-level
 * declarations may add but never remove, replace, narrow, or shadow.
 *
 * @param {import('./store.mjs').Store} store
 * @param {any} claim
 * @param {any} bindingClass matching requirement-class rule from the governing binding
 * @returns {{ union: Array<{alternativeId: string, defectClass: string, statefulness: string, source: string}>, problems: string[] }}
 */
export function effectiveAlternativeSet(store, claim, bindingClass) {
  /** @type {Map<string, {alternativeId: string, defectClass: string, statefulness: string, source: string}>} */
  const union = new Map();
  /** @type {string[]} */
  const problems = [];

  /** @param {{alternativeId: string, defectClass: string, statefulness: string}} alt @param {string} source */
  function add(alt, source) {
    const existing = union.get(alt.alternativeId);
    if (existing) {
      if (existing.defectClass !== alt.defectClass || existing.statefulness !== alt.statefulness) {
        problems.push(
          `alternative '${alt.alternativeId}' declared with conflicting definitions by ${existing.source} and ${source}; ` +
          `duplicate IDs may be deduplicated only when definitions are identical`
        );
      }
      return;
    }
    union.set(alt.alternativeId, { ...alt, source });
  }

  for (const sel of store.selectedProfiles?.selected ?? []) {
    const profile = store.profiles.find((p) => p.profileId === sel.profileId);
    if (!profile) continue;
    for (const alt of profile.plausibleAlternativeCatalog ?? []) {
      const applicable = (alt.applicableCategoryIds ?? []).some(
        (/** @type {string} */ cat) => (claim.verificationCategories ?? []).includes(cat)
      );
      if (applicable) add(alt, `profile:${profile.profileId}`);
    }
  }

  for (const alt of bindingClass?.mandatoryPlausibleAlternativeClasses ?? []) {
    add(alt, `binding:${bindingClass.requirementClassId}`);
  }

  for (const alt of claim.plausibleAlternatives ?? []) {
    add(alt, `claim:${claim.claimId}`);
  }

  return { union: [...union.values()], problems };
}
