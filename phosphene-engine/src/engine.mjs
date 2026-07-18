// The engine core: takes the runtime IR of a .phos scene and runs the
// per-frame expressions. The graph controls topology validation, ordering,
// and render-state assembly under a fixed GPU pipeline — it does not drive
// GPU dispatch. Headless-capable (no GPU dependency) so it's testable.
import { compileEEL } from './expr-vm.mjs';
import { Timekeeper } from './timekeeper.mjs';

// MilkDrop's float->D3DCOLOR channel conversion — (int)(v*255) masked to 8
// bits (D3DCOLOR_RGBA_01, milkdropfs.cpp:41). Truncation then wrap: 1.1 ->
// 24/255, 0.98 -> 249/255. The scene-one border blink past 1.0 IS this wrap.
export function d3dColor01(/** @type {number} */ v) { return (Math.trunc(v * 255) & 0xFF) / 255; }
import { GRID_X, GRID_Y } from './warp-mesh.mjs';

// THE NATIVE-OPERATION REGISTRY (owner-ratified 2026-07-18, replacing the
// fixed MilkDrop sequence contract of 2026-07-17): the single authority for
// what operations exist, what value-ports each consumes, what render state
// each contributes, and what op sequences are realizable. An op enters this
// registry only together with its renderer realization in BOTH pages
// (src/studio.mjs + src/player.mjs dispatch on the contributed state), so an
// accepted graph can never exceed the renderer (Complete Representation).
// Dispatch is by .phos op name only — nothing here reads source-engine
// metadata, per PHOSPHENE-GOAL.md "one native execution model, no parallel
// runtimes".
//
// Sequence grammar per op: `first` (may start a chain), `after` (ops it may
// directly follow), `terminal` (may end the chain). The chain is accepted
// exactly when every link satisfies the grammar — today that admits the
// MilkDrop pipeline [warp-feedback -> borders -> composite] (fixed per
// milkdropfs.cpp:1048-1214) and the single-node [clear-color] graph.
/** @typedef {{ports:string[], first:boolean, after:string[], terminal:boolean, contribute:(state:any, p:Record<string,number>, eng:Engine)=>void}} NativeOp */
export const NATIVE_OPS = /** @type {Record<string,NativeOp>} */ ({
  'warp-feedback': {
    ports: ['fDecay', 'zoom', 'rot', 'warp', 'cx', 'cy', 'dx', 'dy', 'sx', 'sy',
      'fWarpAnimSpeed', 'fWarpScale', 'fZoomExponent'],
    first: true, after: [], terminal: false,
    contribute(state, p, eng) {
      // per-frame warp oscillators — milkdropfs.cpp:1782-1787
      const warpTime = eng.time * (p.fWarpAnimSpeed ?? 0);
      state.motion = {
        aspectX: eng.aspectX(), aspectY: eng.aspectY(), // plugin.cpp:2027-2028
        // warp-pass sampler address choice: wrap > 0.5 selects WRAP else
        // CLAMP (WarpedBlit_NoShaders texaddr, milkdropfs.cpp:1991; snap
        // point 0.5, :588 — blend-time snap variants gated with preset-blend)
        wrap: p.wrap ?? 0,
        decay: d3dColor01(p.decay ?? 0), // quantized via the D3DCOLOR modulate path (:2007)
        zoom: p.zoom ?? 0, zoomExp: p.zoomexp ?? 0, rot: p.rot ?? 0, warp: p.warp ?? 0,
        cx: p.cx ?? 0, cy: p.cy ?? 0, dx: p.dx ?? 0, dy: p.dy ?? 0, sx: p.sx ?? 0, sy: p.sy ?? 0,
        warpTime,
        warpScaleInv: 1 / (p.fWarpScale ?? 1),
        f0: 11.68 + 4.0 * Math.cos(warpTime * 1.413 + 10),
        f1: 8.77 + 3.0 * Math.cos(warpTime * 1.113 + 7),
        f2: 10.54 + 3.0 * Math.cos(warpTime * 1.233 + 3),
        f3: 11.49 + 4.0 * Math.cos(warpTime * 0.933 + 5),
      };
    },
  },
  'borders': {
    ports: ['ib_size', 'ib_r', 'ib_g', 'ib_b', 'ib_a', 'ob_size', 'ob_r', 'ob_g', 'ob_b', 'ob_a'],
    first: false, after: ['warp-feedback'], terminal: false,
    contribute(state, p) {
      // colors and alphas pass the 8-bit conversion (:3453-3457); the draw
      // gate reads the RAW alpha (:3451) — aGate carries it separately
      state.innerBox = { size: p.ib_size ?? 0, r: d3dColor01(p.ib_r ?? 0), g: d3dColor01(p.ib_g ?? 0), b: d3dColor01(p.ib_b ?? 0), a: d3dColor01(p.ib_a ?? 0), aGate: p.ib_a ?? 0 };
      state.outerBox = { size: p.ob_size ?? 0, r: d3dColor01(p.ob_r ?? 0), g: d3dColor01(p.ob_g ?? 0), b: d3dColor01(p.ob_b ?? 0), a: d3dColor01(p.ob_a ?? 0), aGate: p.ob_a ?? 0 };
    },
  },
  'composite': {
    ports: ['fGammaAdj', 'fVideoEchoZoom', 'fVideoEchoAlpha', 'nVideoEchoOrientation'],
    first: false, after: ['borders'], terminal: true,
    contribute(state, p) {
      // gammaAdj + video echo — ShowToUser_NoShaders (milkdropfs.cpp:4147-4260)
      state.comp = {
        gamma: p.gamma ?? 0, echoAlpha: p.echo_alpha ?? 0,
        echoZoom: p.echo_zoom ?? 0, echoOrient: (p.echo_orient ?? 0) % 4,
      };
    },
  },
  'clear-color': {
    // Source-neutral native clear: fills the render surface with one RGBA
    // color, values as raw 0..1 floats each frame (per-frame programs may
    // animate the ports through the pool — native semantics, ours to define).
    // The realization is a real WebGPU clear pass (loadOp:'clear' with this
    // clearValue) in both pages. Plane9's Clear node converts onto this op:
    // "Fills the viewport with a single color." (Plane9Engine.dll
    // sha256 4cebc1b3... string at 0x1f7ecc; CRenderOGL::Clear(glm::vec4&..)
    // export at 0x2295b3 — sources/PLANE9-CONTRACT.md).
    ports: ['clear_r', 'clear_g', 'clear_b', 'clear_a'],
    first: true, after: [], terminal: true,
    contribute(state, p) {
      state.clear = { r: p.clear_r ?? 0, g: p.clear_g ?? 0, b: p.clear_b ?? 0, a: p.clear_a ?? 0 };
    },
  },
});

