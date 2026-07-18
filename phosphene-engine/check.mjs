// THE CHECK — with an HONEST statement of what it does and does not establish.
// This runs the engine on 101-per_frame.milk and compares ib_r against
// 0.7 + 0.4*sin(3*time). LIMIT (per external review): this is NOT an
// independent oracle — both sides use JS Math.sin (the subject routes sin ->
// eelSubject.sin -> Math.sin), and the expected value reuses the engine's own
// time. It therefore verifies: (a) the import parsed vars + the equation, (b)
// the assignment/compile path runs, (c) a changed COEFFICIENT is detectable.
// It does NOT validate MilkDrop's sin/time SEMANTICS against an external
// reference — that needs butterchurn or retained projectM runtime output, which
// is pending. Do not read a PASS here as "MilkDrop-semantics-correct".
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { importMilk, scanMilk } from './src/milk-import.mjs';
import { scanP9, assessP9Records, p9ToPhos } from './src/p9-import.mjs';
import { Engine, d3dColor01 } from './src/engine.mjs';
import { GRID_X, GRID_Y, VERT_COUNT, buildStripIndices, buildWarpUVs, meshPositions } from './src/warp-mesh.mjs';
import { parsePhos, serializePhos, toRuntime, milkToPhos, updateScene, assessRecords } from './src/phos.mjs';
import { eelSubject } from './src/eel.mjs';
import { compileEEL } from './src/expr-vm.mjs';
import { MilkdropFFT, Loudness, Analysis } from './src/audio/analysis.mjs';
import { Timekeeper } from './src/timekeeper.mjs';

const text = readFileSync(new URL('./101-per_frame.milk', import.meta.url), 'utf8');
const scene = importMilk(text);
const phosText = readFileSync(new URL('./scenes/md-101-per_frame.phos', import.meta.url), 'utf8');

// --- REFERENCE: the preset defines ib_r = 0.7 + 0.4*sin(3*time) ---
const refIbR = (/** @type {number} */ t) => 0.7 + 0.4 * Math.sin(3 * t);

// the engine executes the GRAPH form — construct from the .phos runtime
const eng = new Engine(toRuntime(parsePhos(phosText)));
const EPS = 1e-12;
let maxDiff = 0;
const dt = 1 / 60;
const samples = [];
for (let i = 0; i < 600; i++) {          // 10 seconds
  eng.step(dt);
  const expected = refIbR(eng.pool.time ?? 0); // engine's own time, exact
  const got = eng.pool.ib_r ?? 0; // pool value — renderState colors are 8-bit converted (d3dColor01)
  maxDiff = Math.max(maxDiff, Math.abs(expected - got));
  if (i % 120 === 0) samples.push({ t: +(eng.pool.time ?? 0).toFixed(3), expected: +expected.toFixed(6), got: +got.toFixed(6) });
}

// static import checks (defaults must survive)
const importOk =
  /** @type {any} */(scene.vars).fDecay === 0.98 && /** @type {any} */(scene.vars).ib_size === 0.1 &&
  /** @type {any} */(scene.vars).ib_b === 0.0 && /** @type {any} */(scene.vars).ob_size === 0.2 &&
  scene.expressions.perFrame.length === 1;

// mutant: engine with a corrupted equation must DIVERGE from reference
const mutantScene = toRuntime(milkToPhos(importMilk(text.replace('0.4*sin(3*time)', '0.4*sin(4*time)')), { file: 'x.milk', sha256: 'x' }));
const meng = new Engine(mutantScene);
let mutDiff = 0;
for (let i = 0; i < 600; i++) { meng.step(dt); mutDiff = Math.max(mutDiff, Math.abs(refIbR(meng.pool.time ?? 0) - (meng.pool.ib_r ?? 0))); }

const subjectOk = maxDiff <= EPS;
const mutantRejected = mutDiff > EPS;

// === .phos format checks (structural — parse/serialize/convert, no behavior) ===
// (a) The committed scenes/101-per_frame.phos is byte-identical to the converter
//     output for the committed .milk — the native file IS the transcription.
const sha256 = createHash('sha256').update(text).digest('hex');
const regenerated = serializePhos(milkToPhos(importMilk(text), { file: '101-per_frame.milk', sha256 }));
const phosMatchesConverter = regenerated === phosText;

// (b) Canonical serialization is a fixed point: serialize(parse(x)) === x.
const phosParsed = parsePhos(phosText);
const phosFixedPoint = serializePhos(phosParsed) === phosText;

// (c) Load-path equivalence: the .phos runtime carries every .milk var with
//     its exact value, the same expressions, and the ONLY additional vars are
//     exactly the source-default set the converter materializes from
//     state.cpp:654-665 — nothing else added, nothing dropped.
const rt = toRuntime(phosParsed);
const MILK_DEFAULT_KEYS = ['cx', 'cy', 'dx', 'dy', 'sx', 'sy', 'fWarpAnimSpeed', 'fWarpScale', 'fZoomExponent',
  'fGammaAdj', 'fVideoEchoZoom', 'fVideoEchoAlpha', 'nVideoEchoOrientation'];
const runtimeEquiv = Object.entries(scene.vars).every(([k, v]) => rt.vars[k] === v)
  && Object.keys(rt.vars).every((k) => k in scene.vars || MILK_DEFAULT_KEYS.includes(k))
  && MILK_DEFAULT_KEYS.every((k) => typeof rt.vars[k] === 'number')
  && JSON.stringify(rt.expressions) === JSON.stringify(scene.expressions);

// (d) The commented template is a legal scene AND the engine accepts it —
//     parse proves structure; Engine construction proves the required render
//     variables are present (the studio New button walks both doors).
const templateOk = (() => {
  try {
    const t = parsePhos(readFileSync(new URL('./scenes/TEMPLATE.phos', import.meta.url), 'utf8'));
    new Engine(toRuntime(t));
    return true;
  } catch { return false; }
})();

// (d2) index.html and player.html are byte-identical — mechanical guard
//      replacing hand-sync discipline.
const pagesSynced = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
  === readFileSync(new URL('./player.html', import.meta.url), 'utf8');

// (e) Refusal mutants — each structurally plausible corruption must throw.
const refuses = (/** @type {string} */ mutated) => {
  try { parsePhos(mutated); return false; } catch { return true; }
};
const refusalChecks = [
  ['unknown top-level key', refuses(phosText.replace('"resources"', '"reticulation"'))],
  ['unknown port type', refuses(phosText.replace('"type": "render"', '"type": "hologram"'))],
  ['dangling edge reference', refuses(phosText.replace('"out": "warp.out"', '"out": "wisp.out"'))],
  ['wrong format version', refuses(phosText.replace('"phos/1"', '"phos/2"'))],
  ['non-empty resources', refuses(phosText.replace('"resources": []', '"resources": [{}]'))],
];
const allRefused = refusalChecks.every(([, ok]) => ok);

// (f) Converter completeness: an unmapped .milk key must throw, not drop.
const converterRefusesUnmapped = (() => {
  try { milkToPhos(importMilk(text + 'nWaveMode=7\n'), { file: 'x.milk', sha256: 'x' }); return false; }
  catch { return true; }
})();

// (g) Importer refusals: unsupported source content throws, never silently drops.
const importerRefusals = [
  ['per_frame_init line', (() => { try { importMilk(text + 'per_frame_init_1=x=1;\n'); return false; } catch { return true; } })()],
  ['non-numeric value', (() => { try { importMilk(text + 'szName=hello\n'); return false; } catch { return true; } })()],
  ['trailing garbage on number', (() => { try { importMilk(text + 'zoom=1.5abc\n'); return false; } catch { return true; } })()],
  ['unknown section header', (() => { try { importMilk('[preset99]\n' + text); return false; } catch { return true; } })()],
  ['per-vertex code', (() => { try { importMilk(text + 'per_pixel_1=zoom=zoom+0.1;\n'); return false; } catch { return true; } })()],
  ['per-vertex comment-only line', (() => { try { importMilk(text + 'per_pixel_1=// note\n'); return false; } catch { return true; } })()],
  ['duplicate property', (() => { try { importMilk(text + 'zoom=1\n'); return false; } catch { return true; } })()],
  ['equation line mixing code and trailing comment', (() => { try { importMilk(text + 'per_frame_2=x=1; // note\n'); return false; } catch { return true; } })()],
];
const importerRefused = importerRefusals.every(([, ok]) => ok);

