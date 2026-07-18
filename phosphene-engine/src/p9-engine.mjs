// Plane9 runtime — five node types for scene 2 (Other/Color Cycle.p9c).
// Each node's math traces to a primary source cited at its call site:
//   Screen                              — dll node table + corpus witness
//   Clear                               — dll node table
//   HSLAToColor                         — HSL formula reproduces Color
//                                         Cycle's saved Clear.Color to 1e-6
//                                         from its saved ports (verified in
//                                         check.mjs and PLANE9-CONTRACT.md)
//   MinMax (Mode 1 Rand, 3 LoopUp)      — dll enum-name adjacency + corpus
//                                         Mode distribution; interpolation
//                                         via Qt QEasingCurve::Linear as
//                                         the default until falsified
//   Beat                                — dll: value 0..1; the scene's
//                                         BeatStrength is overridden live
//                                         by MinMax2 → Beat.NoMusic, so the
//                                         internal detector is inert when
//                                         MinMax2 drives it, and the port
//                                         range surfaces directly as output
//                                         when there is no music
//
// history.txt line 413 (v1.6, 2010-09-07): "Forced MinMax node to only
// update itself once a frame." Every value node ticks once per frame here.

/** @typedef {{type:string, name:string, ports:Record<string,any>}} P9Node */
/** @typedef {{out:string, in:string}} P9Edge */

const MODE_RAND_SHORTEST = 2, MODE_LOOP_UP = 3, MODE_LOOP_DOWN = 4;

/** HSL-to-RGB (CSS/Wikipedia chroma formulation). Verified against Color
 * Cycle's own saved values to 1e-6 — the scene file is the test vector.
 * @param {number} h degrees, wrapped to [0,360)
 * @param {number} s 0..1 @param {number} l 0..1
 * @returns {[number,number,number]} */
export function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

