// .phos native scene format: parse (validate + strip annotations), serialize
// (canonical form), toRuntime (produce runtime IR the engine consumes), and
// milkToPhos (record-consuming conversion: every source record handled or refused).
// Spec: design/PHOS-FORMAT.md. Strict JSON; "//"-prefixed keys are authoring
// annotations, stripped on parse; any other unknown key is a parse error.
//
// Ports are node-local (owner-decision 2026-07-18): duplicate port names
// across nodes are ALLOWED because scenes with multiple same-typed nodes
// (three MinMax in Plane9's Color Cycle) need node.port qualification. The
// runtime IR carries `nodes: [{id, op, ports: {portName: {type, value?}}}]`
// with edges qualified as "nodeId.portName". The engine dispatches per node.

import { OP_PORTS, NATIVE_OPS } from './engine.mjs';

/** @typedef {{type:string, value?:number|number[]}} Port */
/** @typedef {{id:string, primitive:string, op:string, ports:Record<string,Port>}} PhosNode */
/** @typedef {{id:string, stage:string, code:string[], comments?:string[]}} ExprProgram */
/** @typedef {{format:string, meta:Record<string,unknown>, resources:unknown[], nodes:PhosNode[], edges:{out:string,in:string}[], expressions:ExprProgram[]}} Scene */

const PORT_TYPES = ['float', 'vec2', 'vec3', 'vec4', 'color', 'texture', 'mesh', 'effect', 'render'];
const VECTOR_TYPES = { vec2: 2, vec3: 3, vec4: 4 };
const PRIMITIVES = ['graph', 'shader', 'expr', 'geom', 'compute'];
const EXPR_STAGES = ['per-frame', 'per-vertex'];
const ROOT_KEYS = ['format', 'meta', 'resources', 'nodes', 'edges', 'expressions', 'timeline'];
const META_KEYS = ['name', 'sourceEngine', 'source', 'author', 'description', 'tags', 'license', 'credit'];

/** @returns {never} */
function fail(/** @type {string} */ path, /** @type {string} */ msg) {
  throw new Error(`phos: ${path}: ${msg}`);
}

function checkKeys(/** @type {Record<string,unknown>} */ obj, /** @type {string[]} */ allowed, /** @type {string} */ path) {
  for (const k of Object.keys(obj)) {
    if (k.startsWith('//')) continue;
    if (!allowed.includes(k)) fail(path, `unknown key "${k}" (allowed: ${allowed.join(', ')})`);
  }
}

function reqString(/** @type {Record<string,unknown>} */ obj, /** @type {string} */ key, /** @type {string} */ path) {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) fail(path, `"${key}" must be a non-empty string`);
  return /** @type {string} */ (v);
}

