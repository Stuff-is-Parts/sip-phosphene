// Gate step "syntax": node --check every engine module. Pure node, so the
// step runs identically under Windows cmd and CI's bash with no shell
// configuration (the previous POSIX for-loop needed a bash script-shell,
// and the .npmrc that provided one on Windows broke every CI run).
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const files = [
  ...readdirSync('phosphene-engine/src').filter((f) => f.endsWith('.mjs')).map((f) => `phosphene-engine/src/${f}`),
  ...readdirSync('phosphene-engine/src/audio').filter((f) => f.endsWith('.mjs') || f.endsWith('.js')).map((f) => `phosphene-engine/src/audio/${f}`),
  'phosphene-engine/check.mjs',
];
for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
console.log(`syntax OK (${files.length} files)`);
