// The engine core: takes the runtime IR of a .phos scene, runs the per-frame
// EEL program, then walks the node graph in topological order — value
// operations compute output-port values from their input-port values and
// propagate those values along outgoing edges, and render operations
// contribute to per-frame render state. Per-node state (op-owned) is stored
// in the executor; ports are node-local; edges carry typed values. The
// engine is headless-capable (no GPU dependency) so it stays testable.
import { compileEEL } from './expr-vm.mjs';
import { Timekeeper } from './timekeeper.mjs';
import { GRID_X, GRID_Y } from './warp-mesh.mjs';

// MilkDrop's float->D3DCOLOR channel conversion — (int)(v*255) masked to 8
// bits (D3DCOLOR_RGBA_01, milkdropfs.cpp:41). Truncation then wrap: 1.1 ->
// 24/255, 0.98 -> 249/255. The scene-one border blink past 1.0 IS this wrap.
export function d3dColor01(/** @type {number} */ v) { return (Math.trunc(v * 255) & 0xFF) / 255; }

// ==== Shared xorshift128 RNG ==========================================
// Marsaglia's canonical xorshift128 (Marsaglia 2003, "Xorshift RNGs",
// Journal of Statistical Software 8(14)), constants (11, 8, 19). One
// RNG instance is owned by the engine; every MinMax node in the scene
// draws from this shared generator in the deterministic topological
// order the executor walks. Seed injection is exposed as a test seam
// through setState/getState — production runs use the Marsaglia paper's
// example seed at reset.
//
// DLL cross-check: Todd 2026-07-18 named the shared RNG at Plane9Engine.dll
// RVA 0x1001FE30 (sha256 4cebc1b3...). Whether that implementation's
// constants match Marsaglia's exact 11/8/19 is a follow-up disassembly
// question — the sequence PHOSPHENE draws is documented as Marsaglia's,
// which is a named external reference (not an inferred internal one).
export class Xorshift128 {
  constructor() {
    /** @type {number} */ this.s0 = 0;
    /** @type {number} */ this.s1 = 0;
    /** @type {number} */ this.s2 = 0;
    /** @type {number} */ this.s3 = 0;
    this.reset();
  }
  reset() {
    // Marsaglia's 2003 example seed. Any non-zero tuple works; using the
    // paper's is derivation from a named source rather than an invented value.
    this.s0 = 123456789 >>> 0;
    this.s1 = 362436069 >>> 0;
    this.s2 = 521288629 >>> 0;
    this.s3 = 88675123 >>> 0;
  }
  /** @param {number} a @param {number} b @param {number} c @param {number} d */
  setState(a, b, c, d) { this.s0 = a >>> 0; this.s1 = b >>> 0; this.s2 = c >>> 0; this.s3 = d >>> 0; }
  getState() { return [this.s0, this.s1, this.s2, this.s3]; }
  next32() {
    let t = /** @type {number} */ ((this.s0 ^ ((this.s0 << 11) >>> 0)) >>> 0);
    this.s0 = this.s1; this.s1 = this.s2; this.s2 = this.s3;
    let w = /** @type {number} */ (this.s3);
    w = (w ^ (w >>> 19)) >>> 0;
    w = (w ^ (t ^ (t >>> 8))) >>> 0;
    this.s3 = w;
    return w;
  }
  // Uniform [0, 1): unsigned 32-bit result * 2^-32
  nextUnit() { return this.next32() * (1 / 4294967296); }
  /** @param {number} lo @param {number} hi */
  nextRange(lo, hi) { return lo + this.nextUnit() * (hi - lo); }
}

// ==== MinMax state machine ============================================
// Mode integer mapping (Todd 2026-07-18 from Plane9Engine.dll static
// analysis at RVAs 0x100DD600/0x100DD9A0/0x100DDAE0):
//   0 = None                — no update, current value held
//   1 = Rand                — random target in [Min,Max], smoothstep interp
//   2 = RandShortestDist    — random target in [Min,Max], shortest circular
//   3 = LoopUp              — target = Max, linear, reset to Min at end
//   4 = LoopDown            — target = Min, linear, reset to Max at end
//   5 = PingPong            — target alternates endpoints, smoothstep
// Curves per Todd's specification: LoopUp/LoopDown use linear, all other
// animated modes use smoothstep 3t² − 2t³.
// State machine: every mode passes through Delay and Interp phases
// alternately, so DelayMin/DelayMax = 0 produces immediate transitions
// while the machinery stays uniform.
const MINMAX_MODES = { NONE: 0, RAND: 1, RSD: 2, LOOP_UP: 3, LOOP_DOWN: 4, PINGPONG: 5 };
function smoothstep(/** @type {number} */ t) { return t * t * (3 - 2 * t); }
function linear(/** @type {number} */ t) { return t; }

// MinMax's per-node state is owned by the executor. Each transition through
// the delay/interp phases picks fresh durations and (for Rand/RSD) a fresh
// target, drawing from the shared engine RNG in topological execution order.
/** @param {Record<string,number>} inputs */
function minmaxInitState(inputs) {
  return {
    phase: 'delay',       // begin in delay with duration 0 so the first tick jumps into interp
    prev: inputs.Min ?? 0,
    current: inputs.Min ?? 0,
    target: inputs.Min ?? 0,
    elapsedDelay: 0,
    delayDur: 0,
    elapsedInterp: 0,
    interpDur: 0,
    direction: 1,         // PingPong start heading toward Max
    lastMode: -1,         // detect Mode changes so state resets cleanly
  };
}

/** @param {number} _v @param {number} lo @param {number} hi @param {Xorshift128} rng */
function pickDur(_v, lo, hi, rng) { return (hi > lo) ? rng.nextRange(lo, hi) : lo; }

/** @param {ReturnType<typeof minmaxInitState>} st @param {Record<string,any>} inputs @param {Xorshift128} rng */
function minmaxBeginInterp(st, inputs, rng) {
  const mode = Math.round(inputs.Mode);
  const min = /** @type {number} */ (inputs.Min), max = /** @type {number} */ (inputs.Max);
  st.prev = st.current;
  if (mode === MINMAX_MODES.LOOP_UP) {
    st.prev = min;
    st.current = min;
    st.target = max;
  } else if (mode === MINMAX_MODES.LOOP_DOWN) {
    st.prev = max;
    st.current = max;
    st.target = min;
  } else if (mode === MINMAX_MODES.PINGPONG) {
    st.target = st.direction > 0 ? max : min;
  } else if (mode === MINMAX_MODES.RAND || mode === MINMAX_MODES.RSD) {
    st.target = rng.nextRange(min, max);
  }
  st.interpDur = pickDur(0, /** @type {number} */ (inputs.ITimeMin), /** @type {number} */ (inputs.ITimeMax), rng);
  st.elapsedInterp = 0;
  st.phase = 'interp';
}

