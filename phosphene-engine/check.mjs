// THE CHECK. The engine runs 101-per_frame.milk. Its per-frame equation is
// ib_r = 0.7 + 0.4*sin(3*time). We independently compute the expected ib_r at
// several times (the REFERENCE, from the preset's own math) and confirm the
// engine's pool matches. Also confirms static vars imported correctly.
// A mutant (wrong coefficient) must be rejected.
import { readFileSync } from 'node:fs';
import { importMilk } from './src/milk-import.mjs';
import { Engine } from './src/engine.mjs';

const text = readFileSync(new URL('./101-per_frame.milk', import.meta.url), 'utf8');
const scene = importMilk(text);

// --- REFERENCE: the preset defines ib_r = 0.7 + 0.4*sin(3*time) ---
const refIbR = (t) => 0.7 + 0.4 * Math.sin(3 * t);

const eng = new Engine(scene);
const EPS = 1e-12;
let maxDiff = 0;
const dt = 1 / 60;
let t = 0;
const samples = [];
for (let i = 0; i < 600; i++) {          // 10 seconds
  const st = eng.step(dt);
  t += dt;
  const expected = refIbR(eng.pool.time); // engine's own time, exact
  const got = st.innerBox.r;
  maxDiff = Math.max(maxDiff, Math.abs(expected - got));
  if (i % 120 === 0) samples.push({ t: +eng.pool.time.toFixed(3), expected: +expected.toFixed(6), got: +got.toFixed(6) });
}

// static import checks (defaults must survive)
const importOk =
  scene.vars.fDecay === 0.98 && scene.vars.ib_size === 0.1 &&
  scene.vars.ib_b === 0.0 && scene.vars.ob_size === 0.2 &&
  scene.expressions.perFrame.length === 1;

// mutant: engine with a corrupted equation must DIVERGE from reference
const mutantScene = importMilk(text.replace('0.4*sin(3*time)', '0.4*sin(4*time)'));
const meng = new Engine(mutantScene);
let mutDiff = 0;
for (let i = 0; i < 600; i++) { const st = meng.step(dt); mutDiff = Math.max(mutDiff, Math.abs(refIbR(meng.pool.time) - st.innerBox.r)); }

const subjectOk = maxDiff <= EPS;
const mutantRejected = mutDiff > EPS;
const pass = importOk && subjectOk && mutantRejected;

console.log('=== PHOSPHENE engine — 101-per_frame.milk ===');
console.log('import (defaults + 1 per-frame eq):', importOk ? 'OK' : 'FAIL');
console.log('samples (ib_r = 0.7+0.4*sin(3t)):');
for (const s of samples) console.log(`  t=${s.t}s  expected=${s.expected}  engine=${s.got}`);
console.log(`per-frame execution max divergence from reference: ${maxDiff}`);
console.log(`mutant (sin(4t)) rejected: ${mutantRejected} (Δ=${mutDiff.toExponential(2)})`);
console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);