export function parsePhos(/** @type {string} */ text) {
  const raw = /** @type {Record<string,unknown>} */ (JSON.parse(text));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('$', 'root must be an object');
  checkKeys(raw, ROOT_KEYS, '$');
  if (raw.format !== 'phos/1') fail('$.format', `must be exactly "phos/1", got ${JSON.stringify(raw.format)}`);

  const metaRaw = raw.meta;
  if (typeof metaRaw !== 'object' || metaRaw === null || Array.isArray(metaRaw)) fail('$.meta', 'must be an object');
  const metaObj = /** @type {Record<string,unknown>} */ (metaRaw);
  checkKeys(metaObj, META_KEYS, '$.meta');
  reqString(metaObj, 'name', '$.meta');
  /** @type {Record<string,unknown>} */
  const meta = {};
  for (const k of META_KEYS) if (k in metaObj) meta[k] = metaObj[k];
  if ('source' in meta) {
    const src = meta.source;
    if (typeof src !== 'object' || src === null || Array.isArray(src)) fail('$.meta.source', 'must be an object');
    const srcObj = /** @type {Record<string,unknown>} */ (src);
    checkKeys(srcObj, ['engine', 'file', 'sha256'], '$.meta.source');
    reqString(srcObj, 'engine', '$.meta.source');
    reqString(srcObj, 'file', '$.meta.source');
    reqString(srcObj, 'sha256', '$.meta.source');
    meta.source = { engine: srcObj.engine, file: srcObj.file, sha256: srcObj.sha256 };
  }

  if (!Array.isArray(raw.resources)) fail('$.resources', 'must be an array');
  if (raw.resources.length > 0) fail('$.resources', 'resources are not yet supported: refusing non-empty list');
  if ('timeline' in raw) fail('$.timeline', 'timeline is not yet supported: refusing its presence');

  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) fail('$.nodes', 'must be a non-empty array');
  /** @type {PhosNode[]} */
  const nodes = [];
  /** @type {Set<string>} */
  const nodeIds = new Set();
  raw.nodes.forEach((n, i) => {
    const path = `$.nodes[${i}]`;
    if (typeof n !== 'object' || n === null) fail(path, 'must be an object');
    const nObj = /** @type {Record<string,unknown>} */ (n);
    checkKeys(nObj, ['id', 'primitive', 'op', 'ports'], path);
    const id = reqString(nObj, 'id', path);
    if (nodeIds.has(id)) fail(path, `duplicate node id "${id}"`);
    nodeIds.add(id);
    const primitive = reqString(nObj, 'primitive', path);
    if (!PRIMITIVES.includes(primitive)) fail(path, `primitive "${primitive}" not in [${PRIMITIVES.join(', ')}]`);
    const op = reqString(nObj, 'op', path);
    const portsRaw = nObj.ports;
    if (typeof portsRaw !== 'object' || portsRaw === null || Array.isArray(portsRaw)) fail(path, '"ports" must be an object');
    /** @type {Record<string,Port>} */
    const ports = {};
    for (const [pname, pval] of Object.entries(/** @type {Record<string,unknown>} */ (portsRaw))) {
      if (pname.startsWith('//')) continue;
      const ppath = `${path}.ports.${pname}`;
      if (typeof pval !== 'object' || pval === null) fail(ppath, 'must be an object');
      const pObj = /** @type {Record<string,unknown>} */ (pval);
      checkKeys(pObj, ['type', 'value'], ppath);
      const type = reqString(pObj, 'type', ppath);
      if (!PORT_TYPES.includes(type)) fail(ppath, `type "${type}" not in [${PORT_TYPES.join(', ')}]`);
      if ('value' in pObj) {
        if (type === 'float') {
          if (typeof pObj.value !== 'number' || !Number.isFinite(pObj.value)) fail(ppath, 'float value must be a finite number');
          ports[pname] = { type, value: pObj.value };
        } else if (type in VECTOR_TYPES) {
          const dim = /** @type {number} */ (VECTOR_TYPES[/** @type {'vec2'|'vec3'|'vec4'} */ (type)]);
          if (!Array.isArray(pObj.value) || pObj.value.length !== dim
              || !pObj.value.every((v) => typeof v === 'number' && Number.isFinite(v))) {
            fail(ppath, `${type} value must be an array of ${dim} finite numbers`);
          }
          ports[pname] = { type, value: [...pObj.value] };
        } else {
          fail(ppath, `constant value not supported for port type "${type}" in phos/1`);
        }
      } else {
        ports[pname] = { type };
      }
    }
    nodes.push({ id, primitive, op, ports });
  });

  // edges — both ends must resolve, port types must match. Port refs are
  // "nodeId.portName" and are always node-qualified. Duplicate port NAMES
  // across nodes are legal (Plane9's Color Cycle has three MinMax nodes
  // each declaring a "Min", "Max", ... port); edge qualification
  // disambiguates them.
  if (!Array.isArray(raw.edges)) fail('$.edges', 'must be an array');
  /** @type {{out:string,in:string}[]} */
  const edges = [];
  const portOf = (/** @type {string} */ ref, /** @type {string} */ path) => {
    const dot = ref.indexOf('.');
    if (dot < 1) fail(path, `"${ref}" is not "nodeId.portId"`);
    const node = nodes.find((n) => n.id === ref.slice(0, dot));
    if (!node) fail(path, `node "${ref.slice(0, dot)}" not found`);
    const port = /** @type {PhosNode} */ (node).ports[ref.slice(dot + 1)];
    if (!port) fail(path, `port "${ref}" not found`);
    return /** @type {Port} */ (port);
  };
  raw.edges.forEach((e, i) => {
    const path = `$.edges[${i}]`;
    if (typeof e !== 'object' || e === null) fail(path, 'must be an object');
    const eObj = /** @type {Record<string,unknown>} */ (e);
    checkKeys(eObj, ['out', 'in'], path);
    const out = reqString(eObj, 'out', path);
    const inp = reqString(eObj, 'in', path);
    const a = portOf(out, `${path}.out`);
    const b = portOf(inp, `${path}.in`);
    if (a.type !== b.type) fail(path, `port type mismatch: ${out} is ${a.type}, ${inp} is ${b.type}`);
    edges.push({ out, in: inp });
  });

  if (!Array.isArray(raw.expressions)) fail('$.expressions', 'must be an array');
  /** @type {ExprProgram[]} */
  const expressions = [];
  raw.expressions.forEach((x, i) => {
    const path = `$.expressions[${i}]`;
    if (typeof x !== 'object' || x === null) fail(path, 'must be an object');
    const xObj = /** @type {Record<string,unknown>} */ (x);
    checkKeys(xObj, ['id', 'stage', 'code', 'comments'], path);
    const id = reqString(xObj, 'id', path);
    const stage = reqString(xObj, 'stage', path);
    if (!EXPR_STAGES.includes(stage)) fail(path, `stage "${stage}" not in [${EXPR_STAGES.join(', ')}]`);
    if (!Array.isArray(xObj.code) || !xObj.code.every((c) => typeof c === 'string')) fail(path, '"code" must be an array of strings');
    /** @type {ExprProgram} */
    const prog = { id, stage, code: /** @type {string[]} */ (xObj.code) };
    if ('comments' in xObj) {
      if (!Array.isArray(xObj.comments) || !xObj.comments.every((c) => typeof c === 'string')) fail(path, '"comments" must be an array of strings');
      prog.comments = /** @type {string[]} */ (xObj.comments);
    }
    expressions.push(prog);
  });

  return /** @type {Scene} */ ({ format: 'phos/1', meta, resources: [], nodes, edges, expressions });
}

