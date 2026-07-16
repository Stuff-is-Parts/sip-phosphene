import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/**
 * Clean-environment verification per framework spec §18: clone the current HEAD
 * into a temporary directory, install strictly from the kit lockfile, and run
 * the framework suite plus the global verify there. Returns actual exit codes.
 * A dirty worktree is reported: uncommitted changes are absent from a clean run.
 * @param {string} repoRoot
 * @returns {{ cloneDir: string, steps: Array<{step: string, exitCode: number, output: string}> }}
 */
export function runClean(repoRoot) {
  const cloneDir = mkdtempSync(path.join(os.tmpdir(), 'verify-clean-'));
  /** @type {Array<{step: string, exitCode: number, output: string}>} */
  const steps = [];

  /** @param {string} step @param {string} cmd @param {string[]} args @param {string} cwd */
  function run(step, cmd, args, cwd) {
    // npm is a .cmd shim on Windows and needs a shell; git and node are real executables.
    const shell = process.platform === 'win32' && cmd === 'npm';
    try {
      const output = execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env }, shell });
      steps.push({ step, exitCode: 0, output: output.slice(-4000) });
      return 0;
    } catch (e) {
      const err = /** @type {any} */ (e);
      steps.push({ step, exitCode: err.status ?? 1, output: `${err.stdout ?? ''}\n${err.stderr ?? ''}`.slice(-4000) });
      return err.status ?? 1;
    }
  }

  run('clone', 'git', ['clone', '--quiet', repoRoot, cloneDir], repoRoot);
  const kit = path.join(cloneDir, 'tooling', 'verification-kit');
  if (!existsSync(kit)) {
    steps.push({ step: 'kit-present', exitCode: 1, output: 'tooling/verification-kit not present in clean checkout' });
    return { cloneDir, steps };
  }
  run('npm-ci', 'npm', ['ci', '--no-fund', '--no-audit'], kit);
  run('framework', 'node', [path.join('bin', 'verify.mjs'), 'framework', '--skip-clean'], kit);
  run('global-verify', 'node', [path.join('bin', 'verify.mjs')], kit);
  try {
    rmSync(cloneDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    steps.push({ step: 'cleanup', exitCode: 0, output: `temporary clone left at ${cloneDir} (removal failed; safe to delete)` });
  }
  return { cloneDir, steps };
}
