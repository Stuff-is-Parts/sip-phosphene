/// <reference types="@webgpu/types" />
// The single browser render-plan interpreter — one shared consumer of the
// engine's render plan value, used by both src/studio.mjs and src/player.mjs
// (reviewer 2026-07-18 item 3). Removing the duplicate keeps the Player
// and Studio from implementing the same native plan differently as new
// pass kinds arrive; it also concentrates every WebGPU choice (pipelines,
// sampler modes, ping-pong texture management, bind groups) in one place.
//
// Substrate model (reviewer 2026-07-18 substrate spec): the executor
// receives an explicit resource plan — resources[] with descriptors,
// passes[] with reads/writes naming resource ids, and presentation
// naming one resource to blit onto the canvas. The executor owns
// only WebGPU state (device buffers, pipelines, sampler cache, and
// per-resource physical textures). It does not infer inputs from pass
// position, does not choose targets based on whether a pass is last,
// and does not synthesize resources the plan did not declare.
import { feedbackWGSL, compositeWGSL, plane9BlurWGSL } from './render-wgsl.mjs';
import { buildStripIndices, buildWarpUVs, meshPositions, VERT_COUNT } from './warp-mesh.mjs';

// WGSL blit shader: samples a texture and writes it to the canvas using
// the canvas format. Used to present any transient/persistent texture
// to the swapchain regardless of its format.
const blitWGSL = /* wgsl */`
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var p = array<vec2<f32>,3>(vec2(-1.0,-3.0), vec2(-1.0,1.0), vec2(3.0,1.0));
  var o: VSOut;
  o.pos = vec4(p[i], 0.0, 1.0);
  o.uv = vec2(0.5*p[i].x+0.5, 0.5 - 0.5*p[i].y);
  return o;
}
@fragment fn fs(in: VSOut) -> @location(0) vec4<f32> {
  return textureSample(t, s, in.uv);
}`;

/**
 * Build a per-canvas render context that owns the WebGPU device resources
 * shared across all frames: shader modules, pipelines, samplers, uniform
 * buffers, static mesh buffers, and physical textures allocated from the
 * plan's resource descriptors. Call `executeFrame(plan)` each frame with
 * the engine's current resource plan. `resize()` reallocates textures
 * when the canvas changes size.
 *
 * @param {GPUDevice} device
 * @param {HTMLCanvasElement} canvas
 * @param {GPUCanvasContext} ctx
 * @param {GPUTextureFormat} fmt
 */