/** @param {ReturnType<typeof minmaxInitState>} st @param {Record<string,any>} inputs @param {Xorshift128} rng */
function minmaxBeginDelay(st, inputs, rng) {
  st.delayDur = pickDur(0, /** @type {number} */ (inputs.DelayMin), /** @type {number} */ (inputs.DelayMax), rng);
  st.elapsedDelay = 0;
  st.phase = 'delay';
}

// Circular shortest-distance interpolation over [min, max] — RandShortestDist.
// Both current and target lie inside the range; interp moves along the shorter
// arc, wrapping the result back into the range.
function circularInterp(/** @type {number} */ prev, /** @type {number} */ target,
                        /** @type {number} */ min, /** @type {number} */ max,
                        /** @type {number} */ t) {
  const range = max - min;
  if (range <= 0) return min;
  let diff = target - prev;
  const half = range / 2;
  if (diff > half) diff -= range;
  else if (diff < -half) diff += range;
  let out = prev + diff * t;
  // wrap into [min, max)
  const off = ((out - min) % range + range) % range;
  return min + off;
}

// ==== NATIVE_OPS registry ==============================================
// Each op declares kind ('value' or 'render'), its typed input ports, its
// typed output ports, and its behavior. The graph — its typed edges plus
// the port declarations here — is the sole render authority (reviewer
// foundation call 2026-07-18). There is no parallel sequence grammar
// authorizing particular neighbors; render completeness is checked as
// "every declared render output has an outgoing edge" and "every declared
// render input has an incoming edge". Dispatch is by .phos op name only —
// nothing here reads source-engine metadata (PHOSPHENE-GOAL.md, "one
// native execution model, no parallel runtimes").
/**
 * Render plans are the values render edges carry (reviewer foundation call
 * 2026-07-18). Render ops mirror value ops: each takes a port-keyed dict of
 * incoming plans, one per render input port, and returns a port-keyed dict
 * of outgoing plans, one per render output port. Render edges propagate
 * plans exactly as value edges propagate scalars and vectors, and each
 * render port carries its own plan value — a node with two render inputs
 * receives two distinct plans, and a node with two render outputs produces
 * two distinct plans. Plans are treated as immutable: an op that extends
 * an incoming plan clones the parts it touches before mutating, so a fan-
 * out sending the same output plan to two consumers cannot let one
 * consumer's later contribute alter the other's copy.
 *
 * The Engine's step() returns the presentation sink's read of its input
 * plan; the player executes that plan generically per pass with no
 * `if (st.clear) else` dispatch.
 * @typedef {{ passes: PassSpec[] }} RenderPlan
 * @typedef {WarpFeedbackPass|CompositePass|ClearPass} PassSpec
 * @typedef {{kind:'warp-feedback', motion:any, borders:{inner:null|any, outer:null|any}}} WarpFeedbackPass
 * @typedef {{kind:'composite', comp:any}} CompositePass
 * @typedef {{kind:'clear-color', clear:{r:number, g:number, b:number, a:number}}} ClearPass
 */
/** @typedef {{kind:'value'|'render', inputs:Record<string,string>, outputs:Record<string,string>, portConstraints?:Record<string, number|number[]>, initState?:(inputs:Record<string,any>)=>any, compute?:(ctx:{inputs:Record<string,any>, state:any, dt:number, frame:number, time:number, audio:{musicActive:boolean, rawBeat:number}, rng:Xorshift128})=>Record<string,any>, contribute?:(inputPlans:Record<string,RenderPlan|null>, ports:Record<string,any>, pool:Record<string,number>, eng:Engine)=>Record<string,RenderPlan>}} NativeOp */

/**
 * Deep-clone a render plan so fan-out consumers cannot share mutable state.
 * Uses structuredClone so a new pass kind added later without updating this
 * function cannot silently restore shared references — the whole plan
 * structure is generic plain data and structuredClone deep-copies all of it.
 * @param {RenderPlan} plan
 */
function clonePlan(plan) {
  return /** @type {RenderPlan} */ (structuredClone(plan));
}

/**
 * The single op-level port-value constraint hook (reviewer 2026-07-18).
 * Every port write — construction, setVar, and value-edge propagation each
 * frame — funnels through this hook. An op declares a witnessed value for
 * a port in its `portConstraints` table; any write that doesn't equal that
 * value refuses with a message naming the deviating port and expected value.
 * @param {string} nodeId @param {string} opName @param {string} portName @param {any} value
 */
function assertPortValue(nodeId, opName, portName, value) {
  const op = /** @type {NativeOp|undefined} */ (NATIVE_OPS[opName]);
  const constraint = op?.portConstraints?.[portName];
  if (constraint === undefined) return;
  const matches = Array.isArray(constraint)
    ? Array.isArray(value) && value.length === constraint.length && value.every((v, i) => v === constraint[i])
    : value === constraint;
  if (!matches) {
    throw new Error(`Engine: node "${nodeId}" (${opName}) port "${portName}"=${JSON.stringify(value)} is outside the witnessed value ${JSON.stringify(constraint)}; ${opName} has no implementation of variant values yet, so only the witnessed value is supported — refusing (sources/PLANE9-CONTRACT.md)`);
  }
}

