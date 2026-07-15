/**
 * PHOSPHENE unified execution model: a typed render graph capable of
 * representing native PHOSPHENE scenes, Plane9 node graphs, and MilkDrop's
 * preset pipeline without approximation (COMPATIBILITY-GOAL.md,
 * Architecture). The existing three-layer scene format remains authoring
 * shorthand; `graph-compile.ts` lowers it into this model losslessly.
 *
 * Design rules (COMPATIBILITY-GOAL.md Hard Rules):
 * - No fallback semantics: consumers of this model throw
 *   `UnsupportedNodeError` / `GraphValidationError` instead of substituting
 *   behavior. An importer emits `unsupported` nodes rather than dropping or
 *   approximating source features; execution refuses scenes containing them.
 * - Every node kind is either executable by the engine or explicitly
 *   unsupported — there is no silent third state.
 */

/** A value flowing through CPU-side ports each frame. */
export type PortValue = number | [number, number, number] | [number, number, number, number];

export type PortRef = { node: string; port: string };

/** CPU-side data edge: out-port of one node feeds in-port of another. */
export interface DataEdge { from: PortRef; to: PortRef }

/** GPU resource reference: a render target or texture node id. */
export type TextureRef = string;

export interface ShaderSource {
  /** Source language of `vertex`/`fragment` as imported. */
  lang: "wgsl" | "glsl-p9" | "hlsl-md";
  vertex?: string;
  fragment: string;
}

export type MeshPrimitive =
  | { kind: "fullscreen-rect"; tessellateW?: number; tessellateH?: number }
  | { kind: "cube" } | { kind: "sphere"; segments?: number }
  | { kind: "plane"; segmentsW?: number; segmentsH?: number }
  | { kind: "torus" } | { kind: "cone" } | { kind: "cylinder" } | { kind: "disc" };

/* ------------------------------- nodes -------------------------------- */

export interface NodeBase {
  id: string;
  /** Original importer-side identity (e.g. Plane9 node type + id). */
  origin?: { format: "phosphene" | "plane9" | "milkdrop"; type: string; id?: string };
  /** Static port values (overridden per frame by DataEdges). */
  params?: Record<string, PortValue>;
}

/** Offscreen render target. `feedback: true` keeps last frame readable. */
export interface TargetNode extends NodeBase {
  kind: "target";
  scale?: number;          // relative to output size (1 = full)
  width?: number; height?: number; // absolute, overrides scale
  format?: "rgba8" | "rgba16f";
  feedback?: boolean;
}

/** Clear a target to a color. */
export interface ClearNode extends NodeBase {
  kind: "clear";
  target: TextureRef | "screen";
  color?: [number, number, number, number];
  depth?: boolean;
}

/** Fullscreen (optionally tessellated) draw with a shader. */
export interface DrawFullscreenNode extends NodeBase {
  kind: "draw-fullscreen";
  shader: ShaderSource;
  /** Texture bindings by uniform name (e.g. gTexture1 -> ref). */
  textures?: Record<string, TextureRef>;
  target: TextureRef | "screen";
  blend?: "none" | "alpha" | "additive";
  tessellateW?: number; tessellateH?: number;
}

/** Mesh draw with vertex+fragment shader and transform inputs. */
export interface DrawMeshNode extends NodeBase {
  kind: "draw-mesh";
  mesh: MeshPrimitive;
  instances?: number;
  shader: ShaderSource;
  textures?: Record<string, TextureRef>;
  target: TextureRef | "screen";
  blend?: "none" | "alpha" | "additive";
  depthTest?: boolean;
}

/** CPU expression program (expreval for Plane9, EEL for MilkDrop). */
export interface CpuExprNode extends NodeBase {
  kind: "cpu-expr";
  dialect: "expreval" | "eel";
  program: string;
  /** Named outputs read from the program environment after evaluation. */
  outputs: string[];
}

/** Audio feature source (evaluated per frame on CPU). */
export interface AudioNode extends NodeBase {
  kind: "audio";
  feature: "bass" | "mid" | "treble" | "beat" | "energy" | "spectrum-bin" | "waveform-bin";
  bin?: number;
}

