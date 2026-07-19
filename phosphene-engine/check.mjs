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
import { Engine, d3dColor01, NATIVE_OPS, Xorshift128, flatPortView } from './src/engine.mjs';

// Helper — flat port view of a Scene or runtime IR, keyed by port name.
// Works for MilkDrop scenes (globally-disjoint port names by regvars
// convention); throws on duplicate names (Plane9-style scenes must use
// node-qualified access instead).
const vars = /** @param {any} sceneOrRt */ (sceneOrRt) => flatPortView(sceneOrRt);

// State-shape shim over the new render plan (reviewer foundation 2026-07-18).
// The plan is the value the sink returns; tests still ask for the specific
// per-pass shapes by name — this projects the plan back onto the old field
// layout without carrying the shared mutable state the old model used.
/** @param {any} plan */
function stateOf(plan) {
  const passes = plan?.passes ?? [];
  const wf = passes.find((/** @type {any} */ p) => p.kind === 'warp-feedback');
  const composite = passes.find((/** @type {any} */ p) => p.kind === 'composite');
  const cc = passes.find((/** @type {any} */ p) => p.kind === 'clear-color');
  /** @type {any} */
  const shim = { passes: passes.map((/** @type {any} */ p) => p.kind) };
  if (wf) {
    shim.motion = wf.motion;
    if (wf.borders.inner) shim.innerBox = wf.borders.inner;
    if (wf.borders.outer) shim.outerBox = wf.borders.outer;
  }
  if (composite) shim.comp = composite.comp;
  if (cc) shim.clear = cc.clear;
  return shim;
}
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
  const expected = refIbR(eng.getVar('time') ?? 0); // engine's own time, exact
  const got = eng.getVar('ib_r') ?? 0; // pool value — renderState colors are 8-bit converted (d3dColor01)
  maxDiff = Math.max(maxDiff, Math.abs(expected - got));
  if (i % 120 === 0) samples.push({ t: +(eng.getVar('time') ?? 0).toFixed(3), expected: +expected.toFixed(6), got: +got.toFixed(6) });
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
for (let i = 0; i < 600; i++) { meng.step(dt); mutDiff = Math.max(mutDiff, Math.abs(refIbR(meng.getVar('time') ?? 0) - (meng.getVar('ib_r') ?? 0))); }

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
const rtVars = vars(rt);
const runtimeEquiv = Object.entries(scene.vars).every(([k, v]) => rtVars[k] === v)
  && Object.keys(rtVars).every((k) => k in scene.vars || MILK_DEFAULT_KEYS.includes(k))
  && MILK_DEFAULT_KEYS.every((k) => typeof rtVars[k] === 'number')
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
  // Substrate: resources[] carries typed descriptors; an empty object
  // in the list is missing every required field and must refuse.
  ['unknown resource shape', refuses(phosText.replace(/"resources": \[[\s\S]*?\]/, '"resources": [{}]'))],
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
  // Remove the fDecay port value from its owning node — engine construction
  // must refuse (no silent defaults)
  const owner = /** @type {any} */ (r.nodes.find((/** @type {any} */ n) => 'fDecay' in n.ports));
  if (owner && owner.ports.fDecay) delete owner.ports.fDecay.value;
  try { new Engine(r); return false; } catch { return true; }
})();

// (i2) Graph-contract witnesses: the graph controls topology validation,
//      ordering, and render-state assembly under the fixed pipeline; reversed
//      edges or a broken chain are refused, and the derived order is exactly
//      warp-feedback -> borders -> composite.
const executorOk = (() => {
  const good = new Engine(toRuntime(parsePhos(phosText)));
  const orderOk = JSON.stringify(stateOf(good.step(1 / 60)).passes) === JSON.stringify(['warp-feedback', 'composite']);
  const reversed = (() => {
    const r = toRuntime(parsePhos(phosText));
    r.edges = r.edges.map((/** @type {{out:string,in:string}} */ e) => ({ out: e.in, in: e.out }));
    try { new Engine(r); return false; } catch { return true; }
  })();
  const broken = (() => {
    const r = toRuntime(parsePhos(phosText));
    r.edges = r.edges.slice(0, 1); // drop the borders->comp edge — no covering topological order over render ops
    try { new Engine(r); return false; } catch { return true; }
  })();
  return orderOk && reversed && broken;
})();

// (i3) Warp oscillators vs an independent recompute of milkdropfs.cpp:1782-1787
//      at the engine's own time (exact — same double expressions).
const oscOk = (() => {
  const e2 = new Engine(toRuntime(parsePhos(phosText)));
  const st = stateOf(e2.step(1 / 60));
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
  const editedVars = { ...vars(toRuntime(doc)), ib_g: 0.25 };
  const editedEq = ['ib_r=0.7+0.4*sin(5*time);'];
  const saved = serializePhos(updateScene(doc, editedVars, editedEq));
  const rt2 = toRuntime(parsePhos(saved));
  const rt2Vars = vars(rt2);
  const editApplied = rt2Vars.ib_g === 0.25 && rt2.expressions.perFrame[0] === editedEq[0];
  const unEditedKept = rt2Vars.ob_size === 0.2 && rt2Vars.fDecay === 0.98;
  const commentsKept = JSON.stringify(rt2.expressions.perFrameComments) === JSON.stringify(rt.expressions.perFrameComments);
  const refusesUnmapped = (() => {
    try { updateScene(parsePhos(phosText), { notAPort: 1 }, editedEq); return false; } catch { return true; }
  })();
  return editApplied && unEditedKept && commentsKept && refusesUnmapped;
})();

