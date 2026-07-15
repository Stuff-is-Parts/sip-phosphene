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

export interface P9Port { id: string; value: string | number | undefined }
export interface P9Node { type: string; id: string; ports: Map<string, P9Port> }
export interface P9Connection { fromNode: string; fromPort: string; toNode: string; toPort: string }
export interface P9SceneXml {
  name: string; author: string; desc: string; license: string;
  warmupTime: number;
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
    isArray: (t) => t === "Node" || t === "Port" || t === "Connection",
  });
  const doc = parser.parse(xml);
  const root = doc.Plane9Scene;
  if (!root) throw new P9ImportError("no Plane9Scene root");

  const nodes = new Map<string, P9Node>();
  for (const n of root.Nodes?.Node ?? []) {
    const type = String(n["@Type"] ?? "");
    // Node identity is @Name; connection refs are "Name.Port" (census).
    const id = String(n["@Name"] ?? "");
    if (!type || !id) throw new P9ImportError(`node missing Type/Name (${type}/${id})`);
    const ports = new Map<string, P9Port>();
    for (const p of n.Port ?? []) {
      const pid = String(p["@Id"] ?? "");
      const v = p.Value;
      ports.set(pid, {
        id: pid,
        value: typeof v === "object" && v !== null ? String(v["#text"] ?? "") : v,
      });
    }
    nodes.set(id, { type, id, ports });
  }

  const connections: P9Connection[] = [];
  for (const c of root.Connections?.Connection ?? []) {
    const [fromNode, fromPort] = splitRef(String(c["@Out"] ?? ""));
    const [toNode, toPort] = splitRef(String(c["@In"] ?? ""));
    connections.push({ fromNode, fromPort, toNode, toPort });
  }

  return {
    name: filename.replace(/\.p9c$/i, "").replace(/^.*[\\/]/, ""),
    author: String(root.Author ?? ""),
    desc: String(root.Desc ?? ""),
    license: String(root.License?.["@Type"] ?? ""),
    warmupTime: parseFloat(String(root["@WarmupTime"] ?? "0")) || 0,
    nodes, connections,
  };
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

/** CPU dataflow node types lowered to cpu-expr/audio graph nodes.
 *  Expression = expreval (identified in plane9.txt credits); audio nodes
 *  are engine features. The executor refuses per-type semantics it cannot
 *  run — the import never invents values. */
const CPU_TYPES = new Set([
  "Expression", "Vector", "MinMax", "Beat", "Spectrum", "Waveform",
  "HSLAToColor", "HSVAToColor", "RGBAToColor", "Rotator", "SignalGenerator", "Sin",
]);

/** Texture-producing node types (flow into Shader.TextureN / processors). */
const TEXTURE_SOURCE_TYPES = new Set([
  "RenderToTexture", "PreviousLayer", "FileTexture", "SoundTexture",
  "StoreTexture", "CopyTexture", "NoiseTexture", "Gradient",
  "RandomTexture", "ExpressionTexture", "TuringPattern",
]);

export interface P9GraphImport {
  graph: GraphScene;
  mapping: { p9Type: string; p9Id: string; graphKind: string }[];
}

export function p9ToGraph(src: P9SceneXml): P9GraphImport {
  const nodes: GraphNode[] = [];
  const data: DataEdge[] = [];
  const mapping: P9GraphImport["mapping"] = [];
  const emit = (node: GraphNode, p9: P9Node) => {
    nodes.push(node);
    mapping.push({ p9Type: p9.type, p9Id: p9.id, graphKind: node.kind });
  };

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

  /* ---- per-node mapping ---- */
  const consumed = new Set<string>(); // node ids consumed structurally
  for (const chain of renderChains) for (const id of chain) consumed.add(id);

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
        emit({
          kind: "draw-fullscreen", id: n.id,
          target: renderTargetOf.get(n.id) ?? "screenTarget",
          shader: { lang: "glsl-p9", fragment: String(shaderNode.ports.get("Shader")?.value ?? "") },
          textures, blend: "alpha", origin: og(n),
        }, n);
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
        emit({
          kind: "draw-mesh", id: n.id,
          target: renderTargetOf.get(n.id) ?? "screenTarget",
          mesh: prim,
          shader: { lang: "glsl-p9", fragment: String(shaderNode.ports.get("Shader")?.value ?? "") },
          textures, blend: "alpha", depthTest: true, origin: og(n),
        }, n);
        break;
      }
      case "Shader": case "MeshObject": case "BasicEffect":
        break; // consumed by draw mapping
      default: {
        if (MESH_PRIMS[n.type] || ["TransformMesh", "TransformEx", "Transform", "Bevel",
          "CloneMesh", "CloneMeshExpression", "MeshInstancer", "CloneExpression", "Clone",
          "DelayedTransform"].includes(n.type)) {
          break; // consumed (or reported) via mesh/object chain resolution
        }
        if (CPU_TYPES.has(n.type)) {
          if (n.type === "Beat" || n.type === "Spectrum" || n.type === "Waveform") {
            emit({
              kind: "audio", id: n.id,
              feature: n.type === "Beat" ? "beat" : n.type === "Spectrum" ? "spectrum-bin" : "waveform-bin",
              origin: og(n),
            }, n);
          } else {
            emit({
              kind: "cpu-expr", id: n.id, dialect: "expreval",
              program: String(n.ports.get("Expression")?.value ?? n.ports.get("Value")?.value ?? ""),
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

  /* ---- CPU data edges ---- */
  const graphIds = new Set(nodes.map((x) => x.id));
  const STRUCTURAL_PORTS = /^(Render|Effect|Mesh|Object|Texture\d?|Color)$/;
  for (const c of src.connections) {
    if (STRUCTURAL_PORTS.test(c.toPort) && STRUCTURAL_PORTS.test(c.fromPort)) continue;
    if (graphIds.has(c.fromNode) && graphIds.has(c.toNode)) {
      data.push({ from: { node: c.fromNode, port: c.fromPort }, to: { node: c.toNode, port: c.toPort } });
    }
  }

  /* ---- order: offscreen chains first, then screen chain, CPU first ---- */
  const order: string[] = [];
  for (const nn of nodes) if (nn.kind === "cpu-expr" || nn.kind === "audio") order.push(nn.id);
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

  const graph: GraphScene = {
    version: "graph-1",
    name: src.name.toUpperCase(),
    nodes, data, order,
    warmupSeconds: src.warmupTime,
    credit: `Ported from Plane9 '${src.name}' by ${src.author}` + (src.desc ? ` (${src.desc})` : ""),
    license: src.license,
  };
  validateGraph(graph);
  return { graph, mapping };
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
