import { packUniforms, parseParams, UNIFORM_BYTES, type EffectiveParams } from "../core/params";
import { MESH_W, MESH_H } from "../core/meshwarp";
import type {
  AudioFeatures, CompileDiagnostic, CompileResult, CustomParam, SceneMesh,
  ScenePass, StageId,
} from "../core/types";
import {
  assemble, PRESENT_WGSL, BLOOM_BRIGHT_WGSL, BLOOM_BLUR_WGSL, BLOOM_COMPOSITE_WGSL,
} from "./wgsl";
import { assembleMesh, makeGeometry, PARTICLE_WGSL } from "./mesh";

/** IEEE 754 float32 -> float16 bits (for rgba16float texture uploads). */
function toHalf(v: number): number {
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  f[0] = v;
  const x = u[0];
  const sign = (x >> 16) & 0x8000;
  let exp = ((x >> 23) & 0xff) - 127 + 15;
  let mant = (x >> 13) & 0x3ff;
  if (exp <= 0) { exp = 0; mant = 0; }
  else if (exp >= 31) { exp = 31; mant = 0; }
  return sign | (exp << 10) | mant;
}

interface StageState {
  pipeline: GPURenderPipeline | null;
  params: CustomParam[];
}

interface PassState {
  pipeline: GPURenderPipeline;
  params: CustomParam[];
  ping: GPUTexture;
  pong: GPUTexture;
}

interface MeshState {
  pipeline: GPURenderPipeline;
  vbuf: GPUBuffer;
  ibuf: GPUBuffer;
  indexCount: number;
  instances: number;
}

const TARGET_FORMAT: GPUTextureFormat = "rgba16float";

/** One renderable scene: its stage pipelines, feedback chain, and image. */
class Slot {
  stages: Record<StageId, StageState> = {
    bg: { pipeline: null, params: [] },
    fg: { pipeline: null, params: [] },
    post: { pipeline: null, params: [] },
  };
  sceneTex!: GPUTexture;
  ping!: GPUTexture;
  pong!: GPUTexture;
  bloomA!: GPUTexture;   // half-res
  bloomB!: GPUTexture;   // half-res
  bloomOut!: GPUTexture; // full-res composite target
  image: GPUTexture | null = null;
  imageAspect = 1;
  warpMesh: GPUTexture | null = null;
  passes: PassState[] = [];
  mesh: MeshState | null = null;
  particleBuf: GPUBuffer | null = null;
  particleCount = 0;
  ubo!: GPUBuffer;
  uboGroup!: GPUBindGroup;
  uniformData = new Float32Array(UNIFORM_BYTES / 4);
}

export class Renderer {
  private device!: GPUDevice;
  /** Device access for sibling GPU subsystems (milk pipeline) that own
   *  their targets/pipelines but share the device and presentation. */
  get gpuDevice(): GPUDevice { return this.device; }
  private ctx!: GPUCanvasContext;
  private canvasFormat!: GPUTextureFormat;
  private sampler!: GPUSampler;
  private white!: GPUTexture;
  private width = 4;
  private height = 4;

  private slots: [Slot, Slot] = [new Slot(), new Slot()];
  private presentPipeline!: GPURenderPipeline;
  private uboLayout!: GPUBindGroupLayout;
  private texLayout!: GPUBindGroupLayout;      // sampler, img, src, prev, warpMesh
  private presentLayout!: GPUBindGroupLayout;  // sampler, outA, outB
  private singleTexLayout!: GPUBindGroupLayout; // sampler, tex
  private zero!: GPUTexture;
  private bloomBright!: GPURenderPipeline;
  private bloomBlurH!: GPURenderPipeline;
  private bloomBlurV!: GPURenderPipeline;
  private bloomComposite!: GPURenderPipeline;
  private depthTex!: GPUTexture;
  private particlePipeline!: GPURenderPipeline;

  /** Transition state: progress 0..1 mixing slot0 -> slot1, then swap. */
  transitionProgress = 0;
  transitionMode = 0;
  transitionActive = false;

  onDeviceLost: ((reason: string) => void) | null = null;

