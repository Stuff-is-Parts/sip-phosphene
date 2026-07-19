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

// --- Plane9 source-compatibility gate --------------------------------------
// PHOSPHENE separates two concerns per the reviewer's foundation call
// (2026-07-18):
//   (a) the NATIVE_OPS registry answers "can PHOSPHENE execute this
//       operation?" — MinMax, Beat, HSLAToColor are all registered native
//       ops with producer-inferred implementations, freely usable by native
//       scenes;
//   (b) this compatibility gate answers "is this exact Plane9 source shape
//       evidence-backed for automatic conversion?" — a native op EXISTING
//       does not by itself authorize the Plane9 mapping, and unresolved
//       Plane9 semantics REFUSE conversion rather than passing through the
//       provisional PHOSPHENE implementation.
// Compatibility statuses:
//   'PASS'       — evidence backs the mapping for this source shape.
//   'UNRESOLVED' — no evidence has established the mapping; REFUSE
//                  conversion, cite the DLL RVA or observation that would
//                  settle it. PHOSPHENE's native op may still exist for
//                  native scenes to use.
const P9_COMPATIBILITY = /** @type {Record<string,{status:'PASS'|'UNRESOLVED', nativeOp:string, reason:string}>} */ ({
  Screen: {
    status: 'PASS', nativeOp: 'screen',
    reason: 'Plane9 Screen node function as the render sink is witnessed corpus-wide (79/252 scenes in the exact geometry-free port configuration); PHOSPHENE converts Screen only in that witnessed configuration and refuses camera-port deviations',
  },
  Clear: {
    status: 'PASS', nativeOp: 'clear-color',
    reason: 'Plane9 Clear function grounded by DLL 0x1f7ecc description + CRenderOGL::Clear export at 0x2295b3 + 387/387 corpus single-Color-port uniformity + history.txt:291',
  },
  RGBAToColor: {
    status: 'PASS', nativeOp: 'RGBAToColor',
    reason: 'Plane9 RGBAToColor function grounded by DLL 0x1fa3fc description; "Combines a red, green, blue and alpha component to a color" is the operation PHOSPHENE performs',
  },
  Blur: {
    // Plane9 Blur node — DLL string block at Plane9Engine.dll offset
    // 0x1f8514 (Plane9Engine.dll sha256
    // 4cebc1b36f003a550b4fc6ae1979d579f4f7f27b03599c7aef88fd5526ba1196,
    // v2.5.1 install) reads "Blur" name, "Blurs a texture" description,
    // then port "Dir" (help "Blur direction") with one enum label "Both"
    // at 0x1f853c, port "Width" (help "Size of the blur") with enum
    // labels "4 pixels" (0x1f8558) and "6 pixels" (0x1f8564) among ten
    // width variants, and port "Brightness" (help "How much to amplify
    // the image") at 0x1f85fc. All 18 Blur nodes in the 252-scene corpus
    // use Dir="2" (the "Both" enum position) with Width in {4, 6, 16}
    // and Brightness a float; PHOSPHENE converts the Width={4,6} shape
    // (matching blur.glsl radius-4 and radius-6 kernels) and refuses
    // Width=16 since blur.glsl only defines shaders for radii 4 and 6.
    // Expansion: one Plane9 Blur node maps to two `plane9-blur` graph
    // nodes (H then V) plus two transient texture resources for the
    // H intermediate and the final V output — the p9ToPhos function
    // special-cases Blur to perform this expansion rather than the
    // 1:1 mapping other node types use.
    status: 'PASS', nativeOp: 'plane9-blur',
    reason: 'Plane9 Blur function grounded by DLL 0x1f8514 metadata block ("Blur" name + "Blurs a texture" description + Dir/Width/Brightness ports); the two-pass separable Gaussian is transcribed byte-for-byte from nodedata/blur.glsl (v2.5.1 install) at src/render-wgsl.mjs plane9BlurWGSL; Width={4,6} maps to blur.glsl radius-4/radius-6 kernels, Dir=2 (Both) is the corpus-uniform witnessed direction (18/18 nodes)',
  },
  HSLAToColor: {
    status: 'UNRESOLVED', nativeOp: 'HSLAToColor',
    reason: 'the standard CSS/Wikipedia HSL-to-RGB formula reproduces Color Cycle\'s one retained input/output vector to 1e-6, but ONE vector does not establish a formula for the general Plane9 HSLAToColor node; observation: save a second input vector in a different Hue segment and compare against Plane9\'s output',
  },
  MinMax: {
    status: 'UNRESOLVED', nativeOp: 'MinMax',
    reason: 'PHOSPHENE\'s MinMax carries six producer-inferred lifecycle choices without DLL evidence (initial value, initial phase, mode-change resets, LoopUp/LoopDown endpoint resets, zero-delay overflow accounting, one-transition-per-call) plus a Marsaglia-example-seed RNG whose match against Plane9Engine.dll 0x1001FE30 is not established; observation: byte-level disassembly diff of 0x100DD600 and 0x1001FE30 against PHOSPHENE\'s implementation',
  },
  Beat: {
    status: 'UNRESOLVED', nativeOp: 'Beat',
    reason: 'Plane9\'s Beat detector at Plane9Engine.dll (compiled code, no exported entry) that produces the rawBeat signal remains unresolved; PHOSPHENE\'s Beat has grounded node-level composition per 0x100DF5A0 but supplies musicActive=false in product so any converted Beat node returns NoMusic — that is not evidence-backed Plane9 Beat behavior; observation: probe scene wiring BeatStrength to a visible port under controlled audio with known onsets',
  },
});