export const NATIVE_OPS = /** @type {Record<string,NativeOp>} */ ({
  // ---- MilkDrop render ops (semantics unchanged from f7afd9f) --------
  'warp-feedback': {
    kind: 'render',
    inputs: {
      fDecay: 'float', zoom: 'float', rot: 'float', warp: 'float',
      cx: 'float', cy: 'float', dx: 'float', dy: 'float', sx: 'float', sy: 'float',
      fWarpAnimSpeed: 'float', fWarpScale: 'float', fZoomExponent: 'float',
    },
    outputs: { out: 'render' },
    contribute(inputPlans, ports, pool, eng) {
      // warp-feedback is a plan source — it has no render inputs at all.
      // The port-qualified inputPlans dict must therefore be empty.
      if (Object.keys(inputPlans).length !== 0) throw new Error('warp-feedback is a render-plan source and takes no render inputs — refusing');
      // per-frame warp oscillators — milkdropfs.cpp:1782-1787
      const warpTime = eng.time * ports.fWarpAnimSpeed;
      const motion = {
        aspectX: eng.aspectX(), aspectY: eng.aspectY(), // plugin.cpp:2027-2028
        wrap: pool.wrap ?? 0,   // wrap is EQ_DEFAULT / EEL-visible, not a port
        decay: d3dColor01(ports.fDecay), // quantized via the D3DCOLOR modulate path (:2007)
        zoom: ports.zoom, zoomExp: ports.fZoomExponent, rot: ports.rot, warp: ports.warp,
        cx: ports.cx, cy: ports.cy, dx: ports.dx, dy: ports.dy, sx: ports.sx, sy: ports.sy,
        warpTime,
        warpScaleInv: 1 / ports.fWarpScale,
        f0: 11.68 + 4.0 * Math.cos(warpTime * 1.413 + 10),
        f1: 8.77 + 3.0 * Math.cos(warpTime * 1.113 + 7),
        f2: 10.54 + 3.0 * Math.cos(warpTime * 1.233 + 3),
        f3: 11.49 + 4.0 * Math.cos(warpTime * 0.933 + 5),
      };
      return { out: { passes: [{ kind: 'warp-feedback', motion, borders: { inner: null, outer: null } }] } };
    },
  },
  'borders': {
    kind: 'render',
    inputs: {
      ib_size: 'float', ib_r: 'float', ib_g: 'float', ib_b: 'float', ib_a: 'float',
      ob_size: 'float', ob_r: 'float', ob_g: 'float', ob_b: 'float', ob_a: 'float',
      in: 'render',
    },
    outputs: { out: 'render' },
    contribute(inputPlans, ports) {
      const inPlan = inputPlans.in;
      if (!inPlan || inPlan.passes.length === 0) throw new Error('borders requires an incoming render plan on its "in" port carrying a warp-feedback pass to extend — refusing');
      const lastIn = inPlan.passes[inPlan.passes.length - 1];
      if (lastIn === undefined || lastIn.kind !== 'warp-feedback') throw new Error(`borders extends an in-flight warp-feedback pass; the current plan's last pass is "${lastIn?.kind ?? '(none)'}" — refusing`);
      // Clone before mutating so fan-out consumers of the incoming plan
      // do not see the modification, and so this op's output plan is
      // independent of any other consumer's later contribute calls.
      const cloned = clonePlan(inPlan);
      const last = /** @type {WarpFeedbackPass} */ (cloned.passes[cloned.passes.length - 1]);
      // colors and alphas pass the 8-bit conversion (:3453-3457); the draw
      // gate reads the RAW alpha (:3451) — aGate carries it separately
      last.borders.inner = { size: ports.ib_size, r: d3dColor01(ports.ib_r), g: d3dColor01(ports.ib_g), b: d3dColor01(ports.ib_b), a: d3dColor01(ports.ib_a), aGate: ports.ib_a };
      last.borders.outer = { size: ports.ob_size, r: d3dColor01(ports.ob_r), g: d3dColor01(ports.ob_g), b: d3dColor01(ports.ob_b), a: d3dColor01(ports.ob_a), aGate: ports.ob_a };
      return { out: cloned };
    },
  },
  'composite': {
    kind: 'render',
    inputs: {
      fGammaAdj: 'float', fVideoEchoZoom: 'float', fVideoEchoAlpha: 'float', nVideoEchoOrientation: 'float',
      in: 'render',
    },
    // `presented` is a well-known sink output whose plan is the frame the
    // front end submits. The Engine exempts `presented` from the outgoing-
    // -edge rule and captures the sink's `presented` value each step.
    outputs: { presented: 'render' },
    contribute(inputPlans, ports, pool) {
      const inPlan = inputPlans.in;
      if (!inPlan || inPlan.passes.length === 0) throw new Error('composite requires an incoming render plan on its "in" port — refusing');
      // Clone before appending so a fan-out sibling reading the same input
      // plan does not see the new composite pass.
      const cloned = clonePlan(inPlan);
      // gammaAdj + video echo — ShowToUser_NoShaders (milkdropfs.cpp:4147-4260).
      // MilkDrop's clamps on gamma (0..8) and echo_zoom (0.001..1000) run on
      // the EEL-visible pool aliases and sync back into these ports pre-render.
      cloned.passes.push({
        kind: 'composite',
        comp: {
          gamma: pool.gamma ?? ports.fGammaAdj,
          echoAlpha: ports.fVideoEchoAlpha,
          echoZoom: pool.echo_zoom ?? ports.fVideoEchoZoom,
          echoOrient: (ports.nVideoEchoOrientation) % 4,
        },
      });
      return { presented: cloned };
    },
  },
  // ---- Native render ops (Plane9-source-neutral) --------------------
  'clear-color': {
    // Source-neutral native clear: fills the render surface with one RGBA
    // color read from its vec4 Color input port. Plane9's Clear node
    // converts onto this op ("Fills the viewport with a single color."
    // Plane9Engine.dll 0x1f7ecc). Realization is a real WebGPU clear pass
    // in both studio.mjs and player.mjs.
    kind: 'render',
    inputs: { Color: 'vec4' },
    outputs: { Render: 'render' },
    contribute(inputPlans, ports) {
      if (Object.keys(inputPlans).length !== 0) throw new Error('clear-color is a render-plan source and takes no render inputs — refusing');
      const c = ports.Color;
      return { Render: { passes: [{ kind: 'clear-color', clear: { r: c[0], g: c[1], b: c[2], a: c[3] } }] } };
    },
  },
  'screen': {
    // Plane9 render sink. Present in converted Plane9 scenes so the source
    // Screen node, its camera ports and the Clear.Render->Screen.Render edge
    // remain visible, editable and reloadable. Structural — contributes no
    // additional render state beyond marking the pipeline terminal.
    kind: 'render',
    inputs: {
      Viewport: 'vec4', CamPos: 'vec3', CamRot: 'vec3', CamLookAt: 'vec3',
      CamLookAtInWorldSpace: 'float', CamFov: 'float', CamNear: 'float', CamFar: 'float',
      ScaleByAspect: 'float', Render: 'render',
    },
    outputs: { presented: 'render' },
    // Witnessed geometry-free configuration (79/252 corpus scenes). The
    // contribute below reads none of these values, so any deviation would
    // be a declared functional port backed by no behavior. The single
    // portConstraints hook fires at construction, setVar, and value-edge
    // propagation — every write path.
    portConstraints: {
      Viewport: [0, 0, 1, 1], CamPos: [0, 0, -2], CamRot: [0, 0, 0], CamLookAt: [0, 0, 1],
      CamLookAtInWorldSpace: 0, CamFov: 45, CamNear: 0.1, CamFar: 1000, ScaleByAspect: 0,
    },
    contribute(inputPlans) {
      const inPlan = inputPlans.Render;
      if (!inPlan) throw new Error('screen requires an incoming render plan on its "Render" port — refusing');
      // screen is a passthrough sink; the port witnessed-values check at
      // Engine construction guarantees the camera ports carry only the
      // configuration whose runtime effect is documented as "no-op".
      return { presented: inPlan };
    },
  },
  // ---- Native value ops (source-neutral) ----------------------------
  'HSLAToColor': {
    // Standard HSL-to-RGBA (Hue in degrees, S/L/A in [0,1]), verified against
    // Color Cycle's saved input/output vector to 1e-6. General Plane9 op
    // semantics past that one vector remain unverified — sources/PLANE9-CONTRACT.md.
    kind: 'value',
    inputs: { Hue: 'float', Saturation: 'float', Lightness: 'float', Alpha: 'float' },
    outputs: { Color: 'vec4' },
    compute({ inputs }) {
      const h = inputs.Hue, s = inputs.Saturation, l = inputs.Lightness, a = inputs.Alpha;
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const hp = h / 60;
      const x = c * (1 - Math.abs(((hp % 6) + 6) % 6 % 2 - 1));
      const m = l - c / 2;
      const seg = Math.floor(((hp % 6) + 6) % 6);
      const rows = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]];
      const row = /** @type {number[]} */ (rows[seg] ?? [0, 0, 0]);
      return { Color: [(row[0] ?? 0) + m, (row[1] ?? 0) + m, (row[2] ?? 0) + m, a] };
    },
  },
  'RGBAToColor': {
    // Packs four float channels into a vec4 Color. Plane9 node
    // "Combines a red, green, blue and alpha component to a color."
    // (Plane9Engine.dll 0x1fa3fc). Native scenes use this to animate
    // individual channels through per-frame EEL then drive a Clear op.
    kind: 'value',
    inputs: { Red: 'float', Green: 'float', Blue: 'float', Alpha: 'float' },
    outputs: { Color: 'vec4' },
    compute({ inputs }) { return { Color: [inputs.Red, inputs.Green, inputs.Blue, inputs.Alpha] }; },
  },
  'MinMax': {
    // Plane9's animated interpolator, per Todd's DLL static analysis at
    // 0x100DD600 (frame evaluator) / 0x100DD9A0 (mode/range selector) /
    // 0x100DDAE0 (mode jump table) / 0x101FBB50 (mode pointer table).
    // Ticks once per rendered frame; delay and interp are separate state
    // phases; the shared engine RNG (Xorshift128) at 0x1001FE30 draws in
    // graph-topological execution order for determinism.
    kind: 'value',
    inputs: {
      Min: 'float', Max: 'float', Mode: 'float',
      DelayMin: 'float', DelayMax: 'float', DelayMode: 'float',
      ITimeMin: 'float', ITimeMax: 'float', ITimeMode: 'float',
    },
    outputs: { Value: 'float' },
    // Only DelayMode=1 / ITimeMode=1 have implemented behavior (uniform-
    // random selection over the range). All other values remain
    // UNRESOLVED against Plane9Engine.dll disassembly. The single
    // portConstraints hook enforces this at every write path.
    portConstraints: { DelayMode: 1, ITimeMode: 1 },
    initState(ports) { return minmaxInitState(ports); },
    compute({ inputs, state, dt, rng }) {
      const st = /** @type {ReturnType<typeof minmaxInitState>} */ (state);
      const mode = Math.round(inputs.Mode);
      // Mode changes clear phase state so the machine restarts cleanly.
      if (mode !== st.lastMode) {
        st.lastMode = mode;
        st.phase = 'delay';
        st.elapsedDelay = 0; st.delayDur = 0;
        st.direction = 1;
      }
      if (mode === MINMAX_MODES.NONE) return { Value: st.current };
      // Advance the state machine one phase per call, so the frame on which
      // interp completes returns the snap value (target endpoint) and the
      // next frame begins the reset/next-cycle. This matches Plane9's
      // once-per-frame update (history.txt v1.6 line 413) rather than
      // running multiple phase transitions in a single frame.
      if (st.phase === 'delay') {
        st.elapsedDelay += dt;
        if (st.elapsedDelay >= st.delayDur) {
          minmaxBeginInterp(st, inputs, rng);
          // On the transition-into-interp frame, tick interp once with the
          // remainder-of-frame budget so the first frame of interp is not
          // structurally silent when delay is instant (DelayMin=DelayMax=0).
          const overflow = st.elapsedDelay - st.delayDur;
          if (st.delayDur === 0 && overflow > 0) st.elapsedInterp = overflow;
          const curve = (mode === MINMAX_MODES.LOOP_UP || mode === MINMAX_MODES.LOOP_DOWN) ? linear : smoothstep;
          const dur = st.interpDur;
          const t = dur > 0 ? Math.min(1, st.elapsedInterp / dur) : 1;
          if (mode === MINMAX_MODES.RSD) st.current = circularInterp(st.prev, st.target, inputs.Min, inputs.Max, curve(t));
          else st.current = st.prev + (st.target - st.prev) * curve(t);
        }
        return { Value: st.current };
      }
      // interp phase
      st.elapsedInterp += dt;
      const dur = st.interpDur;
      const t = dur > 0 ? Math.min(1, st.elapsedInterp / dur) : 1;
      const curve = (mode === MINMAX_MODES.LOOP_UP || mode === MINMAX_MODES.LOOP_DOWN) ? linear : smoothstep;
      if (mode === MINMAX_MODES.RSD) {
        st.current = circularInterp(st.prev, st.target, inputs.Min, inputs.Max, curve(t));
      } else {
        st.current = st.prev + (st.target - st.prev) * curve(t);
      }
      if (t >= 1) {
        // snap, then transition to delay; the next call will pick a new target
        st.current = st.target;
        if (mode === MINMAX_MODES.PINGPONG) st.direction = -st.direction;
        minmaxBeginDelay(st, inputs, rng);
      }
      return { Value: st.current };
    },
  },
  'Beat': {
    // Plane9's Beat node — evaluator at Plane9Engine.dll RVA 0x100DF5A0
    // (Todd 2026-07-18). Node-level composition per Todd's spec:
    //   inactive audio: BeatStrength = NoMusic (direct pass-through)
    //   active audio:   BeatStrength = min(Min + rawBeat*Amp*(Max-Min), max(Min,Max))
    // The upstream detector that produces rawBeat is a separate subsystem
    // (unresolved — sources/PLANE9-CONTRACT.md); this op treats rawBeat and
    // the active flag as native audio inputs supplied by the executor.
    kind: 'value',
    inputs: { NoMusic: 'float', Amplification: 'float', Min: 'float', Max: 'float' },
    outputs: { BeatStrength: 'float' },
    compute({ inputs, audio }) {
      if (!audio.musicActive) return { BeatStrength: inputs.NoMusic };
      const raw = inputs.Min + audio.rawBeat * inputs.Amplification * (inputs.Max - inputs.Min);
      return { BeatStrength: Math.min(raw, Math.max(inputs.Min, inputs.Max)) };
    },
  },
});

