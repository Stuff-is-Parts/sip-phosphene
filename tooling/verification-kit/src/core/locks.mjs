import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { abs, rel } from './paths.mjs';
import { hashFile } from './hash.mjs';
import { repoState } from './git.mjs';

/**
 * The lock surfaces per framework spec §8. Each entry lists the repo-relative
 * files or directories (recursive) the lock covers; the lock file itself is excluded.
 * @param {Record<string, string>} tree
 * @returns {Record<string, { lockPath: string, covers: string[] }>}
 */
export function lockSurfaces(tree) {
  return {
    scope: { lockPath: tree.scopeLock, covers: ['verification/scope'] },
    authorization: {
      lockPath: tree.authorizationLock,
      covers: [tree.allowlist, tree.bootstrap, tree.witnessesDir, tree.attestationsDir]
    },
    'framework-conformance': { lockPath: tree.frameworkConformanceLock, covers: [tree.frameworkConformanceDir] },
    profiles: { lockPath: tree.profilesLock, covers: [tree.profilesDir] },
    binding: { lockPath: tree.bindingLock, covers: [tree.binding] },
    authorities: { lockPath: tree.authoritiesLock, covers: [tree.authorities, tree.conflictsDir, tree.rawDir] },
    evidence: { lockPath: tree.evidenceLock, covers: [tree.evidenceDir] },
    fixtures: { lockPath: tree.fixturesLock, covers: [tree.fixturesDir] },
    comparators: { lockPath: tree.comparatorsLock, covers: [tree.comparatorsDir] }
  };
}

/**
 * Enumerate all files under the covered paths, excluding lock files themselves.
 * @param {string} repoRoot @param {string[]} covers
 * @returns {string[]} repo-relative file paths, sorted
 */
export function enumerateCovered(repoRoot, covers) {
  /** @type {string[]} */
  const files = [];
  /** @param {string} absPath */
  function walk(absPath) {
    if (!existsSync(absPath)) return;
    const st = statSync(absPath);
    if (st.isFile()) {
      if (!absPath.endsWith('.lock.json')) files.push(rel(repoRoot, absPath));
      return;
    }
    for (const entry of readdirSync(absPath)) walk(path.join(absPath, entry));
  }
  for (const c of covers) walk(abs(repoRoot, c));
  return files.sort();
}

/**
 * Verify one lock: every covered file present with matching hash, no uncovered files, no missing files.
 * @param {string} repoRoot
 * @param {{ lockPath: string, covers: string[] }} surface
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function verifyLock(repoRoot, surface) {
  /** @type {string[]} */
  const problems = [];
  const lockAbs = abs(repoRoot, surface.lockPath);
  if (!existsSync(lockAbs)) return { ok: false, problems: [`lock missing: ${surface.lockPath}`] };
  /** @type {any} */
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockAbs, 'utf8'));
  } catch (e) {
    return { ok: false, problems: [`lock unreadable: ${surface.lockPath}: ${/** @type {Error} */ (e).message}`] };
  }
  const current = enumerateCovered(repoRoot, surface.covers);
  const locked = new Map((lock.covers ?? []).map((/** @type {any} */ c) => [c.path, c]));
  for (const filePath of current) {
    const entry = locked.get(filePath);
    if (!entry) {
      problems.push(`artifact not covered by lock (changed without lock update): ${filePath}`);
      continue;
    }
    const { sha256, bytes } = hashFile(abs(repoRoot, filePath));
    if (entry.sha256 !== sha256 || entry.bytes !== bytes) {
      problems.push(`stale hash: ${filePath} (locked ${entry.sha256.slice(0, 12)}…, current ${sha256.slice(0, 12)}…)`);
    }
    locked.delete(filePath);
  }
  for (const missingPath of locked.keys()) {
    problems.push(`locked artifact missing from worktree: ${missingPath}`);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Update one lock. Updates lock metadata only; never rewrites covered content.
 * @param {string} repoRoot
 * @param {string} lockId
 * @param {{ lockPath: string, covers: string[] }} surface
 * @param {string} reason
 * @param {string} command
 * @param {string | null} authorizationWitnessId
 * @returns {{ changes: Array<{path: string, kind: string, oldSha256: string | null, newSha256: string | null}> }}
 */
export function updateLock(repoRoot, lockId, surface, reason, command, authorizationWitnessId) {
  const lockAbs = abs(repoRoot, surface.lockPath);
  /** @type {Map<string, any>} */
  let previous = new Map();
  if (existsSync(lockAbs)) {
    try {
      const prior = JSON.parse(readFileSync(lockAbs, 'utf8'));
      previous = new Map((prior.covers ?? []).map((/** @type {any} */ c) => [c.path, c]));
    } catch {
      previous = new Map();
    }
  }
  const current = enumerateCovered(repoRoot, surface.covers);
  /** @type {Array<{path: string, sha256: string, bytes: number}>} */
  const covers = [];
  /** @type {Array<{path: string, kind: string, oldSha256: string | null, newSha256: string | null}>} */
  const changes = [];
  for (const filePath of current) {
    const { sha256, bytes } = hashFile(abs(repoRoot, filePath));
    covers.push({ path: filePath, sha256, bytes });
    const prior = previous.get(filePath);
    if (!prior) changes.push({ path: filePath, kind: 'added', oldSha256: null, newSha256: sha256 });
    else if (prior.sha256 !== sha256) changes.push({ path: filePath, kind: 'changed', oldSha256: prior.sha256, newSha256: sha256 });
    previous.delete(filePath);
  }
  for (const [removedPath, prior] of previous) {
    changes.push({ path: removedPath, kind: 'removed', oldSha256: prior.sha256, newSha256: null });
  }
  const { commit, dirtyWorktree } = repoState(repoRoot);
  const lock = {
    lockId,
    covers,
    meta: {
      reason, command,
      time: new Date().toISOString(),
      commit, dirtyWorktree,
      authorizationWitnessId,
      changes
    }
  };
  mkdirSync(path.dirname(lockAbs), { recursive: true });
  writeFileSync(lockAbs, JSON.stringify(lock, null, 2) + '\n');
  return { changes };
}