// (h) Source comment lines survive transcription (exactness: nothing dropped):
//     the two per_frame comment lines from the .milk land in the .phos program.
const commentsRetained = JSON.stringify(scene.expressions.perFrameComments)
  === JSON.stringify(['// one per frame equation', '// varies outer frame color - red only'])
  && JSON.stringify(rt.expressions.perFrameComments) === JSON.stringify(scene.expressions.perFrameComments);

// (i) Engine refuses a scene missing a required render variable (no silent defaults).
const engineRefusesMissing = (() => {
  const r = toRuntime(parsePhos(phosText));
  delete r.vars.fDecay;
  try { new Engine(r); return false; } catch { return true; }
})();

// (i2) Graph-contract witnesses: the graph controls topology validation,
//      ordering, and render-state assembly under the fixed pipeline; reversed
//      edges or a broken chain are refused, and the derived order is exactly
//      warp-feedback -> borders -> composite.
const executorOk = (() => {
  const good = new Engine(toRuntime(parsePhos(phosText)));
  const orderOk = JSON.stringify(good.renderState().passes) === JSON.stringify(['warp-feedback', 'borders', 'composite']);
  const reversed = (() => {
    const r = toRuntime(parsePhos(phosText));
    r.edges = r.edges.map((/** @type {{out:string,in:string}} */ e) => ({ out: e.in, in: e.out }));
    try { new Engine(r); return false; } catch { return true; }
  })();
  const broken = (() => {
    const r = toRuntime(parsePhos(phosText));
    r.edges = r.edges.slice(0, 1); // drop the borders->comp edge: no single chain
    try { new Engine(r); return false; } catch { return true; }
  })();
  return orderOk && reversed && broken;
})();

// (i3) Warp oscillators vs an independent recompute of milkdropfs.cpp:1782-1787
//      at the engine's own time (exact — same double expressions).
const oscOk = (() => {
  const e2 = new Engine(toRuntime(parsePhos(phosText)));
  const st = e2.step(1 / 60);
  const wt = e2.time * 1; // fWarpAnimSpeed default 1 (state.cpp:654)
  return st.motion.warpTime === wt
    && st.motion.f0 === 11.68 + 4.0 * Math.cos(wt * 1.413 + 10)
    && st.motion.f1 === 8.77 + 3.0 * Math.cos(wt * 1.113 + 7)
    && st.motion.f2 === 10.54 + 3.0 * Math.cos(wt * 1.233 + 3)
    && st.motion.f3 === 11.49 + 4.0 * Math.cos(wt * 0.933 + 5)
    && st.motion.warpScaleInv === 1
    && st.comp.gamma === 2 && st.comp.echoAlpha === 0 && st.comp.echoZoom === 2 && st.comp.echoOrient === 0;
})();

// (i4) EEL parser vs grammar-derived expectations (Compiler.y:55-75 precedence;
//      TreeFunctions.c comparison/if semantics). Each case exact.
const parserOk = (() => {
  const run = (/** @type {string[]} */ src) => { const p = /** @type {Record<string,number>} */ ({}); compileEEL(src)(p); return p; };
  const cases = [
    run(['x=2+3*4;']).x === 14,
    run(['x=2^3^2;']).x === 64,          // ^ LEFT-assoc (Compiler.y:74): (2^3)^2
    run(['x=-2^2;']).x === 4,            // unary minus binds tightest (:75): (-2)^2
    run(['x=1+2^2*3;']).x === 13,        // ^ tighter than *: 1+(2^2)*3
    run(['x=1/0;']).x === 0,             // div guard (TreeFunctions.c:576-595)
    run(['x=10%3;']).x === 1, run(['x=7%0;']).x === 0,
    run(['x=2<3;']).x === 1, run(['x=1==1.000001;']).x === 0, // epsilon 1e-300
    run(['x=if(0,5,7);']).x === 7, run(['x=1 ? 5 : 7;']).x === 5,
    run(['x=q1+1;']).x === 1,            // unset EEL vars read as 0
    run(['y=3;x=y*2;']).x === 6,
    (() => { try { compileEEL(['x=1&&1;']); return false; } catch { return true; } })(),
    (() => { try { compileEEL(['x=$pi;']); return false; } catch { return true; } })(),
    (() => { try { compileEEL(['x=nosuchfn(1);']); return false; } catch { return true; } })(),
  ];
  return cases.every(Boolean);
})();

// (j2) Studio save path: edit -> updateScene -> serialize -> parse -> toRuntime
//      round-trips the edit exactly, keeps unedited values, retains source
//      comments, and refuses an unmapped variable name.
const editRoundTrip = (() => {
  const doc = parsePhos(phosText);
  const editedVars = { ...toRuntime(doc).vars, ib_g: 0.25 };
  const editedEq = ['ib_r=0.7+0.4*sin(5*time);'];
  const saved = serializePhos(updateScene(doc, editedVars, editedEq));
  const rt2 = toRuntime(parsePhos(saved));
  const editApplied = rt2.vars.ib_g === 0.25 && rt2.expressions.perFrame[0] === editedEq[0];
  const unEditedKept = rt2.vars.ob_size === 0.2 && rt2.vars.fDecay === 0.98;
  const commentsKept = JSON.stringify(rt2.expressions.perFrameComments) === JSON.stringify(rt.expressions.perFrameComments);
  const refusesUnmapped = (() => {
    try { updateScene(parsePhos(phosText), { notAPort: 1 }, editedEq); return false; } catch { return true; }
  })();
  return editApplied && unEditedKept && commentsKept && refusesUnmapped;
})();

// (j) Duplicate value-port names across nodes are refused (no silent flattening).
const duplicatePortRefused = (() => {
  const dup = phosText.replace('"ob_size": {', '"fDecay": { "type": "float", "value": 1 }, "ob_size": {');
  try { parsePhos(dup); return false; } catch { return true; }
})();

const phosOk = phosMatchesConverter && phosFixedPoint && runtimeEquiv && templateOk && allRefused
  && converterRefusesUnmapped && importerRefused && commentsRetained && engineRefusesMissing && duplicatePortRefused
  && editRoundTrip && executorOk && oscOk && parserOk;

