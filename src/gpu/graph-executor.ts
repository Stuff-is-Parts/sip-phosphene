/**
 * Graph executor: runs a GraphScene through the WebGPU renderer.
 *
 * Execution contract (COMPATIBILITY-GOAL.md Hard Rules): a node kind is
 * either executed with evidenced behavior or the load REFUSES with
 * UnsupportedNodeError naming every unimplemented feature. There is no
 * approximation path.
 *
 * Native-shape graphs (produced by graph-compile.ts) execute by driving
 * the same renderer capabilities and the same modulation engine the
 * legacy path uses — parameter routing, expression programs, warp-mesh
 * evaluation, particles, bloom, passes, and feedback behave identically
 * by construction, and scripts/equivalence-native.mjs proves the pixels
 * match under identical inputs before the graph path replaces the legacy
 * path (assignment completion gate 1).
 *
 * Imported-format node kinds (milk-*, p9-vector/p9-color, glsl-p9 /
 * hlsl-md draw nodes, targets beyond the native chain) refuse until their
 * engine implementations land with reference validation.
 */

import type { Renderer } from "./renderer";
import { ModEngine } from "../core/mods";
import { meshWarpFor } from "../core/meshwarp";
import { particlesFor } from "../core/particles";
import { normalizeScene, STAGES, type AudioFeatures, type ModRoute, type Scene } from "../core/types";
import {
  GraphScene, UnsupportedNodeError, unsupportedFeatures, validateGraph,
} from "../core/graph";

export class UnsupportedGraphError extends Error {
  constructor(public readonly features: string[]) {
    super("graph requires unimplemented execution: " + features.join(", "));
  }
}

/** Node kinds the executor can run today (native shape). */
const EXECUTABLE_KINDS = new Set([
  "target", "clear", "draw-fullscreen", "draw-mesh", "texture", "present",
  "mod-route", "particles", "bloom", "warp-mesh",
]);

export class GraphExecutor {
  private scene: Scene | null = null;
  private mw: ReturnType<typeof meshWarpFor> = null;
  private ps: ReturnType<typeof particlesFor> = null;
  private readonly mods = new ModEngine();

  constructor(private readonly renderer: Renderer) {}

  /** Compile a graph for execution. Throws UnsupportedNodeError /
   *  UnsupportedGraphError when the graph carries features without an
   *  evidenced implementation. */
  async load(g: GraphScene): Promise<{ errors: string[] }> {
    validateGraph(g);
    const unsupported = unsupportedFeatures(g);
    if (unsupported.length) throw new UnsupportedNodeError(unsupported);
    const beyond = g.nodes.filter((n) => !EXECUTABLE_KINDS.has(n.kind));
    if (beyond.length) {
      throw new UnsupportedGraphError(beyond.map((n) => `${n.kind}(${n.id})`));
    }
    // WGSL-only for now: shader-language execution beyond wgsl requires
    // the importer pipelines' translation stages to land with validation.
    for (const n of g.nodes) {
      if ((n.kind === "draw-fullscreen" || n.kind === "draw-mesh") && n.shader.lang !== "wgsl") {
        throw new UnsupportedGraphError([`${n.kind}(${n.id}):lang=${n.shader.lang}`]);
      }
    }

    // Reconstruct the renderer-facing scene view from graph structure.
    // The graph is authoritative; this view is the renderer adapter.
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const draw = (id: string) => {
      const n = byId.get(id);
      return n && n.kind === "draw-fullscreen" ? n : null;
    };
    const bg = draw("bg"), fg = draw("fg"), post = draw("post");
    if (!bg || !fg || !post) {
      throw new UnsupportedGraphError(["non-native draw topology (no bg/fg/post chain)"]);
    }
    const meshNode = g.nodes.find((n) => n.kind === "draw-mesh");
    const particlesNode = g.nodes.find((n) => n.kind === "particles");
    const bloomNode = g.nodes.find((n) => n.kind === "bloom");
    const warpMeshNode = g.nodes.find((n) => n.kind === "warp-mesh");
    const textNode = g.nodes.find((n) => n.kind === "texture" && n.source.kind === "text");
    const passes = g.order
      .map((id) => byId.get(id))
      .filter((n) => n && n.kind === "draw-fullscreen" && /^pass_/.test(n.id))
      .map((n) => ({ id: n!.id.slice(5), code: (n as { shader: { fragment: string } }).shader.fragment }));
    const mods: ModRoute[] = g.nodes
      .filter((n) => n.kind === "mod-route")
      .map((n) => (n as { route: ModRoute }).route);

    this.scene = normalizeScene({
      name: g.name,
      layers: {
        bg: { code: bg.shader.fragment },
        fg: { code: fg.shader.fragment },
        post: { code: post.shader.fragment },
      },
      ...(g.params ? { params: g.params as unknown as Scene["params"] } : {}),
      custom: g.custom ?? {},
      mods,
      ...(passes.length ? { passes } : {}),
      ...(meshNode ? {
        mesh: {
          primitive: (meshNode as { mesh: { kind: string } }).mesh.kind as never,
          count: (meshNode as { instances?: number }).instances ?? 1,
          code: (meshNode as { shader: { fragment: string } }).shader.fragment,
        },
      } : {}),
      ...(particlesNode ? {
        particles: {
          count: (particlesNode as { count: number }).count,
          code: (particlesNode as { program: string }).program,
        },
      } : {}),
      ...(warpMeshNode ? { warpMesh: (warpMeshNode as { program: string }).program } : {}),
      ...(bloomNode ? { bloom: (bloomNode as { strength: number }).strength } : {}),
      ...(textNode ? {
        text: {
          value: (textNode as { source: { value: string } }).source.value,
          ...((textNode as { source: { size?: number } }).source.size !== undefined
            ? { size: (textNode as { source: { size?: number } }).source.size } : {}),
        },
      } : {}),
      ...(g.imageAsset !== undefined && g.imageAsset !== null
        ? { assets: { image: g.imageAsset } } : {}),
    });

    // Compile through the renderer — the same calls the legacy path makes.
    this.mods.reset();
    const errors: string[] = [];
    for (const stage of STAGES) {
      const res = await this.renderer.compileStage(stage, this.scene.layers[stage].code, 0);
      if (!res.ok) errors.push(`${stage}: ${res.diagnostics[0]?.message ?? "compile failed"}`);
    }
    const passResults = await this.renderer.setPasses(0, this.scene.passes ?? []);
    passResults.forEach((r, i) => {
      if (!r.ok) errors.push(`pass${i}: ${r.diagnostics[0]?.message ?? "compile failed"}`);
    });
    const meshRes = await this.renderer.setMesh(0, this.scene.mesh ?? null);
    if (meshRes && !meshRes.ok) {
      errors.push(`mesh: ${meshRes.diagnostics[0]?.message ?? "compile failed"}`);
    }
    this.renderer.setParticles(0, this.scene.particles?.count ?? 0);
    this.mw = meshWarpFor(this.scene);
    this.ps = particlesFor(this.scene);
    return { errors };
  }

  /** Render one frame at time t with the given audio. */
  frame(t: number, audio: AudioFeatures): void {
    if (!this.scene) throw new Error("no graph loaded");
    const p = this.mods.evaluate(this.scene, this.renderer.stageParams(0), audio, t);
    this.renderer.setWarpMesh(0, this.mw ? this.mw.evaluate(this.mods.exprSnapshot(), t) : null);
    if (this.ps) this.renderer.writeParticles(0, this.ps.update(audio, t));
    this.renderer.frame(t, audio, p);
  }
}
