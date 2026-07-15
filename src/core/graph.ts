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

import type { ModRoute } from "./types";

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
  /** Inter-stage struct declaration (Plane9 `VERTEXOUTPUT { ... }` block,
   *  witnessed in scene.xml Shader ports: fields flow vertex `so.*` ->
   *  fragment `si.*`). */
  interstage?: string;
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

/** Render-state ports carried VERBATIM from a Plane9 Shader node
 *  (witnessed port set in scene.xml: DepthTest, DepthWrite, SrcBlend,
 *  SrcAlphaBlend, DstBlend, DstAlphaBlend, CullMode). Values are the
 *  source's raw strings — the executor maps them to pipeline state only
 *  where the enum meaning is evidenced, and refuses otherwise. */
export type P9RenderState = Record<string, string>;

/** Fullscreen (optionally tessellated) draw with a shader. */
export interface DrawFullscreenNode extends NodeBase {
  kind: "draw-fullscreen";
  shader: ShaderSource;
  /** Texture bindings by uniform name (e.g. gTexture1 -> ref). */
  textures?: Record<string, TextureRef>;
  target: TextureRef | "screen";
  blend?: "none" | "alpha" | "additive";
  /** Source-verbatim render state (imported draws); absent for native. */
  p9State?: P9RenderState;
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
  /** Source-verbatim render state (imported draws); absent for native. */
  p9State?: P9RenderState;
}

/** CPU expression program (expreval for Plane9, EEL for MilkDrop). */
export interface CpuExprNode extends NodeBase {
  kind: "cpu-expr";
  dialect: "expreval" | "eel";
  program: string;
  /** Named outputs read from the program environment after evaluation. */
  outputs: string[];
}

/** A native PHOSPHENE modulation route, carried VERBATIM — target param,
 *  source, gain, base, expr/init/readVar/ns — with no source conversion.
 *  The executor implements each ModSource exactly as the legacy engine
 *  does (src/core/mods.ts sourceValue) or refuses the scene. */
export interface ModRouteNode extends NodeBase {
  kind: "mod-route";
  route: ModRoute;
}

/** Native CPU particle system (count + per-particle EEL update program). */
export interface ParticlesNode extends NodeBase {
  kind: "particles";
  count: number;
  program: string;
  target: TextureRef;
}

/** Built-in bloom chain (bright/blur/composite) at strength 0..1.
 *  Reads `source` and produces its own output texture, readable by other
 *  nodes under this node's id. Bloom output stays OUT of any feedback
 *  loop: the legacy renderer composites bloom after the pass ping-pong
 *  swap, so feedback reads always see pre-bloom content (renderer.ts
 *  renderSlot). */
export interface BloomNode extends NodeBase {
  kind: "bloom";
  strength: number;
  source: TextureRef;
}

/** Native warp-mesh offsets: CPU-evaluated per-vertex program whose output
 *  the post stage samples via meshOff(uv). Ordered before the consuming
 *  draw; carries the program verbatim. */
export interface WarpMeshNode extends NodeBase {
  kind: "warp-mesh";
  program: string;
}

/** Plane9 Vector node: combines scalar inputs X/Y/Z into a vec3
 *  (port structure witnessed in docs/plane9-node-census.json; function
 *  documented at plane9.com/wiki/nodes: "Combines a x, y and z component
 *  to a 3d vector"). */
export interface P9VectorNode extends NodeBase {
  kind: "p9-vector";
}

/** Plane9 color-space conversion nodes (HSLAToColor / HSVAToColor /
 *  RGBAToColor — names + ports witnessed in the census; conversions are
 *  the standard CSS/graphics HSLA/HSVA/RGBA formulas). */
