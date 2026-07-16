import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abs } from './paths.mjs';
import { repoState } from './git.mjs';

/**
 * Write a structured JSON report per framework spec §20 and return its path.
 * A report proves that a command ran and produced the recorded result; it does
 * not independently establish that expected values were substantively correct.
 * @param {import('./store.mjs').Store | { repoRoot: string, tree: Record<string,string> }} store
 * @param {string} command
 * @param {Record<string, unknown>} payload
 * @returns {string} repo-relative report path
 */
export function writeReport(store, command, payload) {
  const { commit, dirtyWorktree } = repoState(store.repoRoot);
  const report = {
    command,
    repositoryCommit: commit,
    dirtyWorktree,
    operatingSystem: `${os.platform()} ${os.release()}`,
    nodeVersion: process.version,
    time: new Date().toISOString(),
    ...payload
  };
  const dirAbs = abs(store.repoRoot, store.tree.reportsDir);
  mkdirSync(dirAbs, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${command.replace(/[^a-z0-9-]/gi, '_')}-${stamp}.json`;
  writeFileSync(path.join(dirAbs, name), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(path.join(dirAbs, `latest-${command.replace(/[^a-z0-9-]/gi, '_')}.json`), JSON.stringify(report, null, 2) + '\n');
  return `${store.tree.reportsDir}/${name}`;
}