// === EEL function semantics (sources/EEL-FUNCTIONS.md; expected values fixed
// from projectm-eval@da885dc TreeFunctions.c formulas, independent of eel.mjs) ===
// [name, args, expected] — exact equality unless expected is 'nan-guard' style.
const PI = Math.PI;
/** @type {[string, number[], number][]} */
const eelCases = [
  // libm delegates: reference values from standard double-precision math
  ['sin', [PI / 2], 1], ['sin', [0], 0], ['cos', [0], 1], ['cos', [PI], -1],
  ['tan', [0], 0], ['atan', [1], PI / 4], ['atan2', [1, 1], PI / 4],
  ['sqrt', [9], 3], ['exp', [0], 1], ['abs', [-3.5], 3.5],
  ['floor', [2.7], 2], ['floor', [-2.7], -3], ['ceil', [2.2], 3],
  // domain guards (:908-942): outside [-1,1] -> 0
  ['asin', [1], PI / 2], ['asin', [2], 0], ['acos', [1], 0], ['acos', [-2], 0],
  // pow guards (:983-1004)
  ['pow', [2, 10], 1024], ['pow', [0, -2], 0], ['pow', [-1, 0.5], 0],
  // log guards (:1018-1052)
  ['log', [Math.E], 1], ['log', [-1], 0], ['log', [0], 0], ['log10', [1000], 3], ['log10', [0], 0],
  ['min', [2, 3], 2], ['max', [2, 3], 3], ['sqr', [-3], 9],
  ['sign', [0], 0], ['sign', [-7], -1], ['sign', [0.001], 1],
  // invsqrt: float32 magic + one Newton step (:1183-1220); constants computed
  // from a fresh transcription of the C in this audit's /execute window
  ['invsqrt', [4], 0.49915357479239103], ['invsqrt', [1], 0.9983071495847821],
  // sigmoid (:1078-1092)
  ['sigmoid', [0, 1], 0.5], ['sigmoid', [2, 1], 0.8807970779778823],
  ['add', [2, 3], 5], ['sub', [2, 3], -1], ['mul', [2, 3], 6],
  // div near-zero-divisor guard (:576-595)
  ['div', [6, 3], 2], ['div', [6, 0], 0],
  // mod: 64-bit integer semantics (:597-616) — 2^32+3 mod 10 must be 9, which
  // 32-bit |0 truncation gets wrong (discriminates the pre-audit behavior)
  ['mod', [10, 3], 1], ['mod', [5, 0], 0], ['mod', [4294967299, 10], 9],
  // band/bor at the 1e-5 epsilon (:672-702) — 1e-6 is FALSE per source
  ['band', [1, 1], 1], ['band', [1e-6, 1], 0], ['band', [2e-5, 1], 1],
  ['bor', [1e-6, 1e-6], 0], ['bor', [1e-6, 1], 1],
  // bnot/equal/noteq at close_factor_low 1e-300 (:430-469) — 1e-8 apart is
  // NOT equal per source (discriminates the pre-audit 1e-5 epsilon)
  ['bnot', [0], 1], ['bnot', [1e-6], 0],
  ['equal', [1, 1], 1], ['equal', [1, 1 + 1e-8], 0],
  ['noteq', [1, 1 + 1e-8], 1], ['noteq', [2, 2], 0],
  ['below', [1, 2], 1], ['above', [2, 1], 1], ['beleq', [2, 2], 1], ['aboeq', [2, 2], 1],
];
const eelFailures = eelCases.filter(([name, args, expected]) => {
  const fn = eelSubject[name];
  return !fn || fn(...args) !== expected;
});
// === Derived audio chain (sources/AUDIO-PATH.md; projectM@2f24414) ===
// (k) FFT: zero input -> all-zero spectrum, exact.
const fft = new MilkdropFFT(480, 512, true);
const zeroSpec = fft.timeToFrequencyDomain(new Array(576).fill(0));
const fftZeroOk = [...zeroSpec].every((v) => v === 0);

// (l) FFT: unit impulse at sample 240. env[240] = 0.5+0.5*sin(240·2π/480 − π/2)
//     = 1 exactly, so |X[k]| = 1 for all k in exact math and expected
//     spectral[i] = equalize[i] = −0.02·ln((512−i)/512) (MilkdropFFT.cpp:64,91).
//     Tolerance 1e-7: the twiddle-recurrence rounding (w *= wp up to 511
//     successive complex multiplies per octave) is the only inexact step in
//     this path; measured error 3.5e-9 in doubles, bound set ~30x above the
//     measurement and 5 orders below the expectation scale. The C source runs
//     this same recurrence in float32 (MilkdropFFT.cpp:35 float PI), where the
//     equivalent error is ~1e-4 — our double path is strictly tighter.
const imp = new Array(576).fill(0); imp[240] = 1;
const impSpec = fft.timeToFrequencyDomain(imp);
let fftImpMaxErr = 0;
for (let i = 0; i < 512; i++) {
  const expected = -0.02 * Math.log((512 - i) / 512);
  fftImpMaxErr = Math.max(fftImpMaxErr, Math.abs((impSpec[i] ?? 0) - expected));
}
const fftImpulseOk = fftImpMaxErr < 1e-7;

// (m) Loudness: constant spectrum of ones, one frame at dt=1/60. Expected values
//     recomputed here from the Loudness.cpp:29-58 formulas: bass band sums
//     samples [0,85) (512·1/6 integer division), short rate 0.2 rising, long
//     rate 0.9 (frame<50), both FPS-adjusted pow(pow(r,30),dt). Exact equality.
const ones = new Float32Array(512).fill(1);
const lb = new Loudness(0);
lb.update(ones, 1 / 60, 1);
const expCurrent = 85;
const expAvg = expCurrent * (1 - Math.pow(Math.pow(0.2, 30), 1 / 60));
const expLong = expCurrent * (1 - Math.pow(Math.pow(0.9, 30), 1 / 60));
const loudnessOk = lb.currentRelative === expCurrent / expLong && lb.averageRelative === expAvg / expLong;

// (n) Band boundary discriminator: bin 84 belongs to bass, bin 85 to mid
//     (Loudness.cpp:31-32 integer division) — a one-bin shift must move the
//     energy between bands.
const at84 = new Float32Array(512); at84[84] = 1;
const at85 = new Float32Array(512); at85[85] = 1;
const b84 = new Loudness(0), m84 = new Loudness(1), b85 = new Loudness(0), m85 = new Loudness(1);
b84.update(at84, 1 / 60, 1); m84.update(at84, 1 / 60, 1);
b85.update(at85, 1 / 60, 1); m85.update(at85, 1 / 60, 1);
const boundaryOk = b84.currentRelative > 1.5 && m84.currentRelative === 1
  && b85.currentRelative === 1 && m85.currentRelative > 1.5;

// (o) PCM ring intake: push 700 known samples through addSamples in two calls;
//     the per-frame copy must yield the newest 576 in order, ×128-scaled
//     (AddToBuffer + CopyNewWaveformData, PCM.cpp:12-37,117-125). Witnessed via
//     the spectrum path: a DC-constant ring vs a zero ring must differ, and two
//     different intake orders producing the same newest-576 must match exactly.
const ringOk = (() => {
  const a1 = new Analysis(), a2 = new Analysis();
  const ramp = Float32Array.from({ length: 700 }, (_, i) => (i % 100) / 100);
  a1.addSamples(ramp.slice(0, 300), null); a1.addSamples(ramp.slice(300), null);
  a2.addSamples(ramp.slice(0, 500), null); a2.addSamples(ramp.slice(500), null);
  a1.update(1 / 60); a2.update(1 / 60);
  const same = JSON.stringify([...a1.spectrum]) === JSON.stringify([...a2.spectrum]);
  const a3 = new Analysis(); a3.update(1 / 60);
  const differs = JSON.stringify([...a1.spectrum]) !== JSON.stringify([...a3.spectrum]);
  return same && differs;
})();

// (p) Timekeeper vs an independent recompute of pluginshell.cpp:1895-1991
//     (high-perf branch, TIME_HIST_SLOTS=128): run 200 ticks at dt=1/60 and
//     compare time/fps exactly at frames 1, 50, 130, 200.
const timekeeperOk = (() => {
  const tk = new Timekeeper();
  const HIST = 128;
  let fps = 0, time = 0, frame = 0, histPos = 0;
  const hist = new Array(HIST).fill(0);
  /** @type {boolean[]} */ const results = [];
  for (let n = 1; n <= 200; n++) {
    let elapsed = 1 / 60;
    if (frame === 0) { fps = 30; time = 0; histPos = 0; }
    let slots = HIST / 2;
    time += 1 / fps;
    if (frame > HIST) {
      if (fps < 60) slots = Math.floor(slots * (0.1 + 0.9 * (fps / 60)));
      if (elapsed > 5 / fps || elapsed > 1 || elapsed < 0) elapsed = 1 / 30;
      const old = /** @type {number} */ (hist[(histPos - slots + HIST) % HIST]);
      const nt = /** @type {number} */ (hist[(histPos - 1 + HIST) % HIST]) + elapsed;
      hist[histPos] = nt; histPos = (histPos + 1) % HIST;
      const nf = slots / (nt - old);
      fps = Math.abs(fps - nf) > 3 ? nf : 0.87 * fps + (1 - 0.87) * nf;
    } else {
      if (frame < 2) elapsed = 1 / 30;
      else if (elapsed > 1 || elapsed < 0) elapsed = 1 / fps;
      const old = /** @type {number} */ (hist[0]);
      const nt = /** @type {number} */ (hist[(histPos - 1 + HIST) % HIST]) + elapsed;
      hist[histPos] = nt; histPos = (histPos + 1) % HIST;
      if (frame > 0) { const nf = frame / (nt - old); fps = 0.6 * fps + (1 - 0.6) * nf; }
    }
    frame++;
    tk.tick(1 / 60);
    if ([1, 50, 130, 200].includes(n)) results.push(tk.time === time && tk.fps === fps);
  }
  return results.every(Boolean);
})();