// Canonical serialization: fixed key order, 2-space indent, trailing newline.
// serialize(parse(serialize(s))) === serialize(s).
export function serializePhos(/** @type {Scene} */ scene) {
  /** @type {Record<string,unknown>} */
  const meta = {};
  for (const k of META_KEYS) if (k in scene.meta) meta[k] = scene.meta[k];
  const out = {
    format: scene.format,
    meta,
    resources: scene.resources,
    nodes: scene.nodes.map((n) => ({
      id: n.id, primitive: n.primitive, op: n.op,
      ports: Object.fromEntries(Object.entries(n.ports).map(([k, p]) =>
        [k, 'value' in p
          ? { type: p.type, value: Array.isArray(p.value) ? [...p.value] : p.value }
          : { type: p.type }])),
    })),
    edges: scene.edges.map((e) => ({ out: e.out, in: e.in })),
    expressions: scene.expressions.map((x) =>
      x.comments ? { id: x.id, stage: x.stage, code: x.code, comments: x.comments } : { id: x.id, stage: x.stage, code: x.code }),
  };
  return JSON.stringify(out, null, 2) + '\n';
}

// Produce the runtime IR the engine consumes. Nodes carry node-local port
// state; edges stay qualified. The IR is a shallow clone so the engine can
// mutate per-frame without affecting the durable Scene document.
export function toRuntime(/** @type {Scene} */ scene) {
  /** @type {string[]} */
  const perFrame = [];
  /** @type {string[]} */
  const perVertex = [];
  /** @type {string[]} */
  const perFrameComments = [];
  for (const x of scene.expressions) {
    if (x.stage === 'per-frame') { perFrame.push(...x.code); if (x.comments) perFrameComments.push(...x.comments); }
    else perVertex.push(...x.code);
  }
  return {
    format: scene.format,
    meta: scene.meta,
    nodes: scene.nodes.map((n) => ({
      id: n.id, op: n.op,
      ports: Object.fromEntries(Object.entries(n.ports).map(([k, p]) =>
        [k, 'value' in p ? { type: p.type, value: Array.isArray(p.value) ? [...p.value] : p.value } : { type: p.type }])),
    })),
    edges: scene.edges.map((e) => ({ out: e.out, in: e.in })),
    expressions: { perFrame, perVertex, perFrameComments },
  };
}

