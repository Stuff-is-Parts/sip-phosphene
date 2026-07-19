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
 *
 * Explicit-resource substrate (reviewer 2026-07-18): the plan now names
 * its resources and each pass names the resources it reads and writes.
 * The executor allocates textures from descriptors and dispatches from
 * named references rather than pass position; presentation names one
 * exact resource the executor blits to the canvas.
 *
 * @typedef {{
 *   id:string,
 *   kind:'texture'|'presentation',
 *   format:'rgba8unorm'|'rgba16float'|'preferred-canvas',
 *   size:{policy:'canvas-16block'|'canvas'}|{policy:'fixed', width:number, height:number},
 *   lifetime:'persistent-pingpong'|'transient'|'per-frame',
 *   usage:('sampled'|'render-attachment'|'presentation')[]
 * }} ResourceDescriptor
 * @typedef {{
 *   resources: ResourceDescriptor[],
 *   passes: PassSpec[],
 *   presentation: {resourceId:string}|null
 * }} RenderPlan
 * @typedef {WarpFeedbackPass|CompositePass|ClearPass|Plane9BlurPass|Plane9RttPass} PassSpec
 * @typedef {{id:string, kind:'warp-feedback', motion:any, borders:{inner:null|any, outer:null|any}, reads:string[], writes:string[]}} WarpFeedbackPass
 * @typedef {{id:string, kind:'composite', comp:any, reads:string[], writes:string[]}} CompositePass
 * @typedef {{id:string, kind:'clear-color', clear:{r:number, g:number, b:number, a:number}, reads:string[], writes:string[]}} ClearPass
 * @typedef {{id:string, kind:'plane9-blur', pass:number, brightness:number, reads:string[], writes:string[]}} Plane9BlurPass
 * @typedef {{id:string, kind:'plane9-rendertotexture', reads:string[], writes:string[]}} Plane9RttPass
 * @typedef {{resourceId:string, passId?:string}} ResourceRef
 * @typedef {{plan:RenderPlan, outputs:Record<string, ResourceRef>}} ContributeResult
 */
