#!/usr/bin/env node
// Mechanical inventory extraction for the framework self-test (spec §7.12):
// enumerates every CRC operation in the fixture input file and emits stable
// inventory IDs with a content hash. Run from anywhere inside the repository:
//   node tooling/verification-kit/src/self-test/extract-inventory.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { findRepoRoot, abs } from '../core/paths.mjs';
import { canonicalJsonHash } from '../core/hash.mjs';

const repoRoot = findRepoRoot(process.cwd());
const inputRel = 'verification/fixtures/inputs/FIX-SELFTEST-CRC32.input.json';
const outputRel = 'verification/inventory/INV-SELFTEST-CRC-OPERATIONS.json';

const input = JSON.parse(readFileSync(abs(repoRoot, inputRel), 'utf8'));
const items = input.operations.map((/** @type {any} */ op, /** @type {number} */ i) => ({
  inventoryItemId: `OP-${i}`,
  behavior: `chunked CRC-32 over ${op.chunksBase64.length} chunk(s), operation index ${i}`,
  sourceLocation: `${inputRel} operations[${i}]`
}));

const inventory = {
  procedureId: 'INV-SELFTEST-CRC-OPERATIONS',
  source: inputRel,
  commandOrProvider: 'node tooling/verification-kit/src/self-test/extract-inventory.mjs',
  extractionToolVersion: `node ${process.version}`,
  extractedAt: new Date().toISOString(),
  outputHash: canonicalJsonHash(items),
  mechanicallyComplete: true,
  residualCompletenessWitnessId: null,
  items
};

const outAbs = abs(repoRoot, outputRel);
mkdirSync(path.dirname(outAbs), { recursive: true });
writeFileSync(outAbs, JSON.stringify(inventory, null, 2) + '\n');
process.stdout.write(`extracted ${items.length} inventory items → ${outputRel}\n`);