// Value-port declaration view of the registry, shared by conversion and
// execution. The converter (src/phos.mjs emitPort) refuses to emit a port
// outside this declaration, and Engine construction refuses a scene carrying
// one — so an emitted port without a runtime consumer cannot exist on either
// side. Kept as a keys-only view for backward compatibility with milkToPhos
// per-node port declarations.
export const OP_PORTS = /** @type {Record<string,string[]>} */ (
  Object.fromEntries(Object.entries(NATIVE_OPS).map(([op, d]) => [op, Object.keys(d.inputs)])));

export const CONSUMED_PORTS = Object.values(NATIVE_OPS).flatMap((d) => Object.keys(d.inputs));

// MilkDrop's .milk-file keys -> the EEL variable names per-frame equations
// actually see, witnessed from the regvar list at state.cpp:260-331
// ("decay", "gamma", "echo_zoom", "echo_alpha", "echo_orient", "zoomexp";
// all others identical). fWarpAnimSpeed/fWarpScale have NO regvar — they are
// preset state, not equation-visible, so they stay under their file keys.
const KEY_TO_EEL = /** @type {Record<string,string>} */ ({
  fDecay: 'decay', fGammaAdj: 'gamma', fVideoEchoZoom: 'echo_zoom',
  fVideoEchoAlpha: 'echo_alpha', nVideoEchoOrientation: 'echo_orient',
  fZoomExponent: 'zoomexp',
});
const EEL_TO_KEY = Object.fromEntries(Object.entries(KEY_TO_EEL).map(([k, v]) => [v, k]));
// Equation-visible preset defaults: values an equation READS even when the
// preset omits them, witnessed from CState::Default (state.cpp:541-683) via
// the var_pf assignment block (milkdropfs.cpp:495-548). Pool-only until
// their subsystems' nodes exist; rendered vars get defaults materialized
// into the .phos by the converter instead.
const EQ_DEFAULTS = /** @type {Record<string,number>} */ ({
  wave_a: 0.8, wave_r: 1, wave_g: 1, wave_b: 1, wave_x: 0.5, wave_y: 0.5,
  wave_mystery: 0, wave_mode: 0, wave_usedots: 0, wave_thick: 0,
  wave_additive: 0, wave_brighten: 1,
  darken_center: 0, wrap: 1, invert: 0, brighten: 0, darken: 0, solarize: 0,
  mv_x: 12, mv_y: 9, mv_dx: 0, mv_dy: 0, mv_l: 0.9, mv_r: 1, mv_g: 1, mv_b: 1, mv_a: 1,
  blur1_min: 0, blur2_min: 0, blur3_min: 0, blur1_max: 1, blur2_max: 1, blur3_max: 1,
  blur1_edge_darken: 0.25, monitor: 0,
});