export function createRenderContext(device, canvas, ctx, fmt) {
  // Physical texture pool keyed by resource id. Persistent-pingpong
  // resources allocate two physical textures with a currentIdx pointer
  // that flips after each write. Transient/per-frame resources allocate
  // one texture (or none if the resource is 'presentation', which uses
  // the swapchain at present time).
  /** @type {Map<string, {desc:import('./engine.mjs').ResourceDescriptor, resolvedFormat:GPUTextureFormat, resolvedW:number, resolvedH:number, resolvedUsage:number, textures:GPUTexture[], currentIdx:number}>} */
  const resourcePool = new Map();
  const canvasSize = () => ({
    canvasW: Math.max(16, canvas.width | 0),
    canvasH: Math.max(16, canvas.height | 0),
    blockW: Math.max(16, Math.ceil(canvas.width / 16) * 16),
    blockH: Math.max(16, Math.ceil(canvas.height / 16) * 16),
  });
  /** @param {import('./engine.mjs').ResourceDescriptor} desc */
  function resolveFormat(desc) {
    if (desc.format === 'preferred-canvas') return fmt;
    return /** @type {GPUTextureFormat} */ ('rgba8unorm');
  }
  /** @param {import('./engine.mjs').ResourceDescriptor} desc */
  function resolveSize(desc) {
    const { canvasW, canvasH, blockW, blockH } = canvasSize();
    if (desc.size.policy === 'canvas-16block') return { w: blockW, h: blockH };
    return { w: canvasW, h: canvasH };
  }
  /** @param {import('./engine.mjs').ResourceDescriptor} desc — WebGPU usage flags derived from declared usage entries only. */
  function resolveUsage(desc) {
    let u = 0;
    for (const use of desc.usage) {
      if (use === 'sampled') u |= GPUTextureUsage.TEXTURE_BINDING;
      else if (use === 'render-attachment') u |= GPUTextureUsage.RENDER_ATTACHMENT;
      // 'presentation' is a plan-level marker — the executor blits into
      // the swapchain and does not add any GPU usage flag for it.
    }
    return u;
  }
  /**
   * Allocate or reuse physical textures backing a resource descriptor for
   * this frame. Reuses the current allocation only when every
   * allocation-relevant field is unchanged: id, kind, resolved format,
   * resolved width, resolved height, lifetime, resolved usage. If any
   * change, destroy and recreate the physical textures and replace the
   * stored descriptor snapshot.
   * @param {import('./engine.mjs').ResourceDescriptor} desc
   */
  function ensureResource(desc) {
    if (desc.kind === 'presentation') return;
    const { w, h } = resolveSize(desc);
    const format = resolveFormat(desc);
    const usage = resolveUsage(desc);
    const entry = resourcePool.get(desc.id);
    if (entry
        && entry.desc.kind === desc.kind
        && entry.desc.lifetime === desc.lifetime
        && entry.resolvedFormat === format
        && entry.resolvedW === w
        && entry.resolvedH === h
        && entry.resolvedUsage === usage) return;
    if (entry) for (const t of entry.textures) t.destroy();
    const count = desc.lifetime === 'persistent-pingpong' ? 2 : 1;
    const textures = [];
    for (let i = 0; i < count; i++) textures.push(device.createTexture({ size: [w, h], format, usage }));
    resourcePool.set(desc.id, { desc, resolvedFormat: format, resolvedW: w, resolvedH: h, resolvedUsage: usage, textures, currentIdx: 0 });
  }
  /**
   * Return the physical texture backing a resource for the given role.
   * For persistent-pingpong resources, 'read' returns the just-written
   * texture and 'write' returns the alternate texture; a subsequent
   * writeSwap() flips the current pointer.
   * @param {string} resourceId
   * @param {'read'|'write'} role
   */
  function textureFor(resourceId, role) {
    const entry = resourcePool.get(resourceId);
    if (!entry) throw new Error(`render executor: resource "${resourceId}" is not allocated`);
    if (entry.desc.lifetime === 'persistent-pingpong') {
      if (role === 'read') return /** @type {GPUTexture} */ (entry.textures[entry.currentIdx]);
      return /** @type {GPUTexture} */ (entry.textures[1 - entry.currentIdx]);
    }
    return /** @type {GPUTexture} */ (entry.textures[0]);
  }
  /** @param {string} resourceId */
  function writeSwap(resourceId) {
    const entry = resourcePool.get(resourceId);
    if (!entry) return;
    if (entry.desc.lifetime === 'persistent-pingpong') entry.currentIdx = 1 - entry.currentIdx;
  }
  function resize() {
    // Force reallocation on next executeFrame by destroying all textures
    // whose stored resolved dimensions no longer match the current canvas.
    for (const [rid, entry] of resourcePool) {
      const { w, h } = resolveSize(entry.desc);
      if (entry.resolvedW !== w || entry.resolvedH !== h) {
        for (const t of entry.textures) t.destroy();
        resourcePool.delete(rid);
      }
    }
  }

  const mod = device.createShaderModule({ code: feedbackWGSL });
  const blitMod = device.createShaderModule({ code: compositeWGSL });
  const blitOnlyMod = device.createShaderModule({ code: blitWGSL });
  const p9BlurMod = device.createShaderModule({ code: plane9BlurWGSL });
  // warp-pass address mode follows the wrap variable per frame (texaddr,
  // milkdropfs.cpp:1991); composite keeps WRAP for the overscan edge
  // per the :4086-4088 comment.
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
  // Pipeline cache keyed by (pass-kind, target-format) so a pass writing
  // rgba8unorm and a pass writing the canvas format get distinct
  // pipelines. Pipeline creation lazily happens on first use per key.
  /** @type {Map<string, GPURenderPipeline>} */
  const pipelineCache = new Map();
  /** @param {string} kind @param {GPUTextureFormat} targetFmt */
  function warpPipeline(kind, targetFmt) {
    const key = kind + '|' + targetFmt;
    let p = pipelineCache.get(key);
    if (p) return p;
    p = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      vertex: { module: mod, entryPoint: 'vs', buffers: [
        { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
        { arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] },
      ] },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format: targetFmt }] },
      primitive: { topology: 'triangle-list' },
    });
    pipelineCache.set(key, p);
    return p;
  }
  /** @param {GPUTextureFormat} targetFmt */
  function compositePipeline(targetFmt) {
    const key = 'composite|' + targetFmt;
    let p = pipelineCache.get(key);
    if (p) return p;
    p = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: blitMod, entryPoint: 'vs' },
      fragment: { module: blitMod, entryPoint: 'fs', targets: [{ format: targetFmt }] },
      primitive: { topology: 'triangle-list' },
    });
    pipelineCache.set(key, p);
    return p;
  }
  // Plane9 blur pipeline cache — one pipeline per (pass, targetFmt).
  // The uniform buffer for gSourceTextureSize+gBrightness is created
  // once and rewritten per pass.
  const p9BlurUbuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  /** @param {number} passNumber @param {GPUTextureFormat} targetFmt */
  function plane9BlurPipeline(passNumber, targetFmt) {
    const key = 'plane9-blur|' + passNumber + '|' + targetFmt;
    let p = pipelineCache.get(key);
    if (p) return p;
    p = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: p9BlurMod, entryPoint: 'vs' },
      fragment: { module: p9BlurMod, entryPoint: 'fs' + passNumber, targets: [{ format: targetFmt }] },
      primitive: { topology: 'triangle-list' },
    });
    pipelineCache.set(key, p);
    return p;
  }
  /** @param {GPUTextureFormat} targetFmt */
  function blitPipeline(targetFmt) {
    const key = 'blit|' + targetFmt;
    let p = pipelineCache.get(key);
    if (p) return p;
    p = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: blitOnlyMod, entryPoint: 'vs' },
      fragment: { module: blitOnlyMod, entryPoint: 'fs', targets: [{ format: targetFmt }] },
      primitive: { topology: 'triangle-list' },
    });
    pipelineCache.set(key, p);
    return p;
  }

  /**
   * Execute the render plan the engine returned for this frame. Allocates
   * physical textures for each resource in the plan, walks passes in
   * order dispatching by reads/writes, then blits the presentation
   * resource to the canvas. Refuses plans whose passes name undeclared
   * resources, plans without a presentation, plans whose composite pass
   * targets a resource that is not a canvas presentation, or clear/warp
   * passes whose target format is incompatible with the resource.
   * @param {import('./engine.mjs').RenderPlan|null} plan
   */
  function executeFrame(plan) {
    if (!plan) throw new Error('render executor: no plan supplied — refusing');
    if (!plan.presentation) throw new Error('render executor: plan has no presentation resource — refusing');
    // Drop pooled resources the plan no longer declares.
    for (const [rid, entry] of resourcePool) {
      if (!plan.resources.some((r) => r.id === rid)) {
        for (const t of entry.textures) t.destroy();
        resourcePool.delete(rid);
      }
    }
    // Allocate or reuse physical textures for every non-presentation
    // resource; ensureResource compares the full allocation-relevant
    // descriptor and reallocates when any field changed.
    for (const r of plan.resources) if (r.kind !== 'presentation') ensureResource(r);
    const presDesc = plan.resources.find((r) => r.id === /** @type {{resourceId:string}} */ (plan.presentation).resourceId);
    if (!presDesc) throw new Error(`render executor: presentation resource "${plan.presentation.resourceId}" not declared in plan.resources — refusing`);

    const enc = device.createCommandEncoder();
    for (const p of plan.passes) {
      if (p.kind === 'clear-color') {
        if (p.writes.length !== 1) throw new Error(`render executor: clear-color pass must write exactly one resource, wrote ${p.writes.length} — refusing`);
        const writeId = /** @type {string} */ (p.writes[0]);
        const target = textureFor(writeId, 'write');
        const rp = enc.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: p.clear.r, g: p.clear.g, b: p.clear.b, a: p.clear.a } }] });
        rp.end();
        writeSwap(writeId);
      } else if (p.kind === 'warp-feedback') {
        if (p.reads.length !== 1 || p.writes.length !== 1) throw new Error('render executor: warp-feedback must read one and write one resource — refusing');
        const readId = /** @type {string} */ (p.reads[0]);
        const writeId = /** @type {string} */ (p.writes[0]);
        if (readId !== writeId) throw new Error(`render executor: warp-feedback expects a persistent-pingpong resource where read and write ids match ("${readId}" vs "${writeId}") — refusing`);
        const m = p.motion;
        const ib = p.borders.inner ?? { size: 0, r: 0, g: 0, b: 0, a: 0, aGate: 0 };
        const ob = p.borders.outer ?? { size: 0, r: 0, g: 0, b: 0, a: 0, aGate: 0 };
        const u = new Float32Array([m.decay, ib.size, ib.r, ib.g, ib.b, ib.a, ib.aGate, ob.size, ob.r, ob.g, ob.b, ob.a, ob.aGate, 0, 0, 0]);
        device.queue.writeBuffer(ubuf, 0, u);
        const readTex = textureFor(readId, 'read');
        const writeTex = textureFor(writeId, 'write');
        const readDesc = /** @type {any} */ (resourcePool.get(readId)).desc;
        const targetFmt = resolveFormat(readDesc);
        // Rebuild warped UVs from motion + current size
        const { w, h } = resolveSize(readDesc);
        buildWarpUVs(m, w, h, uvArr);
        device.queue.writeBuffer(uvBuf, 0, uvArr);
        const samp = (m.wrap > 0.5) ? sampWrap : sampClamp;
        const bg = device.createBindGroup({ layout: bgl, entries: [
          { binding: 0, resource: readTex.createView() },
          { binding: 1, resource: samp },
          { binding: 2, resource: { buffer: ubuf } },
        ] });
        const pipe = warpPipeline('warp-feedback', targetFmt);
        const rp = enc.beginRenderPass({ colorAttachments: [{ view: writeTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
        rp.setPipeline(pipe); rp.setBindGroup(0, bg); rp.setVertexBuffer(0, posBuf); rp.setVertexBuffer(1, uvBuf); rp.setIndexBuffer(ibuf, 'uint16'); rp.drawIndexed(meshIdx.length); rp.end();
        writeSwap(writeId);
      } else if (p.kind === 'composite') {
        if (p.reads.length !== 1 || p.writes.length !== 1) throw new Error('render executor: composite must read one and write one resource — refusing');
        const readId = /** @type {string} */ (p.reads[0]);
        const writeId = /** @type {string} */ (p.writes[0]);
        const writeDesc = plan.resources.find((r) => r.id === writeId);
        if (!writeDesc || writeDesc.kind !== 'presentation') throw new Error(`render executor: composite target "${writeId}" must be a presentation resource — refusing`);
        // aspectY comes from the composite pass spec (engine placed it
        // there from the referenced warp-feedback producer at planning
        // time); the executor never re-reads a prior pass at draw time.
        const compAspectY = /** @type {any} */ (p.comp).aspectY;
        if (typeof compAspectY !== 'number') throw new Error('render executor: composite pass spec is missing comp.aspectY — refusing');
        const aspect = canvas.width / (canvas.height * (1 / compAspectY));
        const cx2 = (aspect > 1 ? 1 : 1 / aspect) * (1 + 1 / canvas.width), cy2 = (aspect > 1 ? aspect : 1) * (1 + 1 / canvas.height);
        const c = p.comp;
        device.queue.writeBuffer(cbuf, 0, new Float32Array([c.gamma, c.echoAlpha, c.echoZoom, c.echoOrient, cx2, cy2, 0, 0]));
        const readTex = textureFor(readId, 'read');
        const targetFmt = fmt; // presentation resource uses canvas format
        const pipe = compositePipeline(targetFmt);
        const bbg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
          { binding: 0, resource: readTex.createView() },
          { binding: 1, resource: sampWrap },
          { binding: 2, resource: { buffer: cbuf } },
        ] });
        const rp = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
        rp.setPipeline(pipe); rp.setBindGroup(0, bbg); rp.draw(3); rp.end();
      } else if (p.kind === 'plane9-rendertotexture') {
        // Plane9 RenderToTexture — blit the source resource into the
        // target resource using the same blit shader the presentation
        // path uses. DLL description at Plane9Engine.dll 0x1f8ad4
        // ("Converts a render port to a texture port."); the actual
        // operation is a texture copy of the incoming rendered surface.
        if (p.reads.length !== 1 || p.writes.length !== 1) throw new Error('render executor: plane9-rendertotexture must read one and write one resource — refusing');
        const readId = /** @type {string} */ (p.reads[0]);
        const writeId = /** @type {string} */ (p.writes[0]);
        const writeDesc = /** @type {any} */ (resourcePool.get(writeId))?.desc;
        if (!writeDesc) throw new Error(`render executor: plane9-rendertotexture target "${writeId}" not allocated — refusing`);
        const readTex = textureFor(readId, 'read');
        const writeTex = textureFor(writeId, 'write');
        const targetFmt = resolveFormat(writeDesc);
        const pipe = blitPipeline(targetFmt);
        const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
          { binding: 0, resource: readTex.createView() },
          { binding: 1, resource: sampClamp },
        ] });
        const rp = enc.beginRenderPass({ colorAttachments: [{ view: writeTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
        rp.setPipeline(pipe); rp.setBindGroup(0, bg); rp.draw(3); rp.end();
        writeSwap(writeId);
      } else if (p.kind === 'plane9-blur') {
        // Plane9 blur pass — samples the source resource once through
        // the shader's kernel and writes to the target resource. The
        // gSourceTextureSize uniform is computed from the source
        // texture's actual dimensions each frame (1/w, 1/h).
        if (p.reads.length !== 1 || p.writes.length !== 1) throw new Error('render executor: plane9-blur must read one and write one resource — refusing');
        const readId = /** @type {string} */ (p.reads[0]);
        const writeId = /** @type {string} */ (p.writes[0]);
        const readDesc = /** @type {any} */ (resourcePool.get(readId))?.desc;
        const writeDesc = /** @type {any} */ (resourcePool.get(writeId))?.desc;
        if (!readDesc || !writeDesc) throw new Error(`render executor: plane9-blur references resource(s) not allocated (read="${readId}", write="${writeId}") — refusing`);
        const readTex = textureFor(readId, 'read');
        const writeTex = textureFor(writeId, 'write');
        const { w: srcW, h: srcH } = resolveSize(readDesc);
        const targetFmt = resolveFormat(writeDesc);
        device.queue.writeBuffer(p9BlurUbuf, 0, new Float32Array([1 / srcW, 1 / srcH, p.brightness, 0]));
        const pipe = plane9BlurPipeline(p.pass, targetFmt);
        const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
          { binding: 0, resource: readTex.createView() },
          { binding: 1, resource: sampClamp },
          { binding: 2, resource: { buffer: p9BlurUbuf } },
        ] });
        const rp = enc.beginRenderPass({ colorAttachments: [{ view: writeTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
        rp.setPipeline(pipe); rp.setBindGroup(0, bg); rp.draw(3); rp.end();
        writeSwap(writeId);
      } else {
        throw new Error('render executor: unknown render pass kind: ' + /** @type {any} */ (p).kind);
      }
    }
    // Presentation: if the composite pass already targeted the canvas
    // presentation resource, its writes wrote the swapchain directly and
    // no blit is needed. Otherwise blit the presented resource's texture
    // to the swapchain using the canvas format.
    const compositeWrotePresentation = plan.passes.some((p) => p.kind === 'composite' && p.writes.includes(/** @type {{resourceId:string}} */ (plan.presentation).resourceId));
    if (!compositeWrotePresentation) {
      const presId = plan.presentation.resourceId;
      const readTex = textureFor(presId, 'read');
      const pipe = blitPipeline(fmt);
      const bg = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
        { binding: 0, resource: readTex.createView() },
        { binding: 1, resource: sampClamp },
      ] });
      const rp = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
      rp.setPipeline(pipe); rp.setBindGroup(0, bg); rp.draw(3); rp.end();
    }
    device.queue.submit([enc.finish()]);
  }

  /**
   * Destroy every pooled scene-specific texture and clear the pool.
   * Immutable device resources (shader modules, pipelines, samplers,
   * uniform buffers, static mesh buffers) are retained across scene
   * loads because they encode API contracts, not scene state. Called
   * by Studio's atomic applyScene sequence so the new engine's plan
   * starts from a clean texture pool rather than reusing physical
   * textures allocated for the prior scene's resource ids.
   */
  function resetScene() {
    for (const entry of resourcePool.values()) for (const t of entry.textures) t.destroy();
    resourcePool.clear();
  }

  return {
    executeFrame,
    resize,
    resetScene,
    get texW() {
      const { blockW } = canvasSize(); return blockW;
    },
    get texH() {
      const { blockH } = canvasSize(); return blockH;
    },
  };
}