export interface P9ColorNode extends NodeBase {
  kind: "p9-color";
  space: "hsla" | "hsva" | "rgba";
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
    | { kind: "sound"; mode: "spectrum" | "waveform" }
    | { kind: "text"; value: string; size?: number };
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

/** Blur cascade update after warp (semantics doc §12). Butterchurn's
 *  Renderer holds three `BlurShader` instances (blur.js), each of
 *  which owns TWO render targets: a horizontal-pass intermediate and
 *  a vertical-pass output. The shader-visible `sampler_blur1/2/3`
 *  textures are the THREE VERTICAL OUTPUTS. So the cascade needs six
 *  textures total (three H intermediates, three V outputs).
 *
 *  This node names:
 *
 *  - `source`: the input the cascade samples for level 1 (canvas
 *    post-warp).
 *  - `levels`: the highest `GetBlurN` referenced by the preset shaders
 *    (0 = unused; N fires N BlurShader cascades levels 1..N).
 *  - `blurHTargets` / `blurVTargets`: the six-target set. Level N reads
 *    from `blurVTargets[N-1]` (or `source` at level 1), writes its H
 *    pass into `blurHTargets[N]`, then its V pass into
 *    `blurVTargets[N]`. Only `blurVTargets` are shader-visible.
 *
 *  Per-pair resolution ratios per rendering_renderer.js:102
 *  `blurRatios`:
 *    Level 1 pair: (H target 0.5x, V target 0.25x of main resolution).
 *    Level 2 pair: (H target 0.125x, V target 0.125x).
 *    Level 3 pair: (H target 0.0625x, V target 0.0625x).
 *
 *  Butterchurn's blur.js:3132-3139 rounds the actual pixel sizes:
 *    sizeX = max(mainW * ratio, 16); sizeX = floor((sizeX + 3) / 16) * 16
 *    sizeY = max(mainH * ratio, 16); sizeY = floor((sizeY + 3) / 4) * 4
 *  Any executor must reproduce this rounding rule for its allocated
 *  textures so per-level texel offsets match the source's blur math.
 *
 *  Scale/bias unpack per src/gpu/milk-blur.ts `getScaleAndBias` from
 *  the getBlurValues-clamped ranges (src/gpu/milk-pipeline.ts
 *  `getBlurValues`). The shader header
 *  (docs/evidence/projectm/PresetShaderHeaderGlsl330.inc lines 149-151)
 *  decompresses on read via `_c5.xy` / `_c5.zw` / `_c6.xy`. */
export interface MilkBlurNode extends NodeBase {
  kind: "milk-blur";
  levels: 0 | 1 | 2 | 3;
  source: TextureRef;
  /** H-pass intermediates per level (blurHTargets[0] = level 1's H
   *  intermediate, etc.). Written and immediately read within the
   *  cascade update; not shader-visible. */
  blurHTargets?: readonly [TextureRef?, TextureRef?, TextureRef?];
  /** V-pass outputs per level. `blurVTargets[N-1]` is the texture the
   *  warp/comp shader sees as `sampler_blurN`. */
  blurVTargets?: readonly [TextureRef?, TextureRef?, TextureRef?];
}

/** Outer+inner borders drawn onto the canvas (semantics doc §9). */
export interface MilkBorderNode extends NodeBase {
  kind: "milk-border";
  target: TextureRef;
}

export interface MilkWarpNode extends NodeBase {
  kind: "milk-warp";
  /** Per-pixel (per-vertex) program; frame env comes from the
   *  MilkPresetRunner's post-per-frame mdVSFrame (src/core/milk-runner.ts). */
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
  | ModRouteNode | ParticlesNode | BloomNode | WarpMeshNode
  | P9VectorNode | P9ColorNode
  | UnsupportedNode
  | MilkFrameNode | MilkMotionVectorsNode | MilkBlurNode | MilkBorderNode
  | MilkWarpNode | MilkWaveNode | MilkShapeNode | MilkCompositeNode;

/* ------------------------------- scene -------------------------------- */

/** Complete preserved source structure: every source node with every port
 *  and its RAW source-text value (no numeric coercion — the original
 *  string is the typed value's lossless form), every connection, the
 *  scene-level attributes/metadata elements, and the complete original
 *  source-file text (Plane9 scene.xml). Consumers may re-derive any
 *  interpretation from the raw text if a future capability needs a
 *  field the interpreter dropped (COMPATIBILITY-GOAL.md: no source
 *  behavior may be silently lost). */
export interface SourceRecord {
  format: "plane9" | "milkdrop";
  /** Root-element attributes verbatim (Plane9: FormatVersion, Id,
   *  ParentId, WarmupTime, SceneType, Version, DevelopmentTime, Created,
   *  LastModified — witnessed across the corpus). */
  sceneAttributes?: Record<string, string>;
  /** Root metadata elements verbatim (Plane9: Author, Desc, Tags,
   *  License text + Type attribute). */
  sceneMeta?: Record<string, string>;
  /** Complete unparsed source-file text as decoded from the container.
   *  Present when the source format is text-based (Plane9 scene.xml).
   *  MilkDrop uses `nodes` since its file has no XML tree. */
  rawSource?: string;
  nodes: {
    type: string; id: string;
    /** Every attribute on the source node verbatim (Plane9: Type/Name;
     *  admits any future attribute without a schema change). */
    attributes?: Record<string, string>;
    ports: {
      id: string; value: string | null;
      /** Every attribute on the source port verbatim (Plane9: Id/Value;
       *  admits any future attribute without a schema change). */
      attributes?: Record<string, string>;
    }[];
  }[];
  connections: {
    fromNode: string; fromPort: string; toNode: string; toPort: string;
    /** Every attribute on the source connection verbatim. */
    attributes?: Record<string, string>;
  }[];
}

export interface GraphScene {
  version: "graph-1";
  name: string;
  nodes: GraphNode[];
  /** CPU dataflow edges (parameter animation). */
  data: DataEdge[];
  /** Node execution order (explicit; importers derive it from the source). */
  order: string[];
  /** Base render parameters (hue/speed/int/fb), carried verbatim. */
  params?: Record<string, number>;
  /** //@param custom values by name, carried verbatim. */
  custom?: Record<string, number>;
  /** Embedded image asset (data URL), carried verbatim. */
  imageAsset?: string | null;
  /** Seconds to pre-run before first display (Plane9 WarmupTime). */
  warmupSeconds?: number;
  /** Lossless source-structure record for imported scenes. */
  source?: SourceRecord;
  /* --- non-execution metadata (carried verbatim; no pixel effect) --- */
  /** JPEG data-URL thumbnail from the native scene file. */
  thumb?: string | null;
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
      case "particles": targetRef(n.target, n.id); break;
      case "bloom": targetRef(n.source, n.id); break;
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