// (q) Sequence-grammar + per-vertex refusals and the reset baseline regression.
const contractOk = (() => {
  const base = toRuntime(parsePhos(phosText));
  // two-node warp->composite: legal chain shape, but composite may only
  // follow borders per the registry sequence grammar (NATIVE_OPS)
  const twoNode = {
    ...base,
    pipelineDescriptor: base.pipelineDescriptor.filter((/** @type {{stage:string}} */ n) => n.stage !== 'borders'),
    edges: [{ out: 'warp.out', in: 'comp.in' }],
  };
  const refusesTwoNode = (() => { try { new Engine(twoNode); return false; } catch { return true; } })();
  const withPv = { ...toRuntime(parsePhos(phosText)) };
  withPv.expressions = { ...withPv.expressions, perVertex: ['zoom=zoom+0.1;'] };
  const refusesPerVertex = (() => { try { new Engine(withPv); return false; } catch { return true; } })();
  return refusesTwoNode && refusesPerVertex;
})();
const resetOk = (() => {
  const e2 = new Engine(toRuntime(parsePhos(phosText)));
  const baseIbG = e2.scene.vars.ib_g;
  const baseEqs = JSON.stringify(e2.scene.expressions.perFrame);
  e2.setVar('ib_g', 0.123);
  e2.recompile(['ib_r=0.1;']);
  e2.step(1 / 60);
  e2.reset();
  return e2.scene.vars.ib_g === baseIbG
    && JSON.stringify(e2.scene.expressions.perFrame) === baseEqs
    && e2.pool.ib_g === baseIbG
    && e2.frame === 0 && e2.time === 0
    && e2.step(1 / 60).innerBox.g === baseIbG;
})();

// (r) Post-equation clamps (milkdropfs.cpp:677-679) and EEL-name aliasing
//     (state.cpp:260-331: equations write gamma/decay/echo_zoom, not file keys).
const clampAliasOk = (() => {
  const e3 = new Engine(toRuntime(parsePhos(phosText)));
  e3.recompile(['gamma=99;']);
  const hi = e3.step(1 / 60).comp.gamma === 8;
  e3.recompile(['gamma=0-5;']);
  const lo = e3.step(1 / 60).comp.gamma === 0;
  e3.recompile(['echo_zoom=0;']);
  const ez = e3.step(1 / 60).comp.echoZoom === 0.001;
  e3.recompile(['gamma=4;', 'decay=0.5;']);
  const st = e3.step(1 / 60);
  const alias = st.comp.gamma === 4 && st.motion.decay === d3dColor01(0.5); // decay renders 8-bit quantized (:2007)
  const get = e3.getVar('fGammaAdj') === 4; // studio reads through the alias
  return hi && lo && ez && alias && get;
})();

// (s) VARIABLE-CONTRACT LEDGER — every per-frame EEL variable MilkDrop
//     registers (the full regvar list, state.cpp:260-331) classified and
//     verified against engine reality. This is the drift guard: a future
//     change that breaks any classification fails here. q1..q32 and init-code
//     monitor semantics are gated behind per_frame_init support (refused at
//     import); vol/vol_att are intentionally ABSENT (no regvar in tier-1).
const VAR_CONTRACT = {
  engine: ['time', 'fps', 'frame', 'bass', 'mid', 'treb', 'bass_att', 'mid_att', 'treb_att',
    'progress', 'meshx', 'meshy', 'pixelsx', 'pixelsy', 'aspectx', 'aspecty'],
  mapped: /** @type {Record<string,string>} */ ({ fDecay: 'decay', fGammaAdj: 'gamma', fVideoEchoZoom: 'echo_zoom',
    fVideoEchoAlpha: 'echo_alpha', nVideoEchoOrientation: 'echo_orient', fZoomExponent: 'zoomexp',
    zoom: 'zoom', rot: 'rot', warp: 'warp', cx: 'cx', cy: 'cy', dx: 'dx', dy: 'dy', sx: 'sx', sy: 'sy',
    ib_size: 'ib_size', ib_r: 'ib_r', ib_g: 'ib_g', ib_b: 'ib_b', ib_a: 'ib_a',
    ob_size: 'ob_size', ob_r: 'ob_r', ob_g: 'ob_g', ob_b: 'ob_b', ob_a: 'ob_a' }),
  defaults: /** @type {Record<string,number>} */ ({ wave_a: 0.8, wave_r: 1, wave_g: 1, wave_b: 1, wave_x: 0.5, wave_y: 0.5,
    wave_mystery: 0, wave_mode: 0, wave_usedots: 0, wave_thick: 0, wave_additive: 0, wave_brighten: 1,
    darken_center: 0, wrap: 1, invert: 0, brighten: 0, darken: 0, solarize: 0,
    mv_x: 12, mv_y: 9, mv_dx: 0, mv_dy: 0, mv_l: 0.9, mv_r: 1, mv_g: 1, mv_b: 1, mv_a: 1,
    blur1_min: 0, blur2_min: 0, blur3_min: 0, blur1_max: 1, blur2_max: 1, blur3_max: 1,
    blur1_edge_darken: 0.25, monitor: 0 }),
};
const varContractOk = (() => {
  const c = VAR_CONTRACT;
  const total = c.engine.length + Object.keys(c.mapped).length + Object.keys(c.defaults).length;
  if (total !== 76) return false; // the witnessed regvar list has exactly 76 names
  const eelNames = [...c.engine, ...Object.values(c.mapped), ...Object.keys(c.defaults)];
  if (new Set(eelNames).size !== 76) return false; // no overlaps, no gaps
  // injected names: present and finite after a step (post-step engine)
  const e4 = new Engine(toRuntime(parsePhos(phosText)));
  const st = e4.step(1 / 60);
  const injectedOk = c.engine.every((n) => Number.isFinite(e4.pool[n]));
  // mapped names: a FRESH pool (equations move vars post-step) carries every
  // scene file-key under its EEL name with the scene's value
  const e5 = new Engine(toRuntime(parsePhos(phosText)));
  const mappedOk = Object.entries(c.mapped).every(([fk, en]) =>
    !(fk in e5.scene.vars) || e5.pool[en] === e5.scene.vars[fk]);
  // equation-visible defaults: fresh pool carries each witnessed default value
  const defaultsOk = Object.entries(c.defaults).every(([n, v]) => e5.pool[n] === v);
  const volAbsent = !('vol' in e4.pool) && !('vol_att' in e4.pool);
  const progressOk = st.passes.length === 3 && e4.pool.progress === e4.time / 16;
  return injectedOk && mappedOk && defaultsOk && volAbsent && progressOk;
})();

