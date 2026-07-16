import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { hostTree, abs } from './paths.mjs';
import { loadValidators, schemaErrors } from './schemas.mjs';

/**
 * @typedef {Object} Store
 * @property {string} repoRoot
 * @property {Record<string, string>} tree
 * @property {string[]} structuralErrors  Missing tree elements, unreadable JSON, schema violations, duplicate IDs.
 * @property {any} projectConfig
 * @property {any} providersConfig
 * @property {any} scope
 * @property {any} allowlist
 * @property {any} bootstrap
 * @property {any[]} witnesses
 * @property {any[]} attestations
 * @property {any[]} authorities
 * @property {any[]} conflicts
 * @property {any[]} requirements
 * @property {any[]} claims
 * @property {any[]} evidence
 * @property {any[]} fixtures
 * @property {any[]} comparators
 * @property {any[]} adapters
 * @property {any[]} checks
 * @property {any[]} evaluators
 * @property {any[]} inventories
 * @property {any[]} profiles
 * @property {any} selectedProfiles
 * @property {any} binding
 * @property {any} selfTestBinding
 * @property {Map<string, any>} byId
 * @property {string[]} referenceErrors
 */

/** @param {string} dirAbs @returns {string[]} */
function jsonFiles(dirAbs) {
  if (!existsSync(dirAbs)) return [];
  return readdirSync(dirAbs).filter((f) => f.endsWith('.json')).map((f) => `${dirAbs}/${f}`);
}

/**
 * @param {string} fileAbs
 * @param {string[]} errors
 * @returns {any}
 */
function readJson(fileAbs, errors) {
  try {
    return JSON.parse(readFileSync(fileAbs, 'utf8'));
  } catch (e) {
    errors.push(`unreadable JSON: ${fileAbs}: ${/** @type {Error} */ (e).message}`);
    return undefined;
  }
}

/**
 * Load and schema-validate the complete verification tree.
 * @param {string} repoRoot
 * @param {{ selfTestBindingPath?: string }} [opts]
 * @returns {Store}
 */