// Value-port declaration view of the registry, shared by conversion and
// execution: the converter (src/phos.mjs emitPort) refuses to emit a port
// outside this declaration, and Engine construction below refuses a scene
// carrying one — so an emitted port without a runtime consumer cannot exist
// on either side. A scene missing a declared port is equally refused — no
// silent defaults (defaults are the CONVERTER's job, materialized into the
// .phos from cited values).
export const OP_PORTS = /** @type {Record<string,string[]>} */ (
  Object.fromEntries(Object.entries(NATIVE_OPS).map(([op, d]) => [op, d.ports])));

// Ports whose values reach the GPU. With the warp math implemented, every
// value port of the supported ops is consumed; the studio uses this to mark
// any future unconsumed port as inert rather than silently editable.
// .milk file keys -> the EEL variable names per-frame equations actually see,
// witnessed from the regvar list at state.cpp:260-331 ("decay", "gamma",
// "echo_zoom", "echo_alpha", "echo_orient", "zoomexp"; all others identical).
// fWarpAnimSpeed/fWarpScale have NO regvar — they are preset state, not
// equation-visible variables, so they stay under their file keys.
const KEY_TO_EEL = /** @type {Record<string,string>} */ ({
  fDecay: 'decay', fGammaAdj: 'gamma', fVideoEchoZoom: 'echo_zoom',
  fVideoEchoAlpha: 'echo_alpha', nVideoEchoOrientation: 'echo_orient',
  fZoomExponent: 'zoomexp',
});
// Equation-visible preset defaults: values an equation READS even when the
// preset file omits them, witnessed from CState::Default (state.cpp:541-683)
// through the var_pf assignment block (milkdropfs.cpp:495-548). These are
// pool-only until their subsystems' nodes exist; rendered vars get their
// defaults materialized into the .phos by the converter instead.
const EQ_DEFAULTS = /** @type {Record<string,number>} */ ({
  wave_a: 0.8, wave_r: 1, wave_g: 1, wave_b: 1, wave_x: 0.5, wave_y: 0.5,
  wave_mystery: 0, wave_mode: 0, wave_usedots: 0, wave_thick: 0,
  wave_additive: 0, wave_brighten: 1,
  darken_center: 0, wrap: 1, invert: 0, brighten: 0, darken: 0, solarize: 0,
  mv_x: 12, mv_y: 9, mv_dx: 0, mv_dy: 0, mv_l: 0.9, mv_r: 1, mv_g: 1, mv_b: 1, mv_a: 1,
  blur1_min: 0, blur2_min: 0, blur3_min: 0, blur1_max: 1, blur2_max: 1, blur3_max: 1,
  blur1_edge_darken: 0.25, monitor: 0,
});

