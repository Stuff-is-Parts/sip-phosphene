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
import { NATIVE_OPS } from './engine.mjs';

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
// The 2026-07-18 owner spec resolved MinMax's mode mapping and semantics
// and Beat's node-level composition from DLL static analysis, so those
// node types now CONVERT rather than refuse. HSLAToColor remains a
// one-vector candidate, but the executor implements the standard formula
// binding for the accepted Color Cycle slice — the boundary is recorded.
const P9_REFUSALS = /** @type {Record<string,string>} */ ({});

// Which Plane9 node types map to which native ops. Presence in this table
// is the sole convertibility signal — a node type absent from it refuses
// with a "no native operation" message unless P9_REFUSALS carries a more
// specific explanation.
const P9_TYPE_TO_OP = /** @type {Record<string,string>} */ ({
  Screen: 'screen',
  Clear: 'clear-color',
  HSLAToColor: 'HSLAToColor',
  RGBAToColor: 'RGBAToColor',
  MinMax: 'MinMax',
  Beat: 'Beat',
});

// Port-name translation Plane9 -> native, per node type. Plane9 uses the
// verbatim port ids from the .scene.xml; the native ops declare their own
// port names (which for these types are identical to Plane9's).
const P9_PORT_MAP = /** @type {Record<string, Record<string,string>>} */ ({
  Screen: {
    Viewport: 'Viewport', CamPos: 'CamPos', CamRot: 'CamRot', CamLookAt: 'CamLookAt',
    CamLookAtInWorldSpace: 'CamLookAtInWorldSpace', CamFov: 'CamFov',
    CamNear: 'CamNear', CamFar: 'CamFar', ScaleByAspect: 'ScaleByAspect',
    Render: 'Render',
  },
  Clear: { Color: 'Color', Render: 'Render' },
  HSLAToColor: { Hue: 'Hue', Saturation: 'Saturation', Lightness: 'Lightness', Alpha: 'Alpha', Color: 'Color' },
  RGBAToColor: { Red: 'Red', Green: 'Green', Blue: 'Blue', Alpha: 'Alpha', Color: 'Color' },
  MinMax: {
    Min: 'Min', Max: 'Max', Mode: 'Mode',
    DelayMin: 'DelayMin', DelayMax: 'DelayMax', DelayMode: 'DelayMode',
    ITimeMin: 'ITimeMin', ITimeMax: 'ITimeMax', ITimeMode: 'ITimeMode',
    Value: 'Value',
  },
  Beat: {
    NoMusic: 'NoMusic', Amplification: 'Amplification',
    Min: 'Min', Max: 'Max', BeatStrength: 'BeatStrength',
  },
});

// Port defaults per Plane9 node type — used when a port name is declared by
// the native op but the source scene.xml omits the port. Plane9 supplies
// these implicitly; we materialize them so the .phos carries exact values.
const P9_PORT_DEFAULTS = /** @type {Record<string, Record<string,number|number[]>>} */ ({
  HSLAToColor: { Alpha: 1 },
  RGBAToColor: { Alpha: 1 },
});