// (t) Aspect factors from the render-target size (plugin.cpp:2027-2030) reach
//     renderState as forward factors and the pool as INVERSE factors
//     (m_fInvAspectX/Y, milkdropfs.cpp:545-546). Exact recompute, same exprs.
const aspectOk = (() => {
  const e6 = new Engine(toRuntime(parsePhos(phosText)));
  const tw = 1920, th = 1080;
  e6.setViewport(tw, th, tw, th);
  const st = e6.step(1 / 60);
  const aX = (th > tw) ? tw / th : 1; // same exprs as Engine.aspectX/Y (plugin.cpp:2027-2028)
  const aY = (tw > th) ? th / tw : 1;
  return st.motion.aspectX === aX && st.motion.aspectY === aY
    && e6.pool.aspectx === 1 / aX && e6.pool.aspecty === 1 / aY;
})();

// (u) Finite-mesh warp path (src/warp-mesh.mjs). Witnesses: strip indices vs
//     the hand-derived first triangle of plugin.cpp:2300-2324 (quadrant 0,
//     slice 0: verts (0,0),(0,1),(1,0)); identity-motion UVs vs a recompute
//     using the identical expression sequence of milkdropfs.cpp:1877-1926;
//     and the zoom=0 structure — every vertex UV NaN, because 1/pow(0,1) is
//     Infinity (:1880) and the rotation step multiplies Infinity by sin(0)=0
//     (:1907) — the same IEEE path the source's floats take.
const meshOk = (() => {
  const idx = buildStripIndices();
  const pos = meshPositions();
  const structuralOk = idx.length === GRID_Y * 2 * GRID_X * 3
    && idx[0] === 0 && idx[1] === GRID_X + 1 && idx[2] === 1
    && Math.max(...idx) === VERT_COUNT - 1
    && pos.length === VERT_COUNT * 2 && pos[0] === -1 && pos[1] === -1
    && pos[pos.length - 2] === 1 && pos[pos.length - 1] === 1;
  const ident = { zoom: 1, zoomExp: 1, rot: 0, warp: 0, cx: 0.5, cy: 0.5, dx: 0, dy: 0,
    sx: 1, sy: 1, warpTime: 0, warpScaleInv: 1, f0: 0, f1: 0, f2: 0, f3: 0, aspectX: 1, aspectY: 1 };
  const uv = buildWarpUVs(ident, 1024, 1024);
  let identOk = true;
  let n = 0;
  for (let j = 0; j <= GRID_Y; j++) {
    for (let i = 0; i <= GRID_X; i++) {
      const x = i / GRID_X * 2 - 1, y = j / GRID_Y * 2 - 1;
      // identical expression sequence, identity motion (fZoom2Inv = 1, cr = 1, sr = 0)
      let eu = x * 1 * 0.5 * 1 + 0.5; eu = (eu - 0.5) / 1 + 0.5;
      let ev = -y * 1 * 0.5 * 1 + 0.5; ev = (ev - 0.5) / 1 + 0.5;
      const eu2 = eu - 0.5, ev2 = ev - 0.5;
      eu = eu2 * 1 - ev2 * 0 + 0.5; ev = eu2 * 0 + ev2 * 1 + 0.5;
      eu = (eu - 0.5) * 1 + 0.5; ev = (ev - 0.5) * 1 + 0.5;
      // the mesh buffer is a Float32Array — compare at its f32 width
      if (uv[n++] !== Math.fround(eu + 0.5 / 1024)) identOk = false;
      if (uv[n++] !== Math.fround(ev + 0.5 / 1024)) identOk = false;
    }
  }
  const uv0 = buildWarpUVs({ ...ident, zoom: 0 }, 1024, 1024);
  let nanOk = true;
  for (const v of uv0) if (!Number.isNaN(v)) nanOk = false;
  const wrapOk = new Engine(toRuntime(parsePhos(phosText))).step(1 / 60).motion.wrap === 1;
  return structuralOk && identOk && nanOk && wrapOk;
})();

// (v) Ordered source records — the recipe stays the unit of enumeration
//     through conversion: one record per nonblank source line, in order, with
//     line numbers and raw text; conversion refuses any record without a
//     handler (converterRefusesUnmapped now names the source line).
const recordsOk = (() => {
  /** @type {{n:number, s:string}[]} */
  const nonblank = [];
  text.split(/\r?\n/).forEach((l, i) => { const s = l.trim(); if (s) nonblank.push({ n: i + 1, s }); });
  const recs = scene.records;
  if (recs.length !== nonblank.length) return false;
  const aligned = recs.every((r, i) => {
    const src = nonblank[i];
    return src !== undefined && r.line === src.n && r.raw === src.s;
  });
  const lineNamed = (() => {
    try { milkToPhos(importMilk(text + 'nWaveMode=7\n'), { file: 'x.milk', sha256: 'x' }); return false; }
    catch (e) { return /line \d+/.test(/** @type {Error} */ (e).message); }
  })();
  return aligned && recs[0] !== undefined && recs[0].kind === 'section' && lineNamed;
})();

// (w) MilkDrop semantic transforms execute in the runtime path: the 8-bit
//     color conversion (milkdropfs.cpp:41) wraps 1.1 to 24/255 — the scene-one
//     border blink past 1.0 — and quantizes decay 0.98 to 249/255 (:2007);
//     the post-equation clamps stay covered by clampAliasOk above.
const transformOk = (() => {
  if (d3dColor01(1.1) !== 24 / 255 || d3dColor01(0.98) !== 249 / 255) return false;
  const e7 = new Engine(toRuntime(parsePhos(phosText)));
  e7.recompile(['ib_r=1.1;']);
  const st7 = e7.step(1 / 60);
  return st7.innerBox.r === 24 / 255 && st7.innerBox.aGate === 1
    && st7.motion.decay === 249 / 255 && e7.pool.ib_r === 1.1;
})();

// (x) Inert-port refusal — the shared OP_PORTS declaration (src/engine.mjs)
//     closes the handler-exists-but-runtime-ignores hole: the parser stays
//     format-generic, but Engine construction refuses a scene carrying a value
//     port no runtime path consumes.
const inertPortOk = (() => {
  const mutated = phosText.replace('"fDecay": {', '"nWaveMode": {\n          "type": "float",\n          "value": 7\n        },\n        "fDecay": {');
  try { parsePhos(mutated); } catch { return false; }
  try { new Engine(toRuntime(parsePhos(mutated))); return false; } catch { return true; }
})();

// (y) Triage scan for the studio's side-by-side view: the tolerant scan
//     collects EVERY refusal with its line while strict import still throws at
//     the first, and the assessment consults the same handler registry —
//     a per-vertex line refuses at scan, an unknown key refuses at assessment.
const triageOk = (() => {
  const t2 = text + 'per_pixel_1=zoom=zoom+0.1;\nnWaveMode=7\n';
  const recs = scanMilk(t2);
  const dis = assessRecords(recs);
  const bad = dis.filter((d) => !d.ok);
  const strictStillThrows = (() => { try { importMilk(t2); return false; } catch { return true; } })();
  return recs.length === dis.length && bad.length === 2
    && bad[0] !== undefined && bad[0].text.includes('per-vertex')
    && bad[1] !== undefined && bad[1].text.includes('no conversion handler')
    && strictStillThrows;
})();

