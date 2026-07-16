#!/usr/bin/env node
// Mechanical inventory extraction for the MilkDrop operator-only expression
// claim (binding procedure INV-MILK-EXPR-STATEMENTS): enumerates every
// statement of the fixture program and emits stable inventory IDs with a
// content hash. Run from anywhere inside the repository:
//   node tooling/reference-adapters/milkdrop-eel/extract-inventory.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('no .git found');
    dir = parent;
  }
}

function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortValue(v[k]);
    return o;
  }
  return v;
}

const repoRoot = findRepoRoot(process.cwd());
const inputRel = 'verification/fixtures/inputs/FIX-MILK-EXPR-OPERATORS.input.json';
const outputRel = 'verification/inventory/INV-MILK-EXPR-STATEMENTS.json';

const input = JSON.parse(readFileSync(path.join(repoRoot, ...inputRel.split('/')), 'utf8'));
const statements = input.program.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
const items = statements.map((stmt, i) => ({
  inventoryItemId: `STMT-${i}`,
  behavior: `EEL statement: ${stmt}`,
  sourceLocation: `${inputRel} program statement index ${i}`
}));

const inventory = {
  procedureId: 'INV-MILK-EXPR-STATEMENTS',
  source: `${inputRel} (program statements)`,
  commandOrProvider: 'node tooling/reference-adapters/milkdrop-eel/extract-inventory.mjs',
  extractionToolVersion: `node ${process.version}`,
  extractedAt: new Date().toISOString(),
  outputHash: 'sha256:' + createHash('sha256').update(JSON.stringify(sortValue(items))).digest('hex'),
  mechanicallyComplete: true,
  residualCompletenessWitnessId: null,
  items
};

const outAbs = path.join(repoRoot, ...outputRel.split('/'));
mkdirSync(path.dirname(outAbs), { recursive: true });
writeFileSync(outAbs, JSON.stringify(inventory, null, 2) + '\n');
process.stdout.write(`extracted ${items.length} inventory items → ${outputRel}\n`);
