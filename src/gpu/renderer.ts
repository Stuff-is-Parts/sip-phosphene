import { packUniforms, parseParams, UNIFORM_BYTES, type EffectiveParams } from "../core/params";
import type {
  AudioFeatures, CompileDiagnostic, CompileResult, CustomParam, StageId,
} from "../core/types";
import { assemble, PRESENT_WGSL } from "./wgsl";

interface StageState {
  pipeline: GPURenderPipeline | null;
  params: CustomParam[];
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
  image: GPUTexture | null = null;
  imageAspect = 1;
  ubo!: GPUBuffer;
  uboGroup!: GPUBindGroup;
  uniformData = new Float32Array(UNIFORM_BYTES / 4);
}

export class Renderer {
  private device!: GPUDevice;
  private ctx!: GPUCanvasContext;
  private canvasFormat!: GPUTextureFormat;
  private sampler!: GPUSampler;
  private white!: GPUTexture;
  private width = 4;
  private height = 4;

  private slots: [Slot, Slot] = [new Slot(), new Slot()];
  private presentPipeline!: GPURenderPipeline;
  private uboLayout!: GPUBindGroupLayout;
  private texLayout!: GPUBindGroupLayout;     // sampler, img, src, prev
  private presentLayout!: GPUBindGroupLayout; // sampler, outA, outB

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
        tex(1), tex(2), tex(3),
      ],
    });
    this.presentLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        tex(1), tex(2),
      ],
    });

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

    this.resize(canvas.width, canvas.height);
  }

  resize(w: number, h: number): void {
    this.width = Math.max(4, w | 0);
    this.height = Math.max(4, h | 0);
    const make = () => this.device.createTexture({
      size: [this.width, this.height],
      format: TARGET_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    for (const s of this.slots) {
      for (const t of [s.sceneTex, s.ping, s.pong]) t?.destroy();
      s.sceneTex = make(); s.ping = make(); s.pong = make();
    }
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

  stageParams(slot: 0 | 1 = 0): Record<StageId, CustomParam[]> {
    const s = this.slots[slot].stages;
    return { bg: s.bg.params, fg: s.fg.params, post: s.post.params };
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

  private renderSlot(enc: GPUCommandEncoder, s: Slot): GPUTexture {
    const groupFor = (src: GPUTexture, prev: GPUTexture) => this.device.createBindGroup({
      layout: this.texLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: (s.image ?? this.white).createView() },
        { binding: 2, resource: src.createView() },
        { binding: 3, resource: prev.createView() },
      ],
    });
    // bg + fg -> sceneTex  (src/prev bound to white: can't sample the attachment)
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
      if (s.stages.fg.pipeline) { pass.setPipeline(s.stages.fg.pipeline); pass.draw(3); }
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
    const out = s.stages.post.pipeline ? s.ping : s.sceneTex;
    const tmp = s.ping; s.ping = s.pong; s.pong = tmp;
    return out;
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
    const outA = this.renderSlot(enc, A);
    const outB = (this.transitionActive && pIncoming) ? this.renderSlot(enc, B) : outA;

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
