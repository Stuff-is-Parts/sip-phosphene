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
const P9_COMPATIBILITY = /** @type {Record<string,{status:'PASS'|'UNRESOLVED', nativeOp:string|null, reason:string}>} */ ({
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
    // Plane9 Blur node — DLL metadata at Plane9Engine.dll v2.5.1 offset
    // 0x1f8514 ("Blur" + "Blurs a texture" + Dir/Width/Brightness
    // ports); blur.glsl kernels transcribed at src/render-wgsl.mjs
    // plane9BlurWGSL. Compatibility is UNRESOLVED because a real
    // Light Worms Blur1 is fed by RenderToTexture2.Color, and
    // RenderToTexture conversion itself is UNRESOLVED (see below).
    // The native `plane9-blur` op is source-grounded and remains
    // available for PHOS-native scenes; scene-level Plane9 Blur
    // conversion does not.
    status: 'UNRESOLVED', nativeOp: 'plane9-blur',
    reason: 'the native `plane9-blur` op is source-grounded (blur.glsl transcription at src/render-wgsl.mjs, DLL metadata at 0x1f8514), but scene-level Blur conversion in every real corpus scene depends on a Texture-producing upstream that PHOSPHENE has not resolved. Light Worms Blur1 is fed by RenderToTexture2.Color, and RenderToTexture conversion is UNRESOLVED per its own compat entry (missing Effect input semantics, nested Shader/Expression payloads, execution model). Observation that would settle it: resolve the RenderToTexture contract completely, and then the Blur end-to-end path can be re-evaluated against a mechanically extracted Light Worms subgraph.',
  },
  RenderToTexture: {
    // Plane9 RenderToTexture node — Format=5 pixel-format mapping IS
    // grounded (Format=5 → GL_RGBA16F → WebGPU rgba16float per
    // sources/plane9/RENDERTOTEXTURE-FORMAT-EVIDENCE.md), but Format
    // is one field on a node whose full contract is not yet
    // established. Every real Light Worms RenderToTexture node also
    // carries a nested `<Port Id="Shader"><Value>...GLSL...</Value>
    // </Port>` and a nested `<Port Id="Expression"><Value></Value>
    // </Port>` (verified from source-scenes/plane9/Abstract/
    // Light Worms.p9c 2026-07-19), plus an Effect-driven incident
    // edge (Shader4.Effect -> RenderToTexture2.Effect) that the DLL
    // port block at 0x1f8b00-0x1f8cb8 alone does not describe.
    // PHOSPHENE has no executable evidence for how these behaviors
    // combine, whether the node renders the incoming Render stream,
    // an Effect-driven shader, or the nested Shader Value; what
    // load/store/clear behavior the output receives; how the Color
    // texture is actually produced; or how the six-value Format enum
    // interacts with an Effect input. Compatibility remains
    // UNRESOLVED until those facts are established from executable
    // evidence (RTTI class routine walk, runtime capture, or the
    // upstream Shader/Effect subsystem itself).
    status: 'UNRESOLVED', nativeOp: null,
    reason: 'Format=5 pixel format is grounded (see sources/plane9/RENDERTOTEXTURE-FORMAT-EVIDENCE.md), but that is one field of many. The complete RenderToTexture contract is UNRESOLVED: full port inventory including Effect (evidenced by Light Worms Shader4.Effect -> RenderToTexture2.Effect); Render-driven versus Effect-driven behavior distinction; nested <Port Id="Shader"><Value>GLSL</Value></Port> payload semantics (present on every Light Worms RTT node); nested <Port Id="Expression"><Value></Value></Port> payload semantics; exact render-target execution path; how the Color texture output is actually produced; load/store/clear and depth-buffer state behavior. No native op is registered for Plane9 RenderToTexture. The prior interpretation as a texture-blit was retracted because a blit is not evidenced as the correct execution semantics, and no other consumer justified retaining a generic blit primitive. Observation that would settle it: walk the CRenderToTextureNode render path in Plane9Engine.dll from its RTTI-identified constructor at 0x100CDA70 into the render loop, or take a runtime graphics capture of RenderToTexture2 executing in Light Worms.',
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
  Object.fromEntries(Object.entries(P9_COMPATIBILITY)
    .filter(([, c]) => c.nativeOp !== null)
    .map(([type, c]) => [type, /** @type {string} */ (c.nativeOp)])));

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

// Plane9 source-node port TYPE inventory (Render vs Texture vs Effect vs
// vec2/vec4/etc). Used by the port-type check in disposeP9 to refuse
// connections whose source-side port type does not match the destination-
// side port type at the Plane9 layer — a Render output plugged into a
// Texture input, or a Texture output into a Render input, is an invalid
// Plane9 source graph regardless of whether individual node types are
// compatibility-PASS. Only Plane9 nodes whose full port set is
// documented here participate; nodes touching an undocumented type
// already refuse via the "endpoint not convertible" disposition.
const P9_PORT_TYPES = /** @type {Record<string, {inputs:Record<string,string>, outputs:Record<string,string>}>} */ ({
  Screen: {
    inputs: {
      Viewport: 'vec4', CamPos: 'vec3', CamRot: 'vec3', CamLookAt: 'vec3',
      CamLookAtInWorldSpace: 'bool', CamFov: 'float', CamNear: 'float', CamFar: 'float',
      ScaleByAspect: 'bool', Render: 'Render',
    },
    outputs: {},
  },
  Clear: { inputs: { Color: 'vec4' }, outputs: { Render: 'Render' } },
  RGBAToColor: {
    inputs: { Red: 'float', Green: 'float', Blue: 'float', Alpha: 'float' },
    outputs: { Color: 'vec4' },
  },
  HSLAToColor: {
    inputs: { Hue: 'float', Saturation: 'float', Lightness: 'float', Alpha: 'float' },
    outputs: { Color: 'vec4' },
  },
  MinMax: {
    inputs: {
      Min: 'float', Max: 'float', Mode: 'int',
      DelayMin: 'float', DelayMax: 'float', DelayMode: 'int',
      ITimeMin: 'float', ITimeMax: 'float', ITimeMode: 'int',
    },
    outputs: { Value: 'float' },
  },
  Beat: {
    inputs: { NoMusic: 'float', Amplification: 'float', Min: 'float', Max: 'float' },
    outputs: { BeatStrength: 'float' },
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
  /** @type {{node:string, port:string, line:number}|null} */
  let openPort = null;
  for (const rec of records) {
    if (rec.kind === 'blank') continue;
    if (rec.kind === 'refused') { out.push({ line: rec.line, ok: false, text: rec.reason || 'refused' }); continue; }
    if (rec.kind === 'node' || rec.kind === 'node-open') {
      cur = rec.name || '';
      openPort = null;
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
    if (rec.kind === 'close' && rec.id === 'Node') { cur = ''; openPort = null; out.push({ line: rec.line, ok: true, text: 'scene structure / metadata' }); continue; }
    if (rec.kind === 'close' && rec.id === 'Port') {
      // The nested port block just closed. The port-open itself was
      // already refused (see below); this close just resets state.
      openPort = null;
      out.push({ line: rec.line, ok: true, text: 'end of nested port block' });
      continue;
    }
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
    if (rec.kind === 'port-open') {
      // Nested port blocks (<Port Id="X">...children...</Port>) carry a
      // <Value>...</Value> payload — for example every Light Worms
      // RenderToTexture node has <Port Id="Shader"><Value>...GLSL...
      // </Value></Port> and <Port Id="Expression"><Value></Value>
      // </Port>. No current conversion path consumes those payloads,
      // and silently omitting them is exactly the failure the reviewer
      // named. Refuse every nested port until a conversion path claims
      // ownership of its payload; the refusal names node, port, and
      // source line so the missing behavior is visible in triage.
      const portId = rec.id ?? '(unknown)';
      openPort = { node: cur, port: portId, line: rec.line };
      out.push({ line: rec.line, ok: false, text: 'node "' + cur + '" nested <Port Id="' + portId + '"> at line ' + rec.line + ' — nested port payloads are not consumed by any current Plane9 conversion path; silently omitting the enclosed <Value> payload is not permitted — refusing' });
      continue;
    }
    if (rec.kind === 'value' || rec.kind === 'value-open' || rec.kind === 'value-content') {
      if (openPort) {
        out.push({ line: rec.line, ok: false, text: 'payload line inside unhandled nested port "' + openPort.node + '.' + openPort.port + '" (opened line ' + openPort.line + ') — refusing' });
      } else {
        out.push({ line: rec.line, ok: false, text: 'orphan <Value> record outside a nested port block — refusing' });
      }
      continue;
    }
    if (rec.kind === 'connection') {
      const conn = { out: rec.out || '', in: rec.in || '' };
      connections.push(conn);
      const [outNodeId, outPortId] = conn.out.split('.');
      const [inNodeId, inPortId] = conn.in.split('.');
      const outNode = nodes[outNodeId || ''];
      const inNode = nodes[inNodeId || ''];
      // Convertibility for the triage disposition is the compatibility gate
      // status, not merely the presence of a native-op mapping — a UNRESOLVED
      // endpoint refuses conversion, so its incident edges are not realizable
      // (reviewer 2026-07-18 minor).
      const convertible = (/** @type {{type:string}|undefined} */ n) =>
        n !== undefined && P9_COMPATIBILITY[n.type]?.status === 'PASS';
      if (convertible(outNode) && convertible(inNode)) {
        // Source-side port type check. If both endpoint node types are
        // in P9_PORT_TYPES, the source-side port at the OUT end and the
        // destination-side port at the IN end must resolve to the same
        // Plane9 port type — a Render output plugged into a Texture
        // input is an invalid Plane9 source graph. Refuses at
        // disposition so p9ToPhos does not run against a
        // structurally-broken source (reviewer 2026-07-18).
        const outTypes = outNode !== undefined ? P9_PORT_TYPES[outNode.type] : undefined;
        const inTypes = inNode !== undefined ? P9_PORT_TYPES[inNode.type] : undefined;
        if (outTypes && inTypes && outPortId && inPortId) {
          const outType = outTypes.outputs[outPortId];
          const inType = inTypes.inputs[inPortId];
          if (outType === undefined) out.push({ line: rec.line, ok: false, text: 'connection ' + conn.out + ' → ' + conn.in + ' — source port "' + outPortId + '" is not a documented output of Plane9 node type "' + (outNode?.type ?? '') + '" — refusing' });
          else if (inType === undefined) out.push({ line: rec.line, ok: false, text: 'connection ' + conn.out + ' → ' + conn.in + ' — destination port "' + inPortId + '" is not a documented input of Plane9 node type "' + (inNode?.type ?? '') + '" — refusing' });
          else if (outType !== inType) out.push({ line: rec.line, ok: false, text: 'connection ' + conn.out + ' → ' + conn.in + ' — Plane9 source port type mismatch: source "' + outPortId + '" is ' + outType + ', destination "' + inPortId + '" is ' + inType + ' — refusing an invalid Plane9 source graph' });
          else out.push({ line: rec.line, ok: true, text: 'connection ' + conn.out + ' → ' + conn.in + ' — ' + outType + ' edge' });
        } else {
          const isRender = conn.out.endsWith('.Render') || conn.in.endsWith('.Render');
          out.push({ line: rec.line, ok: true, text: 'connection ' + conn.out + ' → ' + conn.in + (isRender ? ' — render topology' : ' — value edge propagates node output to input') });
        }
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
    if (srcType === undefined) throw new Error(`p9ToPhos: edge source "${c.out}" is not an output of "${srcNode.op}" — refusing`);
    if (dstType === undefined) throw new Error(`p9ToPhos: edge destination "${c.in}" is not an input of "${dstNode.op}" — refusing`);
    if (srcType !== dstType) throw new Error(`p9ToPhos: edge "${c.out}" (${srcType}) -> "${c.in}" (${dstType}) has mismatched port types — refusing`);
    outEdges.push({ out: c.out, in: c.in });
  }

  // Synthesize resource descriptors for each converted clear-color node
  // (Plane9's Clear). Each writes to a per-node transient texture, and
  // that texture is the presentation source that the executor blits to
  // the canvas at present time.
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