/** Static or engine-provided texture. */
export interface TextureNode extends NodeBase {
  kind: "texture";
  source:
    | { kind: "image"; slot: "scene-image" }
    | { kind: "previous-frame"; of: TextureRef }
    | { kind: "sound"; mode: "spectrum" | "waveform" };
}

/** Copy/blit one texture into another. */
export interface CopyNode extends NodeBase {
  kind: "copy";
  from: TextureRef;
  target: TextureRef;
}

/** Present a texture to the screen (Plane9's Screen node). */
export interface PresentNode extends NodeBase {
  kind: "present";
  source: TextureRef;
}

/**
 * A source feature the importer preserved structurally but the engine has
 * no verified implementation for. Execution refuses the scene, naming the
 * feature; nothing is approximated (COMPATIBILITY-GOAL.md Hard Rules).
 */
export interface UnsupportedNode extends NodeBase {
  kind: "unsupported";
  /** Source node type (e.g. "Plane9:Fluid2d", "MilkDrop:motion-vectors"). */
  feature: string;
  /** What evidence exists / is missing, for the fidelity report. */
  reason: string;
}

/* --- MilkDrop fixed-pipeline nodes (semantics per
 *     docs/milkdrop-execution-model.md; each carries the preset data the
 *     stage needs; the executor implements them from that document or
 *     refuses) --- */

/** The preset's single per-frame evaluation: init once, per-frame each
 *  frame, q1..q32 reset to the init snapshot every frame
 *  (docs/milkdrop-execution-model.md §2). All stage nodes read the
 *  resulting variable environment. baseValues carries EVERY numeric value
 *  from the preset file verbatim — no selection. */
export interface MilkFrameNode extends NodeBase {
  kind: "milk-frame";
  initCode: string;
  perFrame: string;
  baseValues: Record<string, number>;
}

/** Motion vector grid drawn onto the previous frame before warp
 *  (pipeline stage 2; semantics doc §8). Values (mv_*) come from the
 *  frame env. */
export interface MilkMotionVectorsNode extends NodeBase {
  kind: "milk-motion-vectors";
  target: TextureRef;
}

/** Blur cascade update after warp (semantics doc §12); levels = highest
 *  GetBlurN referenced by the preset's shaders (0 = unused). */
export interface MilkBlurNode extends NodeBase {
  kind: "milk-blur";
  levels: 0 | 1 | 2 | 3;
  source: TextureRef;
}

/** Outer+inner borders drawn onto the canvas (semantics doc §9). */
export interface MilkBorderNode extends NodeBase {
  kind: "milk-border";
  target: TextureRef;
}

export interface MilkWarpNode extends NodeBase {
  kind: "milk-warp";
  /** Per-pixel (per-vertex) program; frame env comes from milk-frame. */
  perPixel: string;
  perPixelInit: string;
  gridX: number; gridY: number;
  warpShader?: ShaderSource; // MilkDrop 2 warp shader if present
  source: TextureRef; target: TextureRef;
}

export interface MilkWaveNode extends NodeBase {
  kind: "milk-wave";
  custom: boolean;
  index?: number;               // custom wave index
  initCode?: string;
  perFrame?: string;
  /** Per-point equation program (custom waves; semantics doc §6). */
  perPoint?: string;
  baseValues: Record<string, number>;
  target: TextureRef;
}

export interface MilkShapeNode extends NodeBase {
  kind: "milk-shape";
  index: number;
  initCode?: string; perFrame?: string;
  baseValues: Record<string, number>;
  canvas: TextureRef;           // for textured shapes
  target: TextureRef;
}

export interface MilkCompositeNode extends NodeBase {
  kind: "milk-composite";
  compShader?: ShaderSource;    // MilkDrop 2 comp shader
  /** Legacy path values (echo/gamma/filters) when no comp shader. */
  legacy?: { echoZoom: number; echoAlpha: number; echoOrient: number;
             gammaAdj: number; brighten: boolean; darken: boolean;
             solarize: boolean; invert: boolean };
  source: TextureRef;
  target: TextureRef | "screen";
}

