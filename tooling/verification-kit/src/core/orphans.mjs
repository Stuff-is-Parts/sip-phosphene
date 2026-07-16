/**
 * Orphan and integration checks per framework spec §16: every write has a read,
 * every read has a maintained source. Returns human-precise findings; any finding
 * fails the framework check.
 * @param {import('./store.mjs').Store} store
 * @returns {string[]}
 */
export function findOrphans(store) {
  /** @type {string[]} */
  const findings = [];

  for (const r of store.requirements) {
    const claims = store.claims.filter((c) => (c.requirementIds ?? []).includes(r.requirementId));
    if (claims.length === 0) findings.push(`requirement '${r.requirementId}' has no claim`);
  }
  for (const c of store.claims) {
    if ((c.checkIds ?? []).length === 0) findings.push(`claim '${c.claimId}' has no executable check`);
    for (const [field, kind] of /** @type {Array<[string, string]>} */ ([
      ['requirementIds', 'requirement'], ['authorityIds', 'authority'], ['evidenceIds', 'evidence'],
      ['fixtureIds', 'fixture'], ['comparatorIds', 'comparator'], ['checkIds', 'check'], ['conflictIds', 'conflict']
    ])) {
      for (const id of c[field] ?? []) {
        const hit = store.byId.get(id);
        if (!hit || hit.kind !== kind) findings.push(`claim '${c.claimId}' references missing ${kind} '${id}'`);
      }
    }
  }
  for (const e of store.evidence) {
    const used = store.claims.some((c) => (c.evidenceIds ?? []).includes(e.evidenceId));
    if (!used) findings.push(`evidence '${e.evidenceId}' is referenced by no claim`);
    if (e.evidenceClass === 'derived-evidence' && (e.rawAuthorityArtifactIds ?? []).length === 0) {
      findings.push(`derived evidence '${e.evidenceId}' lacks a raw-authority source reference`);
    }
  }
  for (const f of store.fixtures) {
    const used = store.claims.some((c) => (c.fixtureIds ?? []).includes(f.fixtureId));
    if (!used) findings.push(`fixture '${f.fixtureId}' is unused`);
    if ((f.discriminates ?? []).length === 0) findings.push(`behavioral fixture '${f.fixtureId}' has no discrimination entries`);
  }
  for (const cmp of store.comparators) {
    const used = store.fixtures.some((f) => f.comparatorId === cmp.comparatorId)
      || store.claims.some((c) => (c.comparatorIds ?? []).includes(cmp.comparatorId));
    if (!used) findings.push(`comparator '${cmp.comparatorId}' is unused`);
  }
  for (const chk of store.checks) {
    const claims = (chk.claimIds ?? []).map((/** @type {string} */ id) => store.byId.get(id)).filter((/** @type {any} */ h) => h?.kind === 'claim');
    if (claims.length === 0) findings.push(`check '${chk.checkId}' maps to no claim`);
  }
  for (const ev of store.evaluators) {
    const used = store.fixtures.some((f) => (f.discriminates ?? []).some((/** @type {any} */ d) => d.evaluatorId === ev.evaluatorId));
    if (!used) findings.push(`alternative evaluator '${ev.evaluatorId}' is unused`);
  }
  for (const sel of store.selectedProfiles?.selected ?? []) {
    const profile = store.profiles.find((p) => p.profileId === sel.profileId);
    if (!profile) {
      findings.push(`selected profile '${sel.profileId}' has no profile record at ${sel.path}`);
      continue;
    }
    const consumedByBinding = (store.binding?.selectedProfiles ?? []).some((/** @type {any} */ bp) => bp.profileId === sel.profileId);
    if (!consumedByBinding) findings.push(`selected profile '${sel.profileId}' is not consumed by the project binding`);
  }
  if (!store.binding) {
    findings.push('repository has no project verification binding');
  } else {
    for (const rc of store.binding.requirementClasses ?? []) {
      const matched = store.requirements.some((r) => !r.frameworkOnly &&
        (rc.match?.requirementIdPatterns ?? []).some((/** @type {string} */ p) => {
          const re = new RegExp('^' + p.split('*').map((/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
          return re.test(r.requirementId);
        }));
      if (!matched) findings.push(`binding requirement class '${rc.requirementClassId}' matches no registered requirement (mechanism with no consumer yet)`);
    }
  }
  for (const p of store.providersConfig?.providers ?? []) {
    const usedByCheck = store.checks.some((c) => c.providerId === p.providerId);
    const usedByBinding = (store.binding?.requirementClasses ?? []).some((/** @type {any} */ rc) => (rc.mandatoryProviders ?? []).includes(p.providerId));
    const usedByProfile = store.profiles.some((pr) => (pr.providersSuppliedOrRequired ?? []).some((/** @type {any} */ pp) => pp.providerId === p.providerId));
    if (!usedByCheck && !usedByBinding && !usedByProfile) findings.push(`provider '${p.providerId}' is configured but used by nothing`);
  }
  return findings;
}
