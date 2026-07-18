// Plane9 .p9c importer — container extraction, a line-scanner in the same
// record discipline as milk-import.mjs, and a record-consuming converter
// (p9ToPhos) that shares ONE per-node-type disposition registry with the
// triage view, exactly as milkToPhos shares VALUE_HANDLERS with
// assessRecords. Convertible today: the witnessed geometry-free clear shape
// (Clear.Render -> Screen.Render with a saved constant Color), which lands
// on the shared executor's native clear-color op (NATIVE_OPS,
// src/engine.mjs). Every other node type refuses with the exact missing
// fact and the observation that would resolve it, per
// sources/PLANE9-CONTRACT.md. No Plane9 evaluator, no source-selected
// runtime — PHOSPHENE-GOAL.md's "one native execution model".
import { unzipSync } from '../vendor/fflate/fflate.mjs';

/** @param {Uint8Array} bytes @returns {string} the archive's scene.xml text */
export function extractSceneXml(bytes) {
  const files = unzipSync(bytes);
  const entry = files['scene.xml'];
  if (!entry) throw new Error('.p9c refused: archive has no scene.xml (members: ' + Object.keys(files).join(', ') + ')');
  return new TextDecoder().decode(entry);
}

/**
 * Tolerant line scanner. Every non-blank line becomes exactly one record;
 * lines outside the witnessed grammar become refused records with reasons.
 * @param {string} xml
 * @returns {{kind:string, line:number, raw:string, type?:string, name?:string, id?:string, value?:string, out?:string, in?:string, reason?:string}[]}
 */
