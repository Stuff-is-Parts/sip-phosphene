/// <reference types="@webgpu/types" />
// The single browser render-plan interpreter — one shared consumer of the
// engine's render plan value, used by both src/studio.mjs and src/player.mjs
// (reviewer 2026-07-18 item 3). Removing the duplicate keeps the Player
// and Studio from implementing the same native plan differently as new
// pass kinds arrive; it also concentrates every WebGPU choice (pipelines,
// sampler modes, ping-pong texture management, bind groups) in one place.
import { feedbackWGSL, compositeWGSL } from './render-wgsl.mjs';
import { buildStripIndices, buildWarpUVs, meshPositions, VERT_COUNT } from './warp-mesh.mjs';

/**
 * Build a per-canvas render context that owns the WebGPU device resources
 * shared across all frames: shader modules, pipelines, samplers, uniform
 * buffers, static mesh buffers, and the feedback texture pair. Call
 * `executeFrame(plan)` each frame with the engine's current render plan.
 * `resize(w, h)` reallocates the feedback textures when the canvas
 * changes size.
 *
 * @param {GPUDevice} device
 * @param {HTMLCanvasElement} canvas
 * @param {GPUCanvasContext} ctx
 * @param {GPUTextureFormat} fmt
 */
export function createRenderContext(device, canvas, ctx, fmt) {
  const U = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
  /** @type {GPUTexture|undefined} */ let tA;
  /** @type {GPUTexture|undefined} */ let tB;
  let texW = 0, texH = 0;
  const rebuildTargets = () => {
    const w = Math.max(16, Math.ceil(canvas.width / 16) * 16), h = Math.max(16, Math.ceil(canvas.height / 16) * 16);
    if (w === texW && h === texH) return;
    texW = w; texH = h;
    if (tA) tA.destroy();
    if (tB) tB.destroy();
    tA = device.createTexture({ size: [texW, texH], format: 'rgba8unorm', usage: U });
    tB = device.createTexture({ size: [texW, texH], format: 'rgba8unorm', usage: U });
  };
  rebuildTargets();
  const mod = device.createShaderModule({ code: feedbackWGSL });
  const blitMod = device.createShaderModule({ code: compositeWGSL });
  // warp-pass address mode follows the wrap variable per frame (texaddr,
  // WarpedBlit_NoShaders milkdropfs.cpp:1991); composite keeps WRAP for
  // the overscan edge per the :4086-4088 comment.
  const sampWrap = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' });
  const sampClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const ubuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const meshIdx = buildStripIndices();
  const ibuf = device.createBuffer({ size: meshIdx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ibuf, 0, meshIdx);
  const posArr = meshPositions();
  const posBuf = device.createBuffer({ size: posArr.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(posBuf, 0, posArr);
  const uvArr = new Float32Array(VERT_COUNT * 2);
  const uvBuf = device.createBuffer({ size: uvArr.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const cbuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bgl = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
  ] });
  const pipe = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
    vertex: { module: mod, entryPoint: 'vs', buffers: [
      { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
      { arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] },
    ] },
    fragment: { module: mod, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' },
  });
  const blitPipe = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: blitMod, entryPoint: 'vs' },
    fragment: { module: blitMod, entryPoint: 'fs', targets: [{ format: fmt }] },
    primitive: { topology: 'triangle-list' },
  });

  /**
   * Execute the render plan the engine returned for this frame. Walks
   * plan.passes in order and dispatches each pass by kind. The single
   * source of truth for how a native pass becomes WebGPU commands.
   * @param {import('./engine.mjs').RenderPlan|null} plan
   */
  function executeFrame(plan) {
    if (!plan) throw new Error('render executor: no plan supplied — the engine reported no presentation sink');
    const enc = device.createCommandEncoder();
    let swapNeeded = false;
    /** @type {any} */
    let lastMotion = null;
    for (const p of plan.passes) {
      if (p.kind === 'clear-color') {
        const rp = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: p.clear.r, g: p.clear.g, b: p.clear.b, a: p.clear.a } }] });
        rp.end();
      } else if (p.kind === 'warp-feedback') {
        const m = p.motion;
        // borders fold into the warp-feedback pass; a warp-feedback pass
        // whose borders were never populated draws zero-alpha rings
        const ib = p.borders.inner ?? { size: 0, r: 0, g: 0, b: 0, a: 0, aGate: 0 };
        const ob = p.borders.outer ?? { size: 0, r: 0, g: 0, b: 0, a: 0, aGate: 0 };
        const u = new Float32Array([m.decay, ib.size, ib.r, ib.g, ib.b, ib.a, ib.aGate, ob.size, ob.r, ob.g, ob.b, ob.a, ob.aGate, 0, 0, 0]);
        device.queue.writeBuffer(ubuf, 0, u);
        buildWarpUVs(m, texW, texH, uvArr);
        device.queue.writeBuffer(uvBuf, 0, uvArr);
        const samp = (m.wrap > 0.5) ? sampWrap : sampClamp; // texaddr, milkdropfs.cpp:1991
        const bg = device.createBindGroup({ layout: bgl, entries: [
          { binding: 0, resource: /** @type {GPUTexture} */ (tA).createView() },
          { binding: 1, resource: samp },
          { binding: 2, resource: { buffer: ubuf } },
        ] });
        const rp = enc.beginRenderPass({ colorAttachments: [{ view: /** @type {GPUTexture} */ (tB).createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
        rp.setPipeline(pipe); rp.setBindGroup(0, bg); rp.setVertexBuffer(0, posBuf); rp.setVertexBuffer(1, uvBuf); rp.setIndexBuffer(ibuf, 'uint16'); rp.drawIndexed(meshIdx.length); rp.end();
        swapNeeded = true;
        lastMotion = m;
      } else if (p.kind === 'composite') {
        if (!lastMotion) throw new Error('render executor: composite pass reached without a prior warp-feedback pass — refusing');
        const aspect = canvas.width / (canvas.height * (1 / lastMotion.aspectY));
        const cx2 = (aspect > 1 ? 1 : 1 / aspect) * (1 + 1 / canvas.width), cy2 = (aspect > 1 ? aspect : 1) * (1 + 1 / canvas.height);
        const c = p.comp;
        device.queue.writeBuffer(cbuf, 0, new Float32Array([c.gamma, c.echoAlpha, c.echoZoom, c.echoOrient, cx2, cy2, 0, 0]));
        const bbg = device.createBindGroup({ layout: blitPipe.getBindGroupLayout(0), entries: [
          { binding: 0, resource: /** @type {GPUTexture} */ (tB).createView() },
          { binding: 1, resource: sampWrap },
          { binding: 2, resource: { buffer: cbuf } },
        ] });
        const rp = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
        rp.setPipeline(blitPipe); rp.setBindGroup(0, bbg); rp.draw(3); rp.end();
      } else {
        throw new Error('render executor: unknown render pass kind: ' + /** @type {any} */ (p).kind);
      }
    }
    device.queue.submit([enc.finish()]);
    if (swapNeeded) { const t = tA; tA = tB; tB = t; }
  }

  return {
    executeFrame,
    resize: rebuildTargets,
    get texW() { return texW; },
    get texH() { return texH; },
  };
}