// (z) CSS @import chain integrity. check-html-links (the standard tool, in
//     the repo's check script) validates HTML-level references but does not
//     follow CSS @import chains — witnessed 2026-07-18: it passed while
//     webawesome.css imported a missing native.css and the missing color
//     palette, which broke every component's appearance silently. This case
//     walks link-tag CSS files and their @import closure, asserting each
//     file exists. Tripwire per CLAUDE.md: if this ever needs a second file
//     or a config surface, stop and admit a real tool instead.
const cssImportsOk = (() => {
  const base = new URL('.', import.meta.url);
  const pages = ['index.html', 'player.html', 'studio.html', 'engine-test.html'];
  /** @type {URL[]} */
  const cssQueue = [];
  for (const pg of pages) {
    const html = readFileSync(new URL(pg, base), 'utf8');
    for (const m of html.matchAll(/(?:href|src)="(\.\/[^"]+)"/g)) {
      const u = new URL(/** @type {string} */ (m[1]), base);
      try { readFileSync(u); } catch { return false; }
      if (u.pathname.endsWith('.css')) cssQueue.push(u);
    }
  }
  const seen = new Set();
  while (cssQueue.length) {
    const u = /** @type {URL} */ (cssQueue.pop());
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    let text;
    try { text = readFileSync(u, 'utf8'); } catch { return false; }
    for (const m of text.matchAll(/@import\s+url\(['"]?([^'")]+)['"]?\)/g)) {
      cssQueue.push(new URL(/** @type {string} */ (m[1]), u));
    }
  }
  return seen.size > 0;
})();

// (aa) Plane9 scanner shape + standard HSL formula fingerprint against a
//      retained CC0 fixture. The scene.xml lives at
//      sources/plane9/color-cycle.scene.xml (extracted verbatim from
//      source-scenes/plane9/Other/Color Cycle.p9c whose License
//      Type="CC0" allows retention; the parent .p9c stays gitignored).
//      Provenance and sha256 sit alongside in PROVENANCE.txt.
//      Expected values are read FROM the fixture — the HSL inputs come
//      from the scanned HSLAToColor node's Hue/Saturation/Lightness ports
//      and the RGB expected values come from the scanned Clear1 node's
//      Color port — so an altered fixture cannot pass. The fixture's
//      sha256 is verified against PROVENANCE.txt first, so an altered
//      fixture cannot even reach the value comparison. This does NOT test
//      a Plane9 runtime — no such native operations exist yet.
const p9Ok = (() => {
  const xmlBytes = readFileSync(new URL('../sources/plane9/color-cycle.scene.xml', import.meta.url));
  const provenance = readFileSync(new URL('../sources/plane9/PROVENANCE.txt', import.meta.url), 'utf8');
  const claimed = provenance.match(/sha256:\s*([0-9a-f]{64})/);
  if (!claimed) return false;
  const actual = createHash('sha256').update(xmlBytes).digest('hex');
  if (actual !== claimed[1]) return false;
  const xml = xmlBytes.toString('utf8');
  const recs = scanP9(xml);
  const nodes = recs.filter(r => r.kind === 'node' || r.kind === 'node-open');
  const conns = recs.filter(r => r.kind === 'connection');
  const refused = recs.filter(r => r.kind === 'refused');
  const root = recs.find(r => r.kind === 'root');
  const lic = recs.find(r => r.kind === 'meta' && r.id === 'License');
  const dis = assessP9Records(recs);
  const notOk = dis.filter(d => !d.ok);
  if (nodes.length !== 7 || conns.length !== 6 || refused.length !== 0) return false;
  if (!root || !String(root.value).includes('FormatVersion="2"')) return false;
  if (!lic || !lic.raw.includes('CC0')) return false;
  // dispositions under the shared conversion registry: Screen + Clear (and
  // their ports, and the Clear->Screen render edge) convert; the three
  // MinMax, Beat, and HSLAToColor nodes refuse naming their exact missing
  // facts, and the five connections touching refused nodes refuse with them
  if (notOk.length !== 10) return false;
  if (notOk.filter(d => d.text.includes('mode-integer mapping unresolved')).length !== 3) return false;
  if (notOk.filter(d => d.text.includes('detection algorithm unresolved')).length !== 1) return false;
  if (notOk.filter(d => d.text.includes('one-vector candidate')).length !== 1) return false;
  if (notOk.filter(d => d.text.includes('endpoint node is not convertible')).length !== 5) return false;
  if (!dis.some(d => d.ok && d.text.includes('native clear-color'))) return false;
  if (!dis.some(d => d.ok && d.text.includes('render topology'))) return false;
  // Extract the HSL inputs and Clear expected values from the scan itself,
  // identifying nodes by TYPE (HSLAToColor, Clear) and pairing them by the
  // scene's actual connection HSLAToColor.Color -> Clear.Color rather than
  // by port-shape heuristics that could pair unrelated nodes.
  /** @type {Record<string,{type:string, ports:Record<string,string>}>} */
  const byName = {};
  let cur = '';
  for (const rec of recs) {
    if (rec.kind === 'node' || rec.kind === 'node-open') {
      cur = /** @type {string} */ (rec.name);
      byName[cur] = { type: /** @type {string} */ (rec.type), ports: {} };
    } else if (rec.kind === 'close' && rec.id === 'Node') {
      cur = '';
    } else if (rec.kind === 'port' && cur && rec.id !== undefined && rec.value !== undefined) {
      /** @type {{type:string, ports:Record<string,string>}} */ (byName[cur]).ports[rec.id] = /** @type {string} */ (rec.value);
    }
  }
  const hslToClear = recs.find(r => r.kind === 'connection'
    && /** @type {string} */ (r.out).endsWith('.Color')
    && /** @type {string} */ (r.in).endsWith('.Color')
    && byName[/** @type {string} */ (r.out).split('.')[0] ?? '']?.type === 'HSLAToColor'
    && byName[/** @type {string} */ (r.in).split('.')[0] ?? '']?.type === 'Clear');
  if (!hslToClear) return false;
  const hslName = /** @type {string} */ (hslToClear.out).split('.')[0] ?? '';
  const clearName = /** @type {string} */ (hslToClear.in).split('.')[0] ?? '';
  const hsl = byName[hslName];
  const clear = byName[clearName];
  if (!hsl || !clear) return false;
  const h = Number(hsl.ports['Hue']);
  const s = Number(hsl.ports['Saturation']);
  const l = Number(hsl.ports['Lightness']);
  const clearRgb = String(clear.ports['Color']).trim().split(/\s+/).map(Number);
  if (clearRgb.length !== 4) return false;
  const [er, eg, eb] = clearRgb;
  if (![h, s, l, er, eg, eb].every((v) => Number.isFinite(v))) return false;
  // Standard HSL-to-RGB (CSS/Wikipedia chroma formulation), inlined here
  // so the check is independent of any runtime module.
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(hp);
  const table = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
  const row = table[seg] ?? [0, 0, 0];
  const r = /** @type {number} */ (row[0]) + m;
  const g = /** @type {number} */ (row[1]) + m;
  const b = /** @type {number} */ (row[2]) + m;
  return Math.abs(r - /** @type {number} */ (er)) < 1e-5
      && Math.abs(g - /** @type {number} */ (eg)) < 1e-5
      && Math.abs(b - /** @type {number} */ (eb)) < 1e-5;
})();

// (ab) Native-operation registry sequence grammar: unknown ops and
//      unrealizable chains refuse at construction; the accepted MilkDrop
//      chain contributes exactly its four state groups and no clear state.
const registryOk = (() => {
  const rt0 = () => toRuntime(parsePhos(phosText));
  const unknownOp = (() => {
    const r = rt0();
    r.pipelineDescriptor = [{ id: 'x', stage: 'wibble', ports: [] }];
    r.edges = [];
    try { new Engine(r); return false; } catch (e) { return /not a registered native operation/.test(/** @type {Error} */ (e).message); }
  })();
  const clearThenBorders = (() => {
    const r = rt0();
    r.pipelineDescriptor = [
      { id: 'c', stage: 'clear-color', ports: [] },
      { id: 'b', stage: 'borders', ports: [] },
    ];
    r.edges = [{ out: 'c.out', in: 'b.in' }];
    try { new Engine(r); return false; } catch (e) { return /cannot follow/.test(/** @type {Error} */ (e).message); }
  })();
  const nonTerminalEnd = (() => {
    const r = rt0();
    r.pipelineDescriptor = r.pipelineDescriptor.filter((/** @type {{stage:string}} */ n) => n.stage !== 'composite');
    r.edges = r.edges.slice(0, 1);
    try { new Engine(r); return false; } catch (e) { return /cannot end a pipeline/.test(/** @type {Error} */ (e).message); }
  })();
  const mdState = new Engine(rt0()).step(1 / 60);
  const mdShape = mdState.motion !== undefined && mdState.innerBox !== undefined
    && mdState.outerBox !== undefined && mdState.comp !== undefined && mdState.clear === undefined;
  return unknownOp && clearThenBorders && nonTerminalEnd && mdShape;
})();