/**
 * Split "nodeId.portName" into [nodeId, portName]. Under
 * noUncheckedIndexedAccess the destructured elements would be typed
 * `string | undefined`; slice() always returns string, so return a tuple
 * shape TS can narrow to string.
 * @param {string} ref
 * @returns {[string, string]}
 */
function splitRef(ref) {
  const dot = ref.indexOf('.');
  return [ref.slice(0, dot), ref.slice(dot + 1)];
}
/** @param {string} op @returns {NativeOp} */
function opOf(op) {
  const decl = NATIVE_OPS[op];
  if (!decl) throw new Error(`opOf: op "${op}" is not registered`);
  return decl;
}

/** Topological sort — Kahn's algorithm with an insertion-ordered ready queue,
 *  so identical-priority nodes visit in scene-declaration order (deterministic
 *  RNG draw order). */
function topologicalOrder(/** @type {{id:string, op:string}[]} */ nodes,
                          /** @type {{out:string, in:string}[]} */ edges) {
  const incoming = new Map(nodes.map((n) => [n.id, 0]));
  const outgoing = new Map(nodes.map((n) => /** @type {[string, string[]]} */ ([n.id, []])));
  for (const e of edges) {
    const [src] = splitRef(e.out);
    const [dst] = splitRef(e.in);
    incoming.set(dst, (incoming.get(dst) ?? 0) + 1);
    (outgoing.get(src) ?? []).push(dst);
  }
  /** @type {typeof nodes} */
  const order = [];
  const ready = nodes.filter((n) => incoming.get(n.id) === 0);
  while (ready.length) {
    // shift preserves scene order for equally-ready nodes
    const n = /** @type {{id:string, op:string}} */ (ready.shift());
    order.push(n);
    for (const dst of outgoing.get(n.id) ?? []) {
      const c = (incoming.get(dst) ?? 0) - 1;
      incoming.set(dst, c);
      if (c === 0) {
        const dstNode = nodes.find((x) => x.id === dst);
        if (dstNode) ready.push(dstNode);
      }
    }
  }
  if (order.length !== nodes.length) throw new Error('Engine: graph contains a cycle — refusing');
  return order;
}