// Backward-compat alias — same information as P9_COMPATIBILITY but flat
// name -> native-op-name, so the port-map/defaults lookups below keep
// working without conditional guards.
const P9_TYPE_TO_OP = /** @type {Record<string,string>} */ (
  Object.fromEntries(Object.entries(P9_COMPATIBILITY).map(([type, c]) => [type, c.nativeOp])));

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
  // Blur is handled through the special expansion path in p9ToPhos
  // rather than a 1:1 port map; the map itself carries the three
  // scalar Plane9 port names Dir/Width/Brightness so the "port name
  // not in map" check in disposeP9 still surfaces unmapped fields.
  Blur: { Dir: 'Dir', Width: 'Width', Brightness: 'Brightness', Texture: 'Texture' },
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
      const compat = P9_COMPATIBILITY[t];
      if (!compat) {
        out.push({ line: rec.line, ok: false, text: 'node type "' + t + '" — no Plane9 compatibility entry (no evidence-backed native mapping is registered for this Plane9 node type)' });
      } else if (compat.status === 'UNRESOLVED') {
        out.push({ line: rec.line, ok: false, text: t + ' — Plane9 conversion REFUSED (UNRESOLVED): ' + compat.reason });
      } else {
        out.push({ line: rec.line, ok: true, text: t + ' — Plane9 conversion PASS: ' + compat.reason });
      }
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
      // Convertibility for the triage disposition is the compatibility gate
      // status, not merely the presence of a native-op mapping — a UNRESOLVED
      // endpoint refuses conversion, so its incident edges are not realizable
      // (reviewer 2026-07-18 minor).
      const convertible = (/** @type {{type:string}|undefined} */ n) =>
        n !== undefined && P9_COMPATIBILITY[n.type]?.status === 'PASS';
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
  /** @type {Map<string, {hName:string, vName:string, hOutId:string, vOutId:string}>} */
  const blurExpansions = new Map();
  /** @type {import('./phos.mjs').ResourceDescriptor[]} */
  const blurResources = [];
  for (const [nodeName, src] of Object.entries(nodes)) {
    if (src.type === 'Blur') {
      // Plane9 Blur expansion — strict field-by-field. One source Blur
      // node materializes as two `plane9-blur` graph nodes (H then V)
      // plus two intermediate texture resources. Refuse any port outside
      // the DLL-witnessed set {Dir, Width, Brightness}; refuse Dir other
      // than "2" (the "Both" enum position corpus-witnessed 18/18);
      // refuse Width outside {4, 6} (blur.glsl only defines radius-4
      // and radius-6 shaders). Materialize Brightness default 1.0 per
      // blur.glsl:3 uniform initializer.
      for (const pname of Object.keys(src.ports)) {
        if (pname !== 'Dir' && pname !== 'Width' && pname !== 'Brightness') {
          throw new Error(`p9ToPhos: Blur node "${nodeName}" carries port "${pname}" that is not among the DLL-witnessed Blur ports (Dir, Width, Brightness) — refusing`);
        }
      }
      const dirRaw = src.ports.Dir;
      const widthRaw = src.ports.Width;
      const brightnessRaw = src.ports.Brightness;
      if (dirRaw !== '2') throw new Error(`p9ToPhos: Blur node "${nodeName}" port "Dir"="${dirRaw}" — only Dir="2" (the "Both" enum position at DLL 0x1f853c, corpus-witnessed 18/18 Blur nodes) is supported; other Dir values are UNRESOLVED — refusing`);
      const width = Number(widthRaw);
      if (width !== 4 && width !== 6) throw new Error(`p9ToPhos: Blur node "${nodeName}" port "Width"="${widthRaw}" — blur.glsl only defines shaders for Width=4 (radius-4 kernel, PASS 0/1) and Width=6 (radius-6 kernel, PASS 2/3); other widths are UNRESOLVED — refusing`);
      const brightness = brightnessRaw !== undefined ? Number(brightnessRaw) : 1;
      if (!Number.isFinite(brightness)) throw new Error(`p9ToPhos: Blur node "${nodeName}" port "Brightness"="${brightnessRaw}" is not a finite float — refusing`);
      const hPass = width === 4 ? 0 : 2;
      const vPass = width === 4 ? 1 : 3;
      const hName = nodeName + '-h';
      const vName = nodeName + '-v';
      const hOutId = nodeName + '-h-out';
      const vOutId = nodeName + '-out';
      /** @param {string} id @param {number} passNumber @param {string} targetId */
      const mkBlurNode = (id, passNumber, targetId) => (/** @type {import('./phos.mjs').PhosNode} */ ({
        id, primitive: 'graph', op: 'plane9-blur',
        ports: /** @type {any} */ ({
          Src: { type: 'render' },
          Target: { type: 'texture', value: { resourceId: targetId } },
          Pass: { type: 'float', value: passNumber },
          Brightness: { type: 'float', value: brightness },
          Render: { type: 'render' },
        }),
      }));
      outNodes.push(mkBlurNode(hName, hPass, hOutId));
      outNodes.push(mkBlurNode(vName, vPass, vOutId));
      blurResources.push({
        id: hOutId, kind: 'texture', format: 'rgba8unorm',
        size: { policy: 'canvas' }, lifetime: 'transient',
        usage: ['sampled', 'render-attachment'],
      });
      blurResources.push({
        id: vOutId, kind: 'texture', format: 'rgba8unorm',
        size: { policy: 'canvas' }, lifetime: 'transient',
        usage: ['sampled', 'render-attachment'],
      });
      blurExpansions.set(nodeName, { hName, vName, hOutId, vOutId });
      continue;
    }
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
    // The Clear->clear-color mapping synthesizes a Target texture port
    // referencing a per-node output resource; the scene's resources[]
    // declares the matching descriptor below.
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
      } else if (ptype === 'texture' && nativeOp === 'clear-color' && pname === 'Target') {
        // Synthesized Target port for Plane9 Clear conversion: writes to
        // a per-node transient texture resource ("<clearNodeName>-out")
        // declared in the scene's resources[] below.
        ports[pname] = /** @type {any} */ ({ type: 'texture', value: { resourceId: nodeName + '-out' } });
      } else {
        throw new Error(`p9ToPhos: node "${nodeName}" is missing required port "${pname}" (${ptype}) and no default is defined — refusing`);
      }
    }
    // Declare each declared output port so edges can target them.
    for (const [pname, ptype] of Object.entries(outputTypes)) {
      // `presented` is the well-known presentation-sink output the Engine
      // reads implicitly and exempts from the outgoing-edge rule; it
      // should not appear in the serialized scene as an explicit port,
      // since it is never edge-driven and no scene author writes it.
      if (pname === 'presented') continue;
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
    let outRef = c.out;
    let inRef = c.in;
    const [rawSrcId, rawSrcPort] = c.out.split('.');
    const [rawDstId, rawDstPort] = c.in.split('.');
    // Rewrite endpoints touching a Blur node. Plane9's Blur uses a
    // dual-direction "Texture" port name for both its input (incoming
    // texture) and its output (post-blur texture); the expansion above
    // replaced the Blur node with H and V graph nodes, so the incoming
    // edge routes to `{name}-h.Src` and the outgoing edge originates
    // from `{name}-v.Render`.
    if (rawSrcId && blurExpansions.has(rawSrcId)) {
      const exp = /** @type {any} */ (blurExpansions.get(rawSrcId));
      if (rawSrcPort !== 'Texture') throw new Error(`p9ToPhos: Blur node "${rawSrcId}" outgoing edge uses port "${rawSrcPort}" but the DLL-witnessed output port is "Texture" — refusing`);
      outRef = exp.vName + '.Render';
    }
    if (rawDstId && blurExpansions.has(rawDstId)) {
      const exp = /** @type {any} */ (blurExpansions.get(rawDstId));
      if (rawDstPort !== 'Texture') throw new Error(`p9ToPhos: Blur node "${rawDstId}" incoming edge uses port "${rawDstPort}" but the DLL-witnessed input port is "Texture" — refusing`);
      inRef = exp.hName + '.Src';
    }
    const [srcId, srcPort] = outRef.split('.');
    const [dstId, dstPort] = inRef.split('.');
    const srcNode = byId[srcId ?? ''];
    const dstNode = byId[dstId ?? ''];
    if (!srcNode || !dstNode || !srcPort || !dstPort) throw new Error(`p9ToPhos: edge "${outRef} -> ${inRef}" endpoint not in graph — refusing`);
    const srcOp = NATIVE_OPS[srcNode.op];
    const dstOp = NATIVE_OPS[dstNode.op];
    if (srcOp === undefined || dstOp === undefined) throw new Error(`p9ToPhos: edge "${outRef} -> ${inRef}" references an op not in the registry — refusing`);
    const srcType = /** @type {Record<string,string>} */ (srcOp.outputs)[srcPort];
    const dstType = /** @type {Record<string,string>} */ (dstOp.inputs)[dstPort];
    if (srcType === undefined) throw new Error(`p9ToPhos: edge source "${outRef}" is not an output of "${srcNode.op}" — refusing (the source port map may treat this port as an input)`);
    if (dstType === undefined) throw new Error(`p9ToPhos: edge destination "${inRef}" is not an input of "${dstNode.op}" — refusing`);
    if (srcType !== dstType) throw new Error(`p9ToPhos: edge "${outRef}" (${srcType}) -> "${inRef}" (${dstType}) has mismatched port types — refusing`);
    outEdges.push({ out: outRef, in: inRef });
  }
  // Internal H -> V wire for every Blur expansion, so the vertical
  // pass samples the horizontal intermediate.
  for (const exp of blurExpansions.values()) {
    outEdges.push({ out: exp.hName + '.Render', in: exp.vName + '.Src' });
  }

  // Synthesize resource descriptors for each converted clear-color node
  // (Plane9's Clear). Each writes to a per-node transient texture, and
  // that texture is the presentation source that the executor blits to
  // the canvas at present time. Blur expansions contribute their own
  // pair of intermediate/output resources from blurResources above.
  /** @type {import('./phos.mjs').ResourceDescriptor[]} */
  const resources = [];
  for (const n of outNodes) {
    if (n.op === 'clear-color') {
      resources.push({
        id: n.id + '-out',
        kind: 'texture',
        format: 'rgba8unorm',
        size: { policy: 'canvas' },
        lifetime: 'transient',
        usage: ['sampled', 'render-attachment'],
      });
    }
  }
  for (const r of blurResources) resources.push(r);
  const name = 'p9-' + source.file.replace(/\.[^.]+$/, '');
  return /** @type {import('./phos.mjs').Scene} */ ({
    format: 'phos/1',
    meta: { name, sourceEngine: 'plane9', source: { engine: 'plane9', file: source.file, sha256: source.sha256 } },
    resources,
    nodes: outNodes,
    edges: outEdges,
    expressions: /** @type {import('./phos.mjs').ExprProgram[]} */ ([]),
  });
}