// (ac) Committed native clear-color scene: parses, canonical fixed point,
//      executes through the shared engine with the clear pass carrying the
//      port values, and the per-frame program animates the blue channel.
const nativeClearOk = (() => {
  const t2 = readFileSync(new URL('./scenes/native-clear.phos', import.meta.url), 'utf8');
  const doc = parsePhos(t2);
  if (serializePhos(doc) !== t2) return false;
  const e = new Engine(toRuntime(doc));
  const st = e.step(1 / 60);
  if (JSON.stringify(st.passes) !== JSON.stringify(['clear-color'])) return false;
  if (st.clear.r !== 0 || st.clear.g !== 0.35 || st.clear.a !== 1) return false;
  if (st.clear.b !== 0.25 + 0.15 * Math.sin(e.pool.time ?? 0)) return false;
  // missing declared port refuses (no silent defaults)
  const r2 = toRuntime(parsePhos(t2));
  delete r2.vars.clear_g;
  const missingRefused = (() => { try { new Engine(r2); return false; } catch { return true; } })();
  // an undeclared extra value port refuses (no inert ports)
  const r3 = toRuntime(parsePhos(t2));
  r3.vars.mystery = 1;
  const d0 = /** @type {{ports:string[]}} */ (r3.pipelineDescriptor[0]);
  d0.ports = [...d0.ports, 'mystery'];
  const inertRefused = (() => { try { new Engine(r3); return false; } catch { return true; } })();
  return missingRefused && inertRefused;
})();

// (ad) Plane9 conversion door: the retained Color Cycle fixture REFUSES at
//      its first unresolved node (HSLAToColor, line 22) — Color Cycle is NOT
//      claimed complete; a synthetic scene in the witnessed clear shape
//      (grammar + Screen configuration exactly as the fixture carries them)
//      converts to a native .phos that executes with the XML's color; and
//      tampering (camera deviation / broken wiring / extra node) refuses.
const p9ConvOk = (() => {
  const fixtureXml = readFileSync(new URL('../sources/plane9/color-cycle.scene.xml', import.meta.url), 'utf8');
  const fixtureRefused = (() => {
    try { p9ToPhos(fixtureXml, { file: 'color-cycle.scene.xml', sha256: 'x' }); return false; }
    catch (e) { const m = /** @type {Error} */ (e).message; return /line 22/.test(m) && /HSLAToColor/.test(m); }
  })();
  const clearXml = (/** @type {string} */ fov, /** @type {string} */ color) => [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Plane9Scene FormatVersion="2" Id="checkclr1" ParentId="" WarmupTime="0" SceneType="1" Version="1" DevelopmentTime="0" Created="20260718 00:00" LastModified="20260718 00:00">',
    '\t<Author>check.mjs</Author>',
    '\t<Desc></Desc>',
    '\t<Tags></Tags>',
    '\t<License Type="CC0" RelicensingPossible="1">check input</License>',
    '\t<Nodes>',
    '\t\t<Node Type="Screen" Name="Screen">',
    '\t\t\t<Port Id="Viewport" Value="0 0 1 1"/>',
    '\t\t\t<Port Id="CamPos" Value="0 0 -2"/>',
    '\t\t\t<Port Id="CamRot" Value="0 0 0"/>',
    '\t\t\t<Port Id="CamLookAt" Value="0 0 1"/>',
    '\t\t\t<Port Id="CamLookAtInWorldSpace" Value="false"/>',
    `\t\t\t<Port Id="CamFov" Value="${fov}"/>`,
    '\t\t\t<Port Id="CamNear" Value="0.1"/>',
    '\t\t\t<Port Id="CamFar" Value="1000"/>',
    '\t\t\t<Port Id="ScaleByAspect" Value="false"/>',
    '\t\t</Node>',
    '\t\t<Node Type="Clear" Name="Clear1">',
    `\t\t\t<Port Id="Color" Value="${color}"/>`,
    '\t\t</Node>',
    '\t</Nodes>',
    '\t<Connections>',
    '\t\t<Connection Out="Clear1.Render" In="Screen.Render"/>',
    '\t</Connections>',
    '\t<SceneCompatibility>',
    '\t\t<GoodScenes/>',
    '\t\t<BadScenes/>',
    '\t</SceneCompatibility>',
    '</Plane9Scene>',
    '',
  ].join('\n');
  const good = clearXml('45', '0.25 0.5 0.75 1');
  const doc = p9ToPhos(good, { file: 'check-clear.p9c', sha256: 'x' });
  const reparsed = parsePhos(serializePhos(doc));
  const e = new Engine(toRuntime(reparsed));
  const st = e.step(1 / 60);
  const executes = JSON.stringify(st.passes) === JSON.stringify(['clear-color'])
    && st.clear.r === 0.25 && st.clear.g === 0.5 && st.clear.b === 0.75 && st.clear.a === 1
    && reparsed.meta.sourceEngine === 'plane9';
  const cameraDeviationRefused = (() => {
    try { p9ToPhos(clearXml('60', '0.25 0.5 0.75 1'), { file: 'x.p9c', sha256: 'x' }); return false; }
    catch (e2) { return /CamFov/.test(/** @type {Error} */ (e2).message); }
  })();
  const brokenWiringRefused = (() => {
    try { p9ToPhos(good.replace('Out="Clear1.Render" In="Screen.Render"', 'Out="Screen.Render" In="Clear1.Render"'), { file: 'x.p9c', sha256: 'x' }); return false; }
    catch { return true; }
  })();
  const extraNodeRefused = (() => {
    const withBeat = good.replace('\t</Nodes>',
      '\t\t<Node Type="Beat" Name="Beat1">\n\t\t\t<Port Id="NoMusic" Value="0.5"/>\n\t\t</Node>\n\t</Nodes>');
    try { p9ToPhos(withBeat, { file: 'x.p9c', sha256: 'x' }); return false; }
    catch (e2) { return /Beat/.test(/** @type {Error} */ (e2).message); }
  })();
  const badColorRefused = (() => {
    try { p9ToPhos(clearXml('45', '0.25 0.5'), { file: 'x.p9c', sha256: 'x' }); return false; }
    catch { return true; }
  })();
  return fixtureRefused && executes && cameraDeviationRefused && brokenWiringRefused && extraNodeRefused && badColorRefused;
})();

const audioOk = fftZeroOk && fftImpulseOk && loudnessOk && boundaryOk && ringOk && timekeeperOk && pagesSynced && contractOk && resetOk && clampAliasOk && varContractOk && aspectOk && meshOk && recordsOk && transformOk && inertPortOk && triageOk && cssImportsOk && p9Ok && registryOk && nativeClearOk && p9ConvOk;

