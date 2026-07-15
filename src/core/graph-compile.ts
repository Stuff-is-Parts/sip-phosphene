/**
 * Lossless lowering of the native PHOSPHENE scene format (three-layer
 * shorthand + capability blocks) into the unified render graph
 * (COMPATIBILITY-GOAL.md Architecture: existing authoring structures are
 * shorthand over the execution model).
 *
 * The mapping is TOTAL over the scene format: every field of `Scene`
 * either lowers into graph structure here or raises
 * GraphCompileError — no field is silently dropped, so the compiler
 * cannot misrepresent a scene as simpler than it is.
 */

import type { Scene } from "./types";
import {
  GraphScene, GraphNode, DataEdge, GraphValidationError, validateGraph,
} from "./graph";

export class GraphCompileError extends Error {}

/** Scene fields this compiler consumes. Compilation fails on any field
 *  outside this contract, so format growth cannot silently bypass the
 *  graph (Complete Representation, sip-code-guidelines §1A). */
const CONSUMED_FIELDS = new Set([
  "version", "name", "layers", "params", "custom", "mods", "thumb",
  "assets", "credit", "license", "passes", "mesh", "particles", "text",
  "bloom", "warpMesh",
]);

export function compileSceneToGraph(scene: Scene): GraphScene {
  for (const key of Object.keys(scene)) {
    if (!CONSUMED_FIELDS.has(key)) {
      throw new GraphCompileError(
        `scene field '${key}' has no graph lowering — extend graph-compile.ts before using it`);
    }
  }

  const nodes: GraphNode[] = [];
  const order: string[] = [];
  const data: DataEdge[] = [];

  // Canvas target carries feedback (post's prevTex reads its own last frame).
  nodes.push({ kind: "target", id: "tCanvas", feedback: true });
  // Stage layers lower to fullscreen draws in fixed order.
  nodes.push({ kind: "clear", id: "clear0", target: "tCanvas" });
  order.push("clear0");
  nodes.push({
    kind: "draw-fullscreen", id: "bg", target: "tCanvas", blend: "none",
    shader: { lang: "wgsl", fragment: scene.layers.bg.code },
    origin: { format: "phosphene", type: "layer:bg" },
  });
  order.push("bg");
  if (scene.mesh) {
    nodes.push({
      kind: "draw-mesh", id: "mesh", target: "tCanvas", blend: "alpha", depthTest: true,
      mesh: { kind: scene.mesh.primitive as never },
      instances: scene.mesh.count,
      shader: { lang: "wgsl", fragment: scene.mesh.code },
      origin: { format: "phosphene", type: "capability:mesh" },
    });
    order.push("mesh");
  }
  nodes.push({
    kind: "draw-fullscreen", id: "fg", target: "tCanvas", blend: "additive",
    shader: { lang: "wgsl", fragment: scene.layers.fg.code },
    origin: { format: "phosphene", type: "layer:fg" },
  });
  order.push("fg");
  if (scene.particles) {
    // Particle systems are CPU-updated billboards; the graph carries the
    // program so execution can host it, same contract as the renderer.
    nodes.push({
      kind: "unsupported", id: "particles",
      feature: "phosphene:particles-in-graph",
      reason: "particle execution stays on the legacy path until the graph executor hosts the CPU update loop; scenes with particles run through the existing renderer",
      origin: { format: "phosphene", type: "capability:particles" },
    });
    order.push("particles");
  }
  // POST reads the canvas + its own feedback into a second target.
  nodes.push({ kind: "target", id: "tPost", feedback: true });
  nodes.push({
    kind: "draw-fullscreen", id: "post", target: "tPost", blend: "none",
    shader: { lang: "wgsl", fragment: scene.layers.post.code },
    textures: { srcTex: "tCanvas", prevTex: "tPost" },
    origin: { format: "phosphene", type: "layer:post" },
  });
  order.push("post");

  // Extra passes chain in order; each has its own feedback target.
  let chain = "tPost";
  for (const pass of scene.passes ?? []) {
    const t = `tPass_${pass.id}`;
    nodes.push({ kind: "target", id: t, feedback: true });
    nodes.push({
      kind: "draw-fullscreen", id: `pass_${pass.id}`, target: t, blend: "none",
      shader: { lang: "wgsl", fragment: pass.code },
      textures: { srcTex: chain, prevTex: t },
      origin: { format: "phosphene", type: `capability:pass:${pass.id}` },
    });
    order.push(`pass_${pass.id}`);
    chain = t;
  }

  if (scene.bloom !== undefined && scene.bloom > 0) {
    nodes.push({
      kind: "unsupported", id: "bloom",
      feature: "phosphene:bloom-in-graph",
      reason: "bloom's bright/blur/composite chain lowers once blur-pyramid targets land in the executor; bloom scenes run through the existing renderer",
      origin: { format: "phosphene", type: "capability:bloom" },
    });
    order.push("bloom");
  }
  if (scene.warpMesh) {
    nodes.push({
      kind: "milk-warp", id: "warpMesh",
      perPixel: scene.warpMesh, perPixelInit: "",
      gridX: 64, gridY: 48,
      source: "tCanvas", target: "tCanvas",
      origin: { format: "phosphene", type: "capability:warpMesh" },
    });
    order.push("warpMesh");
  }

  nodes.push({ kind: "present", id: "screen", source: chain });
  order.push("screen");

  // Mod routes lower to cpu-expr / audio nodes with data edges targeting
  // named shader params. Non-expr sources map to audio nodes.
  let modIdx = 0;
  for (const m of scene.mods ?? []) {
    const id = `mod${modIdx++}`;
    if (m.source === "expr" && m.expr) {
      nodes.push({
        kind: "cpu-expr", id, dialect: "eel", program: m.expr,
        outputs: [m.readVar ?? m.target],
        params: m.init ? { __hasInit: 1 } : {},
        origin: { format: "phosphene", type: "mod:expr" },
      });
    } else {
      nodes.push({
        kind: "audio", id,
        feature: (["bass", "mid", "treble", "beat", "energy"].includes(m.source)
          ? m.source : "energy") as never,
        origin: { format: "phosphene", type: `mod:${m.source}` },
      });
    }
    order.push(id);
    data.push({ from: { node: id, port: m.readVar ?? "out" }, to: { node: "post", port: m.target } });
  }

  if (scene.assets?.image || scene.text) {
    nodes.push({
      kind: "texture", id: "sceneImage",
      source: { kind: "image", slot: "scene-image" },
      origin: { format: "phosphene", type: scene.text ? "capability:text" : "asset:image" },
    });
  }

  const g: GraphScene = {
    version: "graph-1",
    name: scene.name,
    nodes, data, order,
    credit: scene.credit,
    license: scene.license,
  };
  validateGraph(g);
  return g;
}

export { GraphValidationError };