  static supported(): boolean {
    return typeof navigator !== "undefined" && !!navigator.gpu;
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter available");
    this.device = await adapter.requestDevice();
    this.device.lost.then((info) => {
      if (info.reason !== "destroyed") this.onDeviceLost?.(info.message || info.reason);
    });

    this.ctx = canvas.getContext("webgpu") as GPUCanvasContext;
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.device, format: this.canvasFormat, alphaMode: "opaque" });

    this.sampler = this.device.createSampler({
      magFilter: "linear", minFilter: "linear",
      addressModeU: "mirror-repeat", addressModeV: "mirror-repeat",
    });
    this.white = this.device.createTexture({
      size: [1, 1], format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: this.white }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);

    this.uboLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      }],
    });
    const tex = (binding: number): GPUBindGroupLayoutEntry =>
      ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
    this.texLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        tex(1), tex(2), tex(3), tex(4),
      ],
    });
    this.presentLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        tex(1), tex(2),
      ],
    });
    this.singleTexLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        tex(1),
      ],
    });

    this.zero = this.device.createTexture({
      size: [1, 1], format: "rgba16float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: this.zero }, new Uint16Array([0, 0, 0, 0]), { bytesPerRow: 8 }, [1, 1]);

    for (const s of this.slots) {
      s.ubo = this.device.createBuffer({
        size: UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      s.uboGroup = this.device.createBindGroup({
        layout: this.uboLayout,
        entries: [{ binding: 0, resource: { buffer: s.ubo } }],
      });
    }

    const presentModule = this.device.createShaderModule({ code: PRESENT_WGSL });
    this.presentPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.uboLayout, this.presentLayout],
      }),
      vertex: { module: presentModule, entryPoint: "vmain" },
      fragment: { module: presentModule, entryPoint: "fmain", targets: [{ format: this.canvasFormat }] },
      primitive: { topology: "triangle-list" },
    });

    const fixed = (code: string, layout: GPUBindGroupLayout, entry: string) => {
      const module = this.device.createShaderModule({ code });
      return this.device.createRenderPipeline({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.uboLayout, layout] }),
        vertex: { module, entryPoint: "vmain" },
        fragment: { module, entryPoint: entry, targets: [{ format: TARGET_FORMAT }] },
        primitive: { topology: "triangle-list" },
      });
    };
    this.bloomBright = fixed(BLOOM_BRIGHT_WGSL, this.singleTexLayout, "fmain");
    this.bloomBlurH = fixed(BLOOM_BLUR_WGSL, this.singleTexLayout, "fmainH");
    this.bloomBlurV = fixed(BLOOM_BLUR_WGSL, this.singleTexLayout, "fmainV");
    this.bloomComposite = fixed(BLOOM_COMPOSITE_WGSL, this.presentLayout, "fmain");

    const particleModule = this.device.createShaderModule({ code: PARTICLE_WGSL });
    this.particlePipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.uboLayout] }),
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

    this.resize(canvas.width, canvas.height);
  }

  /** Compile the extra render-pass chain for a slot (replaces the previous one). */
  async setPasses(slot: 0 | 1, passes: ScenePass[]): Promise<CompileResult[]> {
    const s = this.slots[slot];
    for (const p of s.passes) { p.ping.destroy(); p.pong.destroy(); }
    s.passes = [];
    const results: CompileResult[] = [];
    for (const def of passes) {
      const params = parseParams(def.code);
      const { code, bodyLineOffset } = assemble("post", def.code, params);
      this.device.pushErrorScope("validation");
      const module = this.device.createShaderModule({ code });
      const info = await module.getCompilationInfo();
      const diagnostics: CompileDiagnostic[] = info.messages.map((m) => ({
        line: Math.max(1, (m.lineNum || 1) - bodyLineOffset),
        message: m.message,
        severity: m.type === "error" ? "error" : m.type === "warning" ? "warning" : "info",
      }));
      if (diagnostics.some((d) => d.severity === "error")) {
        await this.device.popErrorScope();
        results.push({ ok: false, diagnostics, params });
        continue;
      }
      const pipeline = await this.device.createRenderPipelineAsync({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.uboLayout, this.texLayout] }),
        vertex: { module, entryPoint: "vmain" },
        fragment: { module, entryPoint: "fmain", targets: [{ format: TARGET_FORMAT }] },
        primitive: { topology: "triangle-list" },
      });
      const scopeErr = await this.device.popErrorScope();
      if (scopeErr) {
        results.push({ ok: false, params, diagnostics: [{ line: 1, message: scopeErr.message, severity: "error" }] });
        continue;
      }
      const make = () => this.device.createTexture({
        size: [this.width, this.height], format: TARGET_FORMAT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      s.passes.push({ pipeline, params, ping: make(), pong: make() });
      results.push({ ok: true, diagnostics, params });
    }
    return results;
  }

  /** Compile (or clear) the rasterized mesh layer for a slot. */
  async setMesh(slot: 0 | 1, mesh: SceneMesh | null): Promise<CompileResult | null> {
    const s = this.slots[slot];
    if (s.mesh) { s.mesh.vbuf.destroy(); s.mesh.ibuf.destroy(); s.mesh = null; }
    if (!mesh) return null;
    const params: CustomParam[] = parseParams(mesh.code);
    const code = assembleMesh(mesh.code);
    this.device.pushErrorScope("validation");
    const module = this.device.createShaderModule({ code });
    const info = await module.getCompilationInfo();
    const diagnostics: CompileDiagnostic[] = info.messages.map((m) => ({
      line: Math.max(1, m.lineNum || 1), message: m.message,
      severity: m.type === "error" ? "error" : m.type === "warning" ? "warning" : "info",
    }));
    if (diagnostics.some((d) => d.severity === "error")) {
      await this.device.popErrorScope();
      return { ok: false, diagnostics, params };
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
    if (scopeErr) {
      return { ok: false, params, diagnostics: [{ line: 1, message: scopeErr.message, severity: "error" }] };
    }
    const geo = makeGeometry(mesh.primitive);
    const vbuf = this.device.createBuffer({
      size: geo.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(vbuf, 0, geo.vertices);
    const ibuf = this.device.createBuffer({
      size: geo.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(ibuf, 0, geo.indices);
    s.mesh = { pipeline, vbuf, ibuf, indexCount: geo.indices.length, instances: mesh.count };
    return { ok: true, diagnostics, params };
  }

  /** Size (or clear) the particle instance buffer for a slot. */
  setParticles(slot: 0 | 1, count: number): void {
    const s = this.slots[slot];
    s.particleBuf?.destroy();
    s.particleBuf = null;
    s.particleCount = count;
    if (count > 0) {
      s.particleBuf = this.device.createBuffer({
        size: count * 16, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
  }

  writeParticles(slot: 0 | 1, data: Float32Array<ArrayBuffer>): void {
    const s = this.slots[slot];
    if (s.particleBuf) this.device.queue.writeBuffer(s.particleBuf, 0, data);
  }

  /** Upload (or clear) the per-vertex warp mesh: MESH_W×MESH_H UV offsets. */
  setWarpMesh(slot: 0 | 1, offsets: Float32Array | null): void {
    const s = this.slots[slot];
    if (!offsets) {
      s.warpMesh?.destroy();
      s.warpMesh = null;
      return;
    }
    if (!s.warpMesh) {
      s.warpMesh = this.device.createTexture({
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
      { texture: s.warpMesh }, half, { bytesPerRow: MESH_W * 8 }, [MESH_W, MESH_H]);
  }

  resize(w: number, h: number): void {
    this.width = Math.max(4, w | 0);
    this.height = Math.max(4, h | 0);
    const make = () => this.device.createTexture({
      size: [this.width, this.height],
      format: TARGET_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const makeHalf = () => this.device.createTexture({
      size: [Math.max(2, this.width >> 1), Math.max(2, this.height >> 1)],
      format: TARGET_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    for (const s of this.slots) {
      for (const t of [s.sceneTex, s.ping, s.pong, s.bloomA, s.bloomB, s.bloomOut]) t?.destroy();
      s.sceneTex = make(); s.ping = make(); s.pong = make();
      s.bloomA = makeHalf(); s.bloomB = makeHalf(); s.bloomOut = make();
      for (const p of s.passes) {
        p.ping.destroy(); p.pong.destroy();
        p.ping = make(); p.pong = make();
      }
    }
    this.depthTex?.destroy();
    this.depthTex = this.device.createTexture({
      size: [this.width, this.height], format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  async setImage(slot: 0 | 1, bitmap: ImageBitmap | null): Promise<void> {
    const s = this.slots[slot];
    s.image?.destroy();
    s.image = null;
    s.imageAspect = 1;
    if (bitmap) {
      s.image = this.device.createTexture({
        size: [bitmap.width, bitmap.height],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST |
               GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.device.queue.copyExternalImageToTexture(
        { source: bitmap }, { texture: s.image }, [bitmap.width, bitmap.height]);
      s.imageAspect = bitmap.width / bitmap.height;
    }
  }

  async compileStage(stage: StageId, body: string, slot: 0 | 1 = 0): Promise<CompileResult> {
    const params = parseParams(body);
    const { code, bodyLineOffset } = assemble(stage, body, params);

    this.device.pushErrorScope("validation");
    const module = this.device.createShaderModule({ code });
    const info = await module.getCompilationInfo();
    const diagnostics: CompileDiagnostic[] = info.messages.map((m) => ({
      line: Math.max(1, (m.lineNum || 1) - bodyLineOffset),
      message: m.message,
      severity: m.type === "error" ? "error" : m.type === "warning" ? "warning" : "info",
    }));
    if (diagnostics.some((d) => d.severity === "error")) {
      await this.device.popErrorScope();
      return { ok: false, diagnostics, params };
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
            blend: stage === "fg" ? {
              color: { srcFactor: "one", dstFactor: "one", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
            } : undefined,
          }],
        },
        primitive: { topology: "triangle-list" },
      });
      const scopeErr = await this.device.popErrorScope();
      if (scopeErr) {
        return { ok: false, params, diagnostics: [{ line: 1, message: scopeErr.message, severity: "error" }] };
      }
      this.slots[slot].stages[stage] = { pipeline, params };
      return { ok: true, diagnostics, params };
    } catch (e) {
      await this.device.popErrorScope().catch(() => null);
      return { ok: false, params, diagnostics: [{ line: 1, message: (e as Error).message, severity: "error" }] };
    }
  }

  stageParams(slot: 0 | 1 = 0): Record<string, CustomParam[]> {
    const s = this.slots[slot];
    const out: Record<string, CustomParam[]> = {
      bg: s.stages.bg.params, fg: s.stages.fg.params, post: s.stages.post.params,
    };
    s.passes.forEach((p, i) => { out[`pass${i}`] = p.params; });
    return out;
  }

  beginTransition(mode: number): void {
    this.transitionMode = mode;
    this.transitionProgress = 0;
    this.transitionActive = true;
  }

  /** Steps the transition; returns true (and swaps slots) on completion. */
  advanceTransition(step: number): boolean {
    if (!this.transitionActive) return false;
    this.transitionProgress = Math.min(1, this.transitionProgress + step);
    if (this.transitionProgress >= 1) {
      this.finishTransition();
      return true;
    }
    return false;
  }

  /** Completes a transition: incoming slot becomes active. */
  finishTransition(): void {
    if (!this.transitionActive) return;
    const [a, b] = this.slots;
    this.slots = [b, a];
    this.transitionActive = false;
    this.transitionProgress = 0;
  }

  private renderSlot(enc: GPUCommandEncoder, s: Slot, bloom = 0): GPUTexture {
    const groupFor = (src: GPUTexture, prev: GPUTexture) => this.device.createBindGroup({
      layout: this.texLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: (s.image ?? this.white).createView() },
        { binding: 2, resource: src.createView() },
        { binding: 3, resource: prev.createView() },
        { binding: 4, resource: (s.warpMesh ?? this.zero).createView() },
      ],
    });
    // bg -> sceneTex  (src/prev bound to white: can't sample the attachment)
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: s.sceneTex.createView(),
          loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      pass.setBindGroup(0, s.uboGroup);
      pass.setBindGroup(1, groupFor(this.white, this.white));
      if (s.stages.bg.pipeline) { pass.setPipeline(s.stages.bg.pipeline); pass.draw(3); }
      pass.end();
    }
    // mesh layer: depth-tested over bg
    if (s.mesh) {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: s.sceneTex.createView(), loadOp: "load", storeOp: "store" }],
        depthStencilAttachment: {
          view: this.depthTex.createView(),
          depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard",
        },
      });
      pass.setBindGroup(0, s.uboGroup);
      pass.setPipeline(s.mesh.pipeline);
      pass.setVertexBuffer(0, s.mesh.vbuf);
      pass.setIndexBuffer(s.mesh.ibuf, "uint32");
      pass.drawIndexed(s.mesh.indexCount, s.mesh.instances);
      pass.end();
    }
    // fg + particles: additive over the composite
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: s.sceneTex.createView(), loadOp: "load", storeOp: "store" }],
      });
      pass.setBindGroup(0, s.uboGroup);
      if (s.stages.fg.pipeline) {
        pass.setBindGroup(1, groupFor(this.white, this.white));
        pass.setPipeline(s.stages.fg.pipeline);
        pass.draw(3);
      }
      if (s.particleBuf && s.particleCount > 0) {
        pass.setPipeline(this.particlePipeline);
        pass.setVertexBuffer(0, s.particleBuf);
        pass.draw(4, s.particleCount);
      }
      pass.end();
    }
    // post(sceneTex, pong) -> ping
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: s.ping.createView(),
          loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      pass.setBindGroup(0, s.uboGroup);
      if (s.stages.post.pipeline) {
        pass.setPipeline(s.stages.post.pipeline);
        pass.setBindGroup(1, groupFor(s.sceneTex, s.pong));
        pass.draw(3);
      }
      pass.end();
    }
    let out = s.stages.post.pipeline ? s.ping : s.sceneTex;
    const tmp = s.ping; s.ping = s.pong; s.pong = tmp;

    // extra render passes: chained, each with its own feedback pair
    for (const p of s.passes) {
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: p.ping.createView(),
          loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      pass.setBindGroup(0, s.uboGroup);
      pass.setBindGroup(1, groupFor(out, p.pong));
      pass.setPipeline(p.pipeline);
      pass.draw(3);
      pass.end();
      out = p.ping;
      const t = p.ping; p.ping = p.pong; p.pong = t;
    }

    if (bloom <= 0) return out;

    // bloom chain: bright/downsample -> blur H -> blur V -> composite
    const single = (src: GPUTexture) => this.device.createBindGroup({
      layout: this.singleTexLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: src.createView() },
      ],
    });
    const step = (pipeline: GPURenderPipeline, group: GPUBindGroup, target: GPUTexture) => {
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: target.createView(),
          loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      pass.setBindGroup(0, s.uboGroup);
      pass.setBindGroup(1, group);
      pass.setPipeline(pipeline);
      pass.draw(3);
      pass.end();
    };
    step(this.bloomBright, single(out), s.bloomA);
    step(this.bloomBlurH, single(s.bloomA), s.bloomB);
    step(this.bloomBlurV, single(s.bloomB), s.bloomA);
    const compositeGroup = this.device.createBindGroup({
      layout: this.presentLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: out.createView() },
        { binding: 2, resource: s.bloomA.createView() },
      ],
    });
    step(this.bloomComposite, compositeGroup, s.bloomOut);
    return s.bloomOut;
  }

  frame(
    time: number,
    audio: AudioFeatures,
    pActive: EffectiveParams,
    pIncoming: EffectiveParams | null = null,
  ): void {
    const [A, B] = this.slots;
    const prog = this.transitionActive ? this.transitionProgress : 0;

    packUniforms(A.uniformData, this.width, this.height, time, audio, pActive,
      prog, this.transitionMode, A.imageAspect);
    this.device.queue.writeBuffer(A.ubo, 0, A.uniformData);
    if (this.transitionActive && pIncoming) {
      packUniforms(B.uniformData, this.width, this.height, time, audio, pIncoming,
        prog, this.transitionMode, B.imageAspect);
      this.device.queue.writeBuffer(B.ubo, 0, B.uniformData);
    }

    const enc = this.device.createCommandEncoder();
    const outA = this.renderSlot(enc, A, pActive.bloom ?? 0);
    const outB = (this.transitionActive && pIncoming)
      ? this.renderSlot(enc, B, pIncoming.bloom ?? 0) : outA;

    const presentGroup = this.device.createBindGroup({
      layout: this.presentLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: outA.createView() },
        { binding: 2, resource: outB.createView() },
      ],
    });
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.ctx.getCurrentTexture().createView(),
        loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });
    pass.setPipeline(this.presentPipeline);
    pass.setBindGroup(0, A.uboGroup); // carries progress/mode in xtra
    pass.setBindGroup(1, presentGroup);
    pass.draw(3);
    pass.end();

    this.device.queue.submit([enc.finish()]);
  }

  destroy(): void {
    try { this.device?.destroy(); } catch { /* already gone */ }
  }
}
