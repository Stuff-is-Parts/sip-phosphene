/**
 * Graph executor: runs a GraphScene on WebGPU directly from graph
 * structure — nodes, resources, data edges, and explicit order. It builds
 * its own textures, pipelines, and bind groups per node and walks
 * `graph.order` each frame. It does NOT reconstruct a legacy Scene and has
 * no knowledge of any node id: topology comes from node kinds, `target`
 * refs, declared texture bindings, and order alone.
 *
 * Execution contract (COMPATIBILITY-GOAL.md Hard Rules): a node kind is
 * either executed with evidenced behavior or the load REFUSES with
 * UnsupportedNodeError / UnsupportedGraphError naming every unimplemented
 * feature. There is no approximation path.
 *
 * Pixel behavior is derived from the witnessed legacy renderer
 * (src/gpu/renderer.ts) because the native lowering must be
 * behavior-preserving: identical WGSL assembly (wgsl.ts), identical
 * uniform packing (params.ts packUniforms), identical blend states
 * (fg additive one/one, mesh opaque + depth, particles additive),
 * identical feedback semantics (a draw sampling its own write target
 * reads the previous frame; front/back swap after the draw), identical
 * bloom chain and PRESENT pipeline. scripts/equivalence-native.mjs proves
 * round-trip pixel equivalence against the legacy path for every shipped
 * scene (completion gate 1).
 *
 * Imported-format node kinds (milk-*, p9-vector/p9-color, cpu-expr,
 * glsl-p9 / hlsl-md shaders) refuse until their engine implementations
 * land with reference validation.
 */