export function scanP9(xml) {
  /** @type {{kind:string, line:number, raw:string, type?:string, name?:string, id?:string, value?:string, out?:string, in?:string, reason?:string}[]} */
  const records = [];
  const lines = xml.split('\n');
  let inValue = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = /** @type {string} */ (lines[i]);
    const line = i + 1;
    const t = raw.trim();
    if (inValue) {
      // multiline <Value> payload (shader/expression text) — raw content
      records.push({ kind: 'value-content', line, raw });
      if (t.endsWith('</Value>')) inValue = false;
      continue;
    }
    if (t === '') { records.push({ kind: 'blank', line, raw }); continue; }
    let m;
    if (t === '<?xml version="1.0" encoding="UTF-8"?>') records.push({ kind: 'decl', line, raw });
    else if ((m = t.match(/^<Plane9Scene (.+)>$/))) records.push({ kind: 'root', line, raw, value: m[1] });
    else if (t === '</Plane9Scene>') records.push({ kind: 'root-close', line, raw });
    else if ((m = t.match(/^<(Author|Desc|Tags|License)(\s[^>]*)?>.*<\/\1>$/))) records.push({ kind: 'meta', line, raw, id: m[1] });
    else if ((m = t.match(/^<(Nodes|Connections|SceneCompatibility|GoodScenes|BadScenes)>$/))) records.push({ kind: 'open', line, raw, id: m[1] });
    else if ((m = t.match(/^<\/(Nodes|Connections|SceneCompatibility|GoodScenes|BadScenes|Node|Port)>$/))) records.push({ kind: 'close', line, raw, id: m[1] });
    else if ((m = t.match(/^<(GoodScenes|BadScenes)\/>$/))) records.push({ kind: 'meta', line, raw, id: m[1] });
    else if ((m = t.match(/^<Scene Name="([^"]*)"\/>$/))) records.push({ kind: 'compat-scene', line, raw, name: m[1] });
    else if ((m = t.match(/^<Node Type="([^"]+)" Name="([^"]+)"\/>$/))) records.push({ kind: 'node', line, raw, type: m[1], name: m[2] });
    else if ((m = t.match(/^<Node Type="([^"]+)" Name="([^"]+)">$/))) records.push({ kind: 'node-open', line, raw, type: m[1], name: m[2] });
    else if ((m = t.match(/^<Port Id="([^"]+)" Value="([^"]*)"\/>$/))) records.push({ kind: 'port', line, raw, id: m[1], value: m[2] });
    else if ((m = t.match(/^<Port Id="([^"]+)">$/))) records.push({ kind: 'port-open', line, raw, id: m[1] });
    else if ((m = t.match(/^<Value>(.*)<\/Value>$/))) records.push({ kind: 'value', line, raw, value: m[1] });
    else if ((m = t.match(/^<Value>(.*)$/))) { records.push({ kind: 'value-open', line, raw, value: m[1] }); inValue = true; }
    else if ((m = t.match(/^<Connection Out="([^".]+\.[^"]+)" In="([^".]+\.[^"]+)"\/>$/))) records.push({ kind: 'connection', line, raw, out: m[1], in: m[2] });
    else records.push({ kind: 'refused', line, raw, reason: 'line outside the witnessed scene.xml grammar' });
  }
  return records;
}

// --- the shared per-node-type disposition registry -------------------------
// Refusal texts name the exact missing fact and the observation that would
// resolve it; evidence offsets refer to Plane9Engine.dll sha256 4cebc1b3…
// as recorded with reproduction procedure in sources/PLANE9-CONTRACT.md.
const P9_REFUSALS = /** @type {Record<string,string>} */ ({
  MinMax: 'MinMax — mode-integer mapping unresolved: the engine names exactly four modes (Rand, RandShortestDist, LoopUp, LoopDown; dll 0x1fab8c) but corpus Mode values span {1..4} while DelayMode spans {0,1}, so no single indexing is derivable; interpolation curve and RNG also unresolved. Observation: save a Studio probe scene at each Mode dropdown position and diff the saved integers.',
  Beat: 'Beat — detection algorithm unresolved: the interface is witnessed (BeatStrength 0..1, NoMusic fallback, Amplification, Min/Max; dll 0x1fb038) but the detector is compiled code. Observation: controlled audio with known onsets against the live BeatStrength value.',
  HSLAToColor: 'HSLAToColor — formula is a one-vector candidate: the standard HSL formula reproduces the single retained input/output vector to 1e-6 and Hue is in degrees (dll 0x1fa228), but one vector cannot establish a formula. Observation: save a second vector in a different Hue segment and compare.',
});

// The witnessed geometry-free Screen configuration — the exact port values
// carried by 79 of 252 corpus scenes including the retained Color Cycle
// fixture. Screen's function as the render sink is witnessed corpus-wide;
// what its camera ports do to a geometry-free clear is NOT resolved, so any
// deviation from these witnessed values refuses rather than assuming
// camera inertness (sources/PLANE9-CONTRACT.md §Screen).
const SCREEN_WITNESSED = /** @type {Record<string,string>} */ ({
  Viewport: '0 0 1 1', CamPos: '0 0 -2', CamRot: '0 0 0', CamLookAt: '0 0 1',
  CamLookAtInWorldSpace: 'false', CamFov: '45', CamNear: '0.1', CamFar: '1000',
  ScaleByAspect: 'false',
});

/**
 * Record-consuming disposition pass — the single code path behind both the
 * triage view and conversion. Every record receives exactly one disposition;
 * conversion succeeds only when every disposition is ok.
 * @param {ReturnType<typeof scanP9>} records
 * @returns {{dispositions:{line:number, ok:boolean, text:string}[],
 *            nodes:Record<string,{type:string, ports:Record<string,string>}>,
 *            connections:{out:string, in:string}[]}}
 */
function disposeP9(records) {
  /** @type {{line:number, ok:boolean, text:string}[]} */
  const out = [];
  /** @type {Record<string,{type:string, ports:Record<string,string>}>} */
  const nodes = {};
  /** @type {{out:string, in:string}[]} */
  const connections = [];
  let cur = '';
  for (const rec of records) {
    if (rec.kind === 'blank') continue;
    if (rec.kind === 'refused') { out.push({ line: rec.line, ok: false, text: rec.reason || 'refused' }); continue; }
    if (rec.kind === 'node' || rec.kind === 'node-open') {
      cur = rec.name || '';
      nodes[cur] = { type: rec.type || '', ports: {} };
      if (rec.type === 'Screen') out.push({ line: rec.line, ok: true, text: 'Screen — render sink (witnessed geometry-free configuration)' });
      else if (rec.type === 'Clear') out.push({ line: rec.line, ok: true, text: 'Clear — converts to native clear-color ("Fills the viewport with a single color.", dll 0x1f7ecc)' });
      else if (rec.type !== undefined && P9_REFUSALS[rec.type]) out.push({ line: rec.line, ok: false, text: /** @type {string} */ (P9_REFUSALS[rec.type]) });
      else out.push({ line: rec.line, ok: false, text: 'node type "' + rec.type + '" — no native operation implemented yet' });
      continue;
    }
    if (rec.kind === 'close' && rec.id === 'Node') { cur = ''; out.push({ line: rec.line, ok: true, text: 'scene structure / metadata' }); continue; }
    if (rec.kind === 'port') {
      const owner = nodes[cur];
      if (owner && rec.id !== undefined && rec.value !== undefined) owner.ports[rec.id] = rec.value;
      if (owner && owner.type === 'Screen' && rec.id !== undefined) {
        const expect = SCREEN_WITNESSED[rec.id];
        if (expect === undefined) out.push({ line: rec.line, ok: false, text: 'Screen port "' + rec.id + '" is outside the witnessed geometry-free configuration — refusing' });
        else if (rec.value !== expect) out.push({ line: rec.line, ok: false, text: 'Screen.' + rec.id + '="' + rec.value + '" deviates from the witnessed geometry-free value "' + expect + '" — camera-port relevance for geometry-free scenes is unresolved. Observation: A/B render a clear-only scene with this port varied.' });
        else out.push({ line: rec.line, ok: true, text: 'Screen.' + rec.id + ' — witnessed geometry-free value' });
        continue;
      }
      if (owner && owner.type === 'Clear' && rec.id === 'Color') {
        const parts = String(rec.value).trim().split(/\s+/).map(Number);
        if (parts.length === 4 && parts.every((v) => Number.isFinite(v))) out.push({ line: rec.line, ok: true, text: 'Clear.Color — native clear-color RGBA' });
        else out.push({ line: rec.line, ok: false, text: 'Clear.Color="' + rec.value + '" is not four finite floats — refusing' });
        continue;
      }
      out.push({ line: rec.line, ok: true, text: 'port ' + rec.id + ' of ' + cur + ' (scanned)' });
      continue;
    }
    if (rec.kind === 'port-open') { out.push({ line: rec.line, ok: true, text: 'port ' + rec.id + ' of ' + cur + ' (scanned)' }); continue; }
    if (rec.kind === 'value' || rec.kind === 'value-open' || rec.kind === 'value-content') { out.push({ line: rec.line, ok: true, text: 'embedded value text (scanned)' }); continue; }
    if (rec.kind === 'connection') {
      const conn = { out: rec.out || '', in: rec.in || '' };
      connections.push(conn);
      const outNode = nodes[conn.out.split('.')[0] || ''];
      const inNode = nodes[conn.in.split('.')[0] || ''];
      const convertible = (/** @type {{type:string}|undefined} */ n) => n !== undefined && (n.type === 'Screen' || n.type === 'Clear');
      if (convertible(outNode) && convertible(inNode)) out.push({ line: rec.line, ok: true, text: 'connection ' + conn.out + ' → ' + conn.in + ' — render topology, realized as the canvas clear pass' });
      else out.push({ line: rec.line, ok: false, text: 'connection ' + conn.out + ' → ' + conn.in + ' — an endpoint node is not convertible, so this wiring cannot be realized' });
      continue;
    }
    out.push({ line: rec.line, ok: true, text: 'scene structure / metadata' });
  }
  return { dispositions: out, nodes, connections };
}

/**
 * Per-line dispositions for the triage view — same shape the .milk triage
 * consumes: {line, ok, text}. Consults the SAME registry conversion uses.
 * @param {ReturnType<typeof scanP9>} records
 * @returns {{line:number, ok:boolean, text:string}[]}
 */
export function assessP9Records(records) {
  return disposeP9(records).dispositions;
}

/**
 * Strict conversion door: scene.xml -> native .phos Scene. Refuses at the
 * first record whose disposition is not ok (naming the source line), then
 * validates that what remains is exactly the witnessed clear shape: one
 * Screen, one Clear with a constant Color, one Clear.Render -> Screen.Render
 * connection. The result is an ordinary .phos the shared executor runs —
 * a single native clear-color node.
 * @param {string} xml
 * @param {{file:string, sha256:string}} source
 */
export function p9ToPhos(xml, source) {
  const { dispositions, nodes, connections } = disposeP9(scanP9(xml));
  const bad = dispositions.find((d) => !d.ok);
  if (bad) throw new Error('p9ToPhos: line ' + bad.line + ' refused: ' + bad.text);
  const entries = Object.entries(nodes);
  const screens = entries.filter(([, n]) => n.type === 'Screen');
  const clears = entries.filter(([, n]) => n.type === 'Clear');
  if (screens.length !== 1 || clears.length !== 1 || entries.length !== 2) {
    throw new Error(`p9ToPhos: convertible shape is exactly one Screen + one Clear, got ${entries.length} node(s) — refusing`);
  }
  const screenName = /** @type {[string, {type:string}]} */ (screens[0])[0];
  const clearEntry = /** @type {[string, {type:string, ports:Record<string,string>}]} */ (clears[0]);
  const clearName = clearEntry[0];
  if (connections.length !== 1 || !connections[0] || connections[0].out !== clearName + '.Render' || connections[0].in !== screenName + '.Render') {
    throw new Error('p9ToPhos: the witnessed clear shape carries exactly the connection ' + clearName + '.Render → ' + screenName + '.Render — refusing other wiring');
  }
  const colorStr = clearEntry[1].ports['Color'];
  if (colorStr === undefined) throw new Error('p9ToPhos: Clear node "' + clearName + '" has no saved Color port — refusing');
  const rgba = colorStr.trim().split(/\s+/).map(Number);
  const [r, g, b, a] = rgba;
  if (rgba.length !== 4 || r === undefined || g === undefined || b === undefined || a === undefined) {
    throw new Error('p9ToPhos: Clear.Color="' + colorStr + '" is not four floats — refusing');
  }
  const name = 'p9-' + source.file.replace(/\.[^.]+$/, '');
  return {
    format: 'phos/1',
    meta: { name, sourceEngine: 'plane9', source: { engine: 'plane9', file: source.file, sha256: source.sha256 } },
    resources: /** @type {unknown[]} */ ([]),
    nodes: [{
      id: 'clear', primitive: 'graph', op: 'clear-color',
      ports: {
        clear_r: { type: 'float', value: r }, clear_g: { type: 'float', value: g },
        clear_b: { type: 'float', value: b }, clear_a: { type: 'float', value: a },
      },
    }],
    edges: /** @type {{out:string,in:string}[]} */ ([]),
    expressions: /** @type {{id:string, stage:string, code:string[]}[]} */ ([]),
  };
}