// --- deterministic per-node RNG so a scene renders identically every load.
// Plane9's own rand() (expression reference) uses an internal seed; each
// value node here gets its own stream keyed by the node name.
function mulberry32(/** @type {number} */ seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFromName(/** @type {string} */ name) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// --- MinMax runtime. From history.txt line 413 + the four dll enum names in
// adjacency order + corpus Mode distribution: Mode is 1..4 with 1=Rand as
// the majority default. Interpolation between successive Min..Max targets
// runs over an ITime seconds duration drawn once per segment from
// [ITimeMin, ITimeMax]. Qt's default easing curve type is Linear.
class MinMaxState {
  /** @param {P9Node} node */
  constructor(node) {
    const p = node.ports;
    this.min = +p.Min; this.max = +p.Max;
    this.mode = +p.Mode | 0;
    this.itMin = +p.ITimeMin; this.itMax = +p.ITimeMax;
    this.rng = mulberry32(seedFromName(node.name));
    this.from = this.mode === MODE_LOOP_UP ? this.min : this.mode === MODE_LOOP_DOWN ? this.max : this.pickRandomTarget();
    this.to = this.mode === MODE_LOOP_UP ? this.max : this.mode === MODE_LOOP_DOWN ? this.min : this.pickRandomTarget();
    this.duration = this.pickITime();
    this.progress = 0;
    this.current = this.from;
  }
  /** @returns {number} random point in [min, max] */
  pickRandomTarget() {
    // MODE_RAND (1) or MODE_RAND_SHORTEST (2): a random point in [min,max].
    // RAND picks uniformly; RAND_SHORTEST biases the interpolation toward
    // the shorter arc across a 360 wrap for hue-like ranges (handled in
    // step()). For a linear range they coincide.
    return this.min + this.rng() * (this.max - this.min);
  }
  pickITime() {
    if (this.itMax <= this.itMin) return Math.max(0.0001, this.itMin);
    return this.itMin + this.rng() * (this.itMax - this.itMin);
  }
  /** @param {number} dt seconds */
  step(dt) {
    if (this.duration <= 0) { this.current = this.to; return; }
    this.progress += dt;
    let t = this.progress / this.duration;
    if (t >= 1) {
      this.from = this.to;
      this.to = this.mode === MODE_LOOP_UP ? this.min
             : this.mode === MODE_LOOP_DOWN ? this.max
             : this.pickRandomTarget();
      this.duration = this.pickITime();
      this.progress = 0;
      t = 0;
    }
    // Qt QEasingCurve::Linear (default from the dll's three QEasingCurve
    // imports plus the release notes' silence on non-linear defaults).
    if (this.mode === MODE_RAND_SHORTEST) {
      // shortest-arc interpolation across a 360 wrap
      const range = this.max - this.min;
      let delta = this.to - this.from;
      if (delta > range / 2) delta -= range;
      else if (delta < -range / 2) delta += range;
      this.current = this.from + delta * t;
      // renormalize into [min, max)
      while (this.current < this.min) this.current += range;
      while (this.current >= this.max) this.current -= range;
    } else {
      this.current = this.from + (this.to - this.from) * t;
    }
  }
}

class BeatState {
  /** @param {P9Node} node */
  constructor(node) {
    const p = node.ports;
    this.noMusic = +p.NoMusic;
    this.amp = +p.Amplification;
    this.min = +p.Min; this.max = +p.Max;
    this.value = 0; // 0..1, dll-documented range
  }
  /** @param {number|undefined} incomingNoMusic when an incoming edge
   *  drives Beat.NoMusic, this scalar is used as the source-level value
   *  (Color Cycle wires MinMax2.Value → Beat.NoMusic). */
  step(incomingNoMusic) {
    // With no audio, output = the (possibly-driven) NoMusic value,
    // clamped by [Min, Max]. The dll documents BeatStrength as 0..1.
    const raw = incomingNoMusic !== undefined ? incomingNoMusic : this.noMusic;
    const amped = raw * this.amp;
    this.value = Math.min(this.max, Math.max(this.min, amped));
  }
}

/** Build and step the Plane9 runtime for the scene. */
export class P9Engine {
  /** @param {{nodes: P9Node[], edges: P9Edge[]}} scene */
  constructor(scene) {
    this.nodes = scene.nodes;
    this.edges = scene.edges;
    /** @type {Record<string,any>} */ this.state = {};
    for (const n of this.nodes) {
      if (n.type === 'MinMax') this.state[n.name] = new MinMaxState(n);
      else if (n.type === 'Beat') this.state[n.name] = new BeatState(n);
    }
    // resolve connections into a lookup of {targetNode.targetPort -> sourceValueFn}
    /** @type {Map<string, () => number>} */
    this.wires = new Map();
    for (const e of this.edges) {
      const [srcNode, srcPort] = e.out.split('.');
      const [dstNode, dstPort] = e.in.split('.');
      if (srcNode === undefined || dstNode === undefined) continue;
      const key = dstNode + '.' + dstPort;
      const st = this.state[srcNode];
      if (!st) continue;
      if (srcPort === 'Value') this.wires.set(key, () => st.current);
      else if (srcPort === 'BeatStrength') this.wires.set(key, () => st.value);
      else if (srcPort === 'Color') { /* HSLAToColor.Color handled as vec4 downstream */ }
    }
    this.time = 0;
    this.frame = 0;
  }
  /** @param {number} dt seconds */
  step(dt) {
    this.time += dt; this.frame++;
    // history.txt line 413: value nodes update once per frame. Order:
    // MinMax first (produces scalars that may feed Beat.NoMusic), then Beat.
    for (const n of this.nodes) {
      if (n.type === 'MinMax') /** @type {MinMaxState} */ (this.state[n.name]).step(dt);
    }
    for (const n of this.nodes) {
      if (n.type === 'Beat') {
        const noMusicWire = this.wires.get(n.name + '.NoMusic');
        const st = /** @type {BeatState} */ (this.state[n.name]);
        st.step(noMusicWire ? noMusicWire() : undefined);
      }
    }
  }
  /** Read Color Cycle's Clear.Color RGBA by resolving HSLAToColor from its
   *  ports plus any incoming Hue/Saturation/Lightness/Alpha wires. */
  clearColor() {
    const hslNode = this.nodes.find(n => n.type === 'HSLAToColor');
    if (!hslNode) {
      const clear = this.nodes.find(n => n.type === 'Clear');
      const raw = (clear && clear.ports.Color) ? String(clear.ports.Color).split(' ').map(Number) : [0, 0, 0, 1];
      return /** @type {[number,number,number,number]} */ (raw);
    }
    /** @param {string} name @param {number} fallback @returns {number} */
    const port = (name, fallback) => {
      const w = this.wires.get(hslNode.name + '.' + name);
      if (w) return w();
      const v = hslNode.ports[name];
      return v === undefined ? fallback : +v;
    };
    const h = port('Hue', 0);
    const s = port('Saturation', 0);
    const l = port('Lightness', 0);
    const a = port('Alpha', 1);
    const [r, g, b] = hslToRgb(h, s, l);
    return /** @type {[number,number,number,number]} */ ([r, g, b, a]);
  }
}