/** @typedef {{kind:'value'|'render', mutatesProducer?:boolean, inputs:Record<string,string>, outputs:Record<string,string>, portConstraints?:Record<string, number|number[]>, initState?:(inputs:Record<string,any>)=>any, compute?:(ctx:{inputs:Record<string,any>, state:any, dt:number, frame:number, time:number, audio:{musicActive:boolean, rawBeat:number}, rng:Xorshift128})=>Record<string,any>, contribute?:(inputRefs:Record<string,ResourceRef>, ports:Record<string,any>, pool:Record<string,number>, eng:Engine, plan:RenderPlan)=>Record<string,ResourceRef>}} NativeOp */

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
      Feedback: 'texture',
    },
    outputs: { out: 'render' },
    contribute(inputRefs, ports, pool, eng, plan) {
      if (Object.keys(inputRefs).length !== 0) throw new Error('warp-feedback is a plan source and takes no render inputs — refusing');
      const fb = /** @type {ResourceRef|undefined} */ (ports.Feedback);
      if (!fb || typeof fb !== 'object' || !('resourceId' in fb)) throw new Error('warp-feedback: Feedback port must carry a texture resource reference — refusing');
      const desc = plan.resources.find((r) => r.id === fb.resourceId);
      if (!desc) throw new Error(`warp-feedback: Feedback references resource "${fb.resourceId}" which is not declared in the scene — refusing`);
      if (desc.lifetime !== 'persistent-pingpong') throw new Error(`warp-feedback: Feedback resource "${fb.resourceId}" must have lifetime "persistent-pingpong", got "${desc.lifetime}" — refusing`);
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
      // Every pass has a stable id so downstream ops can reference it by
      // name; borders augments the warp-feedback pass by id, not by
      // position, so an unrelated inserted pass cannot redirect it.
      const passId = eng.nextPassId();
      plan.passes.push({
        id: passId,
        kind: 'warp-feedback', motion, borders: { inner: null, outer: null },
        reads: [fb.resourceId], writes: [fb.resourceId],
      });
      return { out: /** @type {any} */ ({ resourceId: fb.resourceId, passId }) };
    },
  },
  'borders': {
    kind: 'render',
    // borders augments the producer warp-feedback pass in place; two
    // fan-out branches would both mutate the same pass. The Engine
    // refuses at construction when a producer's render output feeds two
    // consumers where either consumer declares `mutatesProducer: true`.
    mutatesProducer: true,
    inputs: {
      ib_size: 'float', ib_r: 'float', ib_g: 'float', ib_b: 'float', ib_a: 'float',
      ob_size: 'float', ob_r: 'float', ob_g: 'float', ob_b: 'float', ob_a: 'float',
      in: 'render',
    },
    outputs: { out: 'render' },
    contribute(inputRefs, ports, _pool, _eng, plan) {
      const inRef = /** @type {any} */ (inputRefs.in);
      if (!inRef) throw new Error('borders requires an incoming render reference on its "in" port — refusing');
      const producerPassId = inRef.passId;
      if (!producerPassId) throw new Error('borders requires the incoming render reference to identify its producer pass id — refusing');
      const producer = plan.passes.find((p) => /** @type {any} */ (p).id === producerPassId);
      if (!producer) throw new Error(`borders: incoming render reference names producer pass id "${producerPassId}" not found in plan — refusing`);
      if (producer.kind !== 'warp-feedback') throw new Error(`borders augments a warp-feedback pass; producer pass id "${producerPassId}" is "${producer.kind}" — refusing`);
      const wf = /** @type {WarpFeedbackPass} */ (producer);
      wf.borders.inner = { size: ports.ib_size, r: d3dColor01(ports.ib_r), g: d3dColor01(ports.ib_g), b: d3dColor01(ports.ib_b), a: d3dColor01(ports.ib_a), aGate: ports.ib_a };
      wf.borders.outer = { size: ports.ob_size, r: d3dColor01(ports.ob_r), g: d3dColor01(ports.ob_g), b: d3dColor01(ports.ob_b), a: d3dColor01(ports.ob_a), aGate: ports.ob_a };
      return { out: inRef };
    },
  },
  'composite': {
    kind: 'render',
    inputs: {
      fGammaAdj: 'float', fVideoEchoZoom: 'float', fVideoEchoAlpha: 'float', nVideoEchoOrientation: 'float',
      in: 'render',
      Target: 'texture',
    },
    // `presented` is a well-known sink output; the Engine exempts it from
    // the outgoing-edge rule and captures the sink's presentation each step.
    outputs: { presented: 'render' },
    contribute(inputRefs, ports, pool, _eng, plan) {
      const inRef = /** @type {any} */ (inputRefs.in);
      if (!inRef) throw new Error('composite requires an incoming render reference on its "in" port — refusing');
      const target = /** @type {ResourceRef|undefined} */ (ports.Target);
      if (!target || typeof target !== 'object' || !('resourceId' in target)) throw new Error('composite: Target port must carry a texture resource reference — refusing');
      const desc = plan.resources.find((r) => r.id === target.resourceId);
      if (!desc) throw new Error(`composite: Target references resource "${target.resourceId}" which is not declared in the scene — refusing`);
      if (desc.kind !== 'presentation') throw new Error(`composite: Target resource "${target.resourceId}" must have kind "presentation", got "${desc.kind}" — refusing`);
      // Read the producer warp-feedback pass's motion into the composite
      // pass spec so the executor never re-reads a prior pass at draw time.
      const producer = plan.passes.find((p) => /** @type {any} */ (p).id === inRef.passId);
      if (!producer || producer.kind !== 'warp-feedback') throw new Error(`composite: incoming render reference must identify a warp-feedback producer pass; got "${producer?.kind ?? '(none)'}" — refusing`);
      const wf = /** @type {WarpFeedbackPass} */ (producer);
      // gammaAdj + video echo — ShowToUser_NoShaders (milkdropfs.cpp:4147-4260).
      const passId = _eng.nextPassId();
      plan.passes.push(/** @type {any} */ ({
        id: passId,
        kind: 'composite',
        comp: {
          gamma: pool.gamma ?? ports.fGammaAdj,
          echoAlpha: ports.fVideoEchoAlpha,
          echoZoom: pool.echo_zoom ?? ports.fVideoEchoZoom,
          echoOrient: (ports.nVideoEchoOrientation) % 4,
          aspectY: wf.motion.aspectY,
        },
        reads: [inRef.resourceId], writes: [target.resourceId],
      }));
      plan.presentation = { resourceId: target.resourceId };
      return { presented: /** @type {any} */ ({ resourceId: target.resourceId }) };
    },
  },
  // ---- Native render ops (Plane9-source-neutral) --------------------
  'clear-color': {
    // Source-neutral native clear: fills the target texture resource with
    // one RGBA color read from its vec4 Color input port. Plane9's Clear
    // node converts onto this op. Realization is a real WebGPU clear pass.
    kind: 'render',
    inputs: { Color: 'vec4', Target: 'texture' },
    outputs: { Render: 'render' },
    contribute(inputRefs, ports, _pool, eng, plan) {
      if (Object.keys(inputRefs).length !== 0) throw new Error('clear-color is a plan source and takes no render inputs — refusing');
      const target = /** @type {ResourceRef|undefined} */ (ports.Target);
      if (!target || typeof target !== 'object' || !('resourceId' in target)) throw new Error('clear-color: Target port must carry a texture resource reference — refusing');
      const desc = plan.resources.find((r) => r.id === target.resourceId);
      if (!desc) throw new Error(`clear-color: Target references resource "${target.resourceId}" which is not declared in the scene — refusing`);
      if (desc.kind === 'presentation') throw new Error(`clear-color: Target resource "${target.resourceId}" has kind "presentation"; clearing the presentation resource directly is not supported by the executor — refusing`);
      const c = ports.Color;
      const passId = eng.nextPassId();
      plan.passes.push(/** @type {any} */ ({
        id: passId,
        kind: 'clear-color',
        clear: { r: c[0], g: c[1], b: c[2], a: c[3] },
        reads: [], writes: [target.resourceId],
      }));
      return { Render: /** @type {any} */ ({ resourceId: target.resourceId, passId }) };
    },
  },
  'plane9-blur': {
    // Plane9's blur.glsl (C:\Program Files (x86)\Plane9\nodedata\blur.glsl,
    // v2.5.1 install). Each `plane9-blur` op invocation contributes one
    // shader pass — Pass=0 is horizontal-4, Pass=1 vertical-4, Pass=2
    // horizontal-6, Pass=3 vertical-6, matching the source's four
    // `#if PASS == N` branches. Texture is the incoming Texture-typed
    // resource the shader samples; Target names the destination texture
    // resource the pass writes; Brightness maps to the shader's
    // gBrightness uniform (blur.glsl:3 default 1.0); the
    // gSourceTextureSize uniform (blur.glsl:4) is computed by the
    // executor from the source texture's actual dimensions each frame
    // (1/textureWidth, 1/textureHeight) — Plane9 supplies this uniform
    // at runtime rather than storing it on the Blur node itself. The
    // Plane9 Blur node's Dir="2" ("Both") + Width={4,6} pair is expanded
    // by the p9 converter into two `plane9-blur` graph nodes (H then V)
    // with distinct Pass values, so each shader pass is a first-class
    // pass in the plan. Ports use Plane9's own Texture-typed IO — the
    // Texture input mirrors Plane9's Blur.Texture inbound port and the
    // Color output exposes the blurred texture for downstream texture-
    // typed consumers (reviewer 2026-07-18 correction: previously used
    // Src/Render render-typed ports which required synthetic Render-
    // output rewriting in the converter; the honest form is Texture in,
    // Color out, both texture-typed).
    kind: 'render',
    inputs: {
      Texture: 'texture',
      Target: 'texture',
      Pass: 'float',
      Brightness: 'float',
    },
    outputs: { Color: 'texture' },
    contribute(_inputRefs, ports, _pool, eng, plan) {
      const inRef = /** @type {ResourceRef|undefined} */ (ports.Texture);
      if (!inRef || typeof inRef !== 'object' || !('resourceId' in inRef)) throw new Error('plane9-blur: Texture port must carry a texture resource reference — refusing');
      const target = /** @type {ResourceRef|undefined} */ (ports.Target);
      if (!target || typeof target !== 'object' || !('resourceId' in target)) throw new Error('plane9-blur: Target port must carry a texture resource reference — refusing');
      const targetDesc = plan.resources.find((r) => r.id === target.resourceId);
      if (!targetDesc) throw new Error(`plane9-blur: Target references resource "${target.resourceId}" which is not declared in the scene — refusing`);
      if (targetDesc.kind !== 'texture') throw new Error(`plane9-blur: Target resource "${target.resourceId}" must have kind "texture", got "${targetDesc.kind}" — refusing`);
      const srcDesc = plan.resources.find((r) => r.id === inRef.resourceId);
      if (!srcDesc) throw new Error(`plane9-blur: Texture references resource "${inRef.resourceId}" which is not declared in the scene — refusing`);
      const passNumberRaw = /** @type {number} */ (ports.Pass);
      const passNumber = Math.round(passNumberRaw);
      if (passNumber !== 0 && passNumber !== 1 && passNumber !== 2 && passNumber !== 3) throw new Error(`plane9-blur: Pass port must be 0, 1, 2, or 3 (matching blur.glsl PASS branches), got ${passNumberRaw} — refusing`);
      const brightness = /** @type {number} */ (ports.Brightness);
      if (!Number.isFinite(brightness)) throw new Error(`plane9-blur: Brightness port must be a finite float, got ${brightness} — refusing`);
      const passId = eng.nextPassId();
      plan.passes.push(/** @type {any} */ ({
        id: passId,
        kind: 'plane9-blur',
        pass: passNumber,
        brightness,
        reads: [inRef.resourceId], writes: [target.resourceId],
      }));
      return { Color: /** @type {any} */ ({ resourceId: target.resourceId, passId }) };
    },
  },
  'plane9-rendertotexture': {
    // Plane9's RenderToTexture node — DLL description at Plane9Engine.dll
    // offset 0x1f8ad4 (v2.5.1 install, sha256 4cebc1b3...ba1196) reads
    // "Converts a render port to a texture port." The native op models
    // that description as a blit from the incoming Render's resource to
    // the Target texture — the resource descriptor the scene declares
    // owns the realized pixel size and format, so no Format/Width/
    // Height/CreateMipMaps ports appear on the op (they would be inert
    // if the resource owns the realized size, and inert ports fail
    // sip-code-guidelines Complete Representation). Plane9 CONVERSION
    // of this node is UNRESOLVED at src/p9-import.mjs P9_COMPATIBILITY
    // because the RTT Format enum labels (which specific pixel format
    // Plane9 selects for Format=5) are not adjacent to the metadata
    // block at 0x1f8b00-0x1f8cb8 in the DLL string table and cannot be
    // resolved without a separate table pointer walk; a native PHOS
    // scene may still use this op with an explicit fixed-pixel-size
    // Target resource per the new size.policy="fixed" descriptor
    // capability.
    kind: 'render',
    inputs: {
      Render: 'render',
      Target: 'texture',
    },
    outputs: { Color: 'texture' },
    contribute(inputRefs, ports, _pool, eng, plan) {
      const inRef = /** @type {any} */ (inputRefs.Render);
      if (!inRef) throw new Error('plane9-rendertotexture requires an incoming render reference on its "Render" port — refusing');
      const target = /** @type {ResourceRef|undefined} */ (ports.Target);
      if (!target || typeof target !== 'object' || !('resourceId' in target)) throw new Error('plane9-rendertotexture: Target port must carry a texture resource reference — refusing');
      const targetDesc = plan.resources.find((r) => r.id === target.resourceId);
      if (!targetDesc) throw new Error(`plane9-rendertotexture: Target references resource "${target.resourceId}" which is not declared in the scene — refusing`);
      if (targetDesc.kind !== 'texture') throw new Error(`plane9-rendertotexture: Target resource "${target.resourceId}" must have kind "texture", got "${targetDesc.kind}" — refusing`);
      const passId = eng.nextPassId();
      plan.passes.push(/** @type {any} */ ({
        id: passId,
        kind: 'plane9-rendertotexture',
        reads: [inRef.resourceId], writes: [target.resourceId],
      }));
      return { Color: /** @type {any} */ ({ resourceId: target.resourceId, passId }) };
    },
  },
  'screen': {
    // Plane9 render sink. Identifies the connected resource as the
    // presentation source; the executor blits it to the canvas.
    kind: 'render',
    inputs: {
      Viewport: 'vec4', CamPos: 'vec3', CamRot: 'vec3', CamLookAt: 'vec3',
      CamLookAtInWorldSpace: 'float', CamFov: 'float', CamNear: 'float', CamFar: 'float',
      ScaleByAspect: 'float', Render: 'render',
    },
    outputs: { presented: 'render' },
    portConstraints: {
      Viewport: [0, 0, 1, 1], CamPos: [0, 0, -2], CamRot: [0, 0, 0], CamLookAt: [0, 0, 1],
      CamLookAtInWorldSpace: 0, CamFov: 45, CamNear: 0.1, CamFar: 1000, ScaleByAspect: 0,
    },
    contribute(inputRefs, _ports, _pool, _eng, plan) {
      const inRef = inputRefs.Render;
      if (!inRef) throw new Error('screen requires an incoming render reference on its "Render" port — refusing');
      const desc = plan.resources.find((r) => r.id === inRef.resourceId);
      if (!desc) throw new Error(`screen: incoming render reference names resource "${inRef.resourceId}" which is not declared in the scene — refusing`);
      if (!desc.usage.includes('sampled') && desc.kind !== 'presentation') throw new Error(`screen: presented resource "${inRef.resourceId}" must be either kind "presentation" or have usage "sampled" so the executor can source it — refusing`);
      plan.presentation = { resourceId: inRef.resourceId };
      return { presented: { resourceId: inRef.resourceId } };
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

/**
 * Central authoritative plan validation (reviewer 2026-07-18 substrate
 * completion pass §3). Runs after every contribute has added its
 * resources, passes, and presentation to the plan. Refuses:
 *
 *   1. no presentation set;
 *   2. presentation resource id not declared in plan.resources;
 *   3. any pass read/write naming an undeclared resource id;
 *   4. read from a resource without `sampled` usage;
 *   5. write to a resource without `render-attachment` usage;
 *   6. write to a resource with kind `presentation` (executor blits to
 *      canvas via the presentation resource; only composite is allowed
 *      to write a presentation-kind resource, checked below);
 *   7. same-pass read+write of the same resource unless the resource
 *      lifetime is `persistent-pingpong` (ping-pong is the explicit
 *      authorization for that pattern; other lifetimes forbid it);
 *   8. ambiguous multiple writers of the same non-pingpong resource;
 *   9. transient read-before-write (a read of a transient resource
 *      appears in a pass earlier than any write to it);
 *  10. presentation resource is transient without any writer in the frame;
 *  11. presentation resource kind is not `texture` or `presentation`;
 *  12. more than one composite pass writing the same presentation resource.
 *
 * The Plane9 witnessed Clear→Screen shape presents a transient texture
 * whose lifetime is `transient` and kind `texture`; the MilkDrop shape
 * presents a per-frame `presentation`-kind resource composite writes.
 * @param {RenderPlan} plan
 */
function validatePlan(plan) {
  if (!plan.presentation) throw new Error('Engine: plan has no presentation resource — the presentation sink did not set plan.presentation, refusing');
  const presResourceId = plan.presentation.resourceId;
  const presDesc = plan.resources.find((r) => r.id === presResourceId);
  if (!presDesc) throw new Error(`Engine: plan.presentation names resource "${presResourceId}" not declared in scene.resources — refusing`);
  if (presDesc.kind !== 'texture' && presDesc.kind !== 'presentation') throw new Error(`Engine: presentation resource "${presResourceId}" has unsupported kind "${presDesc.kind}" — refusing`);
  const resourceById = /** @type {Record<string, ResourceDescriptor>} */ ({});
  for (const r of plan.resources) resourceById[r.id] = r;
  // Track write times per resource to enforce transient-read-before-write.
  /** @type {Record<string, number>} */
  const firstWriteIdx = {};
  /** @type {Record<string, number>} */
  const writerCount = {};
  for (let i = 0; i < plan.passes.length; i++) {
    const p = /** @type {any} */ (plan.passes[i]);
    for (const rid of p.reads) {
      const rd = resourceById[rid];
      if (!rd) throw new Error(`Engine: pass "${p.kind}" reads undeclared resource "${rid}" — refusing`);
      if (!rd.usage.includes('sampled')) throw new Error(`Engine: pass "${p.kind}" reads resource "${rid}" which does not declare "sampled" usage — refusing`);
      if (rd.lifetime === 'transient' && firstWriteIdx[rid] === undefined) throw new Error(`Engine: pass "${p.kind}" (index ${i}) reads transient resource "${rid}" before any pass writes it — refusing`);
    }
    for (const rid of p.writes) {
      const rd = resourceById[rid];
      if (!rd) throw new Error(`Engine: pass "${p.kind}" writes undeclared resource "${rid}" — refusing`);
      if (!rd.usage.includes('render-attachment')) throw new Error(`Engine: pass "${p.kind}" writes resource "${rid}" which does not declare "render-attachment" usage — refusing`);
      if (rd.kind === 'presentation' && p.kind !== 'composite') throw new Error(`Engine: pass "${p.kind}" writes presentation resource "${rid}"; only composite may write a presentation-kind resource — refusing`);
      if (firstWriteIdx[rid] === undefined) firstWriteIdx[rid] = i;
      writerCount[rid] = (writerCount[rid] ?? 0) + 1;
    }
    // Same-pass read+write aliasing: authorized only for
    // persistent-pingpong resources.
    for (const rid of p.reads) {
      if (p.writes.includes(rid)) {
        const rd = resourceById[rid];
        if (!rd || rd.lifetime !== 'persistent-pingpong') throw new Error(`Engine: pass "${p.kind}" reads and writes the same resource "${rid}" whose lifetime is "${rd?.lifetime}"; same-pass read+write aliasing is authorized only for persistent-pingpong resources — refusing`);
      }
    }
  }
  // Multiple writers refuse for every resource. Persistent-pingpong
  // authorizes one pass to read AND write the same logical resource in
  // one pass (the two physical textures alternate); it does NOT authorize
  // two unrelated writer passes. The same-pass read+write aliasing rule
  // above already covers ping-pong's authorized case; this check keeps
  // multiple unrelated writers refused regardless of lifetime, so a later
  // scene cannot silently ship with two writers competing for one
  // resource per the reviewer 2026-07-18 refinement.
  for (const [rid, count] of Object.entries(writerCount)) {
    if (count > 1) throw new Error(`Engine: resource "${rid}" has ${count} writer passes; multi-writer contracts are not supported — refusing`);
  }
  // Presented transient resource must have a writer in this frame.
  if (presDesc.lifetime === 'transient' && firstWriteIdx[presResourceId] === undefined) throw new Error(`Engine: presentation resource "${presResourceId}" has lifetime "transient" but no pass writes it in this frame — refusing`);
  // Every emitted pass carries a unique, nonempty stable id so downstream
  // ops and regressions can address passes by id without positional
  // ambiguity. Duplicate or missing ids would let a producer silently
  // ship two passes the graph cannot distinguish.
  /** @type {Set<string>} */
  const seenIds = new Set();
  for (let i = 0; i < plan.passes.length; i++) {
    const p = /** @type {any} */ (plan.passes[i]);
    const pid = p.id;
    if (typeof pid !== 'string' || pid.length === 0) throw new Error(`Engine: pass at index ${i} (kind "${p.kind}") has missing or empty id; every pass must carry a nonempty stable id — refusing`);
    if (seenIds.has(pid)) throw new Error(`Engine: duplicate pass id "${pid}" at index ${i} (kind "${p.kind}"); every pass id must be unique in the plan — refusing`);
    seenIds.add(pid);
  }
}

/**
 * Cross-field validation for every resource descriptor the scene declares,
 * including resources no op references (reviewer 2026-07-18 §2). Rules:
 *
 *   1. presentation kind → format=preferred-canvas, size.policy=canvas,
 *      lifetime=per-frame, usage={render-attachment, presentation}. No
 *      other combination is currently supported.
 *   2. texture kind → format=rgba8unorm, size.policy in {canvas,
 *      canvas-16block}, lifetime in {persistent-pingpong, transient},
 *      usage subset of {sampled, render-attachment} with at least one
 *      realizable GPU usage flag. `presentation` usage is presentation-
 *      kind-only; `preferred-canvas` format is presentation-kind-only.
 *   3. persistent-pingpong lifetime → kind=texture with usage including
 *      both `sampled` AND `render-attachment` (ping-pong needs both to
 *      alternate reads and writes across its two physical textures).
 *
 * These rules run at Engine construction over scene.resources so an
 * unused declared resource cannot ship an invalid descriptor into the
 * executor's createTexture path, and so no descriptor Engine accepts
 * causes createTexture() to receive zero GPU usage flags.
 * @param {any[]} resources
 */
function validateResourceDescriptors(resources) {
  for (const r of resources) {
    const rid = r?.id;
    const kind = r?.kind;
    const format = r?.format;
    const policy = r?.size?.policy;
    const lifetime = r?.lifetime;
    /** @type {string[]} */
    const usage = Array.isArray(r?.usage) ? r.usage : [];
    if (kind === 'presentation') {
      if (format !== 'preferred-canvas') throw new Error(`Engine: resource "${rid}" kind "presentation" requires format "preferred-canvas", got "${format}" — refusing`);
      if (policy !== 'canvas') throw new Error(`Engine: resource "${rid}" kind "presentation" requires size.policy "canvas", got "${policy}" — refusing`);
      if (lifetime !== 'per-frame') throw new Error(`Engine: resource "${rid}" kind "presentation" requires lifetime "per-frame", got "${lifetime}" — refusing`);
      if (!usage.includes('render-attachment') || !usage.includes('presentation')) throw new Error(`Engine: resource "${rid}" kind "presentation" must declare usage "render-attachment" and "presentation", got [${usage.join(', ')}] — refusing`);
      for (const u of usage) if (u !== 'render-attachment' && u !== 'presentation') throw new Error(`Engine: resource "${rid}" kind "presentation" has unsupported usage entry "${u}"; only "render-attachment" and "presentation" are supported — refusing`);
      continue;
    }
    if (kind === 'texture') {
      if (format !== 'rgba8unorm' && format !== 'rgba16float') throw new Error(`Engine: resource "${rid}" kind "texture" requires format in {rgba8unorm, rgba16float}, got "${format}"; format "preferred-canvas" is presentation-kind-only — refusing`);
      if (policy !== 'canvas' && policy !== 'canvas-16block' && policy !== 'fixed') throw new Error(`Engine: resource "${rid}" kind "texture" requires size.policy in {canvas, canvas-16block, fixed}, got "${policy}" — refusing`);
      if (policy === 'fixed') {
        const w = /** @type {any} */ (r.size).width;
        const h = /** @type {any} */ (r.size).height;
        if (!Number.isInteger(w) || w <= 0) throw new Error(`Engine: resource "${rid}" size.policy "fixed" requires positive integer width, got ${w} — refusing`);
        if (!Number.isInteger(h) || h <= 0) throw new Error(`Engine: resource "${rid}" size.policy "fixed" requires positive integer height, got ${h} — refusing`);
      }
      if (lifetime !== 'persistent-pingpong' && lifetime !== 'transient') throw new Error(`Engine: resource "${rid}" kind "texture" requires lifetime in {persistent-pingpong, transient}, got "${lifetime}" — refusing`);
      if (usage.includes('presentation')) throw new Error(`Engine: resource "${rid}" kind "texture" carries usage "presentation"; that usage entry is presentation-kind-only — refusing`);
      // Every texture must declare at least one realizable GPU usage
      // flag. Only sampled and render-attachment survive the executor's
      // usage-flag resolution for a texture kind — an empty usage list
      // or a list missing both entries produces a WebGPU createTexture
      // call with zero usage flags, which the executor rejects at
      // runtime. Refuse here at construction rather than defer.
      if (!usage.includes('sampled') && !usage.includes('render-attachment')) throw new Error(`Engine: resource "${rid}" kind "texture" must declare at least one of {sampled, render-attachment} usage; got [${usage.join(', ')}] — the executor cannot allocate a texture with zero GPU usage flags — refusing`);
      for (const u of usage) if (u !== 'sampled' && u !== 'render-attachment') throw new Error(`Engine: resource "${rid}" kind "texture" has unsupported usage entry "${u}"; only "sampled" and "render-attachment" are supported — refusing`);
      if (lifetime === 'persistent-pingpong' && (!usage.includes('sampled') || !usage.includes('render-attachment'))) throw new Error(`Engine: resource "${rid}" lifetime "persistent-pingpong" requires usage "sampled" AND "render-attachment" (both physical textures alternate read/write), got [${usage.join(', ')}] — refusing`);
      continue;
    }
    throw new Error(`Engine: resource "${rid}" has unsupported kind "${kind}"; supported kinds are texture and presentation — refusing`);
  }
}

export class Engine {
  constructor(/** @type {any} */ scene) {
    this.scene = scene;
    /** @type {{id:string, op:string, ports:Record<string,{type:string, value?:number|number[]}>}[]} */
    const nodes = scene.nodes;
    /** @type {{out:string, in:string}[]} */
    const edges = scene.edges ?? [];
    // --- validate every declared resource descriptor cross-field ---
    // Every resource the scene declares must satisfy the substrate's
    // cross-field rules before topology work begins, so an unused
    // declared resource cannot ship an invalid descriptor into the
    // executor (reviewer 2026-07-18 §2).
    validateResourceDescriptors(scene.resources ?? []);
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
    // Fan-out into a producer-mutating consumer is refused, transitively
    // across render edges (reviewer 2026-07-18 §1 refinement). A consumer
    // op that declares `mutatesProducer:true` augments the pass
    // identified by its incoming render ref in place; a non-mutating
    // passthrough preserves the producer's passId as it forwards the
    // render ref, so a mutator reached anywhere downstream of a fan-out
    // branch would mutate the shared producer pass. The check walks
    // render-typed edges downstream from each fan-out branch's initial
    // destination; if any node reached on any branch declares
    // mutatesProducer=true, the fan-out is refused. Cycles are guarded
    // by a visited-node set (ordinary cycle validation via
    // topologicalOrder also remains in force below). Purely non-mutating
    // render fan-out stays legal; value edges are never inspected here.
    // Placed before the input-sourced check so the fan-out refusal fires
    // when the graph is otherwise well-formed enough to hit type-checked
    // edges but not the full sourcing sweep.
    /** @type {Map<string, {out:string,in:string}[]>} */
    const perProducerRenderEdges = new Map();
    for (const e of edges) {
      const [srcId, srcPort] = splitRef(e.out);
      const srcNode = nodes.find((n) => n.id === srcId);
      if (!srcNode) continue;
      const srcOp = opOf(srcNode.op);
      if (srcOp.outputs[srcPort] !== 'render') continue;
      const key = srcId + '.' + srcPort;
      const arr = perProducerRenderEdges.get(key) ?? [];
      arr.push(e);
      perProducerRenderEdges.set(key, arr);
    }
    for (const [key, list] of perProducerRenderEdges) {
      if (list.length < 2) continue;
      /** @type {Set<string>} */
      const mutatorsReached = new Set();
      for (const e of list) {
        const [startDstId] = splitRef(e.in);
        /** @type {Set<string>} */
        const visited = new Set();
        /** @type {string[]} */
        const stack = [startDstId];
        while (stack.length > 0) {
          const nid = /** @type {string} */ (stack.pop());
          if (visited.has(nid)) continue;
          visited.add(nid);
          const n = nodes.find((x) => x.id === nid);
          if (!n) continue;
          const nOp = /** @type {any} */ (opOf(n.op));
          if (nOp.mutatesProducer === true) mutatorsReached.add(n.op + ' (' + nid + ')');
          // Walk render-typed outgoing edges from this node.
          for (const e2 of edges) {
            const [srcId2, srcPort2] = splitRef(e2.out);
            if (srcId2 !== nid) continue;
            if (nOp.outputs[srcPort2] !== 'render') continue;
            const [dstId2] = splitRef(e2.in);
            stack.push(dstId2);
          }
        }
      }
      if (mutatorsReached.size > 0) throw new Error(`Engine: render output "${key}" fans out to ${list.length} branches with producer-mutating op(s) reachable downstream [${[...mutatorsReached].join(', ')}]; a mutating consumer requires exclusive access to its producer pass — refusing`);
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
    // The entry carries `opName` alongside `nodeId` and `portName` so the
    // pool-back-to-port sync at `_writePoolIntoPorts` can call
    // `assertPortValue` on every write without re-searching the scene
    // (reviewer 2026-07-18: EEL was the last write path that bypassed the
    // portConstraints hook).
    /** @type {Map<string, {nodeId:string, portName:string, opName:string}>} */
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
        this.eelOwner.set(eelName, { nodeId: n.id, portName: pname, opName: n.op });
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
    this._passIdCounter = 0;
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
  /**
   * Sync the flat EEL pool back to node ports (aliased where applicable).
   * Every write funnels through the same portConstraints hook that
   * construction, setVar, and value-edge propagation use, so a per-frame
   * EEL equation like `CamFov=60` cannot silently land a witnessed-value
   * port on a value its op has no implementation for (reviewer 2026-07-18).
   */
  _writePoolIntoPorts() {
    for (const [eelName, { nodeId, portName, opName }] of this.eelOwner) {
      const v = this.pool[eelName];
      if (typeof v !== 'number') continue;
      assertPortValue(nodeId, opName, portName, v);
      const ns = /** @type {{ports:Record<string,any>}} */ (this.nodeState[nodeId]);
      ns.ports[portName] = v;
    }
  }

  step(/** @type {number} */ dt,
       /** @type {{bass?:number,mid?:number,treb?:number,bass_att?:number,mid_att?:number,treb_att?:number,musicActive?:boolean,rawBeat?:number}} */ audio = {}) {
    this.timekeeper.tick(dt);
    this.frame += 1;
    // Reset the per-frame pass id counter so pass ids are deterministic
    // across frames (pass-1, pass-2, ...) — makes plan comparison in
    // regressions and reordering-invariance tests reliable.
    this._passIdCounter = 0;

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

    // --- walk topological order — value ops compute + propagate; render
    // ops mutate a shared plan builder (resources declared once from the
    // scene; passes accumulated in topological order; presentation set
    // by the sink) and propagate ResourceRefs along render edges.
    /** @type {Record<string, Record<string, ResourceRef>>} */
    const nodeIncomingRefs = {};
    for (const node of this.order) nodeIncomingRefs[node.id] = {};
    /** @type {import('./engine.mjs').RenderPlan} */
    const plan = {
      resources: this.scene.resources.map((/** @type {ResourceDescriptor} */ r) => ({
        id: r.id, kind: r.kind, format: r.format,
        size: /** @type {any} */ (r.size.policy === 'fixed'
          ? { policy: 'fixed', width: /** @type {any} */ (r.size).width, height: /** @type {any} */ (r.size).height }
          : { policy: r.size.policy }),
        lifetime: r.lifetime, usage: [...r.usage],
      })),
      passes: [],
      presentation: null,
    };
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
            const dstNode = /** @type {{op:string}|undefined} */ (this.scene.nodes.find((/** @type {{id:string}} */ n) => n.id === dstId));
            if (dstNode) assertPortValue(dstId, dstNode.op, dstPort, outputs[srcPort]);
            const dstNs = /** @type {{ports:Record<string,any>}} */ (this.nodeState[dstId]);
            dstNs.ports[dstPort] = outputs[srcPort];
          }
        }
      } else if (op.kind === 'render' && op.contribute) {
        const inputRefs = /** @type {Record<string, ResourceRef>} */ (nodeIncomingRefs[node.id]);
        const outputRefs = op.contribute(inputRefs, ns.ports, this.pool, this, plan);
        for (const edge of this.outgoing.get(node.id) ?? []) {
          const [, srcPort] = splitRef(edge.out);
          const [dstId, dstPort] = splitRef(edge.in);
          const srcType = op.outputs[srcPort];
          if (srcType === 'render' || srcType === 'texture') {
            const producedRef = outputRefs[srcPort];
            if (producedRef === undefined) throw new Error(`Engine: node "${node.id}" (${node.op}) declared ${srcType} output "${srcPort}" but its contribute returned no resource ref for that port — refusing`);
            const dstInputs = /** @type {Record<string, ResourceRef>} */ (nodeIncomingRefs[dstId]);
            if (dstInputs[dstPort] !== undefined) {
              throw new Error(`Engine: node "${dstId}" ${srcType} input "${dstPort}" already carries a resource ref from a prior edge — refusing multiple-driver ${srcType} input at execution`);
            }
            const propagated = /** @type {ResourceRef} */ ({ resourceId: producedRef.resourceId });
            if (/** @type {any} */ (producedRef).passId !== undefined) propagated.passId = /** @type {any} */ (producedRef).passId;
            dstInputs[dstPort] = propagated;
            // Texture-typed inputs are read by downstream ops from
            // ports (matching the constant-driven convention used by
            // e.g. Feedback and Target); mirror the edge-propagated
            // ref into ports so both wiring styles resolve the same
            // way at contribute() time. Render-typed inputs continue
            // to flow through nodeIncomingRefs unchanged.
            if (srcType === 'texture') {
              const dstNs = /** @type {{ports:Record<string,any>}} */ (this.nodeState[dstId]);
              dstNs.ports[dstPort] = propagated;
            }
          }
        }
      }
    }
    validatePlan(plan);
    return plan;
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
  /** Generate a stable per-frame pass id used by contribute functions to
   * identify the producer pass of a render edge; borders references the
   * warp-feedback pass by id rather than by position. */
  nextPassId() { this._passIdCounter += 1; return 'pass-' + this._passIdCounter; }
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
    for (const [pname, port] of Object.entries(/** @type {Record<string,{type?:string, value?:any}>} */ (n.ports))) {
      if (!('value' in port)) continue;
      // Texture ports carry ResourceRef values, not numbers; the flat
      // EEL-style view is scalar/vector only.
      if (port.type === 'texture') continue;
      if (owner[pname] !== undefined) {
        throw new Error(`flatPortView: port "${pname}" is claimed by both "${owner[pname]}" and "${n.id}" — this scene needs node-qualified access`);
      }
      owner[pname] = n.id;
      out[pname] = port.value;
    }
  }
  return out;
}