// Write studio edits back into the Scene document. Accepts EITHER the
// node-qualified form ("nodeId.portName") for scenes with duplicate port
// names, or the bare port-name form for scenes whose port names are unique
// (MilkDrop presets). Refuses when the bare form is ambiguous or unmapped.
export function updateScene(/** @type {Scene} */ scene, /** @type {Record<string,number|number[]>} */ vars, /** @type {string[]} */ perFrameCode) {
  for (const [name, value] of Object.entries(vars)) {
    let owner;
    let portName;
    if (name.includes('.')) {
      const [nid, pname] = name.split('.');
      owner = scene.nodes.find((n) => n.id === nid);
      portName = pname;
    } else {
      const matches = scene.nodes.filter((n) => n.ports[name] && 'value' in n.ports[name]);
      if (matches.length > 1) throw new Error(`updateScene: port name "${name}" is claimed by ${matches.length} nodes — use "nodeId.portName" to disambiguate`);
      owner = matches[0];
      portName = name;
    }
    if (!owner || !portName || !owner.ports[portName]) throw new Error(`updateScene: no value port matches "${name}" — refusing to save an unmapped variable`);
    /** @type {Port} */ (owner.ports[portName]).value = Array.isArray(value) ? [...value] : value;
  }
  const perFramePrograms = scene.expressions.filter((x) => x.stage === 'per-frame');
  if (perFramePrograms.length > 1) throw new Error('updateScene: scene has multiple per-frame programs — write-back target is ambiguous, refusing');
  const first = perFramePrograms[0];
  if (first) first.code = perFrameCode;
  else if (perFrameCode.length > 0) scene.expressions.push({ id: 'per-frame', stage: 'per-frame', code: perFrameCode });
  return scene;
}

// --- MilkDrop conversion: record-consuming handler registry ---------------
// The importer (src/milk-import.mjs) emits one ordered record per nonblank
// source line; milkToPhos consumes EVERY record explicitly or refuses with
// the source line.
//
// Every port emission flows through emitPort, which enforces the ONE
// authoritative port declaration shared with execution (OP_PORTS,
// src/engine.mjs). Where MilkDrop applies semantics beyond storing the
// float, the executable site is in the runtime path the declaration points
// to (see NATIVE_OPS render contributes and warp-mesh.mjs).

/** @typedef {{warp:Record<string,Port>, borders:Record<string,Port>, comp:Record<string,Port>}} NodePorts */
/** @typedef {import('./milk-import.mjs').ValueRecord} ValueRecord */

/** @type {{warp:string, borders:string, comp:string}} */
const NODE_OP = { warp: 'warp-feedback', borders: 'borders', comp: 'composite' };

/**
 * The single emission door: refuses any port the target op does not declare.
 * @param {NodePorts} ports @param {'warp'|'borders'|'comp'} nodeId
 * @param {string} key @param {number} value @param {number} [line]
 */
function emitPort(ports, nodeId, key, value, line) {
  const declared = /** @type {string[]} */ (OP_PORTS[NODE_OP[nodeId]]);
  if (!declared.includes(key)) {
    throw new Error(`milkToPhos: ${line !== undefined ? `line ${line}: ` : ''}port "${key}" is not declared by target op "${NODE_OP[nodeId]}" (OP_PORTS, src/engine.mjs) — no runtime consumer exists, refusing`);
  }
  ports[nodeId][key] = { type: 'float', value };
}

