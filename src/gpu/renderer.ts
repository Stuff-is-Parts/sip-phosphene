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

export class Renderer {
  private device!: GPUDevice;
  private ctx!: GPUCanvasContext;
  private canvasFormat!: GPUTextureFormat;
  private ubo!: GPUBuffer;
  private uniformData = new Float32Array(UNIFORM_BYTES / 4);
  private sampler!: GPUSampler;

  private sceneTex!: GPUTexture;
  private ping!: GPUTexture;
  private pong!: GPUTexture;
  private width = 4;
  private height = 4;

  private stages: Record<StageId, StageState> = {
    bg: { pipeline: null, params: [] },
    fg: { pipeline: null, params: [] },
    post: { pipeline: null, params: [] },
  };
  private presentPipeline!: GPURenderPipeline;
  private uboBindGroup!: GPUBindGroup;
  private uboLayout!: GPUBindGroupLayout;
  private texLayout!: GPUBindGroupLayout;

  onDeviceLost: ((reason: string) => void) | null = null;

  static supported(): boolean {
    return typeof navigator !== "undefined" && !!navigator.gpu;
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter available");
    this.device = await adapter.requestDevice();

    // Device loss is a designed, recoverable event — the thesis feature.
    this.device.lost.then((info) => {
      if (info.reason !== "destroyed") this.onDeviceLost?.(info.message || info.reason);
    });

    this.ctx = canvas.getContext("webgpu") as GPUCanvasContext;
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.device, format: this.canvasFormat, alphaMode: "opaque" });

    this.ubo = this.device.createBuffer({
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.sampler = this.device.createSampler({
      magFilter: "linear", minFilter: "linear",
      addressModeU: "mirror-repeat", addressModeV: "mirror-repeat",
    });

    this.uboLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      }],
    });
    this.texLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });
    this.uboBindGroup = this.device.createBindGroup({
      layout: this.uboLayout,
      entries: [{ binding: 0, resource: { buffer: this.ubo } }],
    });

    this.presentPipeline = await this.makePipeline(PRESENT_WGSL, this.canvasFormat, false, true);
    this.resize(canvas.width, canvas.height);
  }

  resize(w: number, h: number): void {
    this.width = Math.max(4, w | 0);
    this.height = Math.max(4, h | 0);
    for (const t of [this.sceneTex, this.ping, this.pong]) t?.destroy();
    const make = () => this.device.createTexture({
      size: [this.width, this.height],
      format: TARGET_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.sceneTex = make();
    this.ping = make();
    this.pong = make();
  }

  private async makePipeline(
    code: string,
    format: GPUTextureFormat,
    additive: boolean,
    withTextures: boolean,
  ): Promise<GPURenderPipeline> {
    const module = this.device.createShaderModule({ code });
    const layouts: GPUBindGroupLayout[] = [this.uboLayout];
    if (withTextures) layouts.push(this.texLayout);
    return this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: layouts }),
      vertex: { module, entryPoint: "vmain" },
      fragment: {
        module, entryPoint: "fmain",
        targets: [{
          format,
          blend: additive ? {
            color: { srcFactor: "one", dstFactor: "one", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
          } : undefined,
        }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  /** Compile a stage body; returns line-mapped diagnostics. On success the stage is live. */
  async compileStage(stage: StageId, body: string): Promise<CompileResult> {
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
    const hasError = diagnostics.some((d) => d.severity === "error");

    if (hasError) {
      await this.device.popErrorScope();
      return { ok: false, diagnostics, params };
    }

    try {
      const pipeline = await this.device.createRenderPipelineAsync({
        layout: this.device.createPipelineLayout({
          bindGroupLayouts: stage === "post" ? [this.uboLayout, this.texLayout] : [this.uboLayout],
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
        return {
          ok: false, params,
          diagnostics: [{ line: 1, message: scopeErr.message, severity: "error" }],
        };
      }
      this.stages[stage] = { pipeline, params };
      return { ok: true, diagnostics, params };
    } catch (e) {
      await this.device.popErrorScope().catch(() => null);
      return {
        ok: false, params,
        diagnostics: [{ line: 1, message: (e as Error).message, severity: "error" }],
      };
    }
  }

  stageParams(): Record<StageId, CustomParam[]> {
    return {
      bg: this.stages.bg.params,
      fg: this.stages.fg.params,
      post: this.stages.post.params,
    };
  }

  frame(time: number, audio: AudioFeatures, p: EffectiveParams): void {
    packUniforms(this.uniformData, this.width, this.height, time, audio, p);
    this.device.queue.writeBuffer(this.ubo, 0, this.uniformData);

    const enc = this.device.createCommandEncoder();

    // Pass 1+2: bg then additive fg into sceneTex
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: this.sceneTex.createView(),
          loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      pass.setBindGroup(0, this.uboBindGroup);
      if (this.stages.bg.pipeline) {
        pass.setPipeline(this.stages.bg.pipeline);
        pass.draw(3);
      }
      if (this.stages.fg.pipeline) {
        pass.setPipeline(this.stages.fg.pipeline);
        pass.draw(3);
      }
      pass.end();
    }

    // Pass 3: post(sceneTex, pong) -> ping
    const postGroup = this.device.createBindGroup({
      layout: this.texLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.sceneTex.createView() },
        { binding: 2, resource: this.pong.createView() },
      ],
    });
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: this.ping.createView(),
          loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      pass.setBindGroup(0, this.uboBindGroup);
      if (this.stages.post.pipeline) {
        pass.setPipeline(this.stages.post.pipeline);
        pass.setBindGroup(1, postGroup);
        pass.draw(3);
      }
      pass.end();
    }

    // Pass 4: present ping -> canvas
    const presentGroup = this.device.createBindGroup({
      layout: this.texLayout,
      entries: [
        { binding: 0, resource: this.sampler },
        {
          binding: 1,
          resource: (this.stages.post.pipeline ? this.ping : this.sceneTex).createView(),
        },
        { binding: 2, resource: this.pong.createView() },
      ],
    });
    {
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: this.ctx.getCurrentTexture().createView(),
          loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      pass.setPipeline(this.presentPipeline);
      pass.setBindGroup(0, this.uboBindGroup);
      pass.setBindGroup(1, presentGroup);
      pass.draw(3);
      pass.end();
    }

    this.device.queue.submit([enc.finish()]);

    // Pass 5: swap feedback targets
    const tmp = this.ping; this.ping = this.pong; this.pong = tmp;
  }

  destroy(): void {
    try { this.device?.destroy(); } catch { /* already gone */ }
  }
}
