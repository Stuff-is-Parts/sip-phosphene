import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/**
 * Black-box execution of the public CLI in fixture repositories per framework
 * spec §24/§27. Every scenario spawns bin/verify.mjs as a child process — the
 * public command boundary — and inspects observable outputs only.
 * @param {string} kitDir absolute path to tooling/verification-kit
 * @returns {Array<{ scenario: string, ok: boolean, detail: string }>}
 */
export function runFixtureRepoScenarios(kitDir) {
  /** @type {Array<{ scenario: string, ok: boolean, detail: string }>} */
  const results = [];
  const binPath = path.join(kitDir, 'bin', 'verify.mjs');

  /** @param {string} cwd @param {string[]} args @returns {{ exitCode: number, stdout: string }} */
  function spawnCli(cwd, args) {
    try {
      const stdout = execFileSync('node', [binPath, ...args], { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      return { exitCode: 0, stdout };
    } catch (e) {
      const err = /** @type {any} */ (e);
      return { exitCode: err.status ?? 1, stdout: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  }

  /** @param {string} prefix @returns {string} */
  function tempRepo(prefix) {
    const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
    execFileSync('git', ['init', '--quiet', dir], { encoding: 'utf8' });
    return dir;
  }

  const emptyRepo = tempRepo('verify-selftest-empty-');
  try {
    const first = spawnCli(emptyRepo, ['init']);
    const firstReport = latestReport(emptyRepo, 'init');
    const second = spawnCli(emptyRepo, ['init']);
    const secondReport = latestReport(emptyRepo, 'init');
    const firstCreatedTree = first.exitCode === 0 && firstReport && firstReport.created.length > 0;
    const idempotent = second.exitCode === 0 && secondReport && secondReport.created.length === 0;
    results.push({
      scenario: 'init-empty-git-repo',
      ok: Boolean(firstCreatedTree),
      detail: firstCreatedTree ? `created ${firstReport.created.length} paths, refused ${firstReport.refused.length} (scope and binding are user-authored)` : `first init failed: ${first.stdout.slice(0, 300)}`
    });
    results.push({
      scenario: 'init-idempotence',
      ok: Boolean(idempotent),
      detail: idempotent ? 'second init created nothing and preserved everything' : `second init not idempotent: ${JSON.stringify(secondReport?.created ?? 'no report')}`
    });
  } finally {
    rmSync(emptyRepo, { recursive: true, force: true, maxRetries: 3 });
  }

  const nonNodeRepo = tempRepo('verify-selftest-nonnode-');
  try {
    writeFileSync(path.join(nonNodeRepo, 'main.py'), 'print("host product in another language")\n');
    const init = spawnCli(nonNodeRepo, ['init']);
    const preserved = readFileSync(path.join(nonNodeRepo, 'main.py'), 'utf8').includes('another language');
    const scopeRun = spawnCli(nonNodeRepo, ['scope']);
    const scopeReport = latestReport(nonNodeRepo, 'scope');
    const honestFail = scopeRun.exitCode !== 0 && scopeReport && scopeReport.result === 'FAIL';
    results.push({
      scenario: 'init-non-node-host-repo',
      ok: init.exitCode === 0 && preserved,
      detail: init.exitCode === 0 && preserved ? 'initialized without assuming host language; unrelated files preserved' : `init failed or damaged host files (exit ${init.exitCode})`
    });
    results.push({
      scenario: 'missing-scope-fails-loudly',
      ok: Boolean(honestFail),
      detail: honestFail ? 'scope command fails with a structured FAIL report when the user-authored scope is absent' : `expected FAIL with report, got exit ${scopeRun.exitCode}`
    });
  } finally {
    rmSync(nonNodeRepo, { recursive: true, force: true, maxRetries: 3 });
  }

  return results;
}

/** @param {string} repoDir @param {string} command @returns {any | undefined} */
function latestReport(repoDir, command) {
  const reportsDir = path.join(repoDir, 'verification', 'reports');
  if (!existsSync(reportsDir)) return undefined;
  const latest = path.join(reportsDir, `latest-${command}.json`);
  if (!existsSync(latest)) return undefined;
  try {
    return JSON.parse(readFileSync(latest, 'utf8'));
  } catch {
    return undefined;
  }
}

/** @param {string} repoDir @returns {string[]} */
export function listReports(repoDir) {
  const reportsDir = path.join(repoDir, 'verification', 'reports');
  if (!existsSync(reportsDir)) return [];
  return readdirSync(reportsDir);
}
