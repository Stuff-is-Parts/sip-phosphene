/**
 * Plane9 structural importer: scene.xml node graph -> PHOSPHENE GraphScene,
 * preserving nodes, ports, connections, both shader stages, geometry,
 * render targets, and CPU dataflow (COMPATIBILITY-GOAL.md; execution model
 * per docs/plane9-execution-model.md).
 *
 * Witnessed topology semantics (scripts/diag-p9-conns.mjs on shipped
 * scenes; census in docs/plane9-node-census.json):
 * - Render sequencing: `A.Render -> B.Render` chains earlier stages into
 *   later ones, terminating at a sink (`Screen.Render` or
 *   `RenderToTexture.Render`). Execution order = chain order.
 * - RenderRect takes its Shader via `Shader.Effect -> RenderRect.Effect`.
 * - RenderObject draws an object graph: `MeshObject.Object ->
 *   [CloneExpression.Object ->] RenderObject.Object`; the shader binds at
 *   the MeshObject (`Shader.Effect -> MeshObject.Effect`); the geometry
 *   arrives via a mesh chain `Primitive.Mesh -> [modifiers...] ->
 *   MeshObject.Mesh`.
 * - RenderToTexture exposes its result via `.Color`; texture processors
 *   (Bloom, Blur, ...) flow `X.Texture -> Proc.Texture -> Shader.TextureN`.
 *
 * Structure preservation contract (COMPATIBILITY-GOAL.md Hard Rules):
 * every source node maps to exactly one graph node; unverified node types
 * and unresolvable chains become explicit `unsupported` nodes naming the
 * exact feature — never dropped, never approximated.
 */

import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import {
  GraphScene, GraphNode, DataEdge, MeshPrimitive, TextureRef, validateGraph,
} from "../core/graph";

export class P9ImportError extends Error {}

/* --------------------------- source parsing --------------------------- */

/** Port value is the RAW source string (no numeric coercion — the string
 *  is the lossless typed form; consumers parse explicitly). */
export interface P9Port { id: string; value: string | undefined }
export interface P9Node { type: string; id: string; ports: Map<string, P9Port> }
export interface P9Connection { fromNode: string; fromPort: string; toNode: string; toPort: string }
export interface P9SceneXml {
  name: string; author: string; desc: string; license: string; licenseText: string;
  tags: string;
  warmupTime: number;
  /** Root-element attributes verbatim (FormatVersion, Id, ParentId,
   *  WarmupTime, SceneType, Version, DevelopmentTime, Created,
   *  LastModified — the full witnessed corpus set). */
  rootAttributes: Record<string, string>;
  nodes: Map<string, P9Node>;
  connections: P9Connection[];
}

export function parseP9SceneXml(buf: ArrayBuffer, filename: string): P9SceneXml {
  const files = unzipSync(new Uint8Array(buf));
  const entry = Object.keys(files).find((k) => k.toLowerCase().endsWith("scene.xml"));
  if (!entry) throw new P9ImportError("no scene.xml in container");
  const xml = new TextDecoder().decode(files[entry]);
  const parser = new XMLParser({
    ignoreAttributes: false, attributeNamePrefix: "@",
    // No value coercion anywhere: attribute and tag values stay raw
    // strings so the source record is lossless ("1.10", "007", vectors).
    parseTagValue: false, parseAttributeValue: false,
    isArray: (t) => t === "Node" || t === "Port" || t === "Connection",
  });
  const doc = parser.parse(xml);
  const root = doc.Plane9Scene;
  if (!root) throw new P9ImportError("no Plane9Scene root");

  const rootAttributes: Record<string, string> = {};
  for (const k of Object.keys(root)) {
    if (k.startsWith("@")) rootAttributes[k.slice(1)] = String(root[k]);
  }

  const nodes = new Map<string, P9Node>();
  for (const n of root.Nodes?.Node ?? []) {
    const type = String(n["@Type"] ?? "");
    // Node identity is @Name; connection refs are "Name.Port" (census).
    const id = String(n["@Name"] ?? "");
    if (!type || !id) throw new P9ImportError(`node missing Type/Name (${type}/${id})`);
    const ports = new Map<string, P9Port>();
    for (const p of n.Port ?? []) {
      const pid = String(p["@Id"] ?? "");
      // Attribute form <Port Value="..."/> or element form
      // <Port><Value>...</Value></Port> (witnessed: multiline shader /
      // expression text uses the element form).
      const attr = p["@Value"];
      const el = p.Value;
      const value = attr !== undefined ? String(attr)
        : el !== undefined && el !== null
          ? (typeof el === "object" ? String(el["#text"] ?? "") : String(el))
          : undefined;
      ports.set(pid, { id: pid, value });
    }
    nodes.set(id, { type, id, ports });
  }

  const connections: P9Connection[] = [];
  for (const c of root.Connections?.Connection ?? []) {
    const [fromNode, fromPort] = splitRef(String(c["@Out"] ?? ""));
    const [toNode, toPort] = splitRef(String(c["@In"] ?? ""));
    connections.push({ fromNode, fromPort, toNode, toPort });
  }

  const licenseEl = root.License;
  return {
    name: filename.replace(/\.p9c$/i, "").replace(/^.*[\\/]/, ""),
    author: String(root.Author ?? ""),
    desc: String(root.Desc ?? ""),
    tags: String(root.Tags ?? ""),
    license: String(licenseEl?.["@Type"] ?? ""),
    licenseText: typeof licenseEl === "object" && licenseEl !== null
      ? String(licenseEl["#text"] ?? "") : String(licenseEl ?? ""),
    warmupTime: parseFloat(rootAttributes.WarmupTime ?? "0") || 0,
    rootAttributes,
    nodes, connections,
  };
}