export type GraphNode =
  | TargetNode | ClearNode | DrawFullscreenNode | DrawMeshNode
  | CpuExprNode | AudioNode | TextureNode | CopyNode | PresentNode
  | UnsupportedNode
  | MilkFrameNode | MilkMotionVectorsNode | MilkBlurNode | MilkBorderNode
  | MilkWarpNode | MilkWaveNode | MilkShapeNode | MilkCompositeNode;

/* ------------------------------- scene -------------------------------- */

export interface GraphScene {
  version: "graph-1";
  name: string;
  nodes: GraphNode[];
  /** CPU dataflow edges (parameter animation). */
  data: DataEdge[];
  /** Node execution order (explicit; importers derive it from the source). */
  order: string[];
  /** Seconds to pre-run before first display (Plane9 WarmupTime). */
  warmupSeconds?: number;
  credit?: string;
  license?: string;
}

/* ----------------------------- validation ----------------------------- */

export class GraphValidationError extends Error {}
export class UnsupportedNodeError extends Error {
  constructor(public readonly features: { feature: string; reason: string }[]) {
    super("scene requires unsupported features: " +
      features.map((f) => f.feature).join(", "));
  }
}

/** Structural validation: ids unique, refs resolve, order covers nodes. */
export function validateGraph(g: GraphScene): void {
  const ids = new Set<string>();
  for (const n of g.nodes) {
    if (ids.has(n.id)) throw new GraphValidationError(`duplicate node id '${n.id}'`);
    ids.add(n.id);
  }
  const targetRef = (ref: TextureRef | "screen", at: string) => {
    if (ref === "screen") return;
    if (!ids.has(ref)) throw new GraphValidationError(`${at}: unresolved texture ref '${ref}'`);
  };
  for (const n of g.nodes) {
    switch (n.kind) {
      case "clear": targetRef(n.target, n.id); break;
      case "draw-fullscreen":
      case "draw-mesh":
        targetRef(n.target, n.id);
        for (const ref of Object.values(n.textures ?? {})) targetRef(ref, n.id);
        break;
      case "copy": targetRef(n.from, n.id); targetRef(n.target, n.id); break;
      case "present": targetRef(n.source, n.id); break;
      case "milk-warp": targetRef(n.source, n.id); targetRef(n.target, n.id); break;
      case "milk-wave":
      case "milk-shape":
      case "milk-border":
      case "milk-motion-vectors": targetRef(n.target, n.id); break;
      case "milk-blur": targetRef(n.source, n.id); break;
      case "milk-composite": targetRef(n.source, n.id); targetRef(n.target, n.id); break;
      default: break;
    }
  }
  for (const e of g.data) {
    if (!ids.has(e.from.node)) throw new GraphValidationError(`data edge from unknown node '${e.from.node}'`);
    if (!ids.has(e.to.node)) throw new GraphValidationError(`data edge to unknown node '${e.to.node}'`);
  }
  const orderSet = new Set(g.order);
  for (const id of g.order) {
    if (!ids.has(id)) throw new GraphValidationError(`order references unknown node '${id}'`);
  }
  for (const n of g.nodes) {
    const executable = n.kind !== "target" && n.kind !== "texture" && n.kind !== "audio";
    if (executable && !orderSet.has(n.id)) {
      throw new GraphValidationError(`executable node '${n.id}' (${n.kind}) missing from order`);
    }
  }
}

/** The unsupported features a graph carries (empty = fully executable data). */
export function unsupportedFeatures(g: GraphScene): { feature: string; reason: string }[] {
  return g.nodes
    .filter((n): n is UnsupportedNode => n.kind === "unsupported")
    .map((n) => ({ feature: n.feature, reason: n.reason }));
}

/** Throw unless every node in the graph is executable. */
export function assertExecutable(g: GraphScene): void {
  const u = unsupportedFeatures(g);
  if (u.length) throw new UnsupportedNodeError(u);
}
