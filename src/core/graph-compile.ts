/**
 * Lossless lowering of the native PHOSPHENE scene format into the unified
 * render graph (COMPATIBILITY-GOAL.md Architecture: the three-layer format
 * is authoring shorthand over the execution model).
 *
 * Behavioral completeness contract: every `Scene` field lowers into graph
 * structure that the graph executor can run with the SAME behavior as the
 * legacy renderer — base params and custom values verbatim, every
 * modulation route verbatim (target, source, gain, base, init, namespace,
 * readVar — NO source conversion), particles, bloom, text/image assets,
 * warp-mesh in its true position (CPU offsets consumed by the post
 * stage), passes with per-pass feedback, mesh, blending, presentation.
 * Unknown fields raise GraphCompileError so format growth cannot bypass
 * the graph silently (Complete Representation, sip-code-guidelines §1A).
 * Equivalence is proven by scripts/equivalence-native.mjs, which renders
 * shipped scenes through both paths under identical inputs.
 */

import type { Scene } from "./types";
import {
  GraphScene, GraphNode, DataEdge, GraphValidationError, validateGraph,
} from "./graph";

export class GraphCompileError extends Error {}

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

  // Assets first (bindable resources).
  if (scene.assets?.image) {
    nodes.push({
      kind: "texture", id: "sceneImage",
      source: { kind: "image", slot: "scene-image" },
      origin: { format: "phosphene", type: "asset:image" },
    });
  }
  if (scene.text) {
    nodes.push({
      kind: "texture", id: "sceneText",
      source: { kind: "text", value: scene.text.value, ...(scene.text.size !== undefined ? { size: scene.text.size } : {}) },
      origin: { format: "phosphene", type: "capability:text" },
    });
  }

  // Modulation routes: verbatim, ordered before all draws (they compute
  // this frame's parameter values). No source conversion of any kind.
  (scene.mods ?? []).forEach((m, i) => {
    const id = `mod${i}`;
    nodes.push({
      kind: "mod-route", id,
      route: {
        target: m.target, source: m.source, gain: m.gain, base: m.base,
        ...(m.expr !== undefined ? { expr: m.expr } : {}),
        ...(m.readVar !== undefined ? { readVar: m.readVar } : {}),
        ...(m.init !== undefined ? { init: m.init } : {}),
        ...(m.ns !== undefined ? { ns: m.ns } : {}),
      },
      origin: { format: "phosphene", type: `mod:${m.source}` },
    });
    order.push(id);
  });

  // Warp-mesh offsets: CPU program evaluated per frame; its output is
  // sampled by the POST stage via meshOff(uv) — ordered before post.
  if (scene.warpMesh) {
    nodes.push({
      kind: "warp-mesh", id: "warpMesh", program: scene.warpMesh,
      origin: { format: "phosphene", type: "capability:warpMesh" },
    });
    order.push("warpMesh");
  }

  // Canvas: bg -> mesh -> fg compose here; post reads it with feedback.
  nodes.push({ kind: "target", id: "tCanvas", feedback: true });
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
    nodes.push({
      kind: "particles", id: "particles", target: "tCanvas",
      count: scene.particles.count, program: scene.particles.code,
      origin: { format: "phosphene", type: "capability:particles" },
    });
    order.push("particles");
  }

  nodes.push({ kind: "target", id: "tPost", feedback: true });
  nodes.push({
    kind: "draw-fullscreen", id: "post", target: "tPost", blend: "none",
    shader: { lang: "wgsl", fragment: scene.layers.post.code },
    textures: { srcTex: "tCanvas", prevTex: "tPost" },
    origin: { format: "phosphene", type: "layer:post" },
  });
  order.push("post");

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
      kind: "bloom", id: "bloom", strength: scene.bloom, target: chain,
      origin: { format: "phosphene", type: "capability:bloom" },
    });
    order.push("bloom");
  }

  nodes.push({ kind: "present", id: "screen", source: chain });
  order.push("screen");

  const g: GraphScene = {
    version: "graph-1",
    name: scene.name,
    nodes, data, order,
    params: { ...scene.params },
    custom: { ...scene.custom },
    imageAsset: scene.assets?.image ?? null,
    credit: scene.credit,
    license: scene.license,
  };
  validateGraph(g);
  return g;
}

export { GraphValidationError };
