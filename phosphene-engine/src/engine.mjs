// The engine core: takes the runtime IR of a .phos scene, derives its pass
// order FROM THE GRAPH (edges determine execution, not hardcode), runs the
// per-frame expressions, and produces per-frame render state by walking the
// ordered nodes. Headless-capable (no GPU dependency) so it's testable.
import { compileEEL } from './expr-vm.mjs';
import { Timekeeper } from './timekeeper.mjs';

// The value-ports each supported op consumes; a scene missing any of them is
// refused at construction — no silent defaults (defaults are the CONVERTER's
// job, materialized into the .phos from cited source values).
const OP_PORTS = /** @type {Record<string,string[]>} */ ({
  'warp-feedback': ['fDecay', 'zoom', 'rot', 'warp', 'cx', 'cy', 'dx', 'dy', 'sx', 'sy',
    'fWarpAnimSpeed', 'fWarpScale', 'fZoomExponent'],
  'borders': ['ib_size', 'ib_r', 'ib_g', 'ib_b', 'ib_a', 'ob_size', 'ob_r', 'ob_g', 'ob_b', 'ob_a'],
  'composite': ['fGammaAdj', 'fVideoEchoZoom', 'fVideoEchoAlpha', 'nVideoEchoOrientation'],
});

// Ports whose values reach the GPU. With the warp math implemented, every
// value port of the supported ops is consumed; the studio uses this to mark
// any future unconsumed port as inert rather than silently editable.
export const CONSUMED_PORTS = [...OP_PORTS['warp-feedback'] ?? [], ...OP_PORTS['borders'] ?? [], ...OP_PORTS['composite'] ?? []];

export class Engine {
  constructor(/** @type {any} */ scene) {
    // ---- graph-derived execution order (edges are the authority) ----
    /** @type {{id:string, stage:string, ports:string[]}[]} */
    const nodes = scene.pipelineDescriptor;
    /** @type {{out:string,in:string}[]} */
    const edges = scene.edges ?? [];
    if (!Array.isArray(edges) || edges.length !== nodes.length - 1) {
      throw new Error(`Engine: expected a linear chain (${nodes.length - 1} edges for ${nodes.length} nodes), got ${edges ? edges.length : 'none'} — the graph drives execution, refusing`);
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
    for (const n of this.order) {
      const required = OP_PORTS[n.stage];
      if (!required) throw new Error(`Engine: unsupported op "${n.stage}" — the executor implements [${Object.keys(OP_PORTS).join(', ')}], refusing`);
      for (const k of required) {
        if (typeof scene.vars[k] !== 'number') throw new Error(`Engine: node "${n.id}" (${n.stage}) requires variable "${k}" — missing from the scene, refusing`);
      }
    }
    const last = this.order[this.order.length - 1];
    if (!last || last.stage !== 'composite') throw new Error('Engine: the chain must terminate at a composite node — refusing');

    this.scene = scene;
    this.pool = /** @type {Record<string,number>} */ ({ ...scene.vars }); // live variable pool
    this.perFrame = compileEEL(scene.expressions.perFrame);
    this.frame = 0;
    // INTERIM (design/PHOS-FORMAT.md Semantics): MilkDrop's timekeeping is
    // hardwired here for ALL scenes until the executor supports component
    // nodes that converted scenes can reference. Same for the audio chain.
    this.timekeeper = new Timekeeper(); // MilkDrop DoTime semantics: time += 1/damped-fps
  }
  get time() { return this.timekeeper.time; }

  // advance one frame. audio carries the derived analysis values (relative
  // loudness revolving around 1.0 — sources/AUDIO-PATH.md); absent values
  // default to 1, matching the source's silence behavior (Loudness.cpp:49-50).
  step(/** @type {number} */ dt, /** @type {{bass?:number,mid?:number,treb?:number,bass_att?:number,mid_att?:number,treb_att?:number,vol?:number,vol_att?:number}} */ audio = {}) {
    this.timekeeper.tick(dt); // time/fps per pluginshell.cpp:1895+ (src/timekeeper.mjs)
    this.frame += 1;
    // inject engine-provided variables (milkdropfs.cpp:471+ sets these pre-eval)
    Object.assign(this.pool, {
      time: this.timekeeper.time, frame: this.frame, fps: this.timekeeper.fps,
      bass: audio.bass ?? 1, mid: audio.mid ?? 1, treb: audio.treb ?? 1,
      bass_att: audio.bass_att ?? 1, mid_att: audio.mid_att ?? 1, treb_att: audio.treb_att ?? 1,
      vol: audio.vol ?? 1, vol_att: audio.vol_att ?? 1,
    });
    // run per-frame equations (the source-derived expression VM)
    this.perFrame(this.pool);
    return this.renderState();
  }

  // --- studio live-edit surface ---
  setVar(/** @type {string} */ name, /** @type {number} */ value) { this.scene.vars[name] = value; this.pool[name] = value; }
  recompile(/** @type {string[]} */ perFrameSource) {
    this.scene.expressions.perFrame = perFrameSource;
    this.perFrame = compileEEL(perFrameSource);
  }
  reset() {
    this.pool = { ...this.scene.vars };
    this.frame = 0; this.timekeeper.reset();
  }

  // Render state assembled by WALKING THE GRAPH ORDER: each node contributes
  // the state its op defines, from its own port values in the pool. Removing
  // or rewiring a node in the .phos changes (or refuses) this output — the
  // graph is behavior, not display.
  renderState() {
    const p = this.pool;
    const t = this.timekeeper.time;
    const state = /** @type {any} */ ({ passes: this.order.map((n) => n.stage) });
    for (const n of this.order) {
      if (n.stage === 'warp-feedback') {
        // per-frame warp oscillators — milkdropfs.cpp:1782-1787
        const warpTime = t * (p.fWarpAnimSpeed ?? 0);
        state.motion = {
          decay: p.fDecay ?? 0,
          zoom: p.zoom ?? 0, zoomExp: p.fZoomExponent ?? 0, rot: p.rot ?? 0, warp: p.warp ?? 0,
          cx: p.cx ?? 0, cy: p.cy ?? 0, dx: p.dx ?? 0, dy: p.dy ?? 0, sx: p.sx ?? 0, sy: p.sy ?? 0,
          warpTime,
          warpScaleInv: 1 / (p.fWarpScale ?? 1),
          f0: 11.68 + 4.0 * Math.cos(warpTime * 1.413 + 10),
          f1: 8.77 + 3.0 * Math.cos(warpTime * 1.113 + 7),
          f2: 10.54 + 3.0 * Math.cos(warpTime * 1.233 + 3),
          f3: 11.49 + 4.0 * Math.cos(warpTime * 0.933 + 5),
        };
      } else if (n.stage === 'borders') {
        state.innerBox = { size: p.ib_size ?? 0, r: p.ib_r ?? 0, g: p.ib_g ?? 0, b: p.ib_b ?? 0, a: p.ib_a ?? 0 };
        state.outerBox = { size: p.ob_size ?? 0, r: p.ob_r ?? 0, g: p.ob_g ?? 0, b: p.ob_b ?? 0, a: p.ob_a ?? 0 };
      } else if (n.stage === 'composite') {
        // gammaAdj + video echo — ShowToUser_NoShaders (milkdropfs.cpp:4147-4260)
        state.comp = {
          gamma: p.fGammaAdj ?? 0, echoAlpha: p.fVideoEchoAlpha ?? 0,
          echoZoom: p.fVideoEchoZoom ?? 0, echoOrient: (p.nVideoEchoOrientation ?? 0) % 4,
        };
      }
    }
    return state;
  }
}