function buildPool(/** @type {Record<string,number>} */ vars) {
  /** @type {Record<string,number>} */
  const pool = { ...EQ_DEFAULTS };
  for (const [k, v] of Object.entries(vars)) pool[KEY_TO_EEL[k] ?? k] = v;
  return pool;
}

export const CONSUMED_PORTS = Object.values(NATIVE_OPS).flatMap((d) => d.ports);

export class Engine {
  constructor(/** @type {any} */ scene) {
    // ---- graph-derived execution order (edges are the authority) ----
    /** @type {{id:string, stage:string, ports:string[]}[]} */
    const nodes = scene.pipelineDescriptor;
    /** @type {{out:string,in:string}[]} */
    const edges = scene.edges ?? [];
    if (!Array.isArray(edges) || edges.length !== nodes.length - 1) {
      throw new Error(`Engine: expected a linear chain (${nodes.length - 1} edges for ${nodes.length} nodes), got ${edges ? edges.length : 'none'} — refusing`);
    }
    const nextOf = new Map(edges.map((e) => [e.out.split('.')[0], e.in.split('.')[0]]));
    const hasIncoming = new Set(edges.map((e) => e.in.split('.')[0]));
    const startNodes = nodes.filter((n) => !hasIncoming.has(n.id));
    if (startNodes.length !== 1) throw new Error(`Engine: graph must have exactly one start node, found ${startNodes.length}`);
    /** @type {{id:string, stage:string, ports:string[]}[]} */
    this.order = [];
    let cur = /** @type {{id:string, stage:string, ports:string[]}|undefined} */ (startNodes[0]);
    while (cur) {
      this.order.push(cur);
      const nid = nextOf.get(cur.id);
      cur = nodes.find((n) => n.id === nid);
    }
    if (this.order.length !== nodes.length) throw new Error('Engine: edges do not form a single chain covering all nodes — refusing');
    // REGISTRY-VALIDATED SEQUENCE (owner decision 2026-07-18, generalizing the
    // 2026-07-17 fixed contract — the Plane9 clear graph is the scene that
    // forced it): every op must exist in NATIVE_OPS, and each chain link must
    // satisfy the per-op sequence grammar (first/after/terminal). Because an
    // op enters the registry only with its renderer realization, an accepted
    // sequence is always renderable — inventing semantics for other shapes
    // would fill missing knowledge with plausible behavior, which
    // PHOSPHENE-GOAL.md prohibits.
    const stages = this.order.map((n) => n.stage);
    for (const s of stages) {
      if (!NATIVE_OPS[s]) throw new Error(`Engine: op "${s}" is not a registered native operation (NATIVE_OPS) — refusing`);
    }
    const seq = /** @type {string[]} */ (stages);
    const firstStage = /** @type {string} */ (seq[0]);
    if (!(/** @type {NativeOp} */ (NATIVE_OPS[firstStage]).first)) {
      throw new Error(`Engine: op "${firstStage}" cannot start a pipeline — refusing sequence [${seq.join(' -> ')}]`);
    }
    for (let i = 1; i < seq.length; i++) {
      const cur = /** @type {string} */ (seq[i]);
      const prev = /** @type {string} */ (seq[i - 1]);
      if (!(/** @type {NativeOp} */ (NATIVE_OPS[cur]).after.includes(prev))) {
        throw new Error(`Engine: op "${cur}" cannot follow "${prev}" — refusing sequence [${seq.join(' -> ')}]`);
      }
    }
    const lastStage = /** @type {string} */ (seq[seq.length - 1]);
    if (!(/** @type {NativeOp} */ (NATIVE_OPS[lastStage]).terminal)) {
      throw new Error(`Engine: op "${lastStage}" cannot end a pipeline — refusing sequence [${seq.join(' -> ')}]`);
    }
    for (const n of this.order) {
      const declared = /** @type {string[]} */ (OP_PORTS[n.stage]);
      for (const k of declared) {
        if (typeof scene.vars[k] !== 'number') throw new Error(`Engine: node "${n.id}" (${n.stage}) requires variable "${k}" — missing from the scene, refusing`);
      }
      // undeclared extra value ports are refused: an accepted port the render
      // path never reads would be silently inert, the theater failure mode
      for (const pname of n.ports) {
        if (!declared.includes(pname)) throw new Error(`Engine: node "${n.id}" (${n.stage}) carries value port "${pname}" that no runtime path consumes — refusing an inert port`);
      }
    }
    // per-vertex programs parse but are REFUSED at execution until the engine
    // runs them (design/PHOS-FORMAT.md) — accepted-but-unexecuted code is the
    // structure-claimed-as-function failure mode.
    if (scene.expressions.perVertex && scene.expressions.perVertex.length > 0) {
      throw new Error('Engine: scene carries per-vertex code, which the engine does not yet execute — refusing rather than silently ignoring');
    }

    this.scene = scene;
    // immutable load-time baseline: Reset restores THIS, not the edited state
    this.baseline = { vars: { ...scene.vars }, perFrame: [...scene.expressions.perFrame] };
    this.pool = buildPool(scene.vars); // live variable pool, under EEL names
    this.perFrame = compileEEL(scene.expressions.perFrame);
    this.frame = 0;
    this.viewportW = 1024; this.viewportH = 1024; this.texW = 1024; this.texH = 1024; // headless defaults; pages overwrite via setViewport
    // INTERIM (design/PHOS-FORMAT.md Semantics): MilkDrop's timekeeping is
    // hardwired here for ALL scenes until the executor supports component
    // nodes that converted scenes can reference. Same for the audio chain.
    this.timekeeper = new Timekeeper(); // MilkDrop DoTime semantics: time += 1/damped-fps
  }
  get time() { return this.timekeeper.time; }