export class Engine {
  constructor(/** @type {any} */ scene) {
    this.scene = scene;
    /** @type {{id:string, op:string, ports:Record<string,{type:string, value?:number|number[]}>}[]} */
    const nodes = scene.nodes;
    /** @type {{out:string, in:string}[]} */
    const edges = scene.edges ?? [];
    // --- validate every op and every port reference ---
    for (const n of nodes) {
      const op = NATIVE_OPS[n.op];
      if (!op) throw new Error(`Engine: op "${n.op}" is not a registered native operation (NATIVE_OPS) — refusing`);
      const allPorts = { ...op.inputs, ...op.outputs };
      for (const [pname, port] of Object.entries(n.ports)) {
        const declared = allPorts[pname];
        if (declared === undefined) throw new Error(`Engine: node "${n.id}" (${n.op}) carries port "${pname}" that no runtime path consumes — refusing an inert port`);
        if (port.type !== declared) throw new Error(`Engine: node "${n.id}" (${n.op}) port "${pname}" is declared type "${declared}" but the scene labels it "${port.type}" — refusing`);
      }
      // Every input port an op declares must exist in the scene node; render
      // structural inputs (type 'render') and value-carrying inputs alike.
      for (const [pname, ptype] of Object.entries(op.inputs)) {
        if (!(pname in n.ports)) throw new Error(`Engine: node "${n.id}" (${n.op}) is missing declared input port "${pname}" (${ptype}) — refusing`);
      }
    }
    /** @type {Set<string>} */
    const edgeDriven = new Set(); // "nodeId.portName" of every input port that has an incoming edge
    for (const e of edges) {
      const [srcId, srcPort] = splitRef(e.out);
      const [dstId, dstPort] = splitRef(e.in);
      const srcNode = nodes.find((n) => n.id === srcId);
      const dstNode = nodes.find((n) => n.id === dstId);
      if (!srcNode || !dstNode) throw new Error(`Engine: edge ${e.out} -> ${e.in} references a node not in the scene — refusing`);
      const srcOp = opOf(srcNode.op);
      const dstOp = opOf(dstNode.op);
      const srcType = srcOp.outputs[srcPort];
      const dstType = dstOp.inputs[dstPort];
      if (!srcType) throw new Error(`Engine: edge source port "${e.out}" is not an output of op "${srcNode.op}" — refusing`);
      if (!dstType) throw new Error(`Engine: edge destination port "${e.in}" is not an input of op "${dstNode.op}" — refusing`);
      if (srcType !== dstType) throw new Error(`Engine: edge ${e.out} (${srcType}) -> ${e.in} (${dstType}) has mismatched port types — refusing`);
      // Refuse multiple edges into the same input — silent last-writer-wins is
      // exactly the ambiguity the graph model exists to prevent.
      if (edgeDriven.has(e.in)) {
        throw new Error(`Engine: input port "${e.in}" already has an incoming edge; a second edge would silently overwrite it — refusing ambiguous graph`);
      }
      edgeDriven.add(e.in);
    }
    // Every declared input port must be sourced. Value-typed inputs (float,
    // vec2/3/4, ...) are sourced by either a constant on the port or an
    // incoming edge. Render-typed inputs must have an incoming render edge
    // (they carry no value); a render op with a declared render input but
    // no incoming render edge would be silently unwired.
    for (const n of nodes) {
      const op = opOf(n.op);
      for (const [pname, ptype] of Object.entries(op.inputs)) {
        const port = n.ports[pname];
        const hasEdge = edgeDriven.has(n.id + '.' + pname);
        if (ptype === 'render') {
          if (!hasEdge) throw new Error(`Engine: node "${n.id}" (${n.op}) render input port "${pname}" has no incoming render edge — refusing a disconnected render pipeline`);
          continue;
        }
        const hasConstant = port !== undefined && 'value' in port;
        if (!hasConstant && !hasEdge) {
          throw new Error(`Engine: node "${n.id}" (${n.op}) input port "${pname}" (${ptype}) has neither a constant value nor an incoming edge — refusing`);
        }
      }
    }
    // Every port that carries a constant value at construction runs the
    // single op-level constraint hook (assertPortValue above). Every port
    // that an op declares as constrained refuses an incoming edge, because
    // an edge could propagate an unwitnessed value each frame around the
    // hook. And every input port that has BOTH a constant AND an incoming
    // edge refuses regardless: the constant would be silently overwritten
    // by the edge — the exact "editable-value-with-no-effect" failure the
    // reviewer named. These three rules replace the previous per-op
    // inline blocks with one generic sweep.
    for (const n of nodes) {
      const op = opOf(n.op);
      const constrained = op.portConstraints ?? {};
      for (const [portName, port] of Object.entries(n.ports)) {
        const hasConstant = 'value' in port;
        const hasEdge = edgeDriven.has(n.id + '.' + portName);
        if (hasConstant && hasEdge) {
          throw new Error(`Engine: node "${n.id}" (${n.op}) input port "${portName}" carries both a constant and an incoming edge; the edge would silently overwrite the constant — refusing`);
        }
        if (portName in constrained && hasEdge) {
          throw new Error(`Engine: node "${n.id}" (${n.op}) port "${portName}" is a witnessed-value port; edges into it would bypass the value constraint at execution — refusing`);
        }
        if (hasConstant) assertPortValue(n.id, n.op, portName, /** @type {any} */ (port).value);
        // A constrained port that has neither a constant nor an incoming
        // edge is missing a value the executor requires. Every constrained
        // port must therefore carry its constant.
        if (portName in constrained && !hasConstant) {
          throw new Error(`Engine: node "${n.id}" (${n.op}) port "${portName}" is constrained to a witnessed value but the scene omits its constant — refusing`);
        }
      }
    }
    // --- topological execution order ---
    this.order = topologicalOrder(nodes, edges);
    // At least one render op must exist; without one the graph produces no
    // rendered output. The rest of render completeness (which op starts,
    // which ends, what may follow what) is decided by the edges alone —
    // there is no separate sequence grammar.
    const renderOrder = this.order.filter((n) => opOf(n.op).kind === 'render');
    if (renderOrder.length === 0) throw new Error('Engine: graph has no render operation — refusing');
    // Every declared render output must have an outgoing edge. This is the
    // dataflow-level replacement for the retired first/after/terminal
    // grammar: a render op with an unfed Render output is a broken chain,
    // and the graph rejects it without any operation-name-authorizes-
    // -particular-neighbor claim.
    /** @type {Set<string>} */
    const outgoingRefs = new Set();
    for (const e of edges) outgoingRefs.add(e.out);
    for (const n of nodes) {
      const op = opOf(n.op);
      for (const [pname, ptype] of Object.entries(op.outputs)) {
        if (ptype !== 'render') continue;
        // The `presented` port is exempt: it is the presentation surface,
        // not a chainable render output. Every OTHER render output must
        // have an outgoing edge.
        if (pname === 'presented') continue;
        if (!outgoingRefs.has(n.id + '.' + pname)) {
          throw new Error(`Engine: node "${n.id}" (${n.op}) render output "${pname}" has no outgoing edge — the render chain is incomplete, refusing`);
        }
      }
    }
    // Exactly one presentation sink. A sink is a render op that declares a
    // `presented: render` output port. The `presented` port is exempt from
    // the outgoing-edge rule above; the Engine reads the sink's plan from
    // its `presented` return value each step. The single-canvas front end
    // presents one plan per frame; two independent render chains would
    // have two sinks and compete for the canvas.
    const sinks = renderOrder.filter((n) => {
      const op = opOf(n.op);
      return op.outputs.presented === 'render';
    });
    if (sinks.length !== 1) {
      throw new Error(`Engine: graph has ${sinks.length} presentation sink(s); exactly one is required for the single-canvas front end — refusing`);
    }
    /** @type {string} */
    this.sinkId = /** @type {{id:string}} */ (sinks[0]).id;

    // --- per-node state ---
    /** @type {Record<string, {ports:Record<string, any>, outputs:Record<string, any>, state:any}>} */
    this.nodeState = {};
    for (const n of nodes) {
      /** @type {Record<string, any>} */
      const initPorts = {};
      for (const [pname, port] of Object.entries(n.ports)) {
        if ('value' in port) initPorts[pname] = /** @type {any} */ (port.value);
      }
      const op = opOf(n.op);
      this.nodeState[n.id] = {
        ports: initPorts,
        outputs: {},
        state: op.initState ? op.initState(initPorts) : {},
      };
    }

    // --- outgoing edges per node, for value propagation ---
    /** @type {Map<string, {out:string, in:string}[]>} */
    this.outgoing = new Map();
    for (const e of edges) {
      const [src] = splitRef(e.out);
      const arr = this.outgoing.get(src) ?? [];
      arr.push(e);
      this.outgoing.set(src, arr);
    }

    // --- expression VM setup ---
    /** @type {string[]} */
    const perFrame = scene.expressions.perFrame ?? [];
    /** @type {string[]} */
    const perVertex = scene.expressions.perVertex ?? [];
    if (perVertex.length > 0) throw new Error('Engine: scene carries per-vertex code, which the engine does not yet execute — refusing rather than silently ignoring');

    // MilkDrop-compat flat EEL pool. The EEL view aliases each aliased port
    // key (fDecay -> decay, ...) into the pool; per-frame code writes to
    // aliased names and the executor syncs those writes back into node ports.
    // The mapping refuses ambiguity: two ports resolving to the same EEL
    // name would silently last-write-win, so any perFrame code with such an
    // overlap is refused. Scenes with empty perFrame skip this entirely.
    /** @type {Map<string, {nodeId:string, portName:string}>} */
    this.eelOwner = new Map();
    for (const n of nodes) {
      const op = opOf(n.op);
      for (const pname of Object.keys(n.ports)) {
        // only float ports participate in the flat EEL view
        const t = /** @type {string|undefined} */ (op.inputs[pname] ?? op.outputs[pname]);
        if (t !== 'float') continue;
        const eelName = KEY_TO_EEL[pname] ?? pname;
        if (this.eelOwner.has(eelName)) {
          if (perFrame.length > 0) throw new Error(`Engine: EEL name "${eelName}" is claimed by more than one node (perFrame code cannot resolve it unambiguously) — refusing`);
          // no perFrame → collisions are harmless; keep first owner
          continue;
        }
        this.eelOwner.set(eelName, { nodeId: n.id, portName: pname });
      }
    }
    this.baseline = {
      nodes: JSON.parse(JSON.stringify(nodes)),
      perFrame: [...perFrame],
    };
    this.pool = /** @type {Record<string, number>} */ ({});
    this.perFrame = compileEEL(perFrame);
    this.perFrameSource = [...perFrame];
    // Seed the pool with EQ_DEFAULTS + initial aliased port values so a
    // fresh (unstepped) engine is queryable — studios read the pool for
    // live variable display before the first step lands.
    this._readPortsIntoPool();

    // --- shared RNG owned by the engine ---
    this.rng = new Xorshift128();

    // --- timing / viewport ---
    this.frame = 0;
    this.viewportW = 1024; this.viewportH = 1024; this.texW = 1024; this.texH = 1024;
    this.timekeeper = new Timekeeper();
  }
  get time() { return this.timekeeper.time; }

