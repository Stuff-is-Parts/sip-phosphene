import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hostTree, abs } from './paths.mjs';
import { git } from './git.mjs';

/**
 * Initialize the host verification tree per framework spec §6: create only
 * absent framework artifacts, preserve everything else, refuse ambiguous edits,
 * stay idempotent, and report every created, preserved, and refused path.
 * @param {string} repoRoot
 * @returns {{ created: string[], preserved: string[], refused: Array<{path: string, reason: string}> }}
 */
export function initialize(repoRoot) {
  const tree = hostTree(repoRoot);
  /** @type {string[]} */
  const created = [];
  /** @type {string[]} */
  const preserved = [];
  /** @type {Array<{path: string, reason: string}>} */
  const refused = [];

  const dirs = [
    tree.config, 'verification/scope', tree.authorizationDir, tree.witnessesDir, tree.attestationsDir,
    'verification/authorities', tree.rawDir, tree.conflictsDir,
    tree.requirementsDir, tree.claimsDir, tree.evidenceDir, tree.evidenceDerivedDir,
    tree.fixtureInputsDir, tree.fixtureExpectedDir, tree.fixtureRecordsDir,
    tree.comparatorsDir, tree.adaptersDir, tree.checksDir, tree.evaluatorsDir,
    tree.inventoryDir, tree.profilesDir, tree.profileOverridesDir, 'verification/binding', tree.reportsDir
  ];
  for (const d of dirs) {
    const dirAbs = abs(repoRoot, d);
    if (existsSync(dirAbs)) {
      preserved.push(d);
    } else {
      mkdirSync(dirAbs, { recursive: true });
      created.push(d);
    }
  }

  /** @param {string} relPath @param {unknown} content */
  function createIfAbsent(relPath, content) {
    const fileAbs = abs(repoRoot, relPath);
    if (existsSync(fileAbs)) {
      preserved.push(relPath);
      return;
    }
    writeFileSync(fileAbs, JSON.stringify(content, null, 2) + '\n');
    created.push(relPath);
  }

  const remote = git(repoRoot, ['remote', 'get-url', 'origin']);
  const repositoryIdentity = remote.ok
    ? remote.stdout.trim().replace(/\.git$/, '').replace(/^.*[:/]([^/]+\/[^/]+)$/, '$1')
    : 'UNSET (no origin remote; set verification/config/project.json repositoryIdentity)';

  createIfAbsent(tree.projectConfig, {
    projectName: path.basename(repoRoot),
    repositoryIdentity,
    kitPath: 'tooling/verification-kit'
  });
  createIfAbsent(tree.providersConfig, { providers: [] });
  createIfAbsent(tree.allowlist, { identities: [] });
  createIfAbsent(tree.bootstrap, {
    status: 'pending',
    repositoryIdentity,
    requiredExternalActions: [
      'Repository administrator: add your GitHub account login to verification/authorization/authorized-identities.json through a repository-administration action you control (not through the producing agent).',
      'Repository administrator: record the establishing mechanism, actor, time, and verification method in this bootstrap record and set status to established.',
      'Repository administrator: configure branch protection so changes to verification/authorization/** and verification/binding/** require your review (see .github/BRANCH-PROTECTION.md).'
    ]
  });
  createIfAbsent(tree.authorities, { authorities: [] });
  createIfAbsent(tree.selectedProfiles, { selected: [] });

  const scopeAbs = abs(repoRoot, tree.scope);
  if (existsSync(scopeAbs)) {
    preserved.push(tree.scope);
  } else {
    refused.push({
      path: tree.scope,
      reason: 'scope is user-defined; the initializer must not invent approved scope items. Author verification/scope/scope.json from the user-authored scope text, then lock it with: verify scope-lock --reason "initial scope"'
    });
  }
  const bindingAbs = abs(repoRoot, tree.binding);
  if (existsSync(bindingAbs)) {
    preserved.push(tree.binding);
  } else {
    refused.push({
      path: tree.binding,
      reason: 'the project verification binding is repository-specific and requires an authenticated adequacy witness; the initializer must not fabricate it. Author it from the user-authored oracle and inventory policies.'
    });
  }

  return { created, preserved, refused };
}
