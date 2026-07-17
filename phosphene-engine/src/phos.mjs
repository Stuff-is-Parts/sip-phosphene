// .phos native scene format: parse (validate + strip annotations), serialize
// (canonical form), toRuntime (flatten to the engine's runtime IR), and
// milkToPhos (convert a .milk preset via the completeness-checked key map).
// Spec: design/PHOS-FORMAT.md. Strict JSON; "//"-prefixed keys are authoring
// annotations, stripped on parse; any other unknown key is a parse error.

/** @typedef {{type:string, value?:number}} Port */
/** @typedef {{id:string, primitive:string, op:string, ports:Record<string,Port>}} PhosNode */
/** @typedef {{id:string, stage:string, code:string[], comments?:string[]}} ExprProgram */
/** @typedef {{format:string, meta:Record<string,unknown>, resources:unknown[], nodes:PhosNode[], edges:{out:string,in:string}[], expressions:ExprProgram[]}} Scene */

const PORT_TYPES = ['float', 'vec2', 'vec3', 'vec4', 'color', 'texture', 'mesh', 'effect', 'render'];
const PRIMITIVES = ['graph', 'shader', 'expr', 'geom', 'compute'];
const EXPR_STAGES = ['per-frame', 'per-vertex'];
const ROOT_KEYS = ['format', 'meta', 'resources', 'nodes', 'edges', 'expressions', 'timeline'];
const META_KEYS = ['name', 'sourceEngine', 'source', 'author', 'description', 'tags', 'license', 'credit'];

/** @returns {never} */
function fail(/** @type {string} */ path, /** @type {string} */ msg) {
  throw new Error(`phos: ${path}: ${msg}`);
}

// Return the object's meaningful keys (annotations stripped); refuse unknowns.
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

  // meta
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

  // skeleton slots — refused until a scene forces implementation (PHOS-FORMAT.md)
  if (!Array.isArray(raw.resources)) fail('$.resources', 'must be an array');
  if (raw.resources.length > 0) fail('$.resources', 'resources are not yet supported: refusing non-empty list');
  if ('timeline' in raw) fail('$.timeline', 'timeline is not yet supported: refusing its presence');

  // nodes
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
        if (type !== 'float') fail(ppath, `value is only supported on float ports in phos/1, port type is "${type}"`);
        if (typeof pObj.value !== 'number' || !Number.isFinite(pObj.value)) fail(ppath, 'value must be a finite number');
        ports[pname] = { type, value: pObj.value };
      } else {
        ports[pname] = { type };
      }
    }
    nodes.push({ id, primitive, op, ports });
  });

  // Duplicate value-port names across nodes would silently last-write-win when
  // flattened to the runtime pool — refuse (exactness: no silent flattening).
  /** @type {Map<string,string>} */
  const valuePortOwner = new Map();
  for (const n of nodes) {
    for (const [pname, port] of Object.entries(n.ports)) {
      if (typeof port.value !== 'number') continue;
      const prior = valuePortOwner.get(pname);
      if (prior) fail(`$.nodes(${n.id}).ports.${pname}`, `value port name "${pname}" already carried by node "${prior}" — duplicate names would collide in the variable pool`);
      valuePortOwner.set(pname, n.id);
    }
  }

  // edges — both ends must resolve, port types must match
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

  // expressions
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
        [k, 'value' in p ? { type: p.type, value: p.value } : { type: p.type }])),
    })),
    edges: scene.edges.map((e) => ({ out: e.out, in: e.in })),
    expressions: scene.expressions.map((x) =>
      x.comments ? { id: x.id, stage: x.stage, code: x.code, comments: x.comments } : { id: x.id, stage: x.stage, code: x.code }),
  };
  return JSON.stringify(out, null, 2) + '\n';
}

// Flatten the graph document into the runtime IR the current fixed-pipeline
// engine consumes: port values -> variable pool, per-frame programs -> perFrame.
// The .phos file is the durable scene; this IR conforms to it.
export function toRuntime(/** @type {Scene} */ scene) {
  /** @type {Record<string,number>} */
  const vars = {};
  for (const n of scene.nodes) {
    for (const [pname, port] of Object.entries(n.ports)) {
      if (typeof port.value === 'number') vars[pname] = port.value;
    }
  }
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
    vars,
    expressions: { perFrame, perVertex, perFrameComments },
    // display structure for the studio: each node with its value-carrying ports,
    // plus the wiring so the studio can show edges (MUST: nodes + ports + wiring)
    pipelineDescriptor: scene.nodes.map((n) => ({
      id: n.id, stage: n.op,
      ports: Object.keys(n.ports).filter((p) => typeof (/** @type {Port} */ (n.ports[p]).value) === 'number'),
    })),
    edges: scene.edges.map((e) => ({ out: e.out, in: e.in })),
  };
}

// Write studio edits back into the Scene document: variable values land on
// their owning ports (value-port names are scene-unique per the parse-time
// duplicate refusal, so the lookup is unambiguous), and the edited per-frame
// code replaces the single per-frame program's code (comments retained).
// Refusals: a variable with no owning port, or a scene whose per-frame code
// is split across multiple programs (write-back target would be ambiguous).
export function updateScene(/** @type {Scene} */ scene, /** @type {Record<string,number>} */ vars, /** @type {string[]} */ perFrameCode) {
  for (const [name, value] of Object.entries(vars)) {
    const owner = scene.nodes.find((n) => n.ports[name] && typeof (/** @type {Port} */ (n.ports[name])).value === 'number');
    if (!owner) throw new Error(`updateScene: no value port named "${name}" in the scene — refusing to save an unmapped variable`);
    /** @type {Port} */ (owner.ports[name]).value = value;
  }
  const perFramePrograms = scene.expressions.filter((x) => x.stage === 'per-frame');
  if (perFramePrograms.length > 1) throw new Error('updateScene: scene has multiple per-frame programs — write-back target is ambiguous, refusing');
  const first = perFramePrograms[0];
  if (first) first.code = perFrameCode;
  else if (perFrameCode.length > 0) scene.expressions.push({ id: 'per-frame', stage: 'per-frame', code: perFrameCode });
  return scene;
}