  // advance one frame. audio carries the derived analysis values (relative
  // loudness revolving around 1.0 — sources/AUDIO-PATH.md); absent values
  // default to 1, matching the source's silence behavior (Loudness.cpp:49-50).
  step(/** @type {number} */ dt, /** @type {{bass?:number,mid?:number,treb?:number,bass_att?:number,mid_att?:number,treb_att?:number}} */ audio = {}) {
    this.timekeeper.tick(dt); // time/fps per pluginshell.cpp:1895+ (src/timekeeper.mjs)
    this.frame += 1;
    // inject engine-provided variables (milkdropfs.cpp:471+ sets these pre-eval).
    // NOTE: no vol/vol_att — the per-frame regvar list (state.cpp:260-331) has
    // no such variables; classic equations reading vol see an auto-registered 0.
    // projectM-4 exposes vol, but the tier-1 source governs the conflict.
    Object.assign(this.pool, {
      time: this.timekeeper.time, frame: this.frame, fps: this.timekeeper.fps,
      bass: audio.bass ?? 1, mid: audio.mid ?? 1, treb: audio.treb ?? 1,
      bass_att: audio.bass_att ?? 1, mid_att: audio.mid_att ?? 1, treb_att: audio.treb_att ?? 1,
      // progress: (time - presetStart)/(nextPreset - presetStart), milkdropfs.cpp:495;
      // single-scene slice: start 0, duration = fTimeBetweenPresets default 16 (plugin.cpp:939)
      progress: this.timekeeper.time / 16,
      meshx: GRID_X, meshy: GRID_Y,       // grid defaults, plugin.cpp:952-953 (src/warp-mesh.mjs)
      pixelsx: this.viewportW, pixelsy: this.viewportH, // GetWidth/GetHeight, milkdropfs.cpp:543-544
      // the pool carries the INVERSE aspect factors (m_fInvAspectX/Y), milkdropfs.cpp:545-546
      aspectx: 1 / this.aspectX(), aspecty: 1 / this.aspectY(),
    });
    // run per-frame equations (the source-derived expression VM)
    this.perFrame(this.pool);
    // post-equation range clamps — milkdropfs.cpp:677-679 ("a few range checks")
    this.pool.gamma = Math.max(0, Math.min(8, this.pool.gamma ?? 0));
    this.pool.echo_zoom = Math.max(0.001, Math.min(1000, this.pool.echo_zoom ?? 0));
    return this.renderState();
  }