  /** Sync the flat EEL pool from node ports (aliased where applicable). */
  _readPortsIntoPool() {
    this.pool = { ...EQ_DEFAULTS };
    for (const [eelName, { nodeId, portName }] of this.eelOwner) {
      const v = this.nodeState[nodeId]?.ports[portName];
      if (typeof v === 'number') this.pool[eelName] = v;
    }
  }
  /** Sync the flat EEL pool back to node ports (aliased where applicable). */
  _writePoolIntoPorts() {
    for (const [eelName, { nodeId, portName }] of this.eelOwner) {
      const v = this.pool[eelName];
      const ns = /** @type {{ports:Record<string,any>}} */ (this.nodeState[nodeId]);
      if (typeof v === 'number') ns.ports[portName] = v;
    }
  }

  step(/** @type {number} */ dt,
       /** @type {{bass?:number,mid?:number,treb?:number,bass_att?:number,mid_att?:number,treb_att?:number,musicActive?:boolean,rawBeat?:number}} */ audio = {}) {
    this.timekeeper.tick(dt);
    this.frame += 1;

    // --- run per-frame EEL over the aliased flat pool ---
    this._readPortsIntoPool();
    Object.assign(this.pool, {
      time: this.timekeeper.time, frame: this.frame, fps: this.timekeeper.fps,
      bass: audio.bass ?? 1, mid: audio.mid ?? 1, treb: audio.treb ?? 1,
      bass_att: audio.bass_att ?? 1, mid_att: audio.mid_att ?? 1, treb_att: audio.treb_att ?? 1,
      progress: this.timekeeper.time / 16,
      meshx: GRID_X, meshy: GRID_Y,
      pixelsx: this.viewportW, pixelsy: this.viewportH,
      aspectx: 1 / this.aspectX(), aspecty: 1 / this.aspectY(),
    });
    this.perFrame(this.pool);
    // MilkDrop post-equation clamps — apply to the aliased pool so downstream
    // sync writes the clamped value back to node ports (milkdropfs.cpp:677-679)
    if ('gamma' in this.pool) this.pool.gamma = Math.max(0, Math.min(8, this.pool.gamma ?? 0));
    if ('echo_zoom' in this.pool) this.pool.echo_zoom = Math.max(0.001, Math.min(1000, this.pool.echo_zoom ?? 0));
    this._writePoolIntoPorts();

    // --- walk topological order — value ops compute + propagate, render ops
    // consume-and-return plans through render edges. Both kinds now speak
    // the same port-qualified interface: op receives inputs keyed by input
    // port name, returns outputs keyed by output port name.
    // Render plans are propagated to consumers by cloning at fan-out, so
    // two downstream consumers of the same producer's render output cannot
    // share a mutable plan reference.
    /** @type {Record<string, Record<string, import('./engine.mjs').RenderPlan|null>>} */
    const nodeIncomingPlans = {};
    for (const node of this.order) nodeIncomingPlans[node.id] = {};
    /** @type {import('./engine.mjs').RenderPlan|null} */
    let sinkPlan = null;
    const audioCtx = { musicActive: !!audio.musicActive, rawBeat: audio.rawBeat ?? 0 };
    for (const node of this.order) {
      const op = /** @type {NativeOp} */ (NATIVE_OPS[node.op]);
      const ns = /** @type {{ports:Record<string,any>, outputs:Record<string,any>, state:any}} */ (this.nodeState[node.id]);
      if (op.kind === 'value' && op.compute) {
        const outputs = op.compute({
          inputs: ns.ports, state: ns.state,
          dt, frame: this.frame, time: this.timekeeper.time,
          audio: audioCtx, rng: this.rng,
        });
        ns.outputs = outputs;
        for (const edge of this.outgoing.get(node.id) ?? []) {
          const [, srcPort] = splitRef(edge.out);
          const [dstId, dstPort] = splitRef(edge.in);
          if (outputs[srcPort] !== undefined) {
            // Run the same op-level port-constraint hook that construction
            // and setVar use. A value-edge write that violates a witnessed
            // port constraint refuses here, so no path can bypass the hook
            // (reviewer 2026-07-18 item 1). The constant-plus-edge
            // refusal at construction ensures a constrained port has no
            // incoming edge, so this assertion is defense in depth.
            const dstNode = /** @type {{op:string}|undefined} */ (this.scene.nodes.find((/** @type {{id:string}} */ n) => n.id === dstId));
            if (dstNode) assertPortValue(dstId, dstNode.op, dstPort, outputs[srcPort]);
            const dstNs = /** @type {{ports:Record<string,any>}} */ (this.nodeState[dstId]);
            dstNs.ports[dstPort] = outputs[srcPort];
          }
        }
      } else if (op.kind === 'render' && op.contribute) {
        const inputPlans = /** @type {Record<string, import('./engine.mjs').RenderPlan|null>} */ (nodeIncomingPlans[node.id]);
        const outputPlans = op.contribute(inputPlans, ns.ports, this.pool, this);
        if (node.id === this.sinkId && outputPlans.presented) sinkPlan = outputPlans.presented;
        // Propagate each output plan along outgoing edges from its own
        // port. Fan-out from the same port clones per consumer so their
        // views cannot share state; the `presented` port is presentation-
        // -only and has no outgoing edges by the earlier exemption.
        for (const edge of this.outgoing.get(node.id) ?? []) {
          const [, srcPort] = splitRef(edge.out);
          const [dstId, dstPort] = splitRef(edge.in);
          const srcType = op.outputs[srcPort];
          if (srcType === 'render') {
            const producedPlan = outputPlans[srcPort];
            if (producedPlan === undefined) throw new Error(`Engine: node "${node.id}" (${node.op}) declared render output "${srcPort}" but its contribute returned no plan for that port — refusing`);
            const dstInputs = /** @type {Record<string, import('./engine.mjs').RenderPlan|null>} */ (nodeIncomingPlans[dstId]);
            if (dstInputs[dstPort] !== undefined) {
              throw new Error(`Engine: node "${dstId}" render input "${dstPort}" already carries a plan from a prior edge — refusing multiple-driver render input at execution`);
            }
            dstInputs[dstPort] = clonePlan(producedPlan);
          }
        }
      }
    }
    return sinkPlan;
  }