/** @type {Record<string, (rec:ValueRecord, ports:NodePorts) => void>} */
const VALUE_HANDLERS = {
  fDecay: (rec, ports) => emitPort(ports, 'warp', 'fDecay', rec.value, rec.line),
  zoom: (rec, ports) => emitPort(ports, 'warp', 'zoom', rec.value, rec.line),
  rot: (rec, ports) => emitPort(ports, 'warp', 'rot', rec.value, rec.line),
  warp: (rec, ports) => emitPort(ports, 'warp', 'warp', rec.value, rec.line),
  cx: (rec, ports) => emitPort(ports, 'warp', 'cx', rec.value, rec.line),
  cy: (rec, ports) => emitPort(ports, 'warp', 'cy', rec.value, rec.line),
  dx: (rec, ports) => emitPort(ports, 'warp', 'dx', rec.value, rec.line),
  dy: (rec, ports) => emitPort(ports, 'warp', 'dy', rec.value, rec.line),
  sx: (rec, ports) => emitPort(ports, 'warp', 'sx', rec.value, rec.line),
  sy: (rec, ports) => emitPort(ports, 'warp', 'sy', rec.value, rec.line),
  fWarpAnimSpeed: (rec, ports) => emitPort(ports, 'warp', 'fWarpAnimSpeed', rec.value, rec.line),
  fWarpScale: (rec, ports) => emitPort(ports, 'warp', 'fWarpScale', rec.value, rec.line),
  fZoomExponent: (rec, ports) => emitPort(ports, 'warp', 'fZoomExponent', rec.value, rec.line),
  ob_size: (rec, ports) => emitPort(ports, 'borders', 'ob_size', rec.value, rec.line),
  ob_r: (rec, ports) => emitPort(ports, 'borders', 'ob_r', rec.value, rec.line),
  ob_g: (rec, ports) => emitPort(ports, 'borders', 'ob_g', rec.value, rec.line),
  ob_b: (rec, ports) => emitPort(ports, 'borders', 'ob_b', rec.value, rec.line),
  ob_a: (rec, ports) => emitPort(ports, 'borders', 'ob_a', rec.value, rec.line),
  ib_size: (rec, ports) => emitPort(ports, 'borders', 'ib_size', rec.value, rec.line),
  ib_r: (rec, ports) => emitPort(ports, 'borders', 'ib_r', rec.value, rec.line),
  ib_g: (rec, ports) => emitPort(ports, 'borders', 'ib_g', rec.value, rec.line),
  ib_b: (rec, ports) => emitPort(ports, 'borders', 'ib_b', rec.value, rec.line),
  ib_a: (rec, ports) => emitPort(ports, 'borders', 'ib_a', rec.value, rec.line),
  fGammaAdj: (rec, ports) => emitPort(ports, 'comp', 'fGammaAdj', rec.value, rec.line),
  fVideoEchoZoom: (rec, ports) => emitPort(ports, 'comp', 'fVideoEchoZoom', rec.value, rec.line),
  fVideoEchoAlpha: (rec, ports) => emitPort(ports, 'comp', 'fVideoEchoAlpha', rec.value, rec.line),
  nVideoEchoOrientation: (rec, ports) => emitPort(ports, 'comp', 'nVideoEchoOrientation', rec.value, rec.line),
};

const MILK_NODE_DEFAULTS = /** @type {{warp:Record<string,number>, comp:Record<string,number>}} */ ({
  warp: {
    zoom: 1, rot: 0, cx: 0.5, cy: 0.5, dx: 0, dy: 0, warp: 1, sx: 1, sy: 1,
    fWarpAnimSpeed: 1, fWarpScale: 1, fZoomExponent: 1,
  },
  comp: {
    fGammaAdj: 2, fVideoEchoZoom: 2, fVideoEchoAlpha: 0, nVideoEchoOrientation: 0,
  },
});

/**
 * Per-record conversion disposition for the studio's triage view.
 * @param {(import('./milk-import.mjs').SourceRecord|import('./milk-import.mjs').RefusedRecord)[]} records
 * @returns {{line:number, ok:boolean, text:string}[]}
 */