import { Renderer } from "./renderer";
import { toHalf } from "./renderer";
import { ModEngine, type ModSceneView } from "../core/mods";
import { MeshWarp, MESH_W, MESH_H } from "../core/meshwarp";
import { ParticleSystem } from "../core/particles";
import { renderText } from "../core/text";
import { parseParams, packUniforms, UNIFORM_BYTES } from "../core/params";
import { defaultParams, type AudioFeatures, type CustomParam } from "../core/types";
import {
  assembleFullscreen, PRESENT_WGSL,
  BLOOM_BRIGHT_WGSL, BLOOM_BLUR_WGSL, BLOOM_COMPOSITE_WGSL,
} from "./wgsl";
import { assembleMesh, makeGeometry, PARTICLE_WGSL } from "./mesh";
import {
  GraphScene, GraphNode, DrawFullscreenNode, DrawMeshNode, TextureRef,
  UnsupportedNodeError, unsupportedFeatures, validateGraph,
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

const TARGET_FORMAT: GPUTextureFormat = "rgba16float";

/** A render target's textures: `front` is the most recently written
 *  content this frame; `back` (feedback targets only) holds the previous
 *  frame and is what a draw samples when it binds its own write target. */
interface TargetRes {
  front: GPUTexture;
  back: GPUTexture | null;
  feedback: boolean;
}

interface DrawFsRes {
  node: DrawFullscreenNode;
  pipeline: GPURenderPipeline | null;
  params: CustomParam[];
}

interface DrawMeshRes {
  node: DrawMeshNode;
  pipeline: GPURenderPipeline | null;
  params: CustomParam[];
  vbuf: GPUBuffer; ibuf: GPUBuffer; indexCount: number; instances: number;
}

export class GraphExecutor {
  private g: GraphScene | null = null;
  private device!: GPUDevice;
  private width = 4;
  private height = 4;

  private targets = new Map<string, TargetRes>();
  private drawsFs = new Map<string, DrawFsRes>();
  private drawsMesh = new Map<string, DrawMeshRes>();
  private stageParamsMap: Record<string, CustomParam[]> = {};

  private readonly mods = new ModEngine();
  private modView: ModSceneView = { params: defaultParams(), custom: {}, mods: [] };
  private warpMeshProg: MeshWarp | null = null;
  private particles: ParticleSystem | null = null;
  private particleBuf: GPUBuffer | null = null;
  private particleCount = 0;
  private bloomStrength = 0;
  private bloomNodeId: string | null = null;

  private sampler!: GPUSampler;
  private white!: GPUTexture;
  private zero!: GPUTexture;
  private image: GPUTexture | null = null;
  private imageAspect = 1;
  private warpMeshTex: GPUTexture | null = null;
  private depthTex: GPUTexture | null = null;

  private ubo!: GPUBuffer;
  private uboGroup!: GPUBindGroup;
  private readonly uniformData = new Float32Array(UNIFORM_BYTES / 4);

  private uboLayout!: GPUBindGroupLayout;
  private texLayout!: GPUBindGroupLayout;      // sampler, img, src, prev, warpMesh
  private presentLayout!: GPUBindGroupLayout;  // sampler, texA, texB
  private singleTexLayout!: GPUBindGroupLayout;
  private presentPipeline!: GPURenderPipeline;
  private bloomBright!: GPURenderPipeline;
  private bloomBlurH!: GPURenderPipeline;
  private bloomBlurV!: GPURenderPipeline;
  private bloomComposite!: GPURenderPipeline;
  private bloomA: GPUTexture | null = null;
  private bloomB: GPUTexture | null = null;
  private bloomOut: GPUTexture | null = null;
  private particlePipeline!: GPURenderPipeline;

  constructor(private readonly renderer: Renderer) {}

  /* ------------------------------ loading ------------------------------ */

  /** Compile a graph for execution. Throws UnsupportedNodeError /
   *  UnsupportedGraphError when the graph carries features without an
   *  evidenced implementation; returns shader compile errors otherwise. */
  async load(g: GraphScene): Promise<{ errors: string[] }> {
    validateGraph(g);
    const unsupported = unsupportedFeatures(g);
    if (unsupported.length) throw new UnsupportedNodeError(unsupported);
    const refused: string[] = [];
    for (const n of g.nodes) {
      if (!EXECUTABLE_KINDS.has(n.kind)) refused.push(`${n.kind}(${n.id})`);
      if ((n.kind === "draw-fullscreen" || n.kind === "draw-mesh")) {
        if (n.shader.lang !== "wgsl") refused.push(`${n.kind}(${n.id}):lang=${n.shader.lang}`);
        if (n.blend === "alpha") refused.push(`${n.kind}(${n.id}):blend=alpha (no evidenced native consumer)`);
        if (n.p9State) refused.push(`${n.kind}(${n.id}):p9State (render-state enum mapping not yet evidenced)`);
        if (n.target === "screen") refused.push(`${n.kind}(${n.id}):target=screen (native presentation is the present node)`);
      }
      if (n.kind === "texture" &&
          (n.source.kind === "sound" || n.source.kind === "previous-frame")) {
        refused.push(`texture(${n.id}):${n.source.kind}`);
      }
      if (n.kind === "present") {
        const src = g.nodes.find((x) => x.id === n.source);
        if (!src || (src.kind !== "target" && src.kind !== "bloom")) {
          refused.push(`present(${n.id}):source=${src?.kind ?? "missing"}`);
        }
      }
    }
    // CPU dataflow edges have no executor yet (Plane9 per-frame port flow).
    if (g.data.length) refused.push(`data-edges(${g.data.length})`);
    if (refused.length) throw new UnsupportedGraphError(refused);

    this.g = g;
    this.device = this.renderer.gpuDevice;
    const { width, height } = this.renderer.pixelSize;
    this.initFixed();
    this.allocSized(width, height, g);

    // Modulation surface: params/custom verbatim from the graph, routes
    // verbatim from mod-route nodes, bloom strength from the bloom node.
    const bloomNode = g.nodes.find((n) => n.kind === "bloom");
    this.bloomStrength = bloomNode && "strength" in bloomNode ? bloomNode.strength : 0;
    this.bloomNodeId = bloomNode?.id ?? null;
    this.modView = {
      params: { ...defaultParams(), ...(g.params ?? {}) },
      custom: { ...(g.custom ?? {}) },
      mods: g.nodes.flatMap((n) => (n.kind === "mod-route" ? [n.route] : [])),
      ...(this.bloomStrength > 0 ? { bloom: this.bloomStrength } : {}),
    };
    this.mods.reset();

    // CPU per-frame programs.
    const wm = g.nodes.find((n) => n.kind === "warp-mesh");
    this.warpMeshProg = wm && "program" in wm ? new MeshWarp(wm.program as string) : null;
    const pt = g.nodes.find((n) => n.kind === "particles");
    this.particles = null;
    this.particleBuf?.destroy();
    this.particleBuf = null;
    this.particleCount = 0;
    if (pt && pt.kind === "particles") {
      this.particles = new ParticleSystem({ count: pt.count, code: pt.program });
      this.particleCount = pt.count;
      this.particleBuf = this.device.createBuffer({
        size: pt.count * 16, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }

    // Image slot: graph-provided image asset wins; else a text texture
    // node rasterizes into the slot (same precedence as the product scene
    // loader, src/player.ts loadSceneImage); else white.
    this.image?.destroy();
    this.image = null;
    this.imageAspect = 1;
    let imageData: string | null = g.imageAsset ?? null;
    if (!imageData) {
      const textNode = g.nodes.find((n) => n.kind === "texture" && n.source.kind === "text");
      if (textNode && textNode.kind === "texture" && textNode.source.kind === "text") {
        imageData = renderText(textNode.source.value, textNode.source.size);
      }
    }
    if (imageData) {
      try {
        const blob = await (await fetch(imageData)).blob();
        const bmp = await createImageBitmap(blob);
        this.image = this.device.createTexture({
          size: [bmp.width, bmp.height], format: "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST |
                 GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.device.queue.copyExternalImageToTexture(
          { source: bmp }, { texture: this.image }, [bmp.width, bmp.height]);
        this.imageAspect = bmp.width / bmp.height;
      } catch { this.image = null; this.imageAspect = 1; }
    }

    // Compile every draw node.
    const errors: string[] = [];
    this.drawsFs.clear();
    this.drawsMesh.clear();
    this.stageParamsMap = {};
    for (const id of g.order) {
      const n = g.nodes.find((x) => x.id === id);
      if (!n) continue;
      if (n.kind === "draw-fullscreen") {
        const res = await this.compileFullscreen(n);
        this.drawsFs.set(n.id, res);
        this.stageParamsMap[n.id] = res.params;
        if (!res.pipeline) errors.push(`${n.id}: shader compile failed`);
      } else if (n.kind === "draw-mesh") {
        const res = await this.compileMesh(n);
        if (res) {
          this.drawsMesh.set(n.id, res);
          if (!res.pipeline) errors.push(`${n.id}: mesh compile failed`);
        }
      }
    }
    return { errors };
  }

  /** Fixed pipelines and layouts (once per executor). */
  private initFixed(): void {
    if (this.sampler) return;
    const dev = this.device;
    this.sampler = dev.createSampler({
      magFilter: "linear", minFilter: "linear",
      addressModeU: "mirror-repeat", addressModeV: "mirror-repeat",
    });
    this.white = dev.createTexture({
      size: [1, 1], format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    dev.queue.writeTexture(
      { texture: this.white }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
    this.zero = dev.createTexture({
      size: [1, 1], format: "rgba16float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    dev.queue.writeTexture(
      { texture: this.zero }, new Uint16Array([0, 0, 0, 0]), { bytesPerRow: 8 }, [1, 1]);

    this.uboLayout = dev.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      }],
    });
    const tex = (binding: number): GPUBindGroupLayoutEntry =>
      ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
    this.texLayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        tex(1), tex(2), tex(3), tex(4),
      ],
    });
    this.presentLayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        tex(1), tex(2),
      ],
    });
    this.singleTexLayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        tex(1),
      ],
    });

    this.ubo = dev.createBuffer({
      size: UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.uboGroup = dev.createBindGroup({
      layout: this.uboLayout,
      entries: [{ binding: 0, resource: { buffer: this.ubo } }],
    });

    const presentModule = dev.createShaderModule({ code: PRESENT_WGSL });
    this.presentPipeline = dev.createRenderPipeline({
      layout: dev.createPipelineLayout({ bindGroupLayouts: [this.uboLayout, this.presentLayout] }),
      vertex: { module: presentModule, entryPoint: "vmain" },
      fragment: {
        module: presentModule, entryPoint: "fmain",
        targets: [{ format: this.renderer.presentationFormat }],
      },
      primitive: { topology: "triangle-list" },
    });
    const fixed = (code: string, layout: GPUBindGroupLayout, entry: string) => {
      const module = dev.createShaderModule({ code });
      return dev.createRenderPipeline({
        layout: dev.createPipelineLayout({ bindGroupLayouts: [this.uboLayout, layout] }),
        vertex: { module, entryPoint: "vmain" },
        fragment: { module, entryPoint: entry, targets: [{ format: TARGET_FORMAT }] },
        primitive: { topology: "triangle-list" },
      });
    };
    this.bloomBright = fixed(BLOOM_BRIGHT_WGSL, this.singleTexLayout, "fmain");
    this.bloomBlurH = fixed(BLOOM_BLUR_WGSL, this.singleTexLayout, "fmainH");
    this.bloomBlurV = fixed(BLOOM_BLUR_WGSL, this.singleTexLayout, "fmainV");
    this.bloomComposite = fixed(BLOOM_COMPOSITE_WGSL, this.presentLayout, "fmain");

    const particleModule = dev.createShaderModule({ code: PARTICLE_WGSL });
    this.particlePipeline = dev.createRenderPipeline({
      layout: dev.createPipelineLayout({ bindGroupLayouts: [this.uboLayout] }),
      vertex: {
        module: particleModule, entryPoint: "vmain",
        buffers: [{
          arrayStride: 16, stepMode: "instance",
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }],
        }],
      },
      fragment: {
        module: particleModule, entryPoint: "fmain",
        targets: [{
          format: TARGET_FORMAT,
          blend: {
            color: { srcFactor: "one", dstFactor: "one", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
          },
        }],
      },
      primitive: { topology: "triangle-strip" },
    });
  }

  /** (Re)allocate size-dependent textures for the graph's target nodes. */
  private allocSized(width: number, height: number, g: GraphScene): void {
    this.width = Math.max(4, width | 0);
    this.height = Math.max(4, height | 0);
    for (const t of this.targets.values()) { t.front.destroy(); t.back?.destroy(); }
    this.targets.clear();
    const make = (w: number, h: number) => this.device.createTexture({
      size: [w, h], format: TARGET_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING |
             GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
    for (const n of g.nodes) {
      if (n.kind !== "target") continue;
      const w = n.width ?? Math.max(4, Math.round(this.width * (n.scale ?? 1)));
      const h = n.height ?? Math.max(4, Math.round(this.height * (n.scale ?? 1)));
      this.targets.set(n.id, {
        front: make(w, h),
        back: n.feedback ? make(w, h) : null,
        feedback: !!n.feedback,
      });
    }
    this.bloomA?.destroy(); this.bloomB?.destroy(); this.bloomOut?.destroy();
    const hw = Math.max(2, this.width >> 1), hh = Math.max(2, this.height >> 1);
    this.bloomA = make(hw, hh);
    this.bloomB = make(hw, hh);
    this.bloomOut = make(this.width, this.height);
    this.depthTex?.destroy();
    this.depthTex = this.device.createTexture({
      size: [this.width, this.height], format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.warpMeshTex?.destroy();
    this.warpMeshTex = null;
  }

  private async compileFullscreen(n: DrawFullscreenNode): Promise<DrawFsRes> {
    const params = parseParams(n.shader.fragment);
    const withChain = !!(n.textures && ("srcTex" in n.textures || "prevTex" in n.textures));
    const { code } = assembleFullscreen(n.shader.fragment, params, withChain);
    this.device.pushErrorScope("validation");
    const module = this.device.createShaderModule({ code });
    const info = await module.getCompilationInfo();
    if (info.messages.some((m) => m.type === "error")) {
      await this.device.popErrorScope();
      return { node: n, pipeline: null, params };
    }
    try {
      const pipeline = await this.device.createRenderPipelineAsync({
        layout: this.device.createPipelineLayout({
          bindGroupLayouts: [this.uboLayout, this.texLayout],
        }),
        vertex: { module, entryPoint: "vmain" },
        fragment: {
          module, entryPoint: "fmain",
          targets: [{
            format: TARGET_FORMAT,
            blend: n.blend === "additive" ? {
              color: { srcFactor: "one", dstFactor: "one", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
            } : undefined,
          }],
        },
        primitive: { topology: "triangle-list" },
      });
      const scopeErr = await this.device.popErrorScope();
      if (scopeErr) return { node: n, pipeline: null, params };
      return { node: n, pipeline, params };
    } catch {
      await this.device.popErrorScope().catch(() => null);
      return { node: n, pipeline: null, params };
    }
  }

  private async compileMesh(n: DrawMeshNode): Promise<DrawMeshRes | null> {
    const params = parseParams(n.shader.fragment);
    const code = assembleMesh(n.shader.fragment);
    this.device.pushErrorScope("validation");
    const module = this.device.createShaderModule({ code });
    const info = await module.getCompilationInfo();
    if (info.messages.some((m) => m.type === "error")) {
      await this.device.popErrorScope();
      return null;
    }
    const geoKind = n.mesh.kind;
    if (geoKind === "fullscreen-rect" || geoKind === "cone" || geoKind === "disc") {
      // No native scene produces these through this path; makeGeometry
      // (gpu/mesh.ts) carries the witnessed primitive set.
      await this.device.popErrorScope().catch(() => null);
      throw new UnsupportedGraphError([`draw-mesh(${n.id}):primitive=${geoKind}`]);
    }
    const pipeline = await this.device.createRenderPipelineAsync({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.uboLayout] }),
      vertex: {
        module, entryPoint: "vmain",
        buffers: [{
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x3" },
          ],
        }],
      },
      fragment: { module, entryPoint: "fmain", targets: [{ format: TARGET_FORMAT }] },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });
    const scopeErr = await this.device.popErrorScope();
    if (scopeErr) return null;
    const geo = makeGeometry(geoKind);
    const vbuf = this.device.createBuffer({
      size: geo.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(vbuf, 0, geo.vertices);
    const ibuf = this.device.createBuffer({
      size: geo.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(ibuf, 0, geo.indices);
    return {
      node: n, pipeline, params,
      vbuf, ibuf, indexCount: geo.indices.length, instances: n.instances ?? 1,
    };
  }

  /* ------------------------------ frames ------------------------------- */

  /** Sample view for a texture ref read by `readerTarget`: reading your own
   *  write target gives the PREVIOUS frame (back buffer) on feedback
   *  targets; reading any other target gives its latest written content;
   *  a bloom node's id resolves to the bloom chain's output. */
  private readView(ref: TextureRef, readerTarget: TextureRef | "screen"): GPUTextureView {
    if (ref === this.bloomNodeId && this.bloomOut) return this.bloomOut.createView();
    const t = this.targets.get(ref);
    if (!t) return this.white.createView();
    if (ref === readerTarget && t.feedback && t.back) return t.back.createView();
    return t.front.createView();
  }

  private uploadWarpMesh(offsets: Float32Array): void {
    if (!this.warpMeshTex) {
      this.warpMeshTex = this.device.createTexture({
        size: [MESH_W, MESH_H], format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
    }
    const half = new Uint16Array(MESH_W * MESH_H * 4);
    for (let i = 0; i < MESH_W * MESH_H; i++) {
      half[i * 4] = toHalf(offsets[i * 2]);
      half[i * 4 + 1] = toHalf(offsets[i * 2 + 1]);
    }
    this.device.queue.writeTexture(
      { texture: this.warpMeshTex }, half, { bytesPerRow: MESH_W * 8 }, [MESH_W, MESH_H]);
  }

  /** Render one frame at time t with the given audio. */
  frame(t: number, audio: AudioFeatures): void {
    const g = this.g;
    if (!g) throw new Error("no graph loaded");
    const { width, height } = this.renderer.pixelSize;
    if (width !== this.width || height !== this.height) this.allocSized(width, height, g);

    // CPU phase: modulation routes (verbatim), warp mesh, particles.
    const p = this.mods.evaluate(this.modView, this.stageParamsMap, audio, t);
    if (this.warpMeshProg) this.uploadWarpMesh(this.warpMeshProg.evaluate(this.mods.exprSnapshot(), t));
    if (this.particles && this.particleBuf) {
      this.device.queue.writeBuffer(this.particleBuf, 0, this.particles.update(audio, t));
    }
    packUniforms(this.uniformData, this.width, this.height, t, audio, p, 0, 0, this.imageAspect);
    this.device.queue.writeBuffer(this.ubo, 0, this.uniformData);

    const enc = this.device.createCommandEncoder();
    const written = new Set<string>();          // targets written this frame
    const pendingClear = new Map<string, GPUColor>();

    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    for (const id of g.order) {
      const n = byId.get(id) as GraphNode | undefined;
      if (!n) continue;
      switch (n.kind) {
        case "mod-route":
        case "warp-mesh":
          break; // evaluated in the CPU phase above
        case "clear": {
          if (n.target === "screen") break;
          pendingClear.set(n.target, colorOf(n.color));
          break;
        }
        case "draw-fullscreen": this.runFullscreen(enc, n, written, pendingClear); break;
        case "draw-mesh": this.runMesh(enc, n, written, pendingClear); break;
        case "particles": this.runParticles(enc, n.target, written, pendingClear); break;
        case "bloom": this.runBloom(enc, n.source); break;
        case "present": this.runPresent(enc, n.source); break;
        default: break; // target/texture: resources, not execution steps
      }
    }
    // End-of-frame feedback rotation for every feedback target written
    // this frame: within the frame, `front` was the freshly written
    // content and `back` the previous frame (self-reads sampled it via
    // readView). Rotating makes the fresh content next frame's `back` —
    // the legacy renderer's ping/pong swap semantics.
    for (const id of written) {
      const t = this.targets.get(id);
      if (t?.feedback && t.back) {
        const tmp = t.front; t.front = t.back; t.back = tmp;
      }
    }
    this.device.queue.submit([enc.finish()]);
  }

  /** Attachment ops for a write to `target`: an explicit pending clear
   *  wins; otherwise the first write this frame clears to black (the
   *  legacy renderer clears each written target once per frame); later
   *  writes load. */
  private beginColor(
    enc: GPUCommandEncoder, target: TextureRef,
    written: Set<string>, pendingClear: Map<string, GPUColor>,
    depth = false,
  ): GPURenderPassEncoder | null {
    const t = this.targets.get(target);
    if (!t) return null;
    const clear = pendingClear.get(target) ??
      (written.has(target) ? null : { r: 0, g: 0, b: 0, a: 1 });
    pendingClear.delete(target);
    written.add(target);
    return enc.beginRenderPass({
      colorAttachments: [{
        view: t.front.createView(),
        loadOp: clear ? "clear" : "load",
        storeOp: "store",
        ...(clear ? { clearValue: clear } : {}),
      }],
      ...(depth && this.depthTex ? {
        depthStencilAttachment: {
          view: this.depthTex.createView(),
          depthClearValue: 1, depthLoadOp: "clear" as const, depthStoreOp: "discard" as const,
        },
      } : {}),
    });
  }

  private texGroup(node: DrawFullscreenNode): GPUBindGroup {
    const texOf = (name: string): GPUTextureView => {
      const ref = node.textures?.[name];
      if (!ref) return this.white.createView();
      return this.readView(ref, node.target);
    };
    return this.device.createBindGroup({
      layout: this.texLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: (this.image ?? this.white).createView() },
        { binding: 2, resource: texOf("srcTex") },
        { binding: 3, resource: texOf("prevTex") },
        { binding: 4, resource: (this.warpMeshTex ?? this.zero).createView() },
      ],
    });
  }

  private runFullscreen(
    enc: GPUCommandEncoder, node: DrawFullscreenNode,
    written: Set<string>, pendingClear: Map<string, GPUColor>,
  ): void {
    if (node.target === "screen") return; // presentation is the present node's job
    const res = this.drawsFs.get(node.id);
    const pass = this.beginColor(enc, node.target, written, pendingClear);
    if (!pass) return;
    if (res?.pipeline) {
      pass.setBindGroup(0, this.uboGroup);
      pass.setBindGroup(1, this.texGroup(node));
      pass.setPipeline(res.pipeline);
      pass.draw(3);
    }
    pass.end();
  }

  private runParticles(
    enc: GPUCommandEncoder, target: TextureRef,
    written: Set<string>, pendingClear: Map<string, GPUColor>,
  ): void {
    if (!this.particleBuf || this.particleCount <= 0) return;
    const pass = this.beginColor(enc, target, written, pendingClear);
    if (!pass) return;
    pass.setBindGroup(0, this.uboGroup);
    pass.setPipeline(this.particlePipeline);
    pass.setVertexBuffer(0, this.particleBuf);
    pass.draw(4, this.particleCount);
    pass.end();
  }

  private runMesh(
    enc: GPUCommandEncoder, node: DrawMeshNode,
    written: Set<string>, pendingClear: Map<string, GPUColor>,
  ): void {
    if (node.target === "screen") return;
    const res = this.drawsMesh.get(node.id);
    if (!res?.pipeline) return;
    const pass = this.beginColor(enc, node.target, written, pendingClear, true);
    if (!pass) return;
    pass.setBindGroup(0, this.uboGroup);
    pass.setPipeline(res.pipeline);
    pass.setVertexBuffer(0, res.vbuf);
    pass.setIndexBuffer(res.ibuf, "uint32");
    pass.drawIndexed(res.indexCount, res.instances);
    pass.end();
  }

  /** Bloom chain reading `source`, producing this.bloomOut:
   *  bright/downsample -> blur H -> blur V -> composite (same fixed
   *  pipelines as the legacy renderer). The output does NOT feed back
   *  into any target — readers reference the bloom node id. */
  private runBloom(enc: GPUCommandEncoder, source: TextureRef): void {
    const t = this.targets.get(source);
    if (!t || !this.bloomA || !this.bloomB || !this.bloomOut) return;
    const single = (src: GPUTexture) => this.device.createBindGroup({
      layout: this.singleTexLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: src.createView() },
      ],
    });
    const step = (pipeline: GPURenderPipeline, group: GPUBindGroup, dst: GPUTexture) => {
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: dst.createView(),
          loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      pass.setBindGroup(0, this.uboGroup);
      pass.setBindGroup(1, group);
      pass.setPipeline(pipeline);
      pass.draw(3);
      pass.end();
    };
    step(this.bloomBright, single(t.front), this.bloomA);
    step(this.bloomBlurH, single(this.bloomA), this.bloomB);
    step(this.bloomBlurV, single(this.bloomB), this.bloomA);
    const compositeGroup = this.device.createBindGroup({
      layout: this.presentLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: t.front.createView() },
        { binding: 2, resource: this.bloomA.createView() },
      ],
    });
    step(this.bloomComposite, compositeGroup, this.bloomOut);
  }

  private runPresent(enc: GPUCommandEncoder, source: TextureRef): void {
    const view = this.readView(source, "screen");
    const group = this.device.createBindGroup({
      layout: this.presentLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: view },
        { binding: 2, resource: view },
      ],
    });
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.renderer.currentTextureView(),
        loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });
    pass.setPipeline(this.presentPipeline);
    pass.setBindGroup(0, this.uboGroup);
    pass.setBindGroup(1, group);
    pass.draw(3);
    pass.end();
  }
}

function colorOf(c?: [number, number, number, number]): GPUColor {
  return c ? { r: c[0], g: c[1], b: c[2], a: c[3] } : { r: 0, g: 0, b: 0, a: 1 };
}