/* ----------------------- installed shader format ----------------------- */

/** Parsed Plane9 shader text (witnessed format in scene.xml Shader ports
 *  and the engine DLL string table): an optional `VERTEXOUTPUT { ... }`
 *  inter-stage struct, then common text compiled twice — once with VERTEX
 *  defined, once with FRAGMENT defined (`#ifdef VERTEX` / `#ifdef
 *  FRAGMENT` sections; vertex writes gl_Position and `so.*`, fragment
 *  reads `si.*` and writes oColor). */
export interface P9ShaderStages {
  interstage: string;
  vertex: string;
  fragment: string;
}

/** Split the installed two-stage-in-one-text format by evaluating the
 *  #ifdef VERTEX / #ifdef FRAGMENT / #else / #endif conditionals for each
 *  stage define. Text outside those conditionals is shared by both. */
export function parseP9ShaderStages(text: string): P9ShaderStages {
  let interstage = "";
  let rest = text;
  const m = /VERTEXOUTPUT\s*\{[\s\S]*?\}/.exec(text);
  if (m) {
    interstage = m[0];
    rest = text.slice(0, m.index) + text.slice(m.index + m[0].length);
  }
  const forStage = (define: "VERTEX" | "FRAGMENT"): string => {
    const out: string[] = [];
    // Conditional stack: stage frames (#ifdef VERTEX/FRAGMENT) are
    // evaluated here; every other conditional is a passthrough frame whose
    // directive lines are emitted verbatim (the GLSL compiler handles it).
    const stack: { stage: boolean; active: boolean }[] = [];
    const live = () => stack.every((s) => !s.stage || s.active);
    for (const line of rest.split(/\r?\n/)) {
      const stageIf = /^\s*#ifdef\s+(VERTEX|FRAGMENT)\b/.exec(line);
      const anyIf = /^\s*#\s*if(def|ndef)?\b/.test(line);
      const els = /^\s*#\s*else\b/.test(line);
      const endif = /^\s*#\s*endif\b/.test(line);
      if (stageIf) { stack.push({ stage: true, active: stageIf[1] === define }); continue; }
      if (anyIf) { stack.push({ stage: false, active: true }); if (live()) out.push(line); continue; }
      if (els && stack.length) {
        const top = stack[stack.length - 1];
        if (top.stage) { top.active = !top.active; continue; }
        if (live()) out.push(line);
        continue;
      }
      if (endif && stack.length) {
        const top = stack.pop() as { stage: boolean };
        if (top.stage) continue;
        if (live()) out.push(line);
        continue;
      }
      if (live()) out.push(line);
    }
    return out.join("\n").trim();
  };
  return { interstage, vertex: forStage("VERTEX"), fragment: forStage("FRAGMENT") };
}