  // --- studio live-edit surface -----------------------------------------
  /**
   * Write a value into an owning node port and the flat EEL pool. Accepts
   * either "nodeId.portName" (unambiguous) or a bare EEL-visible name that
   * resolves to a unique owner in this.eelOwner.
   * @param {string} name @param {number} value
   */
  setVar(name, value) {
    const write = (/** @type {string} */ nid, /** @type {string} */ pname, /** @type {string} */ poolKey) => {
      const ns = /** @type {{ports:Record<string,any>}} */ (this.nodeState[nid]);
      if (!ns) throw new Error(`setVar: node "${nid}" not found`);
      // Run the same op-level port-constraint hook that construction and
      // edge propagation use. A live edit that violates a witnessed value
      // refuses here, so setVar cannot bypass the port constraint at
      // runtime (reviewer 2026-07-18 item 1).
      const sceneNode = this.scene.nodes.find((/** @type {{id:string}} */ n) => n.id === nid);
      const opName = /** @type {string|undefined} */ (sceneNode?.op);
      if (opName) assertPortValue(nid, opName, pname, value);
      ns.ports[pname] = value;
      this.pool[poolKey] = value;
      if (sceneNode) {
        const p = /** @type {Record<string,{value?:number|number[]}>} */ (sceneNode.ports)[pname];
        if (p) p.value = value;
      }
    };
    if (name.includes('.')) {
      const [nid, pname] = splitRef(name);
      write(nid, pname, KEY_TO_EEL[pname] ?? pname);
      return;
    }
    const eelOwner = this.eelOwner.get(name);
    if (eelOwner) { write(eelOwner.nodeId, eelOwner.portName, name); return; }
    const asKey = EEL_TO_KEY[name] ?? name;
    for (const [, owner] of this.eelOwner) {
      if (owner.portName === asKey) { write(owner.nodeId, asKey, name); return; }
    }
    throw new Error(`setVar: no node port resolves the name "${name}"`);
  }
  /**
   * Read the current value of an owning node port. Accepts "nodeId.portName"
   * or a bare EEL-visible name. Falls back to the pool for engine-injected
   * variables that are not port-backed (time, fps, bass, etc.).
   * @param {string} name
   */
  getVar(name) {
    if (name.includes('.')) {
      const [nid, pname] = splitRef(name);
      const ns = /** @type {{ports:Record<string,any>}|undefined} */ (this.nodeState[nid]);
      return ns?.ports[pname];
    }
    const eelOwner = this.eelOwner.get(name);
    if (eelOwner) {
      const ns = /** @type {{ports:Record<string,any>}} */ (this.nodeState[eelOwner.nodeId]);
      return ns.ports[eelOwner.portName];
    }
    const asKey = EEL_TO_KEY[name] ?? name;
    for (const [, owner] of this.eelOwner) {
      if (owner.portName === asKey) {
        const ns = /** @type {{ports:Record<string,any>}} */ (this.nodeState[owner.nodeId]);
        return ns.ports[asKey];
      }
    }
    return this.pool[name];
  }
  setViewport(/** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ texW = w, /** @type {number} */ texH = h) {
    this.viewportW = w; this.viewportH = h; this.texW = texW; this.texH = texH;
  }
  // aspect factors from the render-target size — plugin.cpp:2027-2028
  aspectX() { return (this.texH > this.texW) ? this.texW / this.texH : 1; }
  aspectY() { return (this.texW > this.texH) ? this.texH / this.texW : 1; }
  recompile(/** @type {string[]} */ perFrameSource) {
    this.perFrameSource = [...perFrameSource];
    this.perFrame = compileEEL(perFrameSource);
    // reflect into the runtime IR's expressions object (perFrame: string[])
    this.scene.expressions.perFrame = [...perFrameSource];
  }
  reset() {
    // restore load-time baseline of every node port + EEL program
    this.scene.nodes = JSON.parse(JSON.stringify(this.baseline.nodes));
    for (const n of this.scene.nodes) {
      /** @type {Record<string, any>} */
      const initPorts = {};
      for (const [pname, port] of Object.entries(/** @type {Record<string, {value?:any}>} */ (n.ports))) {
        if ('value' in port) initPorts[pname] = port.value;
      }
      const op = opOf(n.op);
      this.nodeState[n.id] = {
        ports: initPorts,
        outputs: {},
        state: op.initState ? op.initState(initPorts) : {},
      };
    }
    this.perFrameSource = [...this.baseline.perFrame];
    this.perFrame = compileEEL(this.baseline.perFrame);
    this.scene.expressions.perFrame = [...this.baseline.perFrame];
    this.frame = 0; this.timekeeper.reset();
    this.rng.reset();
    this._readPortsIntoPool();
  }

}

// --- Runtime IR helpers exposed for tests/tools -----------------------
// Legacy flat view of node ports keyed by port name only — for MilkDrop
// scenes whose port names are globally disjoint (regvars discipline), this
// reproduces the pre-refactor `vars` map. Throws if any port name is claimed
// by more than one node.
export function flatPortView(/** @type {any} */ runtime) {
  /** @type {Record<string,number|number[]>} */
  const out = {};
  /** @type {Record<string,string>} */
  const owner = {};
  for (const n of runtime.nodes) {
    for (const [pname, port] of Object.entries(/** @type {Record<string,{value?:any}>} */ (n.ports))) {
      if (!('value' in port)) continue;
      if (owner[pname] !== undefined) {
        throw new Error(`flatPortView: port "${pname}" is claimed by both "${owner[pname]}" and "${n.id}" — this scene needs node-qualified access`);
      }
      owner[pname] = n.id;
      out[pname] = port.value;
    }
  }
  return out;
}