// .milk key -> node assignment for the canonical MilkDrop import.
// Citations: design/PHOS-FORMAT.md scene-one mapping table (milkdropfs.cpp refs).
// Any key not in this map throws — completeness by refusal, no silent drops.
const MILK_KEY_TO_NODE = /** @type {Record<string,string>} */ ({
  fDecay: 'warp', zoom: 'warp', rot: 'warp', warp: 'warp',
  cx: 'warp', cy: 'warp', dx: 'warp', dy: 'warp', sx: 'warp', sy: 'warp',
  fWarpAnimSpeed: 'warp', fWarpScale: 'warp', fZoomExponent: 'warp',
  ob_size: 'borders', ob_r: 'borders', ob_g: 'borders', ob_b: 'borders', ob_a: 'borders',
  ib_size: 'borders', ib_r: 'borders', ib_g: 'borders', ib_b: 'borders', ib_a: 'borders',
  fGammaAdj: 'comp', fVideoEchoZoom: 'comp', fVideoEchoAlpha: 'comp', nVideoEchoOrientation: 'comp',
});

// Source-defined defaults a preset may omit — MilkDrop state.cpp
// (CState::Default): warp-motion params :654-665, composite params :541-544
// (note fGammaAdj DEFAULTS TO 2.0 — "1.0 = reg; +2.0 = double"). The converter
// materializes them so the .phos carries "parsed fields, defaults" per the
// exactness standard, instead of the engine defaulting silently.
const MILK_NODE_DEFAULTS = /** @type {Record<string, Record<string,number>>} */ ({
  warp: {
    zoom: 1, rot: 0, cx: 0.5, cy: 0.5, dx: 0, dy: 0, warp: 1, sx: 1, sy: 1,
    fWarpAnimSpeed: 1, fWarpScale: 1, fZoomExponent: 1,
  },
  comp: {
    fGammaAdj: 2, fVideoEchoZoom: 2, fVideoEchoAlpha: 0, nVideoEchoOrientation: 0,
  },
});

export function milkToPhos(/** @type {{vars:Record<string,number>, expressions:{perFrame:string[], perVertex:string[], perFrameComments:string[]}}} */ ir,
                           /** @type {{file:string, sha256:string}} */ source) {
  /** @type {Record<string, Record<string,Port>>} */
  const nodePorts = { warp: {}, borders: {}, comp: {} };
  for (const [key, value] of Object.entries(ir.vars)) {
    const nodeId = MILK_KEY_TO_NODE[key];
    if (!nodeId) throw new Error(`milkToPhos: no node mapping for .milk key "${key}" — extend the mapping table (design/PHOS-FORMAT.md) before converting`);
    /** @type {Record<string,Port>} */ (nodePorts[nodeId])[key] = { type: 'float', value };
  }
  for (const [nodeId, defaults] of Object.entries(MILK_NODE_DEFAULTS)) {
    for (const [key, dflt] of Object.entries(defaults)) {
      if (!(key in ir.vars)) /** @type {Record<string,Port>} */ (nodePorts[nodeId])[key] = { type: 'float', value: dflt };
    }
  }
  // canonical wiring: warp -> borders -> comp (pipeline grammar, milkdropfs.cpp:1048-1214)
  /** @type {Record<string,Port>} */ (nodePorts.warp).out = { type: 'render' };
  /** @type {Record<string,Port>} */ (nodePorts.borders).in = { type: 'render' };
  /** @type {Record<string,Port>} */ (nodePorts.borders).out = { type: 'render' };
  /** @type {Record<string,Port>} */ (nodePorts.comp).in = { type: 'render' };
  /** @type {ExprProgram[]} */
  const expressions = [];
  if (ir.expressions.perFrame.length > 0 || ir.expressions.perFrameComments.length > 0) {
    /** @type {ExprProgram} */
    const prog = { id: 'preset-per-frame', stage: 'per-frame', code: ir.expressions.perFrame };
    if (ir.expressions.perFrameComments.length > 0) prog.comments = ir.expressions.perFrameComments;
    expressions.push(prog);
  }
  if (ir.expressions.perVertex.length > 0) expressions.push({ id: 'preset-per-vertex', stage: 'per-vertex', code: ir.expressions.perVertex });
  // converted-scene naming: source-engine prefix (md- for MilkDrop, p9- for
  // Plane9 when that converter exists) so provenance shows in the filename
  const name = 'md-' + source.file.replace(/\.[^.]+$/, '');
  return /** @type {Scene} */ ({
    format: 'phos/1',
    meta: { name, sourceEngine: 'milkdrop', source: { engine: 'milkdrop', file: source.file, sha256: source.sha256 } },
    resources: [],
    nodes: [
      { id: 'warp', primitive: 'graph', op: 'warp-feedback', ports: /** @type {Record<string,Port>} */ (nodePorts.warp) },
      { id: 'borders', primitive: 'shader', op: 'borders', ports: /** @type {Record<string,Port>} */ (nodePorts.borders) },
      { id: 'comp', primitive: 'graph', op: 'composite', ports: /** @type {Record<string,Port>} */ (nodePorts.comp) },
    ],
    edges: [
      { out: 'warp.out', in: 'borders.in' },
      { out: 'borders.out', in: 'comp.in' },
    ],
    expressions,
  });
}