function splitRef(ref: string): [string, string] {
  const dot = ref.indexOf(".");
  if (dot < 0) throw new P9ImportError(`malformed connection ref '${ref}'`);
  return [ref.slice(0, dot), ref.slice(dot + 1)];
}

/* --------------------------- graph mapping ---------------------------- */

const MESH_PRIMS: Record<string, MeshPrimitive["kind"]> = {
  Cube: "cube", Sphere: "sphere", Plane: "plane", Torus: "torus",
  Cone: "cone", Cylinder: "cylinder", Disc: "disc",
};

/** CPU node types with EVIDENCED semantics get typed lowerings; every
 *  other CPU type becomes an explicit unsupported node (no generic-
 *  expression translation — COMPATIBILITY-GOAL.md Hard Rules):
 *  - Expression -> cpu-expr/expreval (evaluator identified in plane9.txt
 *    credits: expreval.sourceforge.net);
 *  - Vector -> p9-vector (wiki/nodes: "Combines a x, y and z component
 *    to a 3d vector");
 *  - HSLAToColor / HSVAToColor / RGBAToColor -> p9-color (standard
 *    color-space conversions; names + ports in the census).
 *  Beat / Spectrum / Waveform are UNSUPPORTED until their Plane9-specific
 *  semantics (beat-detection algorithm, spectrum/waveform scaling, port
 *  meanings) are evidenced — they are NOT generic audio features.
 *  MinMax, Rotator, SignalGenerator, Sin, and all other CPU types have
 *  UNEVIDENCED exact behavior and import as unsupported. */
const CPU_EVIDENCED = new Set([
  "Expression", "Vector",
  "HSLAToColor", "HSVAToColor", "RGBAToColor",
]);

/** Texture-producing node types (flow into Shader.TextureN / processors). */
const TEXTURE_SOURCE_TYPES = new Set([
  "RenderToTexture", "PreviousLayer", "FileTexture", "SoundTexture",
  "StoreTexture", "CopyTexture", "NoiseTexture", "Gradient",
  "RandomTexture", "ExpressionTexture", "TuringPattern",
]);

/** Per-source-node disposition: how the importer accounted for it.
 *  Every source node MUST appear here — structural completeness is
 *  auditable as "no source node lacks a disposition". */
export type P9Disposition =
  | { p9Type: string; p9Id: string; disposition: "lowered"; graphKind: string }
  | { p9Type: string; p9Id: string; disposition: "consumed-by"; by: string }
  | { p9Type: string; p9Id: string; disposition: "unsupported"; feature: string };

export interface P9GraphImport {
  graph: GraphScene;
  dispositions: P9Disposition[];
  /** True when every source node carries a disposition AND none is
   *  currently labeled unsupported. This measures source-node disposition
   *  accounting ONLY — it is NOT executable structural completeness
   *  (connections and required behaviors are not yet proven executable)
   *  and NOT fidelity (COMPATIBILITY-GOAL.md: only reference-validated
   *  conversion counts). */
  dispositionCleanImport: boolean;
  unsupportedCount: number;
}

