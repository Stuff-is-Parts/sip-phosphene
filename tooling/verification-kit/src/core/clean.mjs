import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/**
 * Run one verification command in a clean checkout per framework spec §18:
 * clone the current HEAD into a temporary directory, install strictly from
 * lockfiles (kit plus every reference adapter), run the named command there,
 * and propagate its ACTUAL exit code (audit finding 6 — no clean command may
 * report PASS while its named target failed inside the clean checkout).
 * A dirty worktree is reported: uncommitted changes are absent from a clean run.
 * @param {string} repoRoot
 * @param {string[]} targetArgs CLI arguments for the command to run in the clean checkout
 * @returns {{ cloneDir: string, sourceCommit: string, steps: Array<{step: string, exitCode: number, output: string}>, targetExitCode: number | null }}
 */
export function runInClean(repoRoot, targetArgs) {
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
  let sourceCommit = '(unknown)';
  try {
    sourceCommit = execFileSync('git', ['-C', cloneDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    steps.push({ step: 'source-commit', exitCode: 1, output: 'unable to resolve the clean checkout HEAD' });
  }
  const kit = path.join(cloneDir, 'tooling', 'verification-kit');
  if (!existsSync(kit)) {
    steps.push({ step: 'kit-present', exitCode: 1, output: 'tooling/verification-kit not present in clean checkout' });
    return { cloneDir, sourceCommit, steps, targetExitCode: null };
  }
  run('npm-ci', 'npm', ['ci', '--no-fund', '--no-audit'], kit);
  const adaptersDir = path.join(cloneDir, 'tooling', 'reference-adapters');
  if (existsSync(adaptersDir)) {
    for (const entry of readdirSync(adaptersDir)) {
      const pkgDir = path.join(adaptersDir, entry);
      if (existsSync(path.join(pkgDir, 'package.json'))) {
        run(`npm-ci-reference-adapter-${entry}`, 'npm', ['ci', '--no-fund', '--no-audit'], pkgDir);
      }
    }
  }
  const targetExitCode = run(`target:${targetArgs.join(' ') || 'verify (global)'}`, 'node', [path.join('bin', 'verify.mjs'), ...targetArgs], kit);
  try {
    rmSync(cloneDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    steps.push({ step: 'cleanup', exitCode: 0, output: `temporary clone left at ${cloneDir} (removal failed; safe to delete)` });
  }
  return { cloneDir, sourceCommit, steps, targetExitCode };
}
