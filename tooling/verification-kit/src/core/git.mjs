import { execFileSync } from 'node:child_process';

/**
 * @param {string} repoRoot @param {string[]} args
 * @returns {{ ok: true, stdout: string } | { ok: false, error: string }}
 */
export function git(repoRoot, args) {
  try {
    const stdout = execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, error: /** @type {Error} */ (e).message };
  }
}

/** @param {string} repoRoot @returns {{ commit: string, dirtyWorktree: boolean }} */
export function repoState(repoRoot) {
  const head = git(repoRoot, ['rev-parse', 'HEAD']);
  const status = git(repoRoot, ['status', '--porcelain']);
  return {
    commit: head.ok ? head.stdout.trim() : '(no commits)',
    dirtyWorktree: status.ok ? status.stdout.trim().length > 0 : true
  };
}

/**
 * Read a file's content at a specific revision.
 * @param {string} repoRoot @param {string} ref @param {string} relPath
 * @returns {string | undefined}
 */
export function showAt(repoRoot, ref, relPath) {
  const r = git(repoRoot, ['show', `${ref}:${relPath}`]);
  return r.ok ? r.stdout : undefined;
}