export function assessRecords(records) {
  return records.map((rec) => {
    if (rec.kind === 'refused') return { line: rec.line, ok: false, text: rec.reason.replace(/^line \d+: /, '') };
    if (rec.kind === 'section') return rec.name === 'preset00'
      ? { line: rec.line, ok: true, text: 'structural marker → provenance' }
      : { line: rec.line, ok: false, text: `unknown section "${rec.raw}"` };
    if (rec.kind === 'comment') return { line: rec.line, ok: true, text: 'preserved source comment' };
    if (rec.kind === 'equation') return { line: rec.line, ok: true, text: 'per-frame program code' };
    return VALUE_HANDLERS[rec.key]
      ? { line: rec.line, ok: true, text: `port ${rec.key}` }
      : { line: rec.line, ok: false, text: `no conversion handler for "${rec.key}" — missing target capability` };
  });
}

export function milkToPhos(/** @type {{records:import('./milk-import.mjs').SourceRecord[], vars:Record<string,number>, expressions:{perFrame:string[], perVertex:string[], perFrameComments:string[]}}} */ ir,
                           /** @type {{file:string, sha256:string}} */ source) {
  /** @type {NodePorts} */
  const nodePorts = { warp: {}, borders: {}, comp: {} };
  /** @type {string[]} */ const perFrame = [];
  /** @type {string[]} */ const perFrameComments = [];
  let consumed = 0;
  for (const rec of ir.records) {
    if (rec.kind === 'section') {
      if (rec.name !== 'preset00') throw new Error(`milkToPhos: line ${rec.line}: unknown section "${rec.raw}" — refusing`);
      consumed++;
    } else if (rec.kind === 'comment') {
      perFrameComments.push(rec.text); consumed++;
    } else if (rec.kind === 'equation') {
      perFrame.push(rec.code); consumed++;
    } else if (rec.kind === 'value') {
      const handler = VALUE_HANDLERS[rec.key];
      if (!handler) throw new Error(`milkToPhos: line ${rec.line}: no conversion handler for "${rec.key}" — the target cannot yet express this property's behavior, refusing`);
      handler(rec, nodePorts); consumed++;
    } else {
      throw new Error(`milkToPhos: unknown record kind ${JSON.stringify(rec)} — refusing`);
    }
  }
  if (consumed !== ir.records.length) {
    throw new Error(`milkToPhos: ${ir.records.length - consumed} source record(s) left unconsumed — refusing`);
  }
  for (const nodeId of /** @type {('warp'|'comp')[]} */ (['warp', 'comp'])) {
    for (const [key, dflt] of Object.entries(MILK_NODE_DEFAULTS[nodeId])) {
      if (!(key in nodePorts[nodeId])) emitPort(nodePorts, nodeId, key, dflt);
    }
  }
  // canonical render wiring: warp -> borders -> comp
  nodePorts.warp.out = { type: 'render' };
  nodePorts.borders.in = { type: 'render' };
  nodePorts.borders.out = { type: 'render' };
  nodePorts.comp.in = { type: 'render' };
  /** @type {ExprProgram[]} */
  const expressions = [];
  if (perFrame.length > 0 || perFrameComments.length > 0) {
    /** @type {ExprProgram} */
    const prog = { id: 'preset-per-frame', stage: 'per-frame', code: perFrame };
    if (perFrameComments.length > 0) prog.comments = perFrameComments;
    expressions.push(prog);
  }
  const name = 'md-' + source.file.replace(/\.[^.]+$/, '');
  return /** @type {Scene} */ ({
    format: 'phos/1',
    meta: { name, sourceEngine: 'milkdrop', source: { engine: 'milkdrop', file: source.file, sha256: source.sha256 } },
    resources: [],
    nodes: [
      { id: 'warp', primitive: 'graph', op: 'warp-feedback', ports: nodePorts.warp },
      { id: 'borders', primitive: 'shader', op: 'borders', ports: nodePorts.borders },
      { id: 'comp', primitive: 'graph', op: 'composite', ports: nodePorts.comp },
    ],
    edges: [
      { out: 'warp.out', in: 'borders.in' },
      { out: 'borders.out', in: 'comp.in' },
    ],
    expressions,
  });
}
// Re-export so downstream code has a single import surface.
export { NATIVE_OPS };