export function p9ToGraph(src: P9SceneXml): P9GraphImport {
  const nodes: GraphNode[] = [];
  const data: DataEdge[] = [];
  const dispositions: P9Disposition[] = [];
  const emit = (node: GraphNode, p9: P9Node) => {
    nodes.push(node);
    dispositions.push(node.kind === "unsupported"
      ? { p9Type: p9.type, p9Id: p9.id, disposition: "unsupported", feature: (node as { feature: string }).feature }
      : { p9Type: p9.type, p9Id: p9.id, disposition: "lowered", graphKind: node.kind });
  };
  const consumed = new Map<string, string>(); // source node id -> consuming draw id

  // Connection indexes.
  const inTo = new Map<string, P9Connection[]>();   // toNode -> conns
  const outOf = new Map<string, P9Connection[]>();  // fromNode -> conns
  for (const c of src.connections) {
    (inTo.get(c.toNode) ?? inTo.set(c.toNode, []).get(c.toNode)!).push(c);
    (outOf.get(c.fromNode) ?? outOf.set(c.fromNode, []).get(c.fromNode)!).push(c);
  }
  const inPort = (nodeId: string, port: string): P9Connection | undefined =>
    (inTo.get(nodeId) ?? []).find((c) => c.toPort === port);

  /* ---- texture resources: refs for anything a shader can bind ---- */
  const texRefs = new Map<string, TextureRef>();
  for (const n of src.nodes.values()) {
    if (!TEXTURE_SOURCE_TYPES.has(n.type)) continue;
    switch (n.type) {
      case "RenderToTexture":
        emit({ kind: "target", id: n.id, feedback: true, origin: og(n) }, n);
        break;
      case "PreviousLayer":
        emit({ kind: "texture", id: n.id, source: { kind: "previous-frame", of: "screenTarget" }, origin: og(n) }, n);
        break;
      case "FileTexture":
        emit({ kind: "texture", id: n.id, source: { kind: "image", slot: "scene-image" }, origin: og(n) }, n);
        break;
      case "SoundTexture":
        emit({ kind: "texture", id: n.id, source: { kind: "sound", mode: "spectrum" }, origin: og(n) }, n);
        break;
      default:
        // Texture producers without a verified implementation: explicit.
        emit({
          kind: "unsupported", id: n.id, feature: `Plane9:${n.type}`,
          reason: "texture-producing node without a verified engine implementation",
          origin: og(n),
        }, n);
        break;
    }
    texRefs.set(n.id, n.id);
  }
  nodes.push({ kind: "target", id: "screenTarget", feedback: true });

  /** Resolve a texture flow backwards: the node feeding `conn.fromNode` may
   *  itself be a processor (Bloom/Blur). Returns the ref + processors seen. */
  const resolveTexSource = (nodeId: string, seen: string[] = []): { ref?: TextureRef; chain: string[] } => {
    if (texRefs.has(nodeId)) return { ref: texRefs.get(nodeId), chain: seen };
    const n = src.nodes.get(nodeId);
    if (!n) return { chain: seen };
    // processor: follow its inbound Texture edge
    const upstream = inPort(nodeId, "Texture");
    if (upstream) return resolveTexSource(upstream.fromNode, [...seen, n.type]);
    return { chain: [...seen, n.type] };
  };

  /* ---- render chains ---- */
  // Sinks: Screen nodes and RenderToTexture nodes (Render input).
  const renderTargetOf = new Map<string, TextureRef | "screen">(); // render-node -> target
  const renderChains: string[][] = []; // ordered stage node-ids per chain
  for (const n of src.nodes.values()) {
    if (n.type !== "Screen" && n.type !== "RenderToTexture") continue;
    const target: TextureRef | "screen" = n.type === "Screen" ? "screenTarget" : n.id;
    // Walk the Render chain backwards from the sink.
    const chain: string[] = [];
    let cur = inPort(n.id, "Render");
    while (cur) {
      chain.unshift(cur.fromNode);
      renderTargetOf.set(cur.fromNode, target);
      cur = inPort(cur.fromNode, "Render");
    }
    renderChains.push(chain);
    if (n.type === "Screen") {
      emit({ kind: "present", id: n.id, source: "screenTarget", origin: og(n) }, n);
    }
  }

  /** Mesh chain resolution for a MeshObject: primitive + modifier list. */
  const resolveMesh = (meshObjectId: string): { prim?: MeshPrimitive; modifiers: string[] } => {
    const modifiers: string[] = [];
    let conn = inPort(meshObjectId, "Mesh");
    while (conn) {
      const n = src.nodes.get(conn.fromNode);
      if (!n) break;
      if (MESH_PRIMS[n.type]) return { prim: { kind: MESH_PRIMS[n.type] } as MeshPrimitive, modifiers };
      modifiers.push(n.type);
      conn = inPort(n.id, "Mesh");
    }
    return { modifiers };
  };

  /** Object chain for RenderObject: find MeshObject + interposed nodes. */
  const resolveObject = (renderObjectId: string): { meshObject?: P9Node; interposed: string[] } => {
    const interposed: string[] = [];
    let conn = inPort(renderObjectId, "Object");
    while (conn) {
      const n = src.nodes.get(conn.fromNode);
      if (!n) break;
      if (n.type === "MeshObject") return { meshObject: n, interposed };
      interposed.push(n.type);
      conn = inPort(n.id, "Object");
    }
    return { interposed };
  };

  const shaderTextures = (shaderNode: P9Node): { textures: Record<string, TextureRef>; missing: string[] } => {
    const textures: Record<string, TextureRef> = {};
    const missing: string[] = [];
    for (const c of inTo.get(shaderNode.id) ?? []) {
      const m = /^Texture(\d)$/.exec(c.toPort);
      if (!m) continue;
      const res = resolveTexSource(c.fromNode);
      if (res.ref) textures[`gTexture${m[1]}`] = res.ref;
      if (res.chain.length) missing.push(...res.chain);
    }
    return { textures, missing };
  };

  /** Render-state ports carried verbatim from a Shader node (witnessed
   *  port set — raw strings; the executor maps them only with evidence). */
  const P9_STATE_PORTS = [
    "DepthTest", "DepthWrite", "SrcBlend", "SrcAlphaBlend",
    "DstBlend", "DstAlphaBlend", "CullMode",
  ];
  const shaderState = (shaderNode: P9Node): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const k of P9_STATE_PORTS) {
      const v = shaderNode.ports.get(k)?.value;
      if (v !== undefined) out[k] = v;
    }
    return out;
  };

  /* ---- per-node mapping ---- */
  for (const n of src.nodes.values()) {
    if (texRefs.has(n.id)) continue;          // pass 1
    if (n.type === "Screen") continue;        // emitted with chains
    switch (n.type) {
      case "Clear": {
        emit({
          kind: "clear", id: n.id,
          target: renderTargetOf.get(n.id) ?? "screenTarget", depth: true,
          origin: og(n),
        }, n);
        break;
      }
      case "RenderRect": {
        const eff = inPort(n.id, "Effect");
        const shaderNode = eff ? src.nodes.get(eff.fromNode) : undefined;
        if (!shaderNode || shaderNode.type !== "Shader") {
          emit(unsup(n, `Plane9:RenderRect(effect=${shaderNode?.type ?? "none"})`,
            "RenderRect without a Shader effect has no verified translation"), n);
          break;
        }
        const { textures, missing } = shaderTextures(shaderNode);
        if (missing.length) {
          emit(unsup(n, `Plane9:texture-chain(${[...new Set(missing)].join("+")})`,
            "texture chain contains processors without verified implementations"), n);
          break;
        }
        consumed.set(shaderNode.id, n.id);
        {
          const stages = parseP9ShaderStages(String(shaderNode.ports.get("Shader")?.value ?? ""));
          emit({
            kind: "draw-fullscreen", id: n.id,
            target: renderTargetOf.get(n.id) ?? "screenTarget",
            shader: {
              lang: "glsl-p9",
              vertex: stages.vertex, fragment: stages.fragment,
              ...(stages.interstage ? { interstage: stages.interstage } : {}),
            },
            textures, p9State: shaderState(shaderNode), origin: og(n),
          }, n);
        }
        break;
      }
      case "RenderObject": {
        const { meshObject, interposed } = resolveObject(n.id);
        if (!meshObject) {
          emit(unsup(n, `Plane9:RenderObject(object-chain=${interposed.join("+") || "none"})`,
            "object chain does not terminate in a MeshObject"), n);
          break;
        }
        if (interposed.length) {
          emit(unsup(n, `Plane9:object-chain(${[...new Set(interposed)].join("+")})`,
            "object-graph nodes (cloning/instancing) without verified implementations"), n);
          break;
        }
        const eff = inPort(meshObject.id, "Effect");
        const shaderNode = eff ? src.nodes.get(eff.fromNode) : undefined;
        if (!shaderNode || shaderNode.type !== "Shader") {
          emit(unsup(n, `Plane9:RenderObject(effect=${shaderNode?.type ?? "none"})`,
            "MeshObject without a Shader effect (fixed-function BasicEffect) has no verified translation"), n);
          break;
        }
        const { prim, modifiers } = resolveMesh(meshObject.id);
        if (!prim || modifiers.length) {
          emit(unsup(n, `Plane9:mesh-chain(${modifiers.join("+") || "unresolved"})`,
            "mesh chain contains modifiers without verified implementations"), n);
          break;
        }
        const { textures, missing } = shaderTextures(shaderNode);
        if (missing.length) {
          emit(unsup(n, `Plane9:texture-chain(${[...new Set(missing)].join("+")})`,
            "texture chain contains processors without verified implementations"), n);
          break;
        }
        consumed.set(shaderNode.id, n.id);
        consumed.set(meshObject.id, n.id);
        // primitive + clean chain: mark the primitive consumed too
        let mc = inPort(meshObject.id, "Mesh");
        while (mc) {
          consumed.set(mc.fromNode, n.id);
          mc = inPort(mc.fromNode, "Mesh");
        }
        {
          const stages = parseP9ShaderStages(String(shaderNode.ports.get("Shader")?.value ?? ""));
          const state = shaderState(shaderNode);
          emit({
            kind: "draw-mesh", id: n.id,
            target: renderTargetOf.get(n.id) ?? "screenTarget",
            mesh: prim,
            shader: {
              lang: "glsl-p9",
              vertex: stages.vertex, fragment: stages.fragment,
              ...(stages.interstage ? { interstage: stages.interstage } : {}),
            },
            textures,
            // Depth test comes from the witnessed Shader port; blend and
            // the rest stay verbatim in p9State (no hardcoded state).
            ...(state.DepthTest !== undefined ? { depthTest: state.DepthTest === "true" } : {}),
            p9State: state, origin: og(n),
          }, n);
        }
        break;
      }
      case "Shader": case "MeshObject": case "BasicEffect":
        break; // dispositioned in the final accounting pass
      default: {
        if (MESH_PRIMS[n.type] || ["TransformMesh", "TransformEx", "Transform", "Bevel",
          "CloneMesh", "CloneMeshExpression", "MeshInstancer", "CloneExpression", "Clone",
          "DelayedTransform"].includes(n.type)) {
          break; // dispositioned in the final accounting pass
        }
        if (n.type === "Beat" || n.type === "Spectrum" || n.type === "Waveform") {
          emit(unsup(n, `Plane9:${n.type}`,
            "Plane9-specific audio semantics (beat detection, spectrum/waveform scaling, port meanings) not yet evidenced — not a generic audio feature"), n);
          break;
        }
        if (CPU_EVIDENCED.has(n.type)) {
          if (n.type === "Vector") {
            emit({ kind: "p9-vector", id: n.id, params: portParams(n), origin: og(n) }, n);
          } else if (n.type === "HSLAToColor" || n.type === "HSVAToColor" || n.type === "RGBAToColor") {
            emit({
              kind: "p9-color", id: n.id,
              space: n.type === "HSLAToColor" ? "hsla" : n.type === "HSVAToColor" ? "hsva" : "rgba",
              params: portParams(n), origin: og(n),
            }, n);
          } else { // Expression
            emit({
              kind: "cpu-expr", id: n.id, dialect: "expreval",
              program: String(n.ports.get("Expression")?.value ?? ""),
              outputs: (outOf.get(n.id) ?? []).map((c) => c.fromPort),
              params: portParams(n), origin: og(n),
            }, n);
          }
        } else {
          emit(unsup(n, `Plane9:${n.type}`,
            "no verified engine implementation for this node type yet (ports in docs/plane9-node-census.json)"), n);
        }
      }
    }
  }

  /* ---- final accounting: every source node MUST have a disposition ---- */
  const dispositioned = new Set(dispositions.map((d) => d.p9Id));
  for (const n of src.nodes.values()) {
    if (dispositioned.has(n.id)) continue;
    const by = consumed.get(n.id);
    if (by) {
      dispositions.push({ p9Type: n.type, p9Id: n.id, disposition: "consumed-by", by });
    } else {
      // Structurally present but not lowered and not consumed by a
      // successful draw (e.g. a modifier in a chain that blocked its draw,
      // or a Shader whose render node was unsupported): explicit.
      dispositions.push({
        p9Type: n.type, p9Id: n.id, disposition: "unsupported",
        feature: `Plane9:${n.type}(orphaned-by-unsupported-consumer)`,
      });
    }
    dispositioned.add(n.id);
  }

  /* ---- CPU data edges ---- */
  const graphIds = new Set(nodes.map((x) => x.id));
  const STRUCTURAL_PORTS = /^(Render|Effect|Mesh|Object|Texture\d?|Color)$/;
  for (const c of src.connections) {
    if (STRUCTURAL_PORTS.test(c.toPort) && STRUCTURAL_PORTS.test(c.fromPort)) continue;
    if (graphIds.has(c.fromNode) && graphIds.has(c.toNode)) {
      data.push({ from: { node: c.fromNode, port: c.fromPort }, to: { node: c.toNode, port: c.toPort } });
    }
  }

  /* ---- order: CPU nodes topologically over data edges, then offscreen
   *      chains, then the screen chain ---- */
  const order: string[] = [];
  const cpuKinds = new Set(["cpu-expr", "audio", "p9-vector", "p9-color"]);
  const cpuIds = nodes.filter((nn) => cpuKinds.has(nn.kind)).map((nn) => nn.id);
  const cpuSet = new Set(cpuIds);
  const indeg = new Map(cpuIds.map((id) => [id, 0]));
  const succ = new Map<string, string[]>();
  for (const e of src.connections) {
    if (cpuSet.has(e.fromNode) && cpuSet.has(e.toNode)) {
      indeg.set(e.toNode, (indeg.get(e.toNode) ?? 0) + 1);
      (succ.get(e.fromNode) ?? succ.set(e.fromNode, []).get(e.fromNode)!).push(e.toNode);
    }
  }
  const queue = cpuIds.filter((id) => (indeg.get(id) ?? 0) === 0);
  const topo: string[] = [];
  while (queue.length) {
    const id = queue.shift() as string;
    topo.push(id);
    for (const s of succ.get(id) ?? []) {
      indeg.set(s, (indeg.get(s) ?? 1) - 1);
      if ((indeg.get(s) ?? 0) === 0) queue.push(s);
    }
  }
  // cycles (feedback loops through CPU nodes): append remaining in source order
  for (const id of cpuIds) if (!topo.includes(id)) topo.push(id);
  order.push(...topo);
  const chainsOffscreen = renderChains.filter((ch) => ch.some((id) => renderTargetOf.get(id) !== "screenTarget"));
  const chainsScreen = renderChains.filter((ch) => !chainsOffscreen.includes(ch));
  for (const ch of [...chainsOffscreen, ...chainsScreen]) {
    for (const id of ch) if (graphIds.has(id)) order.push(id);
  }
  // any executable node not in a chain (unsupported markers etc.)
  const ordered = new Set(order);
  for (const nn of nodes) {
    const executable = nn.kind !== "target" && nn.kind !== "texture" && nn.kind !== "audio";
    if (executable && !ordered.has(nn.id) && nn.kind !== "present") order.push(nn.id);
  }
  for (const nn of nodes) if (nn.kind === "present" && !ordered.has(nn.id)) order.push(nn.id);

  // Lossless source record: every node, every port with its RAW source
  // string, every connection, plus scene-level attributes and metadata.
  const sourceRecord = {
    format: "plane9" as const,
    sceneAttributes: { ...src.rootAttributes },
    sceneMeta: {
      Author: src.author, Desc: src.desc, Tags: src.tags,
      LicenseType: src.license, LicenseText: src.licenseText,
    },
    nodes: [...src.nodes.values()].map((n) => ({
      type: n.type, id: n.id,
      ports: [...n.ports.values()].map((p) => ({
        id: p.id,
        value: p.value === undefined ? null : p.value,
      })),
    })),
    connections: src.connections.map((c) => ({ ...c })),
  };

  const graph: GraphScene = {
    version: "graph-1",
    name: src.name.toUpperCase(),
    nodes, data, order,
    warmupSeconds: src.warmupTime,
    source: sourceRecord,
    credit: `Ported from Plane9 '${src.name}' by ${src.author}` + (src.desc ? ` (${src.desc})` : ""),
    license: src.license,
  };
  validateGraph(graph);
  const unsupportedCount = dispositions.filter((d) => d.disposition === "unsupported").length;
  const dispositionCleanImport =
    unsupportedCount === 0 && dispositions.length === src.nodes.size;
  return { graph, dispositions, dispositionCleanImport, unsupportedCount };
}

function og(n: P9Node) {
  return { format: "plane9" as const, type: n.type, id: n.id };
}
function unsup(n: P9Node, feature: string, reason: string): GraphNode {
  return { kind: "unsupported", id: n.id, feature, reason, origin: og(n) };
}
function portParams(n: P9Node): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, p] of n.ports) {
    const v = typeof p.value === "number" ? p.value : parseFloat(String(p.value));
    if (Number.isFinite(v)) out[id] = v;
  }
  return out;
}