const eelFnCount = Object.keys(eelSubject).length;
const eelCoveredCount = new Set(eelCases.map((c) => c[0])).size;
// pass = every case exact, all 35 functions exist, and every function has at least one case
// rand() is deterministic (MT19937, fixed seed 0x4141f00d — TreeFunctions.c:150-224):
// verify the first draws against an independent transcription of the same source.
const randOk = (() => {
  const N = 624, M = 397, A = 0x9908b0df;
  const m2 = new Uint32Array(N); let i2 = 0;
  const gen = () => {
    if (!i2) { m2[0] = 0x4141f00d; for (i2 = 1; i2 < N; i2++) { const pv = /** @type {number} */ (m2[i2-1]); m2[i2] = (Math.imul(1812433253, pv ^ (pv >>> 30)) + i2) >>> 0; } }
    if (i2 >= N) { for (let kk = 0; kk < N; kk++) { const y = ((/** @type {number} */ (m2[kk]) & 0x80000000) | (/** @type {number} */ (m2[(kk+1)%N]) & 0x7fffffff)) >>> 0; m2[kk] = (/** @type {number} */ (m2[(kk+M)%N]) ^ (y >>> 1) ^ ((y & 1) ? A : 0)) >>> 0; } i2 = 0; }
    let y = /** @type {number} */ (m2[i2++]);
    y ^= y >>> 11; y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0; y = (y ^ ((y << 15) & 0xefc60000)) >>> 0; y ^= y >>> 18;
    return y >>> 0;
  };
  const fr = /** @type {(x:number)=>number} */ (eelSubject.rand);
  const draws = [fr(100) === gen() * (1/0xFFFFFFFF) * 100,
                 fr(100) === gen() * (1/0xFFFFFFFF) * 100,
                 fr(7)   === gen() * (1/0xFFFFFFFF) * 7,
                 fr(0.5) === gen() * (1/0xFFFFFFFF) * 1,   // max clamps to 1 (:1175-1178)
                 fr(-3)  === gen() * (1/0xFFFFFFFF) * 1];
  return draws.every(Boolean);
})();
const eelOk = eelFailures.length === 0 && eelFnCount === 36 && eelCoveredCount === 35 && randOk;
const pass = importOk && subjectOk && mutantRejected && phosOk && eelOk && audioOk;

console.log('=== PHOSPHENE engine — 101-per_frame.milk ===');
console.log('import (defaults + 1 per-frame eq):', importOk ? 'OK' : 'FAIL');
console.log('samples (ib_r = 0.7+0.4*sin(3t)):');
for (const s of samples) console.log(`  t=${s.t}s  expected=${s.expected}  engine=${s.got}`);
console.log(`per-frame execution max divergence from reference: ${maxDiff}`);
console.log(`mutant (sin(4t)) rejected: ${mutantRejected} (Δ=${mutDiff.toExponential(2)})`);
console.log('\n=== .phos format — scenes/101-per_frame.phos ===');
console.log('committed .phos == converter output (byte):', phosMatchesConverter ? 'OK' : 'FAIL');
console.log('serialize∘parse fixed point:', phosFixedPoint ? 'OK' : 'FAIL');
console.log('runtime equivalence with .milk import (vars+expressions):', runtimeEquiv ? 'OK' : 'FAIL');
console.log('TEMPLATE.phos parses:', templateOk ? 'OK' : 'FAIL');
for (const [name, ok] of refusalChecks) console.log(`refusal — ${name}:`, ok ? 'OK' : 'FAIL');
console.log('converter refuses unmapped .milk key:', converterRefusesUnmapped ? 'OK' : 'FAIL');
for (const [name, ok] of importerRefusals) console.log(`importer refuses ${name}:`, ok ? 'OK' : 'FAIL');
console.log('source comment lines retained through .phos:', commentsRetained ? 'OK' : 'FAIL');
console.log('engine refuses missing required var:', engineRefusesMissing ? 'OK' : 'FAIL');
console.log('duplicate value-port name refused:', duplicatePortRefused ? 'OK' : 'FAIL');
console.log('studio save: edit round-trip + comment retention + unmapped refusal:', editRoundTrip ? 'OK' : 'FAIL');
console.log('graph contract: edge-derived order + reversed/broken refused:', executorOk ? 'OK' : 'FAIL');
console.log('warp oscillators vs milkdropfs.cpp:1782-1787 recompute (exact):', oscOk ? 'OK' : 'FAIL');
console.log('EEL parser vs Compiler.y:55-75 grammar expectations (16 cases):', parserOk ? 'OK' : 'FAIL');
console.log('\n=== EEL functions — sources/EEL-FUNCTIONS.md (projectm-eval@da885dc) ===');
console.log(`function count (expect 36): ${eelFnCount} ${eelFnCount === 36 ? 'OK' : 'FAIL'}`);
console.log(`functions covered by cases (expect 35 table + rand sequence): ${eelCoveredCount} ${eelCoveredCount === 35 ? 'OK' : 'FAIL'}`);
console.log('rand() MT19937 fixed-seed sequence vs independent recompute:', randOk ? 'OK' : 'FAIL');
console.log(`cases: ${eelCases.length - eelFailures.length}/${eelCases.length} exact ${eelFailures.length === 0 ? 'OK' : 'FAIL'}`);
console.log('\n=== Derived audio chain — sources/AUDIO-PATH.md (projectM@2f24414) ===');
console.log('FFT zero input -> zero spectrum (exact):', fftZeroOk ? 'OK' : 'FAIL');
console.log(`FFT impulse vs equalize-table expectation (max err ${fftImpMaxErr.toExponential(1)}):`, fftImpulseOk ? 'OK' : 'FAIL');
console.log('Loudness rates + relatives vs formula recompute (exact):', loudnessOk ? 'OK' : 'FAIL');
console.log('band boundary at bin 85 discriminates bass/mid:', boundaryOk ? 'OK' : 'FAIL');
console.log('PCM ring intake: order-independent newest-576 + non-trivial:', ringOk ? 'OK' : 'FAIL');
console.log('timekeeper vs pluginshell.cpp recompute (exact at 4 frames):', timekeeperOk ? 'OK' : 'FAIL');
console.log('index.html == player.html (byte guard):', pagesSynced ? 'OK' : 'FAIL');
console.log('registry sequence grammar refuses 2-node graph + per-vertex code:', contractOk ? 'OK' : 'FAIL');
console.log('reset restores load-time baseline (vars/equations/state):', resetOk ? 'OK' : 'FAIL');
console.log('post-equation clamps + EEL-name aliasing (gamma/decay/echo_zoom):', clampAliasOk ? 'OK' : 'FAIL');
console.log('variable-contract ledger: 76 regvars classified + verified, vol absent:', varContractOk ? 'OK' : 'FAIL');
console.log('aspect factors: forward to renderState, inverse to pool (exact):', aspectOk ? 'OK' : 'FAIL');
console.log('finite-mesh warp: strip indices + identity UVs exact + zoom=0 NaN structure:', meshOk ? 'OK' : 'FAIL');
console.log('ordered source records: per-line, in order, refusal names the line:', recordsOk ? 'OK' : 'FAIL');
console.log('plane9 Color Cycle: scanner shape (7 nodes, 6 connections, CC0, FormatVersion 2) + registry dispositions (5 nodes + 5 connections refused with named facts) + standard HSL fingerprint match:', p9Ok ? 'OK' : 'FAIL');
console.log('native-op registry: unknown op + unrealizable chains refused, MilkDrop state shape intact:', registryOk ? 'OK' : 'FAIL');
console.log('native clear-color scene: fixed point + executes + pulse + port refusals:', nativeClearOk ? 'OK' : 'FAIL');
console.log('p9 conversion door: Color Cycle refuses at HSLAToColor (line 22); witnessed clear shape converts + executes; tampering refuses:', p9ConvOk ? 'OK' : 'FAIL');
console.log('MilkDrop 8-bit color wrap + decay quantization in the runtime path:', transformOk ? 'OK' : 'FAIL');
console.log('inert value port refused at engine construction (shared OP_PORTS):', inertPortOk ? 'OK' : 'FAIL');
console.log('triage scan: all refusals collected, strict import still throws first:', triageOk ? 'OK' : 'FAIL');
console.log('CSS @import chains: every page reference and import resolves:', cssImportsOk ? 'OK' : 'FAIL');
for (const [name, args] of eelFailures) { const fn = eelSubject[name]; console.log(`  FAIL: ${name}(${args.join(',')}) = ${fn ? fn(...args) : 'missing'}`); }
console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);