// Parse a Plane9 port value string ("0.5", "0.03857 0.11049 0.216148 1",
// "true", "false") into the JS shape the native port type accepts.
function parseP9Value(/** @type {string} */ s, /** @type {string} */ nativeType) {
  const t = s.trim();
  if (nativeType === 'float') {
    if (t === 'true') return 1;
    if (t === 'false') return 0;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  if (nativeType === 'vec2' || nativeType === 'vec3' || nativeType === 'vec4') {
    const dim = nativeType === 'vec2' ? 2 : nativeType === 'vec3' ? 3 : 4;
    const parts = t.split(/\s+/).map(Number);
    if (parts.length !== dim || !parts.every((x) => Number.isFinite(x))) return null;
    return parts;
  }
  return null;
}

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
      const t = rec.type || '';
      if (t === 'Screen') out.push({ line: rec.line, ok: true, text: 'Screen — render sink (witnessed geometry-free configuration)' });
      else if (t === 'Clear') out.push({ line: rec.line, ok: true, text: 'Clear — converts to native clear-color ("Fills the viewport with a single color.", dll 0x1f7ecc)' });
      else if (t === 'HSLAToColor') out.push({ line: rec.line, ok: true, text: 'HSLAToColor — converts to native HSLAToColor value op (formula bound to Color Cycle input/output vector at 1e-6, general Plane9 semantics unresolved beyond that)' });
      else if (t === 'RGBAToColor') out.push({ line: rec.line, ok: true, text: 'RGBAToColor — converts to native RGBAToColor value op (packs 4 float channels into vec4 Color, dll 0x1fa3fc)' });
      else if (t === 'MinMax') out.push({ line: rec.line, ok: true, text: 'MinMax — converts to native MinMax value op (mode integer mapping + curves + shared RNG per DLL static analysis at 0x100DD600/0x100DD9A0/0x100DDAE0/0x101FBB50; upstream mode-specific edge cases per contract)' });
      else if (t === 'Beat') out.push({ line: rec.line, ok: true, text: 'Beat — converts to native Beat value op (node-level composition per dll 0x100DF5A0; inactive path direct, active path linear + upper cap; upstream detector for rawBeat unresolved)' });
      else if (t !== '' && P9_REFUSALS[t]) out.push({ line: rec.line, ok: false, text: /** @type {string} */ (P9_REFUSALS[t]) });
      else out.push({ line: rec.line, ok: false, text: 'node type "' + t + '" — no native operation implemented yet' });
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
      const convertible = (/** @type {{type:string}|undefined} */ n) => n !== undefined && P9_TYPE_TO_OP[n.type] !== undefined;
      if (convertible(outNode) && convertible(inNode)) {
        const isRender = conn.out.endsWith('.Render') || conn.in.endsWith('.Render');
        out.push({ line: rec.line, ok: true, text: 'connection ' + conn.out + ' → ' + conn.in + (isRender ? ' — render topology' : ' — value edge propagates node output to input') });
      } else out.push({ line: rec.line, ok: false, text: 'connection ' + conn.out + ' → ' + conn.in + ' — an endpoint node is not convertible, so this wiring cannot be realized' });
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
 * first record whose disposition is not ok (naming the source line). The
 * result carries every source node as an ordinary native node with the
 * source's own port values, and every source connection as a typed .phos
 * edge — Plane9 structure (Screen, Clear, HSLAToColor, MinMax*, Beat)
 * remains visible, editable and reloadable. The shared executor runs the
 * result end to end through the ordinary `.phos → Engine → WebGPU` path.
 * @param {string} xml
 * @param {{file:string, sha256:string}} source
 */
export function p9ToPhos(xml, source) {
  const { dispositions, nodes, connections } = disposeP9(scanP9(xml));
  const bad = dispositions.find((d) => !d.ok);
  if (bad) throw new Error('p9ToPhos: line ' + bad.line + ' refused: ' + bad.text);
  // must have exactly one Screen (render sink)
  const screens = Object.entries(nodes).filter(([, n]) => n.type === 'Screen');
  if (screens.length !== 1) throw new Error(`p9ToPhos: expected exactly one Screen node, got ${screens.length} — refusing`);

  /** @type {import('./phos.mjs').PhosNode[]} */
  const outNodes = [];
  for (const [nodeName, src] of Object.entries(nodes)) {
    const nativeOp = P9_TYPE_TO_OP[src.type];
    if (!nativeOp) throw new Error(`p9ToPhos: node "${nodeName}" type "${src.type}" has no native op mapping — refusing (disposition check missed this)`);
    const portMap = P9_PORT_MAP[src.type];
    if (!portMap) throw new Error(`p9ToPhos: node "${nodeName}" type "${src.type}" has no port map — refusing`);
    const opDecl = NATIVE_OPS[nativeOp];
    if (!opDecl) throw new Error(`p9ToPhos: native op "${nativeOp}" is not registered — refusing`);
    const inputTypes = /** @type {Record<string,string>} */ (opDecl.inputs);
    const outputTypes = /** @type {Record<string,string>} */ (opDecl.outputs);
    /** @type {Record<string,{type:string, value?:number|number[]}>} */
    const ports = {};

    // Materialize every declared input port. Value ports from source.ports
    // land through the port map; ports absent from the source XML take a
    // materialized default when P9_PORT_DEFAULTS names one, else the
    // structural port is declared without a value (typically render).
    for (const [pname, ptype] of Object.entries(inputTypes)) {
      const srcVal = src.ports[pname];
      if (srcVal !== undefined) {
        const parsed = parseP9Value(srcVal, ptype);
        if (parsed === null) throw new Error(`p9ToPhos: node "${nodeName}" port "${pname}" value "${srcVal}" is not a valid ${ptype} — refusing`);
        ports[pname] = { type: ptype, value: parsed };
      } else if (P9_PORT_DEFAULTS[src.type]?.[pname] !== undefined) {
        const dflt = /** @type {Record<string,number|number[]>} */ (P9_PORT_DEFAULTS[src.type])[pname];
        ports[pname] = { type: ptype, value: /** @type {number|number[]} */ (dflt) };
      } else if (ptype === 'render') {
        ports[pname] = { type: 'render' };
      } else {
        throw new Error(`p9ToPhos: node "${nodeName}" is missing required port "${pname}" (${ptype}) and no default is defined — refusing`);
      }
    }
    // Declare each declared output port so edges can target them.
    for (const [pname, ptype] of Object.entries(outputTypes)) {
      if (!(pname in ports)) ports[pname] = { type: ptype };
    }
    // Also carry any source ports the native op does not declare — refuse
    // rather than silently drop, so an unmapped Plane9 port surfaces cleanly.
    for (const [pname, val] of Object.entries(src.ports)) {
      if (!(pname in inputTypes) && !(pname in outputTypes)) {
        throw new Error(`p9ToPhos: node "${nodeName}" (${src.type}) carries port "${pname}"="${val}" that native op "${nativeOp}" does not declare — refusing`);
      }
    }
    outNodes.push({ id: nodeName, primitive: 'graph', op: nativeOp, ports });
  }

  /** @type {{out:string,in:string}[]} */
  const outEdges = [];
  const byId = /** @type {Record<string, import('./phos.mjs').PhosNode>} */ (Object.fromEntries(outNodes.map((n) => [n.id, n])));
  for (const c of connections) {
    const [srcId, srcPort] = c.out.split('.');
    const [dstId, dstPort] = c.in.split('.');
    const srcNode = byId[srcId ?? ''];
    const dstNode = byId[dstId ?? ''];
    if (!srcNode || !dstNode || !srcPort || !dstPort) throw new Error(`p9ToPhos: edge "${c.out} -> ${c.in}" endpoint not in graph — refusing`);
    const srcOp = NATIVE_OPS[srcNode.op];
    const dstOp = NATIVE_OPS[dstNode.op];
    if (srcOp === undefined || dstOp === undefined) throw new Error(`p9ToPhos: edge "${c.out} -> ${c.in}" references an op not in the registry — refusing`);
    const srcType = /** @type {Record<string,string>} */ (srcOp.outputs)[srcPort];
    const dstType = /** @type {Record<string,string>} */ (dstOp.inputs)[dstPort];
    if (srcType === undefined) throw new Error(`p9ToPhos: edge source "${c.out}" is not an output of "${srcNode.op}" — refusing (the source port map may treat this port as an input)`);
    if (dstType === undefined) throw new Error(`p9ToPhos: edge destination "${c.in}" is not an input of "${dstNode.op}" — refusing`);
    if (srcType !== dstType) throw new Error(`p9ToPhos: edge "${c.out}" (${srcType}) -> "${c.in}" (${dstType}) has mismatched port types — refusing`);
    outEdges.push({ out: c.out, in: c.in });
  }

  const name = 'p9-' + source.file.replace(/\.[^.]+$/, '');
  return /** @type {import('./phos.mjs').Scene} */ ({
    format: 'phos/1',
    meta: { name, sourceEngine: 'plane9', source: { engine: 'plane9', file: source.file, sha256: source.sha256 } },
    resources: /** @type {unknown[]} */ ([]),
    nodes: outNodes,
    edges: outEdges,
    expressions: /** @type {import('./phos.mjs').ExprProgram[]} */ ([]),
  });
}