export function loadStore(repoRoot, opts = {}) {
  const tree = hostTree(repoRoot);
  const { validators } = loadValidators();
  /** @type {string[]} */
  const structuralErrors = [];

  /**
   * @param {string} relPath @param {string} schemaKey @param {boolean} required
   * @returns {any}
   */
  function loadOne(relPath, schemaKey, required) {
    const fileAbs = abs(repoRoot, relPath);
    if (!existsSync(fileAbs)) {
      if (required) structuralErrors.push(`missing required artifact: ${relPath}`);
      return undefined;
    }
    const data = readJson(fileAbs, structuralErrors);
    if (data === undefined) return undefined;
    for (const err of schemaErrors(validators[schemaKey], data)) {
      structuralErrors.push(`schema violation in ${relPath}: ${err}`);
    }
    return data;
  }

  /**
   * @param {string} dirRel @param {string} schemaKey @param {string[]} [excludeBasenames]
   * @returns {any[]}
   */
  function loadDir(dirRel, schemaKey, excludeBasenames = []) {
    /** @type {any[]} */
    const out = [];
    for (const fileAbs of jsonFiles(abs(repoRoot, dirRel))) {
      if (fileAbs.endsWith('.lock.json')) continue;
      if (excludeBasenames.some((b) => fileAbs.endsWith(`/${b}`))) continue;
      const data = readJson(fileAbs, structuralErrors);
      if (data === undefined) continue;
      for (const err of schemaErrors(validators[schemaKey], data)) {
        structuralErrors.push(`schema violation in ${fileAbs}: ${err}`);
      }
      out.push(data);
    }
    return out;
  }

  const projectConfig = loadOne(tree.projectConfig, 'project-config', true);
  const providersConfig = loadOne(tree.providersConfig, 'providers-config', true);
  const scope = loadOne(tree.scope, 'scope', true);
  const allowlist = loadOne(tree.allowlist, 'allowlist', true);
  const bootstrap = loadOne(tree.bootstrap, 'bootstrap', true);
  const witnesses = loadDir(tree.witnessesDir, 'witness');
  const attestations = loadDir(tree.attestationsDir, 'attestation');
  const authoritiesDoc = loadOne(tree.authorities, 'authority', true);
  const authorities = authoritiesDoc?.authorities ?? [];
  const conflicts = loadDir(tree.conflictsDir, 'conflict');
  const requirements = loadDir(tree.requirementsDir, 'requirement');
  const claims = loadDir(tree.claimsDir, 'claim');
  const evidence = loadDir(tree.evidenceDir, 'evidence');
  const fixtures = loadDir(tree.fixtureRecordsDir, 'fixture');
  const comparators = loadDir(tree.comparatorsDir, 'comparator');
  const adapters = loadDir(tree.adaptersDir, 'adapter');
  const checks = loadDir(tree.checksDir, 'check');
  const evaluators = loadDir(tree.evaluatorsDir, 'evaluator');
  const inventories = loadDir(tree.inventoryDir, 'inventory');
  const profiles = loadDir(tree.profilesDir, 'profile', ['selected.json']);
  const selectedProfiles = loadOne(tree.selectedProfiles, 'selected-profiles', true);
  const binding = loadOne(tree.binding, 'binding', false);

  let selfTestBinding;
  if (opts.selfTestBindingPath && existsSync(opts.selfTestBindingPath)) {
    selfTestBinding = readJson(opts.selfTestBindingPath, structuralErrors);
    if (selfTestBinding !== undefined) {
      for (const err of schemaErrors(validators['binding'], selfTestBinding)) {
        structuralErrors.push(`schema violation in self-test binding: ${err}`);
      }
    }
  }

  /** @type {Map<string, any>} */
  const byId = new Map();
  /** @type {string[]} */
  const referenceErrors = [];
  /** @param {string | undefined} id @param {any} record @param {string} kind */
  function index(id, record, kind) {
    if (!id) return;
    if (byId.has(id)) structuralErrors.push(`duplicate ID across records: ${id}`);
    byId.set(id, { kind, record });
  }
  for (const a of authorities) index(a.authorityId, a, 'authority');
  for (const c of conflicts) index(c.conflictId, c, 'conflict');
  for (const r of requirements) index(r.requirementId, r, 'requirement');
  for (const c of claims) index(c.claimId, c, 'claim');
  for (const e of evidence) index(e.evidenceId, e, 'evidence');
  for (const f of fixtures) index(f.fixtureId, f, 'fixture');
  for (const c of comparators) index(c.comparatorId, c, 'comparator');
  for (const a of adapters) index(a.adapterId, a, 'adapter');
  for (const c of checks) index(c.checkId, c, 'check');
  for (const e of evaluators) index(e.evaluatorId, e, 'evaluator');
  for (const i of inventories) index(i.procedureId, i, 'inventory');
  for (const p of profiles) index(p.profileId, p, 'profile');
  for (const w of witnesses) index(w.witnessId, w, 'witness');
  for (const a of attestations) index(a.attestationId, a, 'attestation');

  return {
    repoRoot, tree, structuralErrors,
    projectConfig, providersConfig, scope, allowlist, bootstrap,
    witnesses, attestations, authorities, conflicts,
    requirements, claims, evidence, fixtures, comparators,
    adapters, checks, evaluators, inventories, profiles,
    selectedProfiles, binding, selfTestBinding,
    byId, referenceErrors
  };
}

/**
 * Resolve an ID that must exist with the given kind; records the failure otherwise.
 * @param {Store} store @param {string} id @param {string} kind @param {string} context
 * @returns {any | undefined}
 */
export function resolveId(store, id, kind, context) {
  const hit = store.byId.get(id);
  if (!hit || hit.kind !== kind) {
    store.referenceErrors.push(`${context}: unresolved ${kind} reference '${id}'`);
    return undefined;
  }
  return hit.record;
}