// (j) Duplicate port names across nodes are LEGAL at parse (node-local
//     storage, owner decision 2026-07-18) but Engine refuses an undeclared
//     port at engine construction — so adding "fDecay" to the borders node
//     parses cleanly but refuses when the engine constructs it.
const duplicatePortRefused = (() => {
  const dup = phosText.replace('"ob_size": {', '"fDecay": { "type": "float", "value": 1 }, "ob_size": {');
  let parsed;
  try { parsed = parsePhos(dup); } catch { return false; }
  try { new Engine(toRuntime(parsed)); return false; } catch (e) { return /inert port/.test(/** @type {Error} */ (e).message); }
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

// (q) Render-completeness + per-vertex refusals — the reviewer-required
//     replacement for the retired first/after/terminal grammar. The graph
//     is the sole authority: a lone clear-color with an unfed Render
//     output is a broken chain and must refuse; per-vertex code is still
//     unimplemented and must still refuse.
const contractOk = (() => {
  const loneClear = /** @type {any} */ ({
    format: 'phos/1', meta: { name: 'lone' },
    resources: [
      { id: 'clear-out', kind: 'texture', format: 'rgba8unorm', size: { policy: 'canvas' }, lifetime: 'transient', usage: ['sampled', 'render-attachment'] },
    ],
    nodes: [{ id: 'c', primitive: 'graph', op: 'clear-color', ports: { Color: { type: 'vec4', value: [0, 0, 0, 1] }, Target: { type: 'texture', value: { resourceId: 'clear-out' } }, Render: { type: 'render' } } }],
    edges: [],
    expressions: [],
  });
  const refusesLoneClear = (() => { try { new Engine(toRuntime(loneClear)); return false; } catch (e) { return /render chain is incomplete|presentation sink/i.test(/** @type {Error} */ (e).message); } })();
  const withPv = { ...toRuntime(parsePhos(phosText)) };
  withPv.expressions = { ...withPv.expressions, perVertex: ['zoom=zoom+0.1;'] };
  const refusesPerVertex = (() => { try { new Engine(withPv); return false; } catch { return true; } })();
  return refusesLoneClear && refusesPerVertex;
})();
const resetOk = (() => {
  const e2 = new Engine(toRuntime(parsePhos(phosText)));
  const baseIbG = vars(e2.scene).ib_g;
  const baseEqs = JSON.stringify(e2.perFrameSource);
  e2.setVar('ib_g', 0.123);
  e2.recompile(['ib_r=0.1;']);
  e2.step(1 / 60);
  e2.reset();
  return vars(e2.scene).ib_g === baseIbG
    && JSON.stringify(e2.perFrameSource) === baseEqs
    && e2.getVar('ib_g') === baseIbG
    && e2.frame === 0 && e2.time === 0
    && stateOf(e2.step(1 / 60)).innerBox.g === baseIbG;
})();

// (r) Post-equation clamps (milkdropfs.cpp:677-679) and EEL-name aliasing
//     (state.cpp:260-331: equations write gamma/decay/echo_zoom, not file keys).
const clampAliasOk = (() => {
  const e3 = new Engine(toRuntime(parsePhos(phosText)));
  e3.recompile(['gamma=99;']);
  const hi = stateOf(e3.step(1 / 60)).comp.gamma === 8;
  e3.recompile(['gamma=0-5;']);
  const lo = stateOf(e3.step(1 / 60)).comp.gamma === 0;
  e3.recompile(['echo_zoom=0;']);
  const ez = stateOf(e3.step(1 / 60)).comp.echoZoom === 0.001;
  e3.recompile(['gamma=4;', 'decay=0.5;']);
  const st = stateOf(e3.step(1 / 60));
  const alias = st.comp.gamma === 4 && st.motion.decay === d3dColor01(0.5); // decay renders 8-bit quantized (:2007)
  const get = e3.getVar('fGammaAdj') === 4 && e3.getVar('gamma') === 4; // studio reads through both file-key and EEL alias
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
  const st = stateOf(e4.step(1 / 60));
  const injectedOk = c.engine.every((n) => Number.isFinite(e4.pool[n]));
  // mapped names: a FRESH engine (equations move vars post-step) carries every
  // scene file-key under its EEL name with the scene's value
  const e5 = new Engine(toRuntime(parsePhos(phosText)));
  const e5Vars = vars(e5.scene);
  const mappedOk = Object.entries(c.mapped).every(([fk, en]) =>
    !(fk in e5Vars) || e5.getVar(en) === e5Vars[fk]);
  // equation-visible defaults: fresh pool carries each witnessed default value
  const defaultsOk = Object.entries(c.defaults).every(([n, v]) => e5.pool[n] === v);
  const volAbsent = e4.pool.vol === undefined && e4.pool.vol_att === undefined;
  // MilkDrop plan: warp-feedback (with borders folded into it) + composite
  const progressOk = st.passes.length === 2 && e4.pool.progress === e4.time / 16;
  return injectedOk && mappedOk && defaultsOk && volAbsent && progressOk;
})();

// (t) Aspect factors from the render-target size (plugin.cpp:2027-2030) reach
//     renderState as forward factors and the pool as INVERSE factors
//     (m_fInvAspectX/Y, milkdropfs.cpp:545-546). Exact recompute, same exprs.
const aspectOk = (() => {
  const e6 = new Engine(toRuntime(parsePhos(phosText)));
  const tw = 1920, th = 1080;
  e6.setViewport(tw, th, tw, th);
  const st = stateOf(e6.step(1 / 60));
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
  const wrapOk = stateOf(new Engine(toRuntime(parsePhos(phosText))).step(1 / 60)).motion.wrap === 1;
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
  const st7 = stateOf(e7.step(1 / 60));
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
  const pages = ['index.html', 'player.html', 'studio.html'];
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
  if (nodes.length !== 7 || conns.length !== 6 || refused.length !== 0) return false;
  if (!root || !String(root.value).includes('FormatVersion="2"')) return false;
  if (!lic || !lic.raw.includes('CC0')) return false;
  // Dispositions under the source-compatibility gate (reviewer foundation
  // 2026-07-18): Screen, Clear pass on their evidence; HSLAToColor,
  // MinMax, Beat REFUSE as UNRESOLVED. Three MinMax nodes + one Beat +
  // one HSLAToColor = five UNRESOLVED node refusals, plus five value-edge
  // connections whose endpoints touch refused nodes = five refused edges.
  if (dis.filter(d => !d.ok && /Plane9 conversion REFUSED \(UNRESOLVED\)/.test(d.text)).length < 5) return false;
  if (!dis.some(d => d.ok && d.text.startsWith('Screen — Plane9 conversion PASS'))) return false;
  if (!dis.some(d => d.ok && d.text.startsWith('Clear — Plane9 conversion PASS'))) return false;
  if (dis.filter(d => !d.ok && /^MinMax — Plane9 conversion REFUSED/.test(d.text)).length !== 3) return false;
  if (!dis.some(d => !d.ok && /^Beat — Plane9 conversion REFUSED/.test(d.text))) return false;
  if (!dis.some(d => !d.ok && /^HSLAToColor — Plane9 conversion REFUSED/.test(d.text))) return false;
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

// (ab) Native-operation registry — unknown ops, unrealizable chains, and
//      mistyped edges all refuse at construction; the accepted MilkDrop
//      chain contributes exactly its four state groups and no clear state.
const registryOk = (() => {
  const rt0 = () => toRuntime(parsePhos(phosText));
  const unknownOp = (() => {
    const r = rt0();
    r.nodes = [{ id: 'x', op: 'wibble', ports: {} }];
    r.edges = [];
    try { new Engine(r); return false; } catch (e) { return /not a registered native operation/.test(/** @type {Error} */ (e).message); }
  })();
  const disconnectedRenderOutput = (() => {
    // Retire the sequence grammar in favor of the pure dataflow rule: an
    // edge from clear-color.Render into borders.in is a type-correct edge
    // (render->render), but borders' out has no outgoing edge, so the
    // render chain is incomplete. This is the "graph-as-sole-authority"
    // replacement for first/after/terminal.
    const r = rt0();
    r.resources = /** @type {any} */ ([
      { id: 'clear-out', kind: 'texture', format: 'rgba8unorm', size: { policy: 'canvas' }, lifetime: 'transient', usage: ['sampled', 'render-attachment'] },
    ]);
    r.nodes = [
      { id: 'c', op: 'clear-color', ports: { Color: { type: 'vec4', value: [0, 0, 0, 1] }, Target: { type: 'texture', value: { resourceId: 'clear-out' } }, Render: { type: 'render' } } },
      { id: 'b', op: 'borders', ports: /** @type {any} */ ({
        ib_size: { type: 'float', value: 0.1 }, ib_r: { type: 'float', value: 1 }, ib_g: { type: 'float', value: 1 }, ib_b: { type: 'float', value: 1 }, ib_a: { type: 'float', value: 1 },
        ob_size: { type: 'float', value: 0.1 }, ob_r: { type: 'float', value: 1 }, ob_g: { type: 'float', value: 1 }, ob_b: { type: 'float', value: 1 }, ob_a: { type: 'float', value: 1 },
        in: { type: 'render' }, out: { type: 'render' },
      }) },
    ];
    r.edges = [{ out: 'c.Render', in: 'b.in' }];
    try { new Engine(r); return false; } catch (e) { return /render chain is incomplete|has no outgoing edge|presentation sink/.test(/** @type {Error} */ (e).message); }
  })();
  const mistypedEdge = (() => {
    // borders.out is 'render'; borders.ib_r is 'float' — swapping edge target
    // is refused by the edge-type check
    const r = rt0();
    r.edges = [{ out: 'warp.out', in: 'borders.in' }, { out: 'borders.out', in: 'comp.fGammaAdj' }];
    try { new Engine(r); return false; } catch (e) { return /mismatched port types/.test(/** @type {Error} */ (e).message); }
  })();
  const mdState = stateOf(new Engine(rt0()).step(1 / 60));
  const mdShape = mdState.motion !== undefined && mdState.innerBox !== undefined
    && mdState.outerBox !== undefined && mdState.comp !== undefined && mdState.clear === undefined;
  return unknownOp && disconnectedRenderOutput && mistypedEdge && mdShape;
})();

// (ac) Committed native clear-color scene: parses, canonical fixed point,
//      executes through the shared engine, and demonstrates value-edge
//      dataflow — per-frame EEL animates rgba.Blue, RGBAToColor packs it
//      into a vec4 Color, an edge propagates that vec4 into clear-color's
//      Color port, and the render state emits the clear.
const nativeClearOk = (() => {
  const t2 = readFileSync(new URL('./scenes/native-clear.phos', import.meta.url), 'utf8');
  const doc = parsePhos(t2);
  if (serializePhos(doc) !== t2) return false;
  const e = new Engine(toRuntime(doc));
  const st = stateOf(e.step(1 / 60));
  if (JSON.stringify(st.passes) !== JSON.stringify(['clear-color'])) return false;
  if (st.clear.r !== 0 || st.clear.g !== 0.35 || st.clear.a !== 1) return false;
  if (st.clear.b !== 0.25 + 0.15 * Math.sin(e.getVar('time') ?? 0)) return false;
  // missing declared port refuses (no silent defaults)
  const r2 = toRuntime(parsePhos(t2));
  const rgbaNode = /** @type {any} */ (r2.nodes.find((/** @type {any} */ n) => n.op === 'RGBAToColor'));
  if (rgbaNode && rgbaNode.ports.Green) delete rgbaNode.ports.Green.value;
  const missingRefused = (() => { try { new Engine(r2); return false; } catch { return true; } })();
  // an undeclared extra value port refuses (no inert ports)
  const r3 = toRuntime(parsePhos(t2));
  const rgba3 = /** @type {any} */ (r3.nodes.find((/** @type {any} */ n) => n.op === 'RGBAToColor'));
  if (rgba3) rgba3.ports.mystery = { type: 'float', value: 1 };
  const inertRefused = (() => { try { new Engine(r3); return false; } catch { return true; } })();
  return missingRefused && inertRefused;
})();

// (ac2) Native hue-cycle scene: MinMax(Mode=Rand, 0..360, ITime 5..10s) drives
//       HSLAToColor.Hue via a float edge; HSLAToColor packs to a vec4 Color;
//       clear-color fills the canvas with that color. Verifies four things:
//       (1) canonical round-trip serialize/parse; (2) the plan carries exactly
//       one clear-color pass; (3) at every step the C = max(rgb) - min(rgb)
//       chroma invariant equals (1 - |2L-1|) * S = 0.7 exactly (this is the
//       HSL formula's structural signature — no matter which Hue MinMax
//       produces, an HSL(H, 0.7, 0.5, 1) color has chroma 0.7); (4) the color
//       changes across a large dt window, so MinMax → HSL → clear animates.
const nativeHueCycleOk = (() => {
  const src = readFileSync(new URL('./scenes/native-hue-cycle.phos', import.meta.url), 'utf8');
  const doc = parsePhos(src);
  if (serializePhos(doc) !== src) return false;
  const e = new Engine(toRuntime(doc));
  const plan1 = /** @type {any} */ (e.step(1 / 60));
  if (!plan1 || plan1.passes.length !== 1 || plan1.passes[0].kind !== 'clear-color') return false;
  const clear1 = plan1.passes[0].clear;
  if (clear1.a !== 1) return false;
  const chroma = (/** @type {{r:number,g:number,b:number}} */ c) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
  const S = 0.7, L = 0.5;
  const expectedC = (1 - Math.abs(2 * L - 1)) * S;
  if (Math.abs(chroma(clear1) - expectedC) > 1e-9) return false;
  // Step past one full interp window (ITimeMax=10s) and further, then verify
  // (a) the chroma invariant still holds and (b) the color has moved.
  for (let i = 0; i < 20; i++) e.step(1);
  const planLate = /** @type {any} */ (e.step(1 / 60));
  const clearLate = planLate.passes[0].clear;
  if (Math.abs(chroma(clearLate) - expectedC) > 1e-9) return false;
  const moved = Math.abs(clearLate.r - clear1.r) > 1e-6
             || Math.abs(clearLate.g - clear1.g) > 1e-6
             || Math.abs(clearLate.b - clear1.b) > 1e-6;
  return moved;
})();

// (ad) Plane9 conversion door: the source-compatibility gate refuses Color
//      Cycle because HSLAToColor/MinMax/Beat are UNRESOLVED, and the
//      Screen+Clear-only shape (Black.p9c and the synthetic clearXml below)
//      converts, canonically round-trips, and executes end-to-end.
const p9ConvOk = (() => {
  const fixtureXml = readFileSync(new URL('../sources/plane9/color-cycle.scene.xml', import.meta.url), 'utf8');
  const fixtureConverts = (() => {
    try { p9ToPhos(fixtureXml, { file: 'color-cycle.scene.xml', sha256: 'testsha' }); return false; }
    catch (e) {
      const msg = /** @type {Error} */ (e).message;
      // Color Cycle must refuse at its first UNRESOLVED node — HSLAToColor
      // at scene.xml line 22. The refusal message must name the UNRESOLVED
      // status so the reason is visible in triage.
      return /line 22/.test(msg) && /HSLAToColor/.test(msg) && /UNRESOLVED/.test(msg);
    }
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
  const st = stateOf(e.step(1 / 60));
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
    // Adding a Beat node — Beat is UNRESOLVED, so the compatibility gate
    // refuses at the Beat node before it can be reached by any other check.
    const withBeat = good.replace('\t</Nodes>',
      '\t\t<Node Type="Beat" Name="Beat1">\n\t\t\t<Port Id="NoMusic" Value="0.5"/>\n\t\t</Node>\n\t</Nodes>');
    try { p9ToPhos(withBeat, { file: 'x.p9c', sha256: 'x' }); return false; }
    catch (e2) { const msg = /** @type {Error} */ (e2).message; return /Beat/.test(msg) && /UNRESOLVED/.test(msg); }
  })();
  const badColorRefused = (() => {
    try { p9ToPhos(clearXml('45', '0.25 0.5'), { file: 'x.p9c', sha256: 'x' }); return false; }
    catch { return true; }
  })();
  return fixtureConverts && executes && cameraDeviationRefused && brokenWiringRefused && extraNodeRefused && badColorRefused;
})();

// (ae) Shared RNG — Xorshift128 with Marsaglia's seed is reproducible.
//      A fresh RNG's first 8 draws are identical to a second fresh RNG's,
//      and setState reproduces a specific state exactly.
const rngOk = (() => {
  const a = new Xorshift128();
  const b = new Xorshift128();
  const seqA = [], seqB = [];
  for (let i = 0; i < 8; i++) { seqA.push(a.next32()); seqB.push(b.next32()); }
  if (JSON.stringify(seqA) !== JSON.stringify(seqB)) return false;
  // known Marsaglia seed produces sequence deterministically; first draw
  // must be a non-zero, in-range uint32
  const c = new Xorshift128();
  const first = c.next32();
  if (first === 0 || first >>> 0 !== first) return false;
  // setState reproduces
  c.setState(1, 2, 3, 4);
  const s = c.getState();
  if (s.length !== 4 || s[0] !== 1 || s[1] !== 2 || s[2] !== 3 || s[3] !== 4) return false;
  return true;
})();

// (af) MinMax value op — every mode's behavior on a single node driven by
//      constant inputs, verified against direct closed-form computation.
//      RNG is shared across draws so state.getState changes visibly per
//      transition; each mode ticks at 1/60s over enough frames to observe
//      full state-machine cycles.
const minmaxOk = (() => {
  const op = /** @type {any} */ (NATIVE_OPS.MinMax);
  const rng = new Xorshift128();
  // helper: run a single MinMax node with fixed inputs for N frames
  const run = (/** @type {Record<string,number>} */ inputs, /** @type {number} */ frames, /** @type {number} */ dt) => {
    const state = op.initState(inputs);
    /** @type {number[]} */
    const trace = [];
    for (let i = 0; i < frames; i++) {
      const out = op.compute({ inputs, state, dt, frame: i + 1, time: (i + 1) * dt, audio: { musicActive: false, rawBeat: 0 }, rng });
      trace.push(out.Value);
    }
    return trace;
  };
  // Mode 0 (None) — value never changes (initial = Min)
  const noneTrace = run({ Min: 5, Max: 10, Mode: 0, DelayMin: 0, DelayMax: 0, DelayMode: 1, ITimeMin: 1, ITimeMax: 1, ITimeMode: 1 }, 5, 1 / 60);
  if (!noneTrace.every((v) => v === 5)) return false;

  // Mode 3 (LoopUp) — linear from Min to Max over ITime seconds, resets to Min at end
  {
    rng.reset();
    const inp = { Min: 0, Max: 10, Mode: 3, DelayMin: 0, DelayMax: 0, DelayMode: 1, ITimeMin: 1, ITimeMax: 1, ITimeMode: 1 };
    const trace = run(inp, 90, 1 / 60);
    // after ~60 frames = 1 second, value should reach Max, then reset to Min
    const midpoint = trace[29]; // ~0.5s in, expect ~5 (linear)
    if (midpoint === undefined || Math.abs(midpoint - 5) > 0.2) return false;
    const atOneSec = trace[59];
    if (atOneSec === undefined || Math.abs(atOneSec - 10) > 0.2) return false;
    // after reset, next frame should be back near Min
    const afterReset = trace[62];
    if (afterReset === undefined || afterReset > 2) return false;
  }

  // Mode 4 (LoopDown) — linear from Max to Min
  {
    rng.reset();
    const inp = { Min: 0, Max: 10, Mode: 4, DelayMin: 0, DelayMax: 0, DelayMode: 1, ITimeMin: 1, ITimeMax: 1, ITimeMode: 1 };
    const trace = run(inp, 60, 1 / 60);
    // ~0.5s in (frame index 29): linear midpoint of Max->Min = 5
    const midpoint = trace[29];
    if (midpoint === undefined || Math.abs(midpoint - 5) > 0.2) return false;
    // ~1s in: snap to Min
    const atEnd = trace[59];
    if (atEnd === undefined || Math.abs(atEnd - 0) > 0.2) return false;
  }

  // Mode 5 (PingPong) — smoothstep alternates direction at endpoints
  {
    rng.reset();
    const inp = { Min: 0, Max: 10, Mode: 5, DelayMin: 0, DelayMax: 0, DelayMode: 1, ITimeMin: 1, ITimeMax: 1, ITimeMode: 1 };
    const trace = run(inp, 180, 1 / 60);
    // must reach Max around 1s and Min again around 2s
    const atOneSec = trace[59];
    const atTwoSec = trace[119];
    if (atOneSec === undefined || atTwoSec === undefined) return false;
    if (Math.abs(atOneSec - 10) > 0.5 || Math.abs(atTwoSec - 0) > 0.5) return false;
  }

  // Mode 1 (Rand) — smoothstep interp toward a random target
  //   Determinism: with a fresh RNG both runs produce the same trace.
  {
    const inp = { Min: 0, Max: 1, Mode: 1, DelayMin: 0, DelayMax: 0, DelayMode: 1, ITimeMin: 1, ITimeMax: 1, ITimeMode: 1 };
    rng.reset();
    const t1 = run(inp, 30, 1 / 60);
    rng.reset();
    const t2 = run(inp, 30, 1 / 60);
    if (JSON.stringify(t1) !== JSON.stringify(t2)) return false;
    // value must stay in range
    if (!t1.every((v) => v >= 0 - 1e-9 && v <= 1 + 1e-9)) return false;
  }

  // Mode 2 (RandShortestDist) — wraps into range
  {
    const inp = { Min: 0, Max: 360, Mode: 2, DelayMin: 0, DelayMax: 0, DelayMode: 1, ITimeMin: 1, ITimeMax: 1, ITimeMode: 1 };
    rng.reset();
    const trace = run(inp, 30, 1 / 60);
    if (!trace.every((v) => v >= 0 - 1e-6 && v <= 360 + 1e-6)) return false;
  }

  // Smoothstep vs linear discriminator: at t=0.25, smoothstep = 3(0.25)²−2(0.25)³
  // = 0.15625; linear = 0.25. For same Min/Max/ITime, Mode 1 (smoothstep) and
  // Mode 3 (linear) must differ at that fraction of the interpolation.
  {
    const dt = 1 / 60;
    const startInp = { Min: 0, Max: 10, Mode: 3, DelayMin: 0, DelayMax: 0, DelayMode: 1, ITimeMin: 1, ITimeMax: 1, ITimeMode: 1 };
    rng.reset();
    // LoopUp for 15 frames (~0.25s) — linear at 0.25 * 10 = 2.5
    const linearTrace = run(startInp, 15, dt);
    // Rand for 15 frames — smoothstep towards a target (rng-picked). To
    // compare cleanly, use the same target: force smoothstep by measuring
    // curve shape directly rather than through Rand.
    // Instead: build a synthetic case where target=Max (like LoopUp): use
    // PingPong first ITime — smoothstep towards Max.
    rng.reset();
    const ppInp = { Min: 0, Max: 10, Mode: 5, DelayMin: 0, DelayMax: 0, DelayMode: 1, ITimeMin: 1, ITimeMax: 1, ITimeMode: 1 };
    const smoothTrace = run(ppInp, 15, dt);
    const linearAt = linearTrace[14];
    const smoothAt = smoothTrace[14];
    if (linearAt === undefined || smoothAt === undefined) return false;
    // linear at ~0.25s: t=15/60=0.25, value ≈ 0.25*10 = 2.5
    // smoothstep at ~0.25s: 3(0.25)²−2(0.25)³ = 0.15625, value ≈ 1.5625
    if (!(linearAt > smoothAt + 0.5)) return false;
    if (Math.abs(linearAt - 2.5) > 0.2) return false;
    if (Math.abs(smoothAt - 1.5625) > 0.2) return false;
  }

  return true;
})();

// (ag) Beat value op — inactive path is direct pass-through; active path is
//      linear composition capped at max(Min, Max).
const beatOk = (() => {
  const op = /** @type {any} */ (NATIVE_OPS.Beat);
  const rng = new Xorshift128();
  const call = (/** @type {Record<string,number>} */ inputs, /** @type {any} */ audio) =>
    /** @type {{BeatStrength:number}} */ (op.compute({ inputs, state: {}, dt: 1 / 60, frame: 1, time: 1 / 60, audio, rng }));

  // Inactive: BeatStrength = NoMusic verbatim (no amp/clamp/remap)
  const inactive = call({ NoMusic: 0.4, Amplification: 4, Min: 0.3, Max: 1 }, { musicActive: false, rawBeat: 0.7 });
  if (inactive.BeatStrength !== 0.4) return false;

  // Active, formula: Min + rawBeat * Amp * (Max - Min), then cap at max(Min, Max)
  //   Min=0.3, Max=1, Amp=4, rawBeat=0.1 -> 0.3 + 0.1*4*0.7 = 0.58
  const a1 = call({ NoMusic: 0.4, Amplification: 4, Min: 0.3, Max: 1 }, { musicActive: true, rawBeat: 0.1 });
  if (Math.abs(a1.BeatStrength - 0.58) > 1e-12) return false;

  // Active with cap: rawBeat=1, Amp=4, range=0.7 -> raw=0.3 + 2.8 = 3.1 -> cap to 1
  const a2 = call({ NoMusic: 0.4, Amplification: 4, Min: 0.3, Max: 1 }, { musicActive: true, rawBeat: 1 });
  if (a2.BeatStrength !== 1) return false;

  // Active with Min>Max: max(Min,Max) = Min = 0.9
  const a3 = call({ NoMusic: 0.4, Amplification: 2, Min: 0.9, Max: 0.3 }, { musicActive: true, rawBeat: 1 });
  // raw = 0.9 + 1*2*(0.3-0.9) = 0.9 - 1.2 = -0.3 (below cap 0.9); returns -0.3
  if (Math.abs(a3.BeatStrength - -0.3) > 1e-12) return false;

  return true;
})();

// (ah) HSLAToColor value op — general HSL-to-RGB formula, verified at the
//      retained Color Cycle vector plus a couple of canonical points.
const hslOk = (() => {
  const op = /** @type {any} */ (NATIVE_OPS.HSLAToColor);
  const call = (/** @type {Record<string,number>} */ inputs) =>
    /** @type {{Color: number[]}} */ (op.compute({ inputs, state: {}, dt: 0, frame: 0, time: 0, audio: { musicActive: false, rawBeat: 0 }, rng: new Xorshift128() }));
  const pick = (/** @type {number[]} */ arr, /** @type {number} */ i) => /** @type {number} */ (arr[i] ?? NaN);
  // Color Cycle's retained vector: Hue 215.7, S 0.697156, L 0.127359, A 1 -> ~0.03857 0.11049 0.21615 1
  const cc = call({ Hue: 215.7, Saturation: 0.697156, Lightness: 0.127359, Alpha: 1 }).Color;
  if (Math.abs(pick(cc, 0) - 0.03857) > 1e-4) return false;
  if (Math.abs(pick(cc, 1) - 0.11049) > 1e-4) return false;
  if (Math.abs(pick(cc, 2) - 0.216148) > 1e-4) return false;
  if (pick(cc, 3) !== 1) return false;
  const red = call({ Hue: 0, Saturation: 1, Lightness: 0.5, Alpha: 1 }).Color;
  if (Math.abs(pick(red, 0) - 1) > 1e-9 || Math.abs(pick(red, 1)) > 1e-9 || Math.abs(pick(red, 2)) > 1e-9) return false;
  const green = call({ Hue: 120, Saturation: 1, Lightness: 0.5, Alpha: 1 }).Color;
  if (Math.abs(pick(green, 0)) > 1e-9 || Math.abs(pick(green, 1) - 1) > 1e-9 || Math.abs(pick(green, 2)) > 1e-9) return false;
  return true;
})();

// (ai) Color Cycle Plane9 compatibility RETRACTED 2026-07-18 (reviewer
//      foundation): the fixture refuses at conversion because HSLAToColor,
//      MinMax, and Beat are UNRESOLVED. This check asserts the refusal
//      structurally — Color Cycle does NOT run through PHOSPHENE's
//      provisional MinMax/Beat/HSL implementations to produce a Plane9-
//      compatibility green.
const colorCycleOk = (() => {
  const xml = readFileSync(new URL('../sources/plane9/color-cycle.scene.xml', import.meta.url), 'utf8');
  try {
    p9ToPhos(xml, { file: 'color-cycle.scene.xml', sha256: 'testsha' });
    return false; // conversion succeeding is the failure
  } catch (e) {
    const msg = /** @type {Error} */ (e).message;
    // The first UNRESOLVED node encountered is HSLAToColor at line 22.
    return /line 22/.test(msg) && /HSLAToColor/.test(msg) && /UNRESOLVED/.test(msg);
  }
})();

// (aj) DelayMode/ITimeMode scope guard — the executor implements only the
//      "=1" behavior (uniform-random selection); other values REFUSE at
//      Engine construction. This is the scope-narrowing the reviewer
//      required to stop the "ports declared as functional while having
//      no effect" failure mode (sip-phosphene review 2026-07-18 finding 1).
const delayItimeModeGuardOk = (() => {
  // The Engine's DelayMode/ITimeMode guard exists for native scenes that
  // use PHOSPHENE's MinMax op (Plane9 conversion refuses MinMax at the
  // compatibility gate). Build a synthetic native scene with one MinMax
  // whose Value feeds an RGBAToColor.Red, then vary DelayMode/ITimeMode.
  const mkScene = (/** @type {number} */ delayMode, /** @type {number} */ iTimeMode) => /** @type {any} */ ({
    format: 'phos/1', meta: { name: 'guard' },
    resources: [
      { id: 'clear-out', kind: 'texture', format: 'rgba8unorm', size: { policy: 'canvas' }, lifetime: 'transient', usage: ['sampled', 'render-attachment'] },
    ],
    nodes: [
      { id: 'mm', primitive: 'graph', op: 'MinMax', ports: {
        Min: { type: 'float', value: 0 }, Max: { type: 'float', value: 1 }, Mode: { type: 'float', value: 1 },
        DelayMin: { type: 'float', value: 0 }, DelayMax: { type: 'float', value: 0 }, DelayMode: { type: 'float', value: delayMode },
        ITimeMin: { type: 'float', value: 1 }, ITimeMax: { type: 'float', value: 1 }, ITimeMode: { type: 'float', value: iTimeMode },
        Value: { type: 'float' },
      } },
      { id: 'rgba', primitive: 'graph', op: 'RGBAToColor', ports: {
        Red: { type: 'float' }, Green: { type: 'float', value: 0 }, Blue: { type: 'float', value: 0 }, Alpha: { type: 'float', value: 1 },
        Color: { type: 'vec4' },
      } },
      { id: 'c', primitive: 'graph', op: 'clear-color', ports: { Color: { type: 'vec4' }, Target: { type: 'texture', value: { resourceId: 'clear-out' } }, Render: { type: 'render' } } },
      { id: 's', primitive: 'graph', op: 'screen', ports: {
        Viewport: { type: 'vec4', value: [0, 0, 1, 1] },
        CamPos: { type: 'vec3', value: [0, 0, -2] }, CamRot: { type: 'vec3', value: [0, 0, 0] }, CamLookAt: { type: 'vec3', value: [0, 0, 1] },
        CamLookAtInWorldSpace: { type: 'float', value: 0 }, CamFov: { type: 'float', value: 45 }, CamNear: { type: 'float', value: 0.1 }, CamFar: { type: 'float', value: 1000 },
        ScaleByAspect: { type: 'float', value: 0 }, Render: { type: 'render' },
      } },
    ],
    edges: [
      { out: 'mm.Value', in: 'rgba.Red' }, { out: 'rgba.Color', in: 'c.Color' }, { out: 'c.Render', in: 's.Render' },
    ],
    expressions: [],
  });
  const baselineOk = (() => { try { new Engine(toRuntime(mkScene(1, 1))); return true; } catch { return false; } })();
  const dm0Refuses = (() => { try { new Engine(toRuntime(mkScene(0, 1))); return false; } catch (e) { const m = /** @type {Error} */ (e).message; return /"DelayMode"=0/.test(m) && /witnessed value/.test(m); } })();
  const im2Refuses = (() => { try { new Engine(toRuntime(mkScene(1, 2))); return false; } catch (e) { const m = /** @type {Error} */ (e).message; return /"ITimeMode"=2/.test(m) && /witnessed value/.test(m); } })();
  return baselineOk && dm0Refuses && im2Refuses;
})();

// (ak) Ambiguous-graph refusal — multi-driver last-writer-wins and
//      disconnected render pipelines both refuse at Engine construction
//      (reviewer 2026-07-18 finding 7).
// (al) Render-plan dataflow + presentation-sink invariant (reviewer
//      foundation 2026-07-18): a plan whose warp-feedback pass reaches
//      composite carries the borders through the pass structure; a
//      graph with two independent render chains refuses because it has
//      two presentation sinks and the single-canvas front end can only
//      present one plan per frame.
const renderPlanFoundationOk = (() => {
  const {readFileSync: rd} = { readFileSync };
  const md = rd(new URL('./scenes/md-101-per_frame.phos', import.meta.url), 'utf8');
  const mdPlan = new Engine(toRuntime(parsePhos(md))).step(1 / 60);
  // MilkDrop plan: warp-feedback pass carries borders folded into it,
  // followed by a composite pass
  const md0 = /** @type {any} */ (mdPlan?.passes[0]);
  const md1 = /** @type {any} */ (mdPlan?.passes[1]);
  const mdShapeOk = mdPlan !== null && mdPlan.passes.length === 2
    && md0?.kind === 'warp-feedback' && md0?.borders?.inner !== null && md0?.borders?.outer !== null
    && md1?.kind === 'composite';
  // Two independent render chains would have two sinks — refuse
  const twoChains = /** @type {any} */ ({
    format: 'phos/1', meta: { name: 'two' },
    resources: [
      { id: 'a-out', kind: 'texture', format: 'rgba8unorm', size: { policy: 'canvas' }, lifetime: 'transient', usage: ['sampled', 'render-attachment'] },
      { id: 'b-out', kind: 'texture', format: 'rgba8unorm', size: { policy: 'canvas' }, lifetime: 'transient', usage: ['sampled', 'render-attachment'] },
    ],
    nodes: [
      { id: 'c1', primitive: 'graph', op: 'clear-color', ports: { Color: { type: 'vec4', value: [0, 0, 0, 1] }, Target: { type: 'texture', value: { resourceId: 'a-out' } }, Render: { type: 'render' } } },
      { id: 's1', primitive: 'graph', op: 'screen', ports: {
        Viewport: { type: 'vec4', value: [0, 0, 1, 1] },
        CamPos: { type: 'vec3', value: [0, 0, -2] }, CamRot: { type: 'vec3', value: [0, 0, 0] }, CamLookAt: { type: 'vec3', value: [0, 0, 1] },
        CamLookAtInWorldSpace: { type: 'float', value: 0 }, CamFov: { type: 'float', value: 45 }, CamNear: { type: 'float', value: 0.1 }, CamFar: { type: 'float', value: 1000 },
        ScaleByAspect: { type: 'float', value: 0 }, Render: { type: 'render' },
      } },
      { id: 'c2', primitive: 'graph', op: 'clear-color', ports: { Color: { type: 'vec4', value: [0, 0, 0, 1] }, Target: { type: 'texture', value: { resourceId: 'b-out' } }, Render: { type: 'render' } } },
      { id: 's2', primitive: 'graph', op: 'screen', ports: {
        Viewport: { type: 'vec4', value: [0, 0, 1, 1] },
        CamPos: { type: 'vec3', value: [0, 0, -2] }, CamRot: { type: 'vec3', value: [0, 0, 0] }, CamLookAt: { type: 'vec3', value: [0, 0, 1] },
        CamLookAtInWorldSpace: { type: 'float', value: 0 }, CamFov: { type: 'float', value: 45 }, CamNear: { type: 'float', value: 0.1 }, CamFar: { type: 'float', value: 1000 },
        ScaleByAspect: { type: 'float', value: 0 }, Render: { type: 'render' },
      } },
    ],
    edges: [ { out: 'c1.Render', in: 's1.Render' }, { out: 'c2.Render', in: 's2.Render' } ],
    expressions: [],
  });
  const twoSinksRefused = (() => { try { new Engine(toRuntime(twoChains)); return false; } catch (e) { return /2 presentation sink|two presentation sinks|exactly one is required/i.test(/** @type {Error} */ (e).message); } })();
  // A clear-color followed by borders should refuse — borders extends a
  // warp-feedback pass, not a clear-color pass, and the plan model surfaces
  // that at contribute-time as a data-shape refusal.
  const clearThenBorders = /** @type {any} */ ({
    format: 'phos/1', meta: { name: 'wrong' },
    resources: [
      { id: 'clear-out', kind: 'texture', format: 'rgba8unorm', size: { policy: 'canvas' }, lifetime: 'transient', usage: ['sampled', 'render-attachment'] },
      { id: 'md-feedback', kind: 'texture', format: 'rgba8unorm', size: { policy: 'canvas-16block' }, lifetime: 'persistent-pingpong', usage: ['sampled', 'render-attachment'] },
      { id: 'canvas', kind: 'presentation', format: 'preferred-canvas', size: { policy: 'canvas' }, lifetime: 'per-frame', usage: ['render-attachment', 'presentation'] },
    ],
    nodes: [
      { id: 'c', primitive: 'graph', op: 'clear-color', ports: { Color: { type: 'vec4', value: [0, 0, 0, 1] }, Target: { type: 'texture', value: { resourceId: 'clear-out' } }, Render: { type: 'render' } } },
      { id: 'b', primitive: 'shader', op: 'borders', ports: {
        ib_size: { type: 'float', value: 0 }, ib_r: { type: 'float', value: 0 }, ib_g: { type: 'float', value: 0 }, ib_b: { type: 'float', value: 0 }, ib_a: { type: 'float', value: 0 },
        ob_size: { type: 'float', value: 0 }, ob_r: { type: 'float', value: 0 }, ob_g: { type: 'float', value: 0 }, ob_b: { type: 'float', value: 0 }, ob_a: { type: 'float', value: 0 },
        in: { type: 'render' }, out: { type: 'render' },
      } },
      { id: 'cp', primitive: 'graph', op: 'composite', ports: {
        fGammaAdj: { type: 'float', value: 1 }, fVideoEchoZoom: { type: 'float', value: 1 }, fVideoEchoAlpha: { type: 'float', value: 0 }, nVideoEchoOrientation: { type: 'float', value: 0 },
        in: { type: 'render' }, Target: { type: 'texture', value: { resourceId: 'canvas' } },
      } },
    ],
    edges: [ { out: 'c.Render', in: 'b.in' }, { out: 'b.out', in: 'cp.in' } ],
    expressions: [],
  });
  const eng = new Engine(toRuntime(clearThenBorders));
  const clearThenBordersRefused = (() => { try { eng.step(1 / 60); return false; } catch (e) { return /borders augments a warp-feedback pass/.test(/** @type {Error} */ (e).message); } })();
  return mdShapeOk && twoSinksRefused && clearThenBordersRefused;
})();

// (am) Render fan-out isolation (reviewer 2026-07-18): drive a real fan-out
//      graph through the Engine — one source's Render output feeds two
//      independent branches that both feed a two-input presentation sink —
//      and observe that mutating branch A's plan leaves branch B's plan
//      untouched. Prior versions of this test called structuredClone directly
//      or ran a single-edge scene; both proved shape rather than the fan-out
//      the Engine's step() actually performs. Two test-local ops are
//      registered on NATIVE_OPS: a passthrough render op with in/out ports,
//      and a two-input inspection sink that captures both inputs on a
//      module-scoped witness object so the test can inspect them post-step.
const fanOutWitness = /** @type {{value: {a: any, b: any} | null}} */ ({ value: null });
/** @type {any} */ (NATIVE_OPS)['test-passthrough'] = {
  kind: 'render',
  inputs: { in: 'render' },
  outputs: { out: 'render' },
  contribute(/** @type {any} */ inputRefs) {
    const inRef = inputRefs.in;
    if (!inRef) throw new Error('test-passthrough requires an incoming render reference on "in" — refusing');
    return { out: inRef };
  },
};
/** @type {any} */ (NATIVE_OPS)['test-inspect-sink'] = {
  kind: 'render',
  inputs: { A: 'render', B: 'render' },
  outputs: { presented: 'render' },
  contribute(/** @type {any} */ inputRefs, /** @type {any} */ _ports, /** @type {any} */ _pool, /** @type {any} */ _eng, /** @type {any} */ plan) {
    if (!inputRefs.A || !inputRefs.B) throw new Error('test-inspect-sink requires both A and B — refusing');
    fanOutWitness.value = { a: inputRefs.A, b: inputRefs.B };
    plan.presentation = { resourceId: inputRefs.A.resourceId };
    return { presented: inputRefs.A };
  },
};
// Under the resource-ref substrate, fan-out propagates ResourceRef
// objects (id strings) rather than mutable plans. This test verifies
// that a single source's render output flows through two branches into
// a two-input sink, and both branches see the same resource id at the
// sink — the exact resource identity is stable across the fan-out.
const renderFanOutOk = (() => {
  fanOutWitness.value = null;
  /** @type {any} */
  const scene = {
    format: 'phos/1', meta: { name: 'fanout' },
    resources: [
      { id: 'src-out', kind: 'texture', format: 'rgba8unorm', size: { policy: 'canvas' }, lifetime: 'transient', usage: ['sampled', 'render-attachment'] },
    ],
    nodes: [
      { id: 'src', primitive: 'graph', op: 'clear-color', ports: { Color: { type: 'vec4', value: [0.5, 0.25, 0.125, 1] }, Target: { type: 'texture', value: { resourceId: 'src-out' } }, Render: { type: 'render' } } },
      { id: 'a', primitive: 'graph', op: 'test-passthrough', ports: { in: { type: 'render' }, out: { type: 'render' } } },
      { id: 'b', primitive: 'graph', op: 'test-passthrough', ports: { in: { type: 'render' }, out: { type: 'render' } } },
      { id: 'sink', primitive: 'graph', op: 'test-inspect-sink', ports: { A: { type: 'render' }, B: { type: 'render' }, presented: { type: 'render' } } },
    ],
    edges: [
      { out: 'src.Render', in: 'a.in' },
      { out: 'src.Render', in: 'b.in' },
      { out: 'a.out', in: 'sink.A' },
      { out: 'b.out', in: 'sink.B' },
    ],
    expressions: [],
  };
  const eng = new Engine(toRuntime(scene));
  eng.step(1 / 60);
  const witness = /** @type {{a: any, b: any} | null} */ (fanOutWitness.value);
  if (!witness) return false;
  if (witness.a.resourceId !== 'src-out' || witness.b.resourceId !== 'src-out') return false;
  // Distinct object identities per edge (refs cloned on propagation)
  return witness.a !== witness.b;
})();

// (am3) Value-multi-driver refusal — two edges into the same value input
//       port refuse at construction. This was previously conflated with the
//       fan-out test above.
const valueMultiDriverOk = (() => {
  const twoIntoOne = /** @type {any} */ ({
    format: 'phos/1', meta: { name: 'multi-into-one' },
    resources: [
      { id: 'a-out', kind: 'texture', format: 'rgba8unorm', size: { policy: 'canvas' }, lifetime: 'transient', usage: ['sampled', 'render-attachment'] },
      { id: 'b-out', kind: 'texture', format: 'rgba8unorm', size: { policy: 'canvas' }, lifetime: 'transient', usage: ['sampled', 'render-attachment'] },
    ],
    nodes: [
      { id: 'c1', primitive: 'graph', op: 'clear-color', ports: { Color: { type: 'vec4', value: [0, 0, 0, 1] }, Target: { type: 'texture', value: { resourceId: 'a-out' } }, Render: { type: 'render' } } },
      { id: 'c2', primitive: 'graph', op: 'clear-color', ports: { Color: { type: 'vec4', value: [1, 0, 0, 1] }, Target: { type: 'texture', value: { resourceId: 'b-out' } }, Render: { type: 'render' } } },
      { id: 's', primitive: 'graph', op: 'screen', ports: {
        Viewport: { type: 'vec4', value: [0, 0, 1, 1] }, CamPos: { type: 'vec3', value: [0, 0, -2] }, CamRot: { type: 'vec3', value: [0, 0, 0] }, CamLookAt: { type: 'vec3', value: [0, 0, 1] },
        CamLookAtInWorldSpace: { type: 'float', value: 0 }, CamFov: { type: 'float', value: 45 }, CamNear: { type: 'float', value: 0.1 }, CamFar: { type: 'float', value: 1000 },
        ScaleByAspect: { type: 'float', value: 0 }, Render: { type: 'render' },
      } },
    ],
    edges: [ { out: 'c1.Render', in: 's.Render' }, { out: 'c2.Render', in: 's.Render' } ],
    expressions: [],
  });
  return (() => { try { new Engine(toRuntime(twoIntoOne)); return false; } catch (e) { return /already has an incoming edge/.test(/** @type {Error} */ (e).message); } })();
})();

// (an) Screen refuses unsupported port values at native executor boundary
//      (reviewer 2026-07-18 item 2): each declared camera port must carry
//      exactly the witnessed geometry-free value.
const screenGuardOk = (() => {
  const mkScreen = (/** @type {number} */ camFov) => /** @type {any} */ ({
    format: 'phos/1', meta: { name: 'sg' },
    resources: [
      { id: 'clear-out', kind: 'texture', format: 'rgba8unorm', size: { policy: 'canvas' }, lifetime: 'transient', usage: ['sampled', 'render-attachment'] },
    ],
    nodes: [
      { id: 'c', primitive: 'graph', op: 'clear-color', ports: { Color: { type: 'vec4', value: [0, 0, 0, 1] }, Target: { type: 'texture', value: { resourceId: 'clear-out' } }, Render: { type: 'render' } } },
      { id: 's', primitive: 'graph', op: 'screen', ports: {
        Viewport: { type: 'vec4', value: [0, 0, 1, 1] }, CamPos: { type: 'vec3', value: [0, 0, -2] }, CamRot: { type: 'vec3', value: [0, 0, 0] }, CamLookAt: { type: 'vec3', value: [0, 0, 1] },
        CamLookAtInWorldSpace: { type: 'float', value: 0 }, CamFov: { type: 'float', value: camFov }, CamNear: { type: 'float', value: 0.1 }, CamFar: { type: 'float', value: 1000 },
        ScaleByAspect: { type: 'float', value: 0 }, Render: { type: 'render' },
      } },
    ],
    edges: [ { out: 'c.Render', in: 's.Render' } ], expressions: [],
  });
  const baselineOk = (() => { try { new Engine(toRuntime(mkScreen(45))); return true; } catch { return false; } })();
  const deviationRefuses = (() => { try { new Engine(toRuntime(mkScreen(60))); return false; } catch (e) { const m = /** @type {Error} */ (e).message; return /screen.*"CamFov"=60/.test(m) && /witnessed value/.test(m); } })();
  // setVar path — a live edit that changes Screen.CamFov to 60 refuses at
  // setVar rather than silently updating a functional port with no effect.
  const setVarRefuses = (() => {
    try {
      const eng = new Engine(toRuntime(mkScreen(45)));
      try { eng.setVar('s.CamFov', 60); return false; }
      catch (e) { const m = /** @type {Error} */ (e).message; return /"CamFov"=60/.test(m) && /witnessed value/.test(m); }
    } catch { return false; }
  })();
  // Edge-into-constrained-port refusal — value edges into any Screen
  // constrained port refuse at construction, so a value producer cannot
  // route around the port constraint.
  const edgeRefuses = (() => {
    /** @type {any} */
    const scene = {
      format: 'phos/1', meta: { name: 'edge-into-screen' },
      resources: [
        { id: 'clear-out', kind: 'texture', format: 'rgba8unorm', size: { policy: 'canvas' }, lifetime: 'transient', usage: ['sampled', 'render-attachment'] },
      ],
      nodes: [
        { id: 'mm', primitive: 'graph', op: 'MinMax', ports: {
          Min: { type: 'float', value: 0 }, Max: { type: 'float', value: 60 }, Mode: { type: 'float', value: 1 },
          DelayMin: { type: 'float', value: 0 }, DelayMax: { type: 'float', value: 0 }, DelayMode: { type: 'float', value: 1 },
          ITimeMin: { type: 'float', value: 1 }, ITimeMax: { type: 'float', value: 1 }, ITimeMode: { type: 'float', value: 1 },
          Value: { type: 'float' },
        } },
        { id: 'c', primitive: 'graph', op: 'clear-color', ports: { Color: { type: 'vec4', value: [0, 0, 0, 1] }, Target: { type: 'texture', value: { resourceId: 'clear-out' } }, Render: { type: 'render' } } },
        { id: 's', primitive: 'graph', op: 'screen', ports: {
          Viewport: { type: 'vec4', value: [0, 0, 1, 1] }, CamPos: { type: 'vec3', value: [0, 0, -2] }, CamRot: { type: 'vec3', value: [0, 0, 0] }, CamLookAt: { type: 'vec3', value: [0, 0, 1] },
          CamLookAtInWorldSpace: { type: 'float', value: 0 }, CamFov: { type: 'float', value: 45 }, CamNear: { type: 'float', value: 0.1 }, CamFar: { type: 'float', value: 1000 },
          ScaleByAspect: { type: 'float', value: 0 }, Render: { type: 'render' },
        } },
      ],
      edges: [ { out: 'mm.Value', in: 's.CamFov' }, { out: 'c.Render', in: 's.Render' } ],
      expressions: [],
    };
    try { new Engine(toRuntime(scene)); return false; }
    catch (e) { const m = /** @type {Error} */ (e).message; return /both a constant and an incoming edge|witnessed-value port/.test(m); }
  })();
  // EEL path — a per-frame equation that writes CamFov=60 into the flat
  // pool must be refused by the same portConstraints hook when the pool
  // syncs back into node ports, so the EEL surface cannot bypass the
  // constraint the other three write paths honor (reviewer 2026-07-18 item 1).
  const eelRefuses = (() => {
    /** @type {any} */
    const scene = {
      format: 'phos/1', meta: { name: 'eel-into-screen' },
      resources: [
        { id: 'clear-out', kind: 'texture', format: 'rgba8unorm', size: { policy: 'canvas' }, lifetime: 'transient', usage: ['sampled', 'render-attachment'] },
      ],
      nodes: [
        { id: 'c', primitive: 'graph', op: 'clear-color', ports: { Color: { type: 'vec4', value: [0, 0, 0, 1] }, Target: { type: 'texture', value: { resourceId: 'clear-out' } }, Render: { type: 'render' } } },
        { id: 's', primitive: 'graph', op: 'screen', ports: {
          Viewport: { type: 'vec4', value: [0, 0, 1, 1] }, CamPos: { type: 'vec3', value: [0, 0, -2] }, CamRot: { type: 'vec3', value: [0, 0, 0] }, CamLookAt: { type: 'vec3', value: [0, 0, 1] },
          CamLookAtInWorldSpace: { type: 'float', value: 0 }, CamFov: { type: 'float', value: 45 }, CamNear: { type: 'float', value: 0.1 }, CamFar: { type: 'float', value: 1000 },
          ScaleByAspect: { type: 'float', value: 0 }, Render: { type: 'render' },
        } },
      ],
      edges: [ { out: 'c.Render', in: 's.Render' } ],
      expressions: [{ id: 'per-frame', stage: 'per-frame', code: ['CamFov=60;'] }],
    };
    try {
      const eng = new Engine(toRuntime(scene));
      try { eng.step(1 / 60); return false; }
      catch (e) { const m = /** @type {Error} */ (e).message; return /"CamFov"=60/.test(m) && /witnessed value/.test(m); }
    } catch { return false; }
  })();
  return baselineOk && deviationRefuses && setVarRefuses && edgeRefuses && eelRefuses;
})();

const ambiguousGraphRefusedOk = (() => {
  // multi-driver: build a synthetic native scene with two MinMax->RGBAToColor.Red
  // edges — the second refuses because Red already has an incoming edge.
  const twoDriverScene = /** @type {any} */ ({
    format: 'phos/1', meta: { name: 'multi' },
    resources: [
      { id: 'clear-out', kind: 'texture', format: 'rgba8unorm', size: { policy: 'canvas' }, lifetime: 'transient', usage: ['sampled', 'render-attachment'] },
    ],
    nodes: [
      { id: 'a', primitive: 'graph', op: 'MinMax', ports: {
        Min: { type: 'float', value: 0 }, Max: { type: 'float', value: 1 }, Mode: { type: 'float', value: 1 },
        DelayMin: { type: 'float', value: 0 }, DelayMax: { type: 'float', value: 0 }, DelayMode: { type: 'float', value: 1 },
        ITimeMin: { type: 'float', value: 1 }, ITimeMax: { type: 'float', value: 1 }, ITimeMode: { type: 'float', value: 1 },
        Value: { type: 'float' },
      } },
      { id: 'b', primitive: 'graph', op: 'MinMax', ports: {
        Min: { type: 'float', value: 0 }, Max: { type: 'float', value: 1 }, Mode: { type: 'float', value: 1 },
        DelayMin: { type: 'float', value: 0 }, DelayMax: { type: 'float', value: 0 }, DelayMode: { type: 'float', value: 1 },
        ITimeMin: { type: 'float', value: 1 }, ITimeMax: { type: 'float', value: 1 }, ITimeMode: { type: 'float', value: 1 },
        Value: { type: 'float' },
      } },
      { id: 'rgba', primitive: 'graph', op: 'RGBAToColor', ports: {
        Red: { type: 'float' }, Green: { type: 'float', value: 0 }, Blue: { type: 'float', value: 0 }, Alpha: { type: 'float', value: 1 },
        Color: { type: 'vec4' },
      } },
      { id: 'c', primitive: 'graph', op: 'clear-color', ports: { Color: { type: 'vec4' }, Target: { type: 'texture', value: { resourceId: 'clear-out' } }, Render: { type: 'render' } } },
      { id: 's', primitive: 'graph', op: 'screen', ports: {
        Viewport: { type: 'vec4', value: [0, 0, 1, 1] },
        CamPos: { type: 'vec3', value: [0, 0, -2] }, CamRot: { type: 'vec3', value: [0, 0, 0] }, CamLookAt: { type: 'vec3', value: [0, 0, 1] },
        CamLookAtInWorldSpace: { type: 'float', value: 0 }, CamFov: { type: 'float', value: 45 }, CamNear: { type: 'float', value: 0.1 }, CamFar: { type: 'float', value: 1000 },
        ScaleByAspect: { type: 'float', value: 0 }, Render: { type: 'render' },
      } },
    ],
    edges: [
      { out: 'a.Value', in: 'rgba.Red' }, { out: 'b.Value', in: 'rgba.Red' },
      { out: 'rgba.Color', in: 'c.Color' }, { out: 'c.Render', in: 's.Render' },
    ],
    expressions: [],
  });
  const multiDriverRefuses = (() => { try { new Engine(toRuntime(twoDriverScene)); return false; } catch (e) { return /already has an incoming edge/.test(/** @type {Error} */ (e).message); } })();
  // disconnected render pipeline: a two-node clear-color + screen graph
  // with NO Clear.Render->Screen.Render edge must refuse
  const disconnected = /** @type {any} */ ({
    format: 'phos/1',
    meta: { name: 'x' },
    resources: [
      { id: 'clear-out', kind: 'texture', format: 'rgba8unorm', size: { policy: 'canvas' }, lifetime: 'transient', usage: ['sampled', 'render-attachment'] },
    ],
    nodes: [
      { id: 'c', primitive: 'graph', op: 'clear-color', ports: { Color: { type: 'vec4', value: [0, 0, 0, 1] }, Target: { type: 'texture', value: { resourceId: 'clear-out' } }, Render: { type: 'render' } } },
      { id: 's', primitive: 'graph', op: 'screen', ports: {
        Viewport: { type: 'vec4', value: [0, 0, 1, 1] },
        CamPos: { type: 'vec3', value: [0, 0, -2] }, CamRot: { type: 'vec3', value: [0, 0, 0] }, CamLookAt: { type: 'vec3', value: [0, 0, 1] },
        CamLookAtInWorldSpace: { type: 'float', value: 0 }, CamFov: { type: 'float', value: 45 }, CamNear: { type: 'float', value: 0.1 }, CamFar: { type: 'float', value: 1000 },
        ScaleByAspect: { type: 'float', value: 0 },
        Render: { type: 'render' },
      } },
    ],
    edges: [],
    expressions: [],
  });
  const disconnectedRefuses = (() => { try { new Engine(toRuntime(disconnected)); return false; } catch (e) { return /disconnected render pipeline/.test(/** @type {Error} */ (e).message); } })();
  return multiDriverRefuses && disconnectedRefuses;
})();

// (ao) Substrate regressions (reviewer 2026-07-18 substrate spec): the
//      RenderPlan carries explicit resources, per-pass reads/writes, and
//      a presentation resource id. Every failure mode the substrate
//      forbids must surface either at parse, at Engine construction, or
//      at step time.
const substrateOk = (() => {
  const md = readFileSync(new URL('./scenes/md-101-per_frame.phos', import.meta.url), 'utf8');
  const mdPlan = /** @type {any} */ (new Engine(toRuntime(parsePhos(md))).step(1 / 60));
  // (1) MilkDrop plan declares md-feedback and canvas resources
  const resourcesShapeOk = mdPlan.resources.length === 2
    && mdPlan.resources.some((/** @type {any} */ r) => r.id === 'md-feedback' && r.lifetime === 'persistent-pingpong')
    && mdPlan.resources.some((/** @type {any} */ r) => r.id === 'canvas' && r.kind === 'presentation');
  // (2) Warp reads and writes md-feedback; composite reads md-feedback and writes canvas
  const warp = mdPlan.passes.find((/** @type {any} */ p) => p.kind === 'warp-feedback');
  const comp = mdPlan.passes.find((/** @type {any} */ p) => p.kind === 'composite');
  const passesShapeOk = warp && warp.reads[0] === 'md-feedback' && warp.writes[0] === 'md-feedback'
    && comp && comp.reads[0] === 'md-feedback' && comp.writes[0] === 'canvas';
  // (3) Presentation names canvas
  const presentationOk = mdPlan.presentation && mdPlan.presentation.resourceId === 'canvas';
  // (4) Native clear scene: clear-color writes clear-out; presentation is clear-out
  const nc = readFileSync(new URL('./scenes/native-clear.phos', import.meta.url), 'utf8');
  const ncPlan = /** @type {any} */ (new Engine(toRuntime(parsePhos(nc))).step(1 / 60));
  const clearPass = ncPlan.passes.find((/** @type {any} */ p) => p.kind === 'clear-color');
  const clearPresentation = clearPass && clearPass.writes[0] === 'clear-out'
    && ncPlan.presentation && ncPlan.presentation.resourceId === 'clear-out';
  // (5) Parser refuses a clear-color scene whose Target references an undeclared resource
  const undeclaredRefuses = (() => {
    try {
      parsePhos(nc.replace('"clear-out"', '"not-declared"'));
      return false;
    } catch (e) { return /is not declared in \$\.resources/.test(/** @type {Error} */ (e).message); }
  })();
  // (6) Engine refuses a warp-feedback scene missing the required
  //     md-feedback resource
  const missingFeedbackRefuses = (() => {
    try {
      const doc = parsePhos(md);
      doc.resources = doc.resources.filter((/** @type {any} */ r) => r.id !== 'md-feedback');
      new Engine(toRuntime(doc)).step(1 / 60);
      return false;
    } catch (e) { return /md-feedback/.test(/** @type {Error} */ (e).message); }
  })();
  // (7) Engine refuses a scene declaring feedback with wrong lifetime
  const wrongLifetimeRefuses = (() => {
    try {
      const doc = /** @type {any} */ (parsePhos(md));
      doc.resources.find((/** @type {any} */ r) => r.id === 'md-feedback').lifetime = 'transient';
      new Engine(toRuntime(doc)).step(1 / 60);
      return false;
    } catch (e) { return /persistent-pingpong/.test(/** @type {Error} */ (e).message); }
  })();
  // (8) Parser refuses an unknown resource kind
  const unknownKindRefuses = (() => {
    try {
      parsePhos(nc.replace('"kind": "texture"', '"kind": "buffer"'));
      return false;
    } catch (e) { return /kind "buffer" not in/.test(/** @type {Error} */ (e).message); }
  })();
  // (9) Parser refuses an unknown resource format
  const unknownFormatRefuses = (() => {
    try {
      parsePhos(nc.replace('"format": "rgba8unorm"', '"format": "rg32sint"'));
      return false;
    } catch (e) { return /format "rg32sint" not in/.test(/** @type {Error} */ (e).message); }
  })();
  return resourcesShapeOk && passesShapeOk && presentationOk && clearPresentation
    && undeclaredRefuses && missingFeedbackRefuses && wrongLifetimeRefuses
    && unknownKindRefuses && unknownFormatRefuses;
})();

// (ap) Substrate completion regressions (reviewer 2026-07-18 completion
//      pass): magic-id removal, positional dependency removal, central
//      plan validation, resource-pool descriptor comparison.
const substrateCompletionOk = (() => {
  const md = readFileSync(new URL('./scenes/md-101-per_frame.phos', import.meta.url), 'utf8');
  const nc = readFileSync(new URL('./scenes/native-clear.phos', import.meta.url), 'utf8');
  // (1) MilkDrop resources renamed does not require native-op changes.
  //     Rename md-feedback → fb and canvas → tv in scene resources[]
  //     and in the Feedback/Target texture-port values; the plan
  //     must use the renamed IDs and Engine.step must succeed.
  const renamedOk = (() => {
    // Rename via structured edit so we don't accidentally rewrite the
    // "canvas" size-policy string; only touch resource ids and
    // texture-port resourceId values.
    const doc = /** @type {any} */ (parsePhos(md));
    for (const r of doc.resources) { if (r.id === 'md-feedback') r.id = 'fb'; else if (r.id === 'canvas') r.id = 'tv'; }
    for (const n of doc.nodes) {
      for (const p of Object.values(/** @type {any} */ (n.ports))) {
        const port = /** @type {any} */ (p);
        if (port.type === 'texture' && port.value) {
          if (port.value.resourceId === 'md-feedback') port.value.resourceId = 'fb';
          else if (port.value.resourceId === 'canvas') port.value.resourceId = 'tv';
        }
      }
    }
    try {
      const plan = /** @type {any} */ (new Engine(toRuntime(doc)).step(1 / 60));
      const warp = plan.passes.find((/** @type {any} */ p) => p.kind === 'warp-feedback');
      const comp = plan.passes.find((/** @type {any} */ p) => p.kind === 'composite');
      return warp && warp.reads[0] === 'fb' && warp.writes[0] === 'fb'
        && comp && comp.reads[0] === 'fb' && comp.writes[0] === 'tv'
        && plan.presentation.resourceId === 'tv';
    } catch { return false; }
  })();
  // (2) Borders targets its connected producer pass by id, not by
  //     position. A composite between borders and warp would reject in
  //     Engine construction (borders.in must connect to warp.out), so
  //     verify pass ids are stable and borders references the correct
  //     producer id.
  const bordersByIdOk = (() => {
    const plan = /** @type {any} */ (new Engine(toRuntime(parsePhos(md))).step(1 / 60));
    const warp = plan.passes.find((/** @type {any} */ p) => p.kind === 'warp-feedback');
    return warp && typeof warp.id === 'string' && warp.borders.inner !== null && warp.borders.outer !== null;
  })();
  // (3) Composite pass spec carries aspectY directly; the executor no
  //     longer retains lastMotion. Verify comp.aspectY is present.
  const compositeSelfContainedOk = (() => {
    const plan = /** @type {any} */ (new Engine(toRuntime(parsePhos(md))).step(1 / 60));
    const comp = plan.passes.find((/** @type {any} */ p) => p.kind === 'composite');
    return comp && typeof comp.comp.aspectY === 'number';
  })();
  // (4) Persistent-pingpong lifetime without both sampled + render-attachment
  //     refuses at descriptor validation (reviewer 2026-07-18 refinement §2):
  //     ping-pong needs both to alternate reads and writes across its two
  //     physical textures, so shipping either alone is an invalid descriptor.
  const noSampledRefuses = (() => {
    try {
      const doc = /** @type {any} */ (parsePhos(md));
      doc.resources.find((/** @type {any} */ r) => r.id === 'md-feedback').usage = ['render-attachment'];
      new Engine(toRuntime(doc)).step(1 / 60);
      return false;
    } catch (e) { return /"persistent-pingpong" requires usage "sampled" AND "render-attachment"/.test(/** @type {Error} */ (e).message); }
  })();
  // (5) Write to a resource without 'render-attachment' usage refuses.
  const noAttachmentRefuses = (() => {
    try {
      const doc = /** @type {any} */ (parsePhos(nc));
      doc.resources[0].usage = ['sampled'];
      new Engine(toRuntime(doc)).step(1 / 60);
      return false;
    } catch (e) { return /does not declare "render-attachment" usage/.test(/** @type {Error} */ (e).message); }
  })();
  // (6) Clear targeting a valid presentation-kind resource refuses at
  //     contribute time. The descriptor is coerced to the full valid
  //     presentation shape (format=preferred-canvas, size.policy=canvas,
  //     lifetime=per-frame, usage=render-attachment+presentation) so it
  //     passes cross-field descriptor validation, and the refusal fires
  //     at clear-color's contribute — only composite may write a
  //     presentation-kind resource.
  const clearOnPresentationRefuses = (() => {
    try {
      const doc = /** @type {any} */ (parsePhos(nc));
      doc.resources[0].kind = 'presentation';
      doc.resources[0].format = 'preferred-canvas';
      doc.resources[0].size = { policy: 'canvas' };
      doc.resources[0].lifetime = 'per-frame';
      doc.resources[0].usage = ['render-attachment', 'presentation'];
      new Engine(toRuntime(doc)).step(1 / 60);
      return false;
    } catch (e) { return /clear-color: Target resource .* has kind "presentation"/.test(/** @type {Error} */ (e).message); }
  })();
  // (7) Persistent-pingpong read+write aliasing remains authorized;
  //     verified by the MilkDrop plan running unchanged (warp reads and
  //     writes md-feedback in the same pass).
  const pingpongAuthorizedOk = (() => {
    const plan = /** @type {any} */ (new Engine(toRuntime(parsePhos(md))).step(1 / 60));
    const warp = plan.passes.find((/** @type {any} */ p) => p.kind === 'warp-feedback');
    return warp && warp.reads.includes('md-feedback') && warp.writes.includes('md-feedback');
  })();
  // (8) Existing MilkDrop and native Clear→Screen plans remain valid.
  const existingPlansOk = (() => {
    try {
      new Engine(toRuntime(parsePhos(md))).step(1 / 60);
      new Engine(toRuntime(parsePhos(nc))).step(1 / 60);
      return true;
    } catch { return false; }
  })();
  return renamedOk && bordersByIdOk && compositeSelfContainedOk
    && noSampledRefuses && noAttachmentRefuses && clearOnPresentationRefuses
    && pingpongAuthorizedOk && existingPlansOk;
})();

// (aq) Substrate refinement regressions (reviewer 2026-07-18 refinement
//      pass): mutating fan-out refusal, cross-field descriptor validation
//      including unused declared resources, zero-usage refusal, single-
//      writer rule, pass-id uniqueness, and existing MilkDrop plus
//      Clear→Screen plans remaining green.
const substrateRefinementOk = (() => {
  const md = readFileSync(new URL('./scenes/md-101-per_frame.phos', import.meta.url), 'utf8');
  const nc = readFileSync(new URL('./scenes/native-clear.phos', import.meta.url), 'utf8');
  // (1) Direct fan-out from a producer into two mutating consumers
  //     refuses. borders declares mutatesProducer:true, so two borders
  //     nodes both consuming warp.out is the shared-mutable-pass shape.
  const fanOutMutatorRefused = (() => {
    const doc = /** @type {any} */ (parsePhos(md));
    const borders2 = { id: 'borders2', primitive: 'shader', op: 'borders', ports: /** @type {any} */ ({
      ib_size: { type: 'float', value: 0.05 }, ib_r: { type: 'float', value: 0 }, ib_g: { type: 'float', value: 0.5 }, ib_b: { type: 'float', value: 1 }, ib_a: { type: 'float', value: 1 },
      ob_size: { type: 'float', value: 0.05 }, ob_r: { type: 'float', value: 1 }, ob_g: { type: 'float', value: 0 }, ob_b: { type: 'float', value: 0 }, ob_a: { type: 'float', value: 1 },
      in: { type: 'render' }, out: { type: 'render' },
    }) };
    doc.nodes.push(borders2);
    doc.edges.push({ out: 'warp.out', in: 'borders2.in' });
    try { new Engine(toRuntime(doc)); return false; }
    catch (e) {
      const msg = /** @type {Error} */ (e).message;
      return /producer-mutating op\(s\) reachable downstream/.test(msg) && /borders/.test(msg);
    }
  })();
  // (1b) Transitive fan-out through non-mutating passthroughs into two
  //      borders refuses. Each branch goes warp.out -> passthrough ->
  //      borders; the passthrough preserves the producer passId, so
  //      both borders would still mutate the same warp-feedback pass.
  const fanOutMutatorTransitiveRefused = (() => {
    const doc = /** @type {any} */ (parsePhos(md));
    const bordersLike = (/** @type {string} */ id) => ({ id, primitive: 'shader', op: 'borders', ports: /** @type {any} */ ({
      ib_size: { type: 'float', value: 0.05 }, ib_r: { type: 'float', value: 0 }, ib_g: { type: 'float', value: 0.5 }, ib_b: { type: 'float', value: 1 }, ib_a: { type: 'float', value: 1 },
      ob_size: { type: 'float', value: 0.05 }, ob_r: { type: 'float', value: 1 }, ob_g: { type: 'float', value: 0 }, ob_b: { type: 'float', value: 0 }, ob_a: { type: 'float', value: 1 },
      in: { type: 'render' }, out: { type: 'render' },
    }) });
    const pass = (/** @type {string} */ id) => ({ id, primitive: 'graph', op: 'test-passthrough', ports: /** @type {any} */ ({ in: { type: 'render' }, out: { type: 'render' } }) });
    // Replace the original borders in the md scene with two passthrough
    // branches each feeding its own borders. The graph shape becomes:
    //   warp.out -> pa.in
    //   warp.out -> pb.in
    //   pa.out   -> ba.in
    //   pb.out   -> bb.in
    //   ba.out and bb.out have no downstream consumer, but construction
    //   refuses at the fan-out check before the outgoing-edge check
    //   reaches them.
    doc.nodes = doc.nodes.filter((/** @type {any} */ n) => n.id !== 'borders');
    doc.edges = doc.edges.filter((/** @type {any} */ e) => e.out !== 'warp.out' && e.in !== 'borders.in' && e.out !== 'borders.out');
    doc.nodes.push(pass('pa'), pass('pb'), bordersLike('ba'), bordersLike('bb'));
    doc.edges.push(
      { out: 'warp.out', in: 'pa.in' },
      { out: 'warp.out', in: 'pb.in' },
      { out: 'pa.out', in: 'ba.in' },
      { out: 'pb.out', in: 'bb.in' },
    );
    try { new Engine(toRuntime(doc)); return false; }
    catch (e) {
      const msg = /** @type {Error} */ (e).message;
      return /producer-mutating op\(s\) reachable downstream/.test(msg) && /borders \(ba\)/.test(msg) && /borders \(bb\)/.test(msg);
    }
  })();
  // (1c) Mixed fan-out: one mutating branch plus one non-mutating branch
  //      still refuses. Even the single mutator would mutate the shared
  //      producer pass, and the non-mutating branch would then observe
  //      the mutated result via the same passId.
  const fanOutMutatorMixedRefused = (() => {
    const doc = /** @type {any} */ (parsePhos(md));
    // Existing edges: warp.out -> borders.in; borders.out -> comp.in.
    // Add a second branch through a passthrough that terminates without
    // any mutator downstream. That branch is legal on its own; the
    // fan-out refuses because the OTHER branch (borders) mutates.
    doc.nodes.push({ id: 'pnm', primitive: 'graph', op: 'test-passthrough', ports: /** @type {any} */ ({ in: { type: 'render' }, out: { type: 'render' } }) });
    doc.edges.push({ out: 'warp.out', in: 'pnm.in' });
    try { new Engine(toRuntime(doc)); return false; }
    catch (e) {
      const msg = /** @type {Error} */ (e).message;
      return /producer-mutating op\(s\) reachable downstream/.test(msg) && /borders \(borders\)/.test(msg);
    }
  })();
  // (1d) Purely non-mutating render fan-out remains accepted. Two
  //      passthroughs branching from one source into a two-input
  //      inspection sink construct and step without refusal — this is
  //      the same shape renderFanOutOk already covers, restated here so
  //      the refinement block is self-contained.
  const fanOutNonMutatingAccepted = (() => {
    /** @type {any} */
    const scene = {
      format: 'phos/1', meta: { name: 'fanout-legal' },
      resources: [
        { id: 'src-out', kind: 'texture', format: 'rgba8unorm', size: { policy: 'canvas' }, lifetime: 'transient', usage: ['sampled', 'render-attachment'] },
      ],
      nodes: [
        { id: 'src', primitive: 'graph', op: 'clear-color', ports: { Color: { type: 'vec4', value: [0.1, 0.2, 0.3, 1] }, Target: { type: 'texture', value: { resourceId: 'src-out' } }, Render: { type: 'render' } } },
        { id: 'pa', primitive: 'graph', op: 'test-passthrough', ports: { in: { type: 'render' }, out: { type: 'render' } } },
        { id: 'pb', primitive: 'graph', op: 'test-passthrough', ports: { in: { type: 'render' }, out: { type: 'render' } } },
        { id: 'sink', primitive: 'graph', op: 'test-inspect-sink', ports: { A: { type: 'render' }, B: { type: 'render' }, presented: { type: 'render' } } },
      ],
      edges: [
        { out: 'src.Render', in: 'pa.in' },
        { out: 'src.Render', in: 'pb.in' },
        { out: 'pa.out', in: 'sink.A' },
        { out: 'pb.out', in: 'sink.B' },
      ],
      expressions: [],
    };
    try { new Engine(toRuntime(scene)).step(1 / 60); return true; }
    catch { return false; }
  })();
  // (2) Cross-field descriptor validation applies to every declared
  //     resource including unused ones. An unused descriptor with an
  //     invalid combination refuses at Engine construction before any
  //     op-level or plan-level check runs.
  const invalidUnusedRefused = (() => {
    // Add a completely unused unused-tex descriptor with an unsupported
    // shape (texture kind + preferred-canvas format is presentation-only).
    const doc = /** @type {any} */ (parsePhos(md));
    doc.resources.push({ id: 'unused-tex', kind: 'texture', format: 'preferred-canvas', size: { policy: 'canvas' }, lifetime: 'transient', usage: ['sampled', 'render-attachment'] });
    try { new Engine(toRuntime(doc)); return false; }
    catch (e) { return /kind "texture" requires format "rgba8unorm".*preferred-canvas.*presentation-kind-only/.test(/** @type {Error} */ (e).message); }
  })();
  // (3) Zero-usage refusal — a texture descriptor with an empty usage
  //     list would produce a WebGPU createTexture call with zero flags.
  //     Descriptor validation refuses before any executor path runs.
  const zeroUsageRefused = (() => {
    const doc = /** @type {any} */ (parsePhos(md));
    doc.resources.push({ id: 'no-usage-tex', kind: 'texture', format: 'rgba8unorm', size: { policy: 'canvas' }, lifetime: 'transient', usage: [] });
    try { new Engine(toRuntime(doc)); return false; }
    catch (e) { return /must declare at least one of \{sampled, render-attachment\} usage/.test(/** @type {Error} */ (e).message); }
  })();
  // (4) Invalid presentation cross-field combinations. Four cases: wrong
  //     format, wrong size.policy, wrong lifetime, missing presentation
  //     usage. Each refuses at descriptor validation.
  const invalidPresentationCombosRefused = (() => {
    const mut = (/** @type {(r:any)=>void} */ f) => {
      const doc = /** @type {any} */ (parsePhos(md));
      const p = doc.resources.find((/** @type {any} */ r) => r.id === 'canvas');
      f(p);
      try { new Engine(toRuntime(doc)); return null; }
      catch (e) { return /** @type {Error} */ (e).message; }
    };
    const wrongFormat = mut((p) => { p.format = 'rgba8unorm'; });
    const wrongPolicy = mut((p) => { p.size.policy = 'canvas-16block'; });
    const wrongLifetime = mut((p) => { p.lifetime = 'transient'; });
    const missingPresentationUsage = mut((p) => { p.usage = ['render-attachment']; });
    // Presentation usage on a texture-kind resource refuses.
    const presUsageOnTexture = (() => {
      const doc = /** @type {any} */ (parsePhos(md));
      const t = doc.resources.find((/** @type {any} */ r) => r.id === 'md-feedback');
      t.usage = ['sampled', 'render-attachment', 'presentation'];
      try { new Engine(toRuntime(doc)); return null; }
      catch (e) { return /** @type {Error} */ (e).message; }
    })();
    return wrongFormat !== null && /requires format "preferred-canvas"/.test(wrongFormat)
      && wrongPolicy !== null && /requires size.policy "canvas"/.test(wrongPolicy)
      && wrongLifetime !== null && /requires lifetime "per-frame"/.test(wrongLifetime)
      && missingPresentationUsage !== null && /must declare usage "render-attachment" and "presentation"/.test(missingPresentationUsage)
      && presUsageOnTexture !== null && /kind "texture" carries usage "presentation"/.test(presUsageOnTexture);
  })();
  // (5) Multiple writers to the same persistent-pingpong resource refuse.
  //     Ping-pong authorizes one pass to read+write its logical resource
  //     across two physical textures, but not two unrelated writers.
  //     Two warp-feedback nodes both write md-feedback and their outputs
  //     feed the test-inspect-sink, so the graph constructs cleanly and
  //     the multi-writer check fires at plan validation.
  const multiWriterPingpongRefused = (() => {
    const scene = /** @type {any} */ ({
      format: 'phos/1', meta: { name: 'multi-writer' },
      resources: [
        { id: 'md-feedback', kind: 'texture', format: 'rgba8unorm', size: { policy: 'canvas-16block' }, lifetime: 'persistent-pingpong', usage: ['sampled', 'render-attachment'] },
      ],
      nodes: [
        { id: 'w1', primitive: 'graph', op: 'warp-feedback', ports: /** @type {any} */ ({
          fDecay: { type: 'float', value: 0.98 }, zoom: { type: 'float', value: 0 }, rot: { type: 'float', value: 0 }, warp: { type: 'float', value: 0 },
          cx: { type: 'float', value: 0.5 }, cy: { type: 'float', value: 0.5 }, dx: { type: 'float', value: 0 }, dy: { type: 'float', value: 0 },
          sx: { type: 'float', value: 1 }, sy: { type: 'float', value: 1 },
          fWarpAnimSpeed: { type: 'float', value: 1 }, fWarpScale: { type: 'float', value: 1 }, fZoomExponent: { type: 'float', value: 1 },
          Feedback: { type: 'texture', value: { resourceId: 'md-feedback' } }, out: { type: 'render' },
        }) },
        { id: 'w2', primitive: 'graph', op: 'warp-feedback', ports: /** @type {any} */ ({
          fDecay: { type: 'float', value: 0.98 }, zoom: { type: 'float', value: 0 }, rot: { type: 'float', value: 0 }, warp: { type: 'float', value: 0 },
          cx: { type: 'float', value: 0.5 }, cy: { type: 'float', value: 0.5 }, dx: { type: 'float', value: 0 }, dy: { type: 'float', value: 0 },
          sx: { type: 'float', value: 1 }, sy: { type: 'float', value: 1 },
          fWarpAnimSpeed: { type: 'float', value: 1 }, fWarpScale: { type: 'float', value: 1 }, fZoomExponent: { type: 'float', value: 1 },
          Feedback: { type: 'texture', value: { resourceId: 'md-feedback' } }, out: { type: 'render' },
        }) },
        { id: 'sink', primitive: 'graph', op: 'test-inspect-sink', ports: /** @type {any} */ ({ A: { type: 'render' }, B: { type: 'render' }, presented: { type: 'render' } }) },
      ],
      edges: [
        { out: 'w1.out', in: 'sink.A' },
        { out: 'w2.out', in: 'sink.B' },
      ],
      expressions: [],
    });
    try { new Engine(toRuntime(scene)).step(1 / 60); return false; }
    catch (e) { const msg = /** @type {Error} */ (e).message; return /has 2 writer passes|multi-writer contracts are not supported/.test(msg) && /md-feedback/.test(msg); }
  })();
  // (6) Every emitted pass has a unique nonempty string id. Composite no
  //     longer emits id:null; validatePlan refuses on duplicates or
  //     missing ids. Verify by inspecting the MilkDrop plan (2 passes,
  //     both with distinct string ids).
  const uniquePassIdsOk = (() => {
    const plan = /** @type {any} */ (new Engine(toRuntime(parsePhos(md))).step(1 / 60));
    const ids = plan.passes.map((/** @type {any} */ p) => p.id);
    return ids.length === 2 && ids.every((/** @type {any} */ i) => typeof i === 'string' && i.length > 0)
      && new Set(ids).size === ids.length;
  })();
  // (7) Existing renamed MilkDrop and Clear→Screen plans remain valid.
  //     The renamedOk sub-check in substrateCompletionOk already covers
  //     MilkDrop resource-id rename; here we verify Clear→Screen too.
  const existingRenamedClearOk = (() => {
    const doc = /** @type {any} */ (parsePhos(nc));
    doc.resources[0].id = 'renamed-clear';
    for (const n of doc.nodes) {
      for (const p of Object.values(/** @type {any} */ (n.ports))) {
        const port = /** @type {any} */ (p);
        if (port.type === 'texture' && port.value && port.value.resourceId === 'clear-out') port.value.resourceId = 'renamed-clear';
      }
    }
    try {
      const plan = /** @type {any} */ (new Engine(toRuntime(doc)).step(1 / 60));
      return plan.presentation.resourceId === 'renamed-clear';
    } catch { return false; }
  })();
  return fanOutMutatorRefused && fanOutMutatorTransitiveRefused && fanOutMutatorMixedRefused
    && fanOutNonMutatingAccepted
    && invalidUnusedRefused && zeroUsageRefused
    && invalidPresentationCombosRefused && multiWriterPingpongRefused
    && uniquePassIdsOk && existingRenamedClearOk;
})();

// (ar) Studio scene-swap lifecycle-seam regressions (reviewer 2026-07-18
//      Studio fix). The Studio bug loaded a scene whose composite pass
//      inherited stale canvas dimensions because canvas sync did not
//      happen before the new Engine's first step. These checks exercise
//      the same seam at the engine layer where the fix's logic lives:
//      viewport-before-step drives composite motion.aspectY, successive
//      scene loads with the same resource ids remain independent, and
//      the composite pass reads its aspect from the current Engine's
//      viewport rather than any prior state.
const studioLifecycleOk = (() => {
  const md = readFileSync(new URL('./scenes/md-101-per_frame.phos', import.meta.url), 'utf8');
  // (1) setViewport landing before step() drives the composite's
  //     aspect. A landscape viewport (1920x1080) produces aspectY < 1;
  //     a portrait viewport (1080x1920) produces aspectY = 1; a square
  //     viewport (1024x1024) also produces aspectY = 1. The precise
  //     values follow the Engine.aspectY expression:
  //       aspectY = (texW > texH) ? texH/texW : 1
  const engLandscape = new Engine(toRuntime(parsePhos(md)));
  engLandscape.setViewport(1920, 1080, 1920, 1080);
  const planLandscape = /** @type {any} */ (engLandscape.step(1 / 60));
  const compLandscape = planLandscape.passes.find((/** @type {any} */ p) => p.kind === 'composite');
  if (Math.abs(compLandscape.comp.aspectY - (1080 / 1920)) > 1e-9) return false;
  const engPortrait = new Engine(toRuntime(parsePhos(md)));
  engPortrait.setViewport(1080, 1920, 1080, 1920);
  const planPortrait = /** @type {any} */ (engPortrait.step(1 / 60));
  const compPortrait = planPortrait.passes.find((/** @type {any} */ p) => p.kind === 'composite');
  if (compPortrait.comp.aspectY !== 1) return false;
  const engSquare = new Engine(toRuntime(parsePhos(md)));
  engSquare.setViewport(1024, 1024, 1024, 1024);
  const planSquare = /** @type {any} */ (engSquare.step(1 / 60));
  const compSquare = planSquare.passes.find((/** @type {any} */ p) => p.kind === 'composite');
  if (compSquare.comp.aspectY !== 1) return false;
  // (2) Two successive Engine constructions from the same scene text
  //     produce independent plan objects — a Studio scene swap that
  //     builds the next Engine before replacing the active one cannot
  //     let plan state leak between them. The passes carry the same
  //     stable ids across both engines (nextPassId resets per frame,
  //     so identical scenes at frame 1 yield identical id strings),
  //     but the containing plan objects and pass objects are distinct.
  const engA = new Engine(toRuntime(parsePhos(md)));
  engA.setViewport(1920, 1080, 1920, 1080);
  const planA = /** @type {any} */ (engA.step(1 / 60));
  const engB = new Engine(toRuntime(parsePhos(md)));
  engB.setViewport(1024, 1024, 1024, 1024);
  const planB = /** @type {any} */ (engB.step(1 / 60));
  if (planA === planB) return false;
  if (planA.passes[0] === planB.passes[0]) return false;
  // Same-frame pass ids are deterministic strings, so both plans carry
  // 'pass-1' / 'pass-2'; the plan-level uniqueness check still passed
  // per plan, which is what validatePlan enforces.
  const idsA = planA.passes.map((/** @type {any} */ p) => p.id);
  const idsB = planB.passes.map((/** @type {any} */ p) => p.id);
  if (JSON.stringify(idsA) !== JSON.stringify(idsB)) return false;
  // (3) Changing viewport between step() calls on a single engine
  //     updates comp.aspectY at the next step — the composite reads
  //     its aspect from the current Engine viewport, not any cached
  //     first-frame value.
  const engMut = new Engine(toRuntime(parsePhos(md)));
  engMut.setViewport(1024, 1024, 1024, 1024);
  const planMutSquare = /** @type {any} */ (engMut.step(1 / 60));
  const compMutSquare = planMutSquare.passes.find((/** @type {any} */ p) => p.kind === 'composite');
  if (compMutSquare.comp.aspectY !== 1) return false;
  engMut.setViewport(1920, 1080, 1920, 1080);
  const planMutLand = /** @type {any} */ (engMut.step(1 / 60));
  const compMutLand = planMutLand.passes.find((/** @type {any} */ p) => p.kind === 'composite');
  if (Math.abs(compMutLand.comp.aspectY - (1080 / 1920)) > 1e-9) return false;
  return true;
})();

// ==== TWO SEPARATE SURFACES (reviewer foundation 2026-07-18) ====
// engineRegressionOk: PHOSPHENE's own executor behaves as this codebase
//   specifies it — MilkDrop scene 1 renders unchanged, the graph executor
//   admits every valid graph and refuses every malformed one, PHOSPHENE's
//   PHOSPHENE-native ops (MinMax/Beat/HSL as internal implementations,
//   RGBAToColor, clear-color) behave as their PHOSPHENE spec requires.
//   This does NOT establish Plane9 fidelity.
// plane9CompatibilityOk: PHOSPHENE's Plane9 conversion door refuses every
//   UNRESOLVED source shape and passes every evidence-backed one. Screen
//   (witnessed geometry-free) and Clear PASS; HSLAToColor, MinMax, and
//   Beat REFUSE at the compatibility gate; Color Cycle refuses at
//   conversion. This surface does NOT accept PHOSPHENE's internal
//   regression tests as evidence of Plane9 fidelity.
const engineRegressionOk = fftZeroOk && fftImpulseOk && loudnessOk && boundaryOk && ringOk && timekeeperOk && pagesSynced && contractOk && resetOk && clampAliasOk && varContractOk && aspectOk && meshOk && recordsOk && transformOk && inertPortOk && triageOk && cssImportsOk && registryOk && nativeClearOk && nativeHueCycleOk && rngOk && minmaxOk && beatOk && hslOk && delayItimeModeGuardOk && ambiguousGraphRefusedOk && renderPlanFoundationOk && renderFanOutOk && valueMultiDriverOk && screenGuardOk && substrateOk && substrateCompletionOk && substrateRefinementOk && studioLifecycleOk;
const plane9CompatibilityOk = p9Ok && p9ConvOk && colorCycleOk;
const audioOk = engineRegressionOk && plane9CompatibilityOk;

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
console.log('duplicate port name across nodes: parses (node-local), engine refuses undeclared port:', duplicatePortRefused ? 'OK' : 'FAIL');
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
console.log('[engine regression] graph-as-sole-authority: lone clear-color with unfed Render output refuses + per-vertex code still refuses:', contractOk ? 'OK' : 'FAIL');
console.log('reset restores load-time baseline (vars/equations/state):', resetOk ? 'OK' : 'FAIL');
console.log('post-equation clamps + EEL-name aliasing (gamma/decay/echo_zoom):', clampAliasOk ? 'OK' : 'FAIL');
console.log('variable-contract ledger: 76 regvars classified + verified, vol absent:', varContractOk ? 'OK' : 'FAIL');
console.log('aspect factors: forward to renderState, inverse to pool (exact):', aspectOk ? 'OK' : 'FAIL');
console.log('finite-mesh warp: strip indices + identity UVs exact + zoom=0 NaN structure:', meshOk ? 'OK' : 'FAIL');
console.log('ordered source records: per-line, in order, refusal names the line:', recordsOk ? 'OK' : 'FAIL');
console.log('[plane9 compat] Color Cycle: scanner shape (7 nodes, 6 connections, CC0, FormatVersion 2) + compat-gate dispositions (Screen+Clear PASS, MinMax/Beat/HSLAToColor REFUSED UNRESOLVED) + standard HSL fingerprint match against retained fixture:', p9Ok ? 'OK' : 'FAIL');
console.log('native-op registry: unknown op + unrealizable chains + mistyped edges refused, MilkDrop state shape intact:', registryOk ? 'OK' : 'FAIL');
console.log('native clear-color scene: RGBAToColor->clear-color value-edge dataflow + Blue-pulse + port refusals:', nativeClearOk ? 'OK' : 'FAIL');
console.log('native hue-cycle scene: MinMax(Rand) -> HSLAToColor -> clear-color animates and matches the HSL formula:', nativeHueCycleOk ? 'OK' : 'FAIL');
console.log('[plane9 compat] p9 conversion door: Color Cycle refuses (HSLAToColor UNRESOLVED) + Screen+Clear PASS shape converts and executes + tampering refuses:', p9ConvOk ? 'OK' : 'FAIL');
console.log('=== SEMANTIC-SCOPE NOTE (reviewer foundation 2026-07-18) ===');
console.log('two separate surfaces are reported below:');
console.log('  [engine regression]  — PHOSPHENE internal implementation behaves');
console.log('                         as this codebase specifies (does NOT');
console.log('                         verify Plane9 runtime fidelity).');
console.log('  [plane9 compat]      — Plane9 conversion gate refuses UNRESOLVED');
console.log('                         source shapes and passes evidence-backed');
console.log('                         ones (Screen witnessed-config + Clear).');
console.log('an unresolved Plane9 behavior may be exercised by native scenes');
console.log('but cannot contribute to the compatibility surface passing.');
console.log('===');
console.log('[internal regression] shared xorshift128 RNG: two fresh instances match 8 draws + setState round-trips (does NOT verify Plane9 DLL RNG identity):', rngOk ? 'OK' : 'FAIL');
console.log('[internal regression] MinMax against PHOSPHENE\'s own implementation of Todd\'s spec — None + LoopUp/LoopDown linear + PingPong + Rand determinism + smoothstep vs linear discriminator (does NOT verify vs Plane9 traces):', minmaxOk ? 'OK' : 'FAIL');
console.log('[internal regression] Beat node-level composition against Todd\'s spec — inactive=NoMusic direct + active linear formula + upper cap + Min>Max case (does NOT verify upstream detector):', beatOk ? 'OK' : 'FAIL');
console.log('[internal regression] HSLAToColor standard formula — Color Cycle retained vector + pure red + pure green (one-vector against Plane9 output, two invented probes):', hslOk ? 'OK' : 'FAIL');
console.log('[plane9 compat] Color Cycle: fixture REFUSES at conversion (HSLAToColor UNRESOLVED at line 22) — provisional PHOSPHENE MinMax/Beat/HSL implementations do NOT run through as accepted Plane9 conversion:', colorCycleOk ? 'OK' : 'FAIL');
console.log('[MinMax scope bound] DelayMode/ITimeMode ≠ 1 refuses at Engine construction:', delayItimeModeGuardOk ? 'OK' : 'FAIL');
console.log('[render-plan foundation] MilkDrop plan carries borders inside its warp-feedback pass, two independent chains refuse (two sinks), and clear→borders refuses at contribute time:', renderPlanFoundationOk ? 'OK' : 'FAIL');
console.log('[render fan-out] a real graph where one source Render output feeds two branches through a two-input inspection sink — branch A mutation leaves branch B untouched, and the two branches are independent objects at every level:', renderFanOutOk ? 'OK' : 'FAIL');
console.log('[value multi-driver] two value edges into the same input port refuse at construction:', valueMultiDriverOk ? 'OK' : 'FAIL');
console.log('[screen guard] every write path — construction, setVar, edge attachment, EEL per-frame pool sync — refuses a Screen port deviation:', screenGuardOk ? 'OK' : 'FAIL');
console.log('[substrate] MilkDrop plan carries resources + explicit reads/writes + presentation; parser refuses undeclared/wrong-kind/wrong-format resources; engine refuses missing feedback and wrong lifetime:', substrateOk ? 'OK' : 'FAIL');
console.log('[substrate completion] resources rename does not touch ops; borders references producer pass by id; composite carries aspectY; usage/kind cross-field rules refuse; persistent-pingpong aliasing authorized; existing plans intact:', substrateCompletionOk ? 'OK' : 'FAIL');
console.log('[substrate refinement] mutating fan-out refused at construction; cross-field descriptor validation refuses invalid unused + zero-usage + presentation combos; multi-writer refused for every resource; every pass has a unique nonempty id; existing renamed plans stay valid:', substrateRefinementOk ? 'OK' : 'FAIL');
console.log('[studio lifecycle] setViewport before step drives composite motion.aspectY (landscape/portrait/square); two Engines from the same scene text produce independent plan objects; changing viewport between step calls updates aspectY at the next step:', studioLifecycleOk ? 'OK' : 'FAIL');
console.log('[graph correctness] multi-driver refusal + render-input requires incoming edge:', ambiguousGraphRefusedOk ? 'OK' : 'FAIL');
console.log('MilkDrop 8-bit color wrap + decay quantization in the runtime path:', transformOk ? 'OK' : 'FAIL');
console.log('inert value port refused at engine construction (shared OP_PORTS):', inertPortOk ? 'OK' : 'FAIL');
console.log('triage scan: all refusals collected, strict import still throws first:', triageOk ? 'OK' : 'FAIL');
console.log('CSS @import chains: every page reference and import resolves:', cssImportsOk ? 'OK' : 'FAIL');
for (const [name, args] of eelFailures) { const fn = eelSubject[name]; console.log(`  FAIL: ${name}(${args.join(',')}) = ${fn ? fn(...args) : 'missing'}`); }
console.log(`\n=== TWO-SURFACE SUMMARY ===`);
console.log(`engine regression: ${engineRegressionOk ? 'PASS' : 'FAIL'}`);
console.log(`plane9 compat:     ${plane9CompatibilityOk ? 'PASS' : 'FAIL'} (Screen + Clear PASS; HSLAToColor + MinMax + Beat REFUSED UNRESOLVED)`);
console.log(`\nRESULT: ${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);