  // --- studio live-edit surface ---
  setVar(/** @type {string} */ name, /** @type {number} */ value) { this.scene.vars[name] = value; this.pool[KEY_TO_EEL[name] ?? name] = value; }
  getVar(/** @type {string} */ name) { return this.pool[KEY_TO_EEL[name] ?? name]; }
  setViewport(/** @type {number} */ w, /** @type {number} */ h, /** @type {number} */ texW = w, /** @type {number} */ texH = h) { this.viewportW = w; this.viewportH = h; this.texW = texW; this.texH = texH; }
  // aspect factors from the render-target size — plugin.cpp:2027-2028
  aspectX() { return (this.texH > this.texW) ? this.texW / this.texH : 1; }
  aspectY() { return (this.texW > this.texH) ? this.texH / this.texW : 1; }
  recompile(/** @type {string[]} */ perFrameSource) {
    this.scene.expressions.perFrame = perFrameSource;
    this.perFrame = compileEEL(perFrameSource);
  }
  reset() {
    // restore the load-time baseline (edits mutate scene.vars, so copying from
    // it would restore the edited state — the aliasing bug the review caught)
    this.scene.vars = { ...this.baseline.vars };
    this.scene.expressions.perFrame = [...this.baseline.perFrame];
    this.pool = buildPool(this.baseline.vars);
    this.perFrame = compileEEL(this.baseline.perFrame);
    this.frame = 0; this.timekeeper.reset();
  }

  // Render state assembled by walking the graph order: each node contributes
  // the state its op defines (NATIVE_OPS contribute), from its own port
  // values in the pool. Removing or rewiring a node in the .phos changes
  // (or refuses) this output.
  renderState() {
    const state = /** @type {any} */ ({ passes: this.order.map((n) => n.stage) });
    for (const n of this.order) {
      /** @type {NativeOp} */ (NATIVE_OPS[n.stage]).contribute(state, this.pool, this);
    }
    return state;
  }
}
