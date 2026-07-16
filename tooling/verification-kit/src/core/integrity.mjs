import { canonicalJsonHash } from './hash.mjs';
import { git, showAt } from './git.mjs';

/** @param {string} repoRoot @param {string} ref @param {string} relPath @returns {any | undefined} */
function jsonAt(repoRoot, ref, relPath) {
  const text = showAt(repoRoot, ref, relPath);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** @param {string} repoRoot @param {string} ref @param {string} dirRel @returns {string[]} */
function filesAt(repoRoot, ref, dirRel) {
  const r = git(repoRoot, ['ls-tree', '-r', '--name-only', ref, '--', dirRel]);
  if (!r.ok) return [];
  return r.stdout.split('\n').map((s) => s.trim()).filter((s) => s.endsWith('.json') && !s.endsWith('.lock.json'));
}

/**
 * Merge-integrity comparison per framework spec §19. Compares base and head and
 * fails on concealment, weakening, unauthorized regression, and trust-root
 * mutation. Makes no claim that the project is complete or healthy.
 * @param {string} repoRoot @param {string} base @param {string} head
 * @returns {{ failures: Array<{code: string, detail: string}>, notes: string[] }}
 */
export function changeIntegrity(repoRoot, base, head) {
  /** @type {Array<{code: string, detail: string}>} */
  const failures = [];
  /** @type {string[]} */
  const notes = [];

  const baseAllow = jsonAt(repoRoot, base, 'verification/authorization/authorized-identities.json');
  const headAllow = jsonAt(repoRoot, head, 'verification/authorization/authorized-identities.json');
  const baseBootstrap = jsonAt(repoRoot, base, 'verification/authorization/bootstrap-record.json');
  const headBootstrap = jsonAt(repoRoot, head, 'verification/authorization/bootstrap-record.json');

  const allowChanged = JSON.stringify(baseAllow) !== JSON.stringify(headAllow);
  const bootstrapChanged = JSON.stringify(baseBootstrap) !== JSON.stringify(headBootstrap);
  if (allowChanged || bootstrapChanged) {
    if (baseAllow === undefined && baseBootstrap === undefined) {
      notes.push('identity allowlist and bootstrap record are new at head (no base trust root existed); initial bootstrap must still be established by repository administration, not by this change');
    } else {
      const baseIdentities = (baseAllow?.identities ?? []).map((/** @type {any} */ i) => i.value);
      const headWitnessFiles = filesAt(repoRoot, head, 'verification/authorization/witnesses');
      const authorized = headWitnessFiles.some((f) => {
        const w = jsonAt(repoRoot, head, f);
        return w?.authorizationType === 'allowlist-change' && baseIdentities.includes(w.authorizingIdentity);
      });
      if (!authorized) {
        failures.push({
          code: 'IDENTITY_ALLOWLIST_CHANGE_UNAUTHORIZED',
          detail: 'identity allowlist or bootstrap record changed without an allowlist-change witness from an identity in the BASE revision allowlist or a repository-administration event'
        });
      } else {
        notes.push('allowlist/bootstrap change carries a base-allowlist-identity witness; live authentication of that witness is the authorization-live-verification job’s responsibility');
      }
    }
  }

  const baseScope = jsonAt(repoRoot, base, 'verification/scope/scope.json');
  const headScope = jsonAt(repoRoot, head, 'verification/scope/scope.json');
  if (baseScope !== undefined && JSON.stringify(baseScope) !== JSON.stringify(headScope)) {
    if (headScope === undefined) {
      failures.push({ code: 'SCOPE_APPROVAL_MISSING', detail: 'approved scope record removed without authenticated scope authorization' });
    } else if (baseScope.authorizationWitnessId === headScope.authorizationWitnessId) {
      failures.push({ code: 'AUTHORIZATION_WITNESS_MISSING', detail: 'scope record changed without a new scope-change authorization witness' });
    }
    const baseItems = (baseScope.approvedScopeItems ?? []).map((/** @type {any} */ s) => s.scopeItemId);
    const headItems = new Set((headScope?.approvedScopeItems ?? []).map((/** @type {any} */ s) => s.scopeItemId));
    for (const id of baseItems) {
      if (!headItems.has(id)) {
        failures.push({ code: 'SCOPE_APPROVAL_MISSING', detail: `approved scope item '${id}' removed at head; scope reduction requires an authenticated scope-change witness` });
      }
    }
  }

  const baseBinding = jsonAt(repoRoot, base, 'verification/binding/project-verification-binding.json');
  const headBinding = jsonAt(repoRoot, head, 'verification/binding/project-verification-binding.json');
  if (baseBinding !== undefined) {
    if (headBinding === undefined) {
      failures.push({ code: 'PROJECT_BINDING_MISSING', detail: 'project verification binding removed at head' });
    } else {
      const baseAdopted = baseBinding.bindingAuthorization?.adoptionOrChangeWitnessId != null;
      const contentChanged = canonicalJsonHash(baseBinding) !== canonicalJsonHash(headBinding);
      if (contentChanged && baseAdopted &&
        headBinding.bindingAuthorization?.adoptionOrChangeWitnessId === baseBinding.bindingAuthorization?.adoptionOrChangeWitnessId) {
        failures.push({ code: 'AUTHORIZATION_WITNESS_MISSING', detail: 'an adopted project binding changed without a new adoption/change witness' });
      }
      for (const baseClass of baseBinding.requirementClasses ?? []) {
        const headClass = (headBinding.requirementClasses ?? []).find((/** @type {any} */ rc) => rc.requirementClassId === baseClass.requirementClassId);
        if (!headClass) {
          failures.push({ code: 'PROJECT_UNDERBOUND', detail: `binding requirement class '${baseClass.requirementClassId}' removed at head without authenticated authorization` });
          continue;
        }
        const baseAlts = new Set((baseClass.mandatoryPlausibleAlternativeClasses ?? []).map((/** @type {any} */ a) => a.alternativeId));
        const headAlts = new Set((headClass.mandatoryPlausibleAlternativeClasses ?? []).map((/** @type {any} */ a) => a.alternativeId));
        for (const alt of baseAlts) {
          if (!headAlts.has(alt)) {
            failures.push({ code: 'ALTERNATIVE_SET_UNDERBOUND', detail: `head narrows binding class '${baseClass.requirementClassId}': required alternative '${alt}' removed` });
          }
        }
      }
    }
  }

  for (const dir of ['verification/requirements', 'verification/claims', 'verification/checks', 'verification/evaluators', 'verification/fixtures/records']) {
    const baseFiles = filesAt(repoRoot, base, dir);
    const headFiles = new Set(filesAt(repoRoot, head, dir));
    for (const f of baseFiles) {
      if (!headFiles.has(f)) {
        failures.push({ code: 'REGRESSION_UNAUTHORIZED', detail: `verification artifact removed at head without authenticated authorization: ${f}` });
      }
    }
  }

  for (const f of filesAt(repoRoot, base, 'verification/comparators')) {
    const baseCmp = jsonAt(repoRoot, base, f);
    const headCmp = jsonAt(repoRoot, head, f);
    if (baseCmp && headCmp) {
      const widened =
        (baseCmp.equalityMode === 'exact' && headCmp.equalityMode === 'toleranced') ||
        (baseCmp.equalityMode === 'toleranced' && headCmp.equalityMode === 'toleranced' && (headCmp.tolerance ?? 0) > (baseCmp.tolerance ?? 0));
      if (widened) {
        failures.push({ code: 'COMPARATOR_UNJUSTIFIED', detail: `comparator widened at head without independent evidence path: ${f} (a tolerance may not be widened because CI failed)` });
      }
    }
  }

  notes.push('result-level regression comparison (base PASS becoming head FAIL) is computed by the CI change-integrity job, which runs the engine at head; a base PASS at an earlier commit is recoverable from that commit’s retained CI reports');
  return { failures, notes };
}
