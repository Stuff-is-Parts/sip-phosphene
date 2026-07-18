/// <reference types="@webgpu/types" />
// PHOSPHENE studio application shell — extracted from studio.html so the
// five-tool gate (syntax, tsc, eslint, stylelint, knip) covers it like any
// other module. The page keeps only markup and CSS.
import { parsePhos, toRuntime, serializePhos, updateScene, milkToPhos, assessRecords } from './phos.mjs';
import { importMilk, scanMilk } from './milk-import.mjs';
import { extractSceneXml, scanP9, assessP9Records, p9ToPhos } from './p9-import.mjs';
import { Engine, NATIVE_OPS } from './engine.mjs';
import { AudioEngine } from './audio/sources.mjs';
import { feedbackWGSL, compositeWGSL } from './render-wgsl.mjs';
import { buildStripIndices, buildWarpUVs, meshPositions, VERT_COUNT } from './warp-mesh.mjs';
// DOM lookup helpers: the page ships these elements statically, so absence is
// a build defect — assert once here instead of null-checking every use.
/** @param {string} id @returns {HTMLElement} */
const $ = (id) => { const el = document.getElementById(id); if (!el) throw new Error('missing #' + id); return el; };
/** @param {string} id @returns {HTMLInputElement} */
const $in = (id) => /** @type {HTMLInputElement} */ (/** @type {unknown} */ ($(id)));
/** @param {string} id @returns {HTMLCanvasElement} */
const $cv = (id) => /** @type {HTMLCanvasElement} */ (/** @type {unknown} */ ($(id)));
/** @param {string} id @returns {any} */
const $any = (id) => /** @type {any} */ ($(id));
/** @param {unknown} e @returns {string} */
const errMsg = (e) => e instanceof Error ? e.message : String(e);
// CodeMirror is a vendored classic script on the page, not a module import
const CodeMirror = /** @type {any} */ (globalThis).CodeMirror;


// ---- load content (native .phos scene; .milk remains an export format) ----
const sceneText = await (await fetch('./scenes/md-101-per_frame.phos')).text();
let sceneDoc = parsePhos(sceneText);        // the durable scene document
let scene = toRuntime(sceneDoc);            // flattened runtime IR the engine consumes
let engine = new Engine(scene);
// immutable serialization of the loaded scene — Reset re-parses THIS, so it
// restores everything: metadata, vars, equations, engine state, UI, dirty
let baselineText = serializePhos(sceneDoc);

// load a new scene document as the baseline (initial load, template button)
/** @param {any} doc */
function loadDoc(doc){ baselineText = serializePhos(doc); applyScene(doc); updateSrcBtn(); }
// swap in a scene document and refresh the whole UI
/** @param {any} doc */
function applyScene(doc){
  sceneDoc = doc; scene = toRuntime(doc); engine = new Engine(scene);
  renderGraph(); renderMetaInputs();
  eqEl.value = scene.expressions.perFrame.join('\n');
  renderSceneStrip();
  setDirty(false);
}
// Count all value ports across all nodes (post-refactor node-local storage)
function countPortValues(){
  let n = 0;
  for (const node of scene.nodes) for (const p of Object.values(/** @type {Record<string,{value?:unknown}>} */ (node.ports))) if ('value' in p) n++;
  return n;
}
// the scene NAME is the strip's title; the meta line carries counts only
function renderSceneStrip(){
  $('sceneTitle').textContent = String(scene.meta.name);
  $('meta').textContent = scene.expressions.perFrame.length + ' per-frame eq · ' + countPortValues() + ' vars';
}
// Reset acts on the dirty state, so it renders beside the marker and only
// while something is there to reset (display toggled in JS — a page [hidden]
// rule on the host would be component-element CSS the stylelint ban rejects)
/** @param {boolean} v */
const setDirty = v => {
  $('dirty').innerHTML = v ? '<span class="dirty-dot">● modified</span>' : '';
  $('reset').style.display = v ? '' : 'none';
};

// ---- metadata (view + edit — VSLICE-MOSCOW metadata editing) ----
const metaEl = $('metaEdit');
function renderMetaInputs(){
  metaEl.innerHTML = '';
  for (const key of ['name','author','description']) {
    const p = document.createElement('div'); p.className = 'port';
    p.innerHTML = `<label>${key}</label>`;
    const inp = document.createElement('input'); inp.type = 'text';
    inp.value = typeof sceneDoc.meta[key] === 'string' ? sceneDoc.meta[key] : '';
    inp.addEventListener('change', () => {
      sceneDoc.meta[key] = inp.value;
      if (key === 'name') { scene.meta.name = inp.value; renderSceneStrip(); }
      setDirty(true);
    });
    p.append(inp); metaEl.append(p);
  }
}
renderMetaInputs();
renderSceneStrip();

// ---- new scene from the commented template (VSLICE-MOSCOW template UI) ----
$('newScene').onclick = async () => {
  loadDoc(parsePhos(await (await fetch('./scenes/TEMPLATE.phos')).text()));
};

// ---- render the IR as a node graph (MUST: show IR, ports, values) ----
// Each node's ports come from the .phos verbatim; each editable float port
// is bound by "nodeId.portName" so scenes with duplicate port names across
// nodes (Plane9 Color Cycle carries three MinMax nodes) are unambiguous.
const graphEl = $('graph');
function renderGraph() {
  graphEl.innerHTML = '';
  // Every port that the .phos declares appears in the graph, labeled by
  // direction (in/out/render) so the graph surface is fully visible per
  // the reviewer's finding 8 (2026-07-18). Constant floats and vec2/3/4s
  // are editable; render-typed ports are shown as edges-only.
  for (const node of scene.nodes) {
    const n = document.createElement('div'); n.className = 'node';
    n.innerHTML = `<div class="node-h">${node.id}<span class="prim">${node.op}</span></div>`;
    const opDecl = /** @type {any} */ (window).__opsRegistry?.[node.op];
    const isOutput = /** @param {string} k */ (k) => opDecl ? (opDecl.outputs && k in opDecl.outputs) : false;
    for (const [key, port] of Object.entries(/** @type {Record<string,{type:string,value?:number|number[]}>} */ (node.ports))) {
      const p = document.createElement('div'); p.className = 'port';
      const dirTag = port.type === 'render' ? 'render' : (isOutput(key) ? 'out' : 'in');
      p.innerHTML = `<label>${key} <span class="port-type">(${dirTag} · ${port.type})</span></label>`;
      const qualified = node.id + '.' + key;
      if (port.type === 'render') {
        // structural — value comes from an edge; no editable field
        const s = document.createElement('span'); s.className = 'edge-only'; s.textContent = '(edge-only)';
        p.append(s); n.append(p); continue;
      }
      if (!('value' in port)) {
        // no constant on this value port — it's either an output or an edge-driven input
        const s = document.createElement('span'); s.className = 'edge-only'; s.textContent = dirTag === 'out' ? '(output)' : '(edge-driven)';
        const live = document.createElement('span'); live.className = 'live'; live.dataset.live = qualified;
        p.append(s, live); n.append(p); continue;
      }
      const inp = document.createElement('input'); inp.type = 'text';
      inp.value = Array.isArray(port.value) ? port.value.join(', ') : String(port.value);
      inp.dataset.key = qualified;
      const dim = { vec2: 2, vec3: 3, vec4: 4 }[port.type];
      inp.addEventListener('change', () => {
        const vt = inp.value.trim();
        if (port.type === 'float') {
          if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(vt)) { engine.setVar(qualified, parseFloat(vt)); setDirty(true); }
          else { inp.value = String(port.value); }
        } else if (dim !== undefined) {
          const parts = vt.split(/[,\s]+/).filter(Boolean).map(Number);
          if (parts.length === dim && parts.every((x) => Number.isFinite(x))) { engine.setVar(qualified, /** @type {any} */ (parts)); setDirty(true); }
          else { inp.value = Array.isArray(port.value) ? port.value.join(', ') : String(port.value); }
        } else {
          inp.value = String(port.value);
        }
      });
      const live = document.createElement('span'); live.className = 'live'; live.dataset.live = qualified;
      p.append(inp, live); n.append(p);
    }
    graphEl.append(n);
  }
  const w = document.createElement('div'); w.className = 'meta';
  w.textContent = scene.edges.map(e => `${e.out} → ${e.in}`).join('   ·   ');
  graphEl.append(w);
}
// Publish NATIVE_OPS to the window so renderGraph can distinguish output
// ports from input ports without threading the registry through every call.
/** @type {any} */ (window).__opsRegistry = NATIVE_OPS;
renderGraph();

// ---- equation editor (MUST: edit equation live) ----
const eqEl = /** @type {HTMLTextAreaElement} */ (/** @type {unknown} */ ($('eq')));
eqEl.value = scene.expressions.perFrame.join('\n');
eqEl.addEventListener('input', () => { eqEl.classList.add('dirty'); setDirty(true); });
eqEl.addEventListener('change', () => {
  const src = eqEl.value.split('\n').map(s=>s.trim()).filter(Boolean);
  try { engine.recompile(src); $('eqstatus').textContent = 'compiled ✓'; $('eqstatus').style.color='var(--good)'; eqEl.classList.remove('dirty'); }
  catch(err){ $('eqstatus').textContent = 'error: '+errMsg(err); $('eqstatus').style.color='#ff6b6b'; }
});

// ---- transport (MUST: play/pause) ----
// master transport: the scene button pauses the WORLD — render loop and
// audio together (AudioEngine.pause suspends the context); the source
// buttons below only choose or stop what is playing
let playing = true;
const playBtn = $('play');
// transitions serialize through one promise chain so a rapid pause/resume
// cannot leave rendering and audio split (external review 2026-07-18)
let transportOp = Promise.resolve();
/** @param {boolean} v */
function setPlaying(v){
  transportOp = transportOp.then(async () => {
    playing = v;
    playBtn.textContent = v ? '⏸ Pause' : '▶ Play';
    if (v) await audio.resume(); else await audio.pause();
  });
  return transportOp;
}
playBtn.onclick = () => setPlaying(!playing);
$('reset').onclick = () => {
  // restore the COMPLETE loaded scene — metadata, vars, equations, engine
  // state, and every input field — by re-parsing the load-time serialization
  applyScene(parsePhos(baselineText));
  eqEl.classList.remove('dirty');
  $('eqstatus').textContent = '';
};
// ---- save .phos (MUST: native save — VSLICE-MOSCOW) ----
$('savePhos').onclick = async () => {
  const eqLines = eqEl.value.split('\n').map(s=>s.trim()).filter(Boolean);
  const out = serializePhos(updateScene(sceneDoc, currentPortValues(), eqLines));
  const blob = new Blob([out], {type:'application/json'});
  const name = (scene.meta.name || 'scene') + '.phos';
  const wsfp = /** @type {any} */ (window).showSaveFilePicker;
  if (wsfp) {
    try { const h = await wsfp({suggestedName:name}); const w = await h.createWritable(); await w.write(blob); await w.close(); setDirty(false); }
    catch { /* cancelled */ }
  } else { const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setDirty(false); }
};

// ---- WebGPU render (MUST: running visual) ----
const canvas = $cv('c');
if (!navigator.gpu) { $('hud').innerHTML = 'WebGPU not available'; }
else {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('WebGPU adapter unavailable');
  const device = await adapter.requestDevice();
  const maybeCtx = canvas.getContext('webgpu');
  if (!maybeCtx) throw new Error('WebGPU canvas context unavailable');
  const ctx = maybeCtx;
  const fmt = navigator.gpu.getPreferredCanvasFormat();
  const dpr = devicePixelRatio||1;
  const U=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING;
  /** @type {GPUTexture|undefined} */ let tA;
  /** @type {GPUTexture|undefined} */ let tB;
  let texW=0,texH=0;
  // render targets follow the canvas (nTexSize -1 auto-exact, plugin.cpp:1851-1852)
  // snapped to 16-pixel blocks (:1879-1880); resize recreates them
  const rebuildTargets=()=>{
    const w=Math.max(16,Math.ceil(canvas.width/16)*16), h=Math.max(16,Math.ceil(canvas.height/16)*16);
    if(w===texW&&h===texH)return;
    texW=w;texH=h;
    if(tA)tA.destroy();if(tB)tB.destroy();
    tA=device.createTexture({size:[texW,texH],format:'rgba8unorm',usage:U});
    tB=device.createTexture({size:[texW,texH],format:'rgba8unorm',usage:U});
  };
  const resize=()=>{canvas.width=canvas.clientWidth*dpr;canvas.height=canvas.clientHeight*dpr;rebuildTargets();};
  resize(); addEventListener('resize',resize);
  ctx.configure({device,format:fmt,alphaMode:'opaque'});
  const mod = device.createShaderModule({code:feedbackWGSL});
  const blitMod = device.createShaderModule({code:compositeWGSL});
  const sampWrap=device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'repeat',addressModeV:'repeat'});
  const sampClamp=device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
  const ubuf=device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const meshIdx=buildStripIndices();
  const ibuf=device.createBuffer({size:meshIdx.byteLength,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(ibuf,0,meshIdx);
  const posArr=meshPositions();
  const posBuf=device.createBuffer({size:posArr.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(posBuf,0,posArr);
  const uvArr=new Float32Array(VERT_COUNT*2);
  const uvBuf=device.createBuffer({size:uvArr.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
  const cbuf=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
  const bgl=device.createBindGroupLayout({entries:[
    {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{}},
    {binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{}},
    {binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
  const pipe=device.createRenderPipeline({layout:device.createPipelineLayout({bindGroupLayouts:[bgl]}),
    vertex:{module:mod,entryPoint:'vs',buffers:[
      {arrayStride:8,attributes:[{shaderLocation:0,offset:0,format:'float32x2'}]},
      {arrayStride:8,attributes:[{shaderLocation:1,offset:0,format:'float32x2'}]}]},
    fragment:{module:mod,entryPoint:'fs',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});
  const blitPipe=device.createRenderPipeline({layout:'auto',vertex:{module:blitMod,entryPoint:'vs'},fragment:{module:blitMod,entryPoint:'fs',targets:[{format:fmt}]},primitive:{topology:'triangle-list'}});

  let last=performance.now(),fpsAcc=0,fpsN=0;
  /** @param {number} now */
  function frame(now){
    const dt=Math.min(0.05,(now-last)/1000); last=now;
    if(playing&&tA&&tB){
      engine.setViewport(canvas.width,canvas.height,texW,texH); // live dims each frame (scene swaps replace the engine)
      audio.analysis.update(dt);
      const a=audio.analysis;
      // Plane9 Beat runs INACTIVE in PHOSPHENE — the upstream detector
      // producing rawBeat is unresolved (PLANE9-CONTRACT.md §Beat). A
      // scene with a Beat node returns NoMusic on its BeatStrength port
      // and any Beat-driven downstream reads that.
      const plan=engine.step(dt,{bass:a.bass,mid:a.mid,treb:a.treb,bass_att:a.bassAtt,mid_att:a.midAtt,treb_att:a.trebAtt,musicActive:false,rawBeat:0});
      if(!plan) throw new Error('engine.step returned no render plan — the graph has no presentation sink');
      drawScope();
      // Execute the sink's render plan generically per pass — no
      // `if (st.clear) else` mode switch (reviewer foundation 2026-07-18).
      const enc=device.createCommandEncoder();
      let swapNeeded=false;
      for(const p of plan.passes){
        if(p.kind==='clear-color'){
          const rp=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:p.clear.r,g:p.clear.g,b:p.clear.b,a:p.clear.a}}]});
          rp.end();
        }else if(p.kind==='warp-feedback'){
          const m=p.motion;
          const ib=p.borders.inner ?? {size:0,r:0,g:0,b:0,a:0,aGate:0};
          const ob=p.borders.outer ?? {size:0,r:0,g:0,b:0,a:0,aGate:0};
          const u=new Float32Array([m.decay,ib.size,ib.r,ib.g,ib.b,ib.a,ib.aGate,ob.size,ob.r,ob.g,ob.b,ob.a,ob.aGate,0,0,0]);
          device.queue.writeBuffer(ubuf,0,u);
          buildWarpUVs(m,texW,texH,uvArr);device.queue.writeBuffer(uvBuf,0,uvArr);
          const samp=(m.wrap>0.5)?sampWrap:sampClamp; // texaddr, milkdropfs.cpp:1991
          const bg=device.createBindGroup({layout:bgl,entries:[{binding:0,resource:tA.createView()},{binding:1,resource:samp},{binding:2,resource:{buffer:ubuf}}]});
          const rp=enc.beginRenderPass({colorAttachments:[{view:tB.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
          rp.setPipeline(pipe);rp.setBindGroup(0,bg);rp.setVertexBuffer(0,posBuf);rp.setVertexBuffer(1,uvBuf);rp.setIndexBuffer(ibuf,'uint16');rp.drawIndexed(meshIdx.length);rp.end();
          swapNeeded=true;
          /** @type {any} */(plan).__lastMotion=m;
        }else if(p.kind==='composite'){
          const m=/** @type {any} */(plan).__lastMotion;
          if(!m)throw new Error('composite pass reached without a prior warp-feedback pass — refusing');
          const aspect=canvas.width/(canvas.height*(1/m.aspectY));
          const cx2=(aspect>1?1:1/aspect)*(1+1/canvas.width), cy2=(aspect>1?aspect:1)*(1+1/canvas.height);
          const c=p.comp;
          device.queue.writeBuffer(cbuf,0,new Float32Array([c.gamma,c.echoAlpha,c.echoZoom,c.echoOrient,cx2,cy2,0,0]));
          const bbg=device.createBindGroup({layout:blitPipe.getBindGroupLayout(0),entries:[{binding:0,resource:tB.createView()},{binding:1,resource:sampWrap},{binding:2,resource:{buffer:cbuf}}]});
          const rp=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
          rp.setPipeline(blitPipe);rp.setBindGroup(0,bbg);rp.draw(3);rp.end();
        }else{
          throw new Error('unknown render pass kind: '+/** @type {any} */(p).kind);
        }
      }
      device.queue.submit([enc.finish()]);
      if(swapNeeded)[tA,tB]=[tB,tA];
      // MUST: live variable readout + live port values
      $('fr').textContent=String(engine.frame);
      fpsAcc+=1/dt;fpsN++; if(fpsN>=15){$('fps').textContent=String(Math.round(fpsAcc/fpsN));fpsAcc=0;fpsN=0;}
      const vd=$('vars'); vd.innerHTML='';
      // time is always present; each other row picks the first numeric
      // reading of a well-known EEL-aliased port so the readout is useful
      // for MilkDrop and honest (empty) for Plane9 scenes without perFrame.
      const readout=['time','ib_r','ib_g','ib_b','decay','Blue','Red','Green'];
      for(const k of readout){ const val=engine.getVar(k); if(val!==undefined&&val!==null&&typeof val==='number'){const r=document.createElement('div');r.className='v';r.innerHTML=`<span>${k}</span><b>${(+val).toFixed(4)}</b>`;vd.append(r);} }
      document.querySelectorAll('[data-live]').forEach(n=>{const el=/** @type {HTMLElement} */(n);const key=el.dataset.live;if(key===undefined)return;const v=engine.getVar(key);if(v!==undefined&&v!==null&&typeof v==='number')el.textContent=(+v).toFixed(3);});
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ---- source ⇄ .phos review + one format-dispatched Import ------------------
// Context-sensitive viewer: dual panes when the scene carries a source from
// another engine (meta.source), a single .phos pane for native scenes, and a
// line-aligned triage report for refused imports. In dual mode every .phos
// line knows its origin — S emitted from a source line, D materialized
// default (converter-added, state.cpp citation attached), W pipeline wiring,
// unmarked JSON framing — with badges in a gutter, each node's default block
// collapsed to one labeled line, and clicks resolving across BOTH panes.
const srcOverlay=$('srcOverlay');
const srcNote=$('srcNote');
/** @type {any} */ let cmSrc=null;
/** @type {any} */ let cmPhos=null;
let lineMap=new Map();     // source line number -> .phos line index
/** @type {any[]} */ let phosMeta=[]; // per-.phos-line origin {kind, srcLine?, label}
/** @type {number[]} */ let hitLines=[];
let selLine=-1;
let alignScroll=false;     // triage mode: lockstep scrolling, no click nav
/** @type {string|null} */ let importedSrcText=null; // in-memory source for imported files (not served)
const foldRuns=new Map();  // .phos line -> {from,to,label} for each node's default block
// CodeMirror's own fold machinery does the folding (foldcode/foldgutter,
// vendored from the same 5.65.18 package): this finder hands it the
// default-block ranges, and falls back to ordinary brace folding elsewhere
/** @param {any} cm @param {any} pos */
function blockFinder(cm,pos){
  const run=foldRuns.get(pos.line);
  if(run)return {from:CodeMirror.Pos(run.fromLine,run.fromCh),to:CodeMirror.Pos(run.toLine,run.toCh)};
  return CodeMirror.fold.brace(cm,pos);
}
function ensureCMs(){
  if(!cmSrc){
    cmSrc=CodeMirror($('cmSrcHost'),{value:'',readOnly:true,lineNumbers:true,mode:null});
    cmSrc.on('cursorActivity',()=>{ if(!alignScroll)jumpFromSource(cmSrc.getCursor().line+1); });
    cmSrc.on('scroll',()=>{ if(alignScroll&&cmPhos)cmPhos.scrollTo(null,cmSrc.getScrollInfo().top); });
  }
  if(!cmPhos){
    cmPhos=CodeMirror($('cmPhosHost'),{value:'',readOnly:true,lineNumbers:true,mode:{name:'javascript',json:true},
      foldGutter:{rangeFinder:blockFinder},
      gutters:['CodeMirror-linenumbers','origin','CodeMirror-foldgutter']});
    cmPhos.on('cursorActivity',()=>{ if(!alignScroll)jumpFromPhos(cmPhos.getCursor().line); });
  }
}
// Review finding 1: the "live" pane must carry unsaved edits. Serialize a
// throwaway clone through the SAME inputs the Save path writes (scene.vars +
// the equation editor's lines, studio Save handler) — sceneDoc is never
// mutated by opening the viewer.
// Build a flat {qualified: value} map of all current float port values —
// consumed by updateScene, which accepts node-qualified keys and disambiguates
// scenes with duplicate port names (Plane9 Color Cycle carries three MinMax
// nodes each with a "Min" port, so the qualified form is required).
function currentPortValues(){
  // Collect every currently-constant port — floats AND vectors. Vector
  // values are read back from the scene doc since the engine's per-node
  // ports store scalar EEL-view values for floats but keep vec-typed
  // values in place.
  /** @type {Record<string,number|number[]>} */
  const out={};
  for(const node of scene.nodes){
    for(const [key,port] of Object.entries(/** @type {Record<string,{value?:unknown}>} */(node.ports))){
      if(!('value' in port))continue;
      const qualified=node.id+'.'+key;
      const live=engine.getVar(qualified);
      if(typeof live==='number')out[qualified]=live;
      else if(Array.isArray(live)&&live.every(n=>typeof n==='number'))out[qualified]=/** @type {number[]} */(live);
      else if(typeof port.value==='number')out[qualified]=port.value;
      else if(Array.isArray(port.value))out[qualified]=/** @type {number[]} */(port.value);
    }
  }
  return out;
}
function livePhosText(){
  const clone=parsePhos(serializePhos(sceneDoc));
  const eqLines=eqEl.value.split('\n').map(s=>s.trim()).filter(Boolean);
  return serializePhos(updateScene(clone,currentPortValues(),eqLines));
}
function updateSrcBtn(){
  const hasSrc=!!(sceneDoc.meta&&sceneDoc.meta.source);
  $('srcView').textContent=hasSrc?'⇄ Source':'{ } Scene code';
}
$('srcClose').onclick=()=>srcOverlay.classList.remove('open');
// copy the full text of either viewer pane (owner request 2026-07-18);
// clipboard is the platform API and the button reports its own outcome
/** @param {string} btnId @param {() => any} cm */
function wireCopy(btnId, cm){
  const b=$(btnId);
  b.onclick=async()=>{
    const ed=cm();
    if(!ed)return;
    try{ await navigator.clipboard.writeText(ed.getValue()); b.textContent='✓ copied'; }
    catch{ b.textContent='copy failed'; }
    setTimeout(()=>{ b.textContent='⧉ Copy'; },1200);
  };
}
wireCopy('copySrc',()=>cmSrc);
wireCopy('copyPhos',()=>cmPhos);
addEventListener('keydown',e=>{ if(e.key==='Escape')srcOverlay.classList.remove('open'); });
$('srcView').onclick=async()=>{
  const src=/** @type {any} */ (sceneDoc.meta&&sceneDoc.meta.source);
  if(!src){ openSingle(); return; }
  let text=importedSrcText; // imported text is exact by construction
  if(text===null){
    let r;
    try{ r=await fetch('./'+src.file); }
    catch(e){ openSingle('source fetch failed ('+errMsg(e)+') — showing .phos only'); return; }
    if(!r.ok){ openSingle('source fetch failed: HTTP '+r.status+' — refusing the dual-source claim'); return; }
    text=await r.text();
    // review finding 2: the pinned hash exists to identify the exact recipe;
    // a served file that does not match it must not wear the "source" title
    if(crypto.subtle&&src.sha256){
      const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
      const hex=[...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('');
      if(hex!==src.sha256){ openSingle('source "'+src.file+'" does not match the pinned sha256 — the served file is not the converted recipe; showing .phos only'); return; }
    } else if(!crypto.subtle){
      srcNote.textContent='warning: no secure context — source hash unverified';
    }
  }
  openDual(text,src.file);
};
/** @param {string} [msg] */
function openSingle(msg){
  ensureCMs();
  srcOverlay.classList.add('open','single');
  $('srcTitleR').textContent='scene code (.phos)';
  phosMeta=[]; lineMap=new Map(); hitLines=[]; alignScroll=false;
  cmPhos.setValue(livePhosText());
  srcNote.textContent=msg||'native scene — .phos code (read-only; edit through the panel)';
}
/** @param {string} srcText @param {string} fileName */
function openDual(srcText,fileName){
  ensureCMs();
  srcOverlay.classList.add('open'); srcOverlay.classList.remove('single');
  $('srcTitleL').textContent=fileName;
  $('srcTitleR').textContent='current .phos (live, incl. unsaved edits)';
  const phosNow=livePhosText();
  phosMeta=[]; lineMap=new Map(); hitLines=[]; selLine=-1; alignScroll=false;
  cmSrc.setValue(srcText); cmPhos.setValue(phosNow);
  buildPhosView(srcText,phosNow);
}
/** @param {string} srcText @param {string} fileName @param {{line:number,ok:boolean,text:string}[]} dis */
function openTriage(srcText,fileName,dis){
  ensureCMs();
  srcOverlay.classList.add('open'); srcOverlay.classList.remove('single');
  $('srcTitleL').textContent=fileName+' — REFUSED';
  $('srcTitleR').textContent='per-line disposition (nothing was imported)';
  phosMeta=[]; lineMap=new Map(); hitLines=[]; alignScroll=true;
  cmSrc.setValue(srcText);
  /** @type {string[]} */ const rows=new Array(srcText.split('\n').length).fill('');
  let bad=0;
  for(const d of dis){ rows[d.line-1]=(d.ok?'· ':'✗ ')+d.text; if(!d.ok)bad++; }
  cmPhos.setValue(rows.join('\n'));
  for(const d of dis)if(!d.ok)cmSrc.addLineClass(d.line-1,'background','srcRefused');
  srcNote.textContent=bad+' of '+dis.length+' source lines cannot convert yet — panes scroll together, ✗ rows name each reason';
}
/** @param {string} letter */
function badgeEl(letter){
  const b=document.createElement('span');
  b.className='badge b'+letter; b.textContent=letter;
  return b;
}
/** @param {any} cm @param {number} line @param {number} ch @param {number} len @param {string} cls */
function markTok(cm,line,ch,len,cls){ if(ch>=0&&len>0)cm.markText({line,ch},{line,ch:ch+len},{className:cls}); }
// Build the per-line origin model for the .phos pane: which node each port
// belongs to comes from the scene text itself (no duplicated registry), and
// the default citations follow the converter's own sources — warp defaults
// state.cpp:654-665, composite defaults state.cpp:541-544.
/** @param {string} srcText @param {string} phosText */
function buildPhosView(srcText,phosText){
  const phosLines=phosText.split('\n');
  if(/** @type {any} */(sceneDoc.meta).sourceEngine==='plane9'){
    // converted .p9c: the per-line origin map below is built from .milk
    // records; the plane9 pair shows plain dual panes until a p9 origin
    // map exists
    phosMeta=new Array(phosLines.length).fill(null);
    srcNote.textContent='plane9 source — dual panes unannotated (per-line origin map exists for .milk sources only)';
    return;
  }
  let ir;
  try{ ir=importMilk(srcText); }
  catch(e){ srcNote.textContent='importer refuses this source: '+errMsg(e); return; }
  phosMeta=new Array(phosLines.length).fill(null);
  const recLineByKey=new Map();
  const sourceKeys=new Set();
  const parityByKey=new Map(); // alternating pair hues, same parity in both panes
  let pIdx=0;
  for(const rec of ir.records){
    if(rec.kind==='value'){ sourceKeys.add(rec.key); recLineByKey.set(rec.key,rec.line); parityByKey.set(rec.key,pIdx++%2); }
    else if(rec.kind==='equation')parityByKey.set('eq:'+rec.line,pIdx++%2);
  }
  // walk the .phos text: track node ids, find port-name lines
  let node='';
  /** @type {any[]} */
  const ports=[];
  phosLines.forEach((l,i)=>{
    const idm=l.match(/^\s{6}"id": "(\w+)",$/);
    if(idm&&idm[1]!==undefined)node=idm[1];
    const pm=l.match(/^\s{8}"([A-Za-z_][A-Za-z0-9_]*)": \{$/);
    if(pm)ports.push({line:i,key:pm[1],node});
  });
  for(const pt of ports){
    const isValue=(phosLines[pt.line+2]||'').trim().startsWith('"value"');
    const end=pt.line+(isValue?3:2);
    let m;
    if(!isValue){
      m={kind:'wiring',label:'render wiring '+pt.node+'.'+pt.key+' — fixed pipeline (milkdropfs.cpp:1048-1214)'};
      cmPhos.setGutterMarker(pt.line,'origin',badgeEl('W'));
    } else if(sourceKeys.has(pt.key)){
      const sl=recLineByKey.get(pt.key);
      m={kind:'source',srcLine:sl,label:'port '+pt.key+' ← source line '+sl};
      lineMap.set(sl,pt.line);
      cmPhos.setGutterMarker(pt.line,'origin',badgeEl('S'));
      const ab=parityByKey.get(pt.key)?'B':'A';
      markTok(cmPhos,pt.line,(phosLines[pt.line]||'').indexOf('"'),pt.key.length+2,'tokKey'+ab);
      const vl=phosLines[pt.line+2]||'';
      const vm=vl.match(/^(\s*"value": )(\S+?),?$/);
      if(vm&&vm[1]!==undefined&&vm[2]!==undefined)markTok(cmPhos,pt.line+2,vm[1].length,vm[2].length,'tokVal'+ab);
    } else {
      const cite=pt.node==='comp'?'state.cpp:541-544':'state.cpp:654-665';
      m={kind:'default',label:'materialized default '+pt.key+' — MilkDrop applies this invisibly ('+cite+')',cite};
      cmPhos.setGutterMarker(pt.line,'origin',badgeEl('D'));
      for(let i=pt.line;i<=end;i++)cmPhos.addLineClass(i,'background','srcDefault');
    }
    for(let i=pt.line;i<=end;i++)phosMeta[i]=m;
    pt.meta=m; pt.end=end;
  }
  // equations, comments, section -> their .phos landings. Review finding 3:
  // duplicate code or comment text must map occurrence-to-occurrence, so each
  // search continues from a moving cursor instead of restarting at the top
  let eqCursor=0, cmCursor=0;
  for(const rec of ir.records){
    let i=-1, label='';
    if(rec.kind==='equation'){
      const needle=JSON.stringify(rec.code);
      i=phosLines.findIndex((l,idx)=>idx>=eqCursor&&l.includes(needle));
      if(i>=0)eqCursor=i+1;
      label='per-frame program code ← source line '+rec.line;
    } else if(rec.kind==='comment'){
      const needle=JSON.stringify(rec.text);
      i=phosLines.findIndex((l,idx)=>idx>=cmCursor&&l.includes(needle));
      if(i>=0)cmCursor=i+1;
      label='preserved source comment ← source line '+rec.line;
    } else if(rec.kind==='section'){ i=phosLines.findIndex(l=>l.includes('"sourceEngine"')); label='structural marker → provenance block'; }
    if(i>=0){
      phosMeta[i]={kind:'source',srcLine:rec.line,label};
      lineMap.set(rec.line,i);
      cmPhos.setGutterMarker(i,'origin',badgeEl('S'));
      const li=phosLines[i]||'';
      if(rec.kind==='equation'){
        const ab=parityByKey.get('eq:'+rec.line)?'B':'A';
        markTok(cmPhos,i,li.indexOf('"'),li.trim().length,'tokVal'+ab);
      }
      if(rec.kind==='comment')markTok(cmPhos,i,li.indexOf('"'),li.trim().length,'tokComment');
    }
  }
  // token-color the source pane with the SAME pair hues, so ib_a=1.0 on the
  // left and the ib_a port on the right read as one colored pair
  const srcLines=srcText.split('\n');
  for(const rec of ir.records){
    const lt=srcLines[rec.line-1]||'';
    const eq=lt.indexOf('=');
    if(rec.kind==='value'){
      const ab=parityByKey.get(rec.key)?'B':'A';
      markTok(cmSrc,rec.line-1,lt.indexOf(rec.key),rec.key.length,'tokKey'+ab);
      markTok(cmSrc,rec.line-1,eq+1,lt.length-eq-1,'tokVal'+ab);
    } else if(rec.kind==='equation'){
      const ab=parityByKey.get('eq:'+rec.line)?'B':'A';
      markTok(cmSrc,rec.line-1,0,eq,'tokKey'+ab);
      markTok(cmSrc,rec.line-1,eq+1,lt.length-eq-1,'tokVal'+ab);
    } else if(rec.kind==='comment'){
      markTok(cmSrc,rec.line-1,0,lt.length,'tokComment');
    }
  }
  // edges block is wiring
  const eStart=phosLines.findIndex(l=>l.trim()==='"edges": [');
  if(eStart>=0){
    let eEnd=eStart;
    while(eEnd<phosLines.length-1&&(phosLines[eEnd]||'').trim()!=='],')eEnd++;
    const wm={kind:'wiring',label:'pipeline wiring warp → borders → comp — fixed pipeline (milkdropfs.cpp:1048-1214)'};
    for(let i=eStart;i<=eEnd;i++)phosMeta[i]=wm;
    cmPhos.setGutterMarker(eStart,'origin',badgeEl('W'));
  }
  // fold each node's contiguous default block through CodeMirror's fold
  // machinery — the gutter caret toggles it both ways
  foldRuns.clear();
  /** @type {any[]} */
  let run=[];
  const flush=()=>{
    if(run.length===0)return;
    const first=run[0], last=run[run.length-1];
    const w=document.createElement('span');
    w.className='foldWidget';
    w.textContent=' ▸ '+run.length+' materialized defaults ('+first.node+') — '+first.meta.cite+' ';
    foldRuns.set(first.line,{fromLine:first.line,fromCh:0,toLine:last.end,toCh:(phosLines[last.end]||'').length});
    cmPhos.foldCode(CodeMirror.Pos(first.line,0),{rangeFinder:blockFinder,widget:w},'fold');
    run=[];
  };
  for(const pt of ports){
    if(pt.meta.kind==='default'&&(run.length===0||run[run.length-1].node===pt.node))run.push(pt);
    else flush();
    if(pt.meta.kind==='default'&&run.length===0)run.push(pt);
  }
  flush();
  srcNote.textContent='click either pane to trace a line · defaults are folded per node';
}
/** @param {number} srcLine */
function jumpFromSource(srcLine){
  if(!cmPhos||!cmSrc||phosMeta.length===0)return;
  for(const i of hitLines)cmPhos.removeLineClass(i,'background','srcHit');
  hitLines=[];
  if(selLine>=0)cmSrc.removeLineClass(selLine,'background','srcSel');
  selLine=srcLine-1;
  cmSrc.addLineClass(selLine,'background','srcSel');
  const pl=lineMap.get(srcLine);
  if(pl===undefined){ srcNote.textContent='source line '+srcLine+': no direct .phos landing (blank line)'; return; }
  cmPhos.addLineClass(pl,'background','srcHit');
  hitLines.push(pl);
  cmPhos.scrollIntoView({line:pl,ch:0},80);
  srcNote.textContent='source line '+srcLine+' → '+(phosMeta[pl]?phosMeta[pl].label:'.phos line '+(pl+1));
}
/** @param {number} pLine */
function jumpFromPhos(pLine){
  if(!cmPhos||!cmSrc||phosMeta.length===0)return;
  const m=phosMeta[pLine];
  if(selLine>=0){ cmSrc.removeLineClass(selLine,'background','srcSel'); selLine=-1; }
  if(!m){ srcNote.textContent='.phos line '+(pLine+1)+': scene structure (JSON framing, no single source line)'; return; }
  if(m.kind==='source'){
    selLine=m.srcLine-1;
    cmSrc.addLineClass(selLine,'background','srcSel');
    cmSrc.scrollIntoView({line:selLine,ch:0},80);
  }
  srcNote.textContent='.phos line '+(pLine+1)+': '+m.label;
}
// ---- studio audio: player-identical sources feeding the same analysis ----
const audio=new AudioEngine();
const audioStatus=$('audioStatus');
const silentStatus=audioStatus.innerHTML; // restored when a source stops
// the demo button is a toggle, so it shows the state it will change
function refreshDemoBtn(){
  $('aDemo').textContent = audio.source==='demo' ? '■ STOP' : '▶ DEMO';
}
/** @param {() => Promise<void>} fn @param {string} label */
async function startAudio(fn,label){
  if(!playing) await setPlaying(true); // starting a source resumes the master transport
  try{ await fn(); audioStatus.textContent='source: '+label; }
  catch(e){ audioStatus.textContent='audio failed: '+errMsg(e); }
  refreshDemoBtn();
}
$('aDemo').onclick=()=>{
  if(audio.source==='demo'){ audio.stop(); audioStatus.innerHTML=silentStatus; refreshDemoBtn(); }
  else startAudio(()=>audio.startDemo(),'demo track');
};
$('aMic').onclick=()=>startAudio(()=>audio.startMic(),'microphone');
const audioFileEl=$in('audioFile');
$('aFile').onclick=()=>audioFileEl.click();
audioFileEl.onchange=()=>{ const f=audioFileEl.files&&audioFileEl.files[0]; if(f)void startAudio(()=>audio.playFile(f),f.name); audioFileEl.value=''; };

// ---- audio scope: three instantaneous band METERS (bass/mid/treb exactly as
// engine.step receives them, 1.0 baseline marked, peak-hold), log-frequency
// spectrum bars, and the raw waveform — the one true wave in the pipeline —
// overlaid. All scaling is display-only; every element is real pipeline data.
const scopeEl=$cv('scope');
const scopeCtx=/** @type {CanvasRenderingContext2D} */ (scopeEl.getContext('2d'));
const BAND_COLORS={bass:'#39ff14',mid:'#ff2ec4',treb:'#00e5ff'}; // neon set, owner-picked style
const bandPeaks={bass:0,mid:0,treb:0};
let specPeak=1e-6;
function drawScope(){
  const a=audio.analysis, w=scopeEl.width, h=scopeEl.height;
  scopeCtx.clearRect(0,0,w,h);
  // meters: segmented LED/VFD form after hardware meters and Winamp's own
  // segmented analyzer with peak row (design/UI-REFERENCE.md rule 7).
  // Display scale 0..2.5 (relative loudness revolves around 1.0), peak cell
  // held with 4%/frame decay. Discrete cells with a visible unlit track —
  // no continuous bar, no core stripe.
  const labelH=12, gh=h-labelH; // bottom strip carries the live-value digits
  const mw=18, gap=10, x0=4, SCALE=2.5;
  const cellPitch=8, cellH=6;   // 6px lit cell + 2px gap
  const cells=Math.floor(gh/cellPitch);
  const bands=/** @type {('bass'|'mid'|'treb')[]} */ (['bass','mid','treb']);
  scopeCtx.font='11px ui-monospace,monospace'; scopeCtx.textAlign='center';
  bands.forEach((k,i)=>{
    const v=a[k]||0, x=x0+i*(mw+gap);
    const lit=Math.min(cells,Math.round(v/SCALE*cells));
    bandPeaks[k]=Math.max(v,bandPeaks[k]*0.96);
    const peakCell=Math.min(cells-1,Math.round(bandPeaks[k]/SCALE*cells)-1);
    for(let c=0;c<cells;c++){
      const cy=gh-(c+1)*cellPitch;
      if(c<lit){
        scopeCtx.shadowColor=BAND_COLORS[k]; scopeCtx.shadowBlur=8;
        scopeCtx.fillStyle=BAND_COLORS[k];
        scopeCtx.fillRect(x,cy,mw,cellH);
        scopeCtx.shadowBlur=0;
      } else {
        scopeCtx.fillStyle='rgba(255,255,255,.05)'; // unlit cell
        scopeCtx.fillRect(x,cy,mw,cellH);
      }
    }
    if(peakCell>=0&&peakCell>=lit){ // peak indicator cell, white-hot
      scopeCtx.fillStyle='rgba(255,255,255,.9)';
      scopeCtx.fillRect(x,gh-(peakCell+1)*cellPitch,mw,cellH);
    }
    // truth readout: the exact value engine.step receives this frame
    scopeCtx.fillStyle=BAND_COLORS[k];
    scopeCtx.fillText(v.toFixed(2),x+mw/2,h-1);
  });
  const mRight=x0+bands.length*mw+(bands.length-1)*gap;
  scopeCtx.fillStyle='rgba(221,228,245,.5)';
  scopeCtx.fillRect(0,gh-(1/SCALE)*gh,mRight+2,1); // the 1.0 tick
  // spectrum: log-frequency, sqrt amplitude, slow auto-gain (right block)
  const sx=mRight+10, sw=w-sx;
  let frameMax=0;
  for(let i=1;i<a.spectrum.length;i++)frameMax=Math.max(frameMax,a.spectrum[i]||0);
  specPeak=Math.max(frameMax,specPeak*0.995,1e-6);
  scopeCtx.fillStyle='rgba(0,229,255,.3)'; // spectrum stays in the dominant cyan family
  const N=a.spectrum.length;
  for(let x=0;x<sw;x++){
    const i0=Math.max(1,Math.floor(Math.pow(N-1,x/sw)));
    const i1=Math.max(i0+1,Math.floor(Math.pow(N-1,(x+1)/sw)));
    let v=0; for(let i=i0;i<i1;i++)v=Math.max(v,a.spectrum[i]||0);
    const y=Math.sqrt(v/specPeak)*gh*0.9;
    scopeCtx.fillRect(sx+x,gh-y,1,y);
  }
  // raw waveform overlay
  const wf=a.waveform;
  if(wf&&wf.length){
    scopeCtx.strokeStyle='rgba(255,255,255,.45)'; // neutral so the wave never reads as a band color
    scopeCtx.beginPath();
    for(let i=0;i<wf.length;i++){
      const x=sx+i/(wf.length-1)*sw, y=gh*0.5-((wf[i]||0)/256)*gh;
      if(i)scopeCtx.lineTo(x,y); else scopeCtx.moveTo(x,y);
    }
    scopeCtx.stroke();
  }
}

// ---- scene library drawer: committed manifest + this-session imports ----
/** @type {{name:string,text:string,ext:string}[]} */
const importedScenes=[];
const libDrawer=$any('libDrawer');
async function renderLibrary(){
  const list=$('libList'); list.innerHTML='';
  /** @type {{scenes:{name:string,file:string}[]}} */
  let manifest={scenes:[]};
  try{ const r=await fetch('./scenes/manifest.json'); if(r.ok)manifest=await r.json(); }
  catch{ /* session imports still listed below */ }
  /** @param {string} label @param {() => void} fn */
  const add=(label,fn)=>{ const b=document.createElement('wa-button'); b.setAttribute('size','s'); b.style.display='block'; b.style.marginBottom='6px'; b.textContent=label; b.addEventListener('click',fn); list.append(b); };
  for(const sc of manifest.scenes||[]) add(sc.name,async()=>{ loadDoc(parsePhos(await (await fetch('./scenes/'+sc.file)).text())); importedSrcText=null; libDrawer.open=false; });
  for(const sc of importedScenes) add(sc.name+' (imported)',async()=>{
    if(sc.ext==='p9c'){
      try{ await loadP9(sc.text,sc.name); }
      catch{ openTriage(sc.text, sc.name+' :: scene.xml', assessP9Records(scanP9(sc.text))); }
      libDrawer.open=false; return;
    }
    const h=IMPORTERS[sc.ext];
    try{ if(h)await h(sc.text,sc.name); }
    catch{ if(sc.ext==='milk')openTriage(sc.text, sc.name, assessRecords(scanMilk(sc.text))); }
    libDrawer.open=false;
  });
  if(!(manifest.scenes||[]).length&&!importedScenes.length)list.textContent='no scenes listed';
}
$('library').onclick=async()=>{
  await customElements.whenDefined('wa-drawer'); // components register async
  await renderLibrary();
  libDrawer.open=true;
};

// ---- one Import button: dispatch by format, refuse unknowns by name --------
// .phos loads natively; .milk converts through the strict door (a refusal
// opens triage instead of importing partially); .p9c is BINARY (a zip), so
// importFile routes it through container extraction + the Plane9 strict
// door, whose refusal opens the per-line triage; anything else refuses
// naming the extension.
/** @param {string} text */
async function shaOf(text){
  if(!crypto.subtle)return 'sha256-unavailable';
  const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
// Plane9 conversion load path: scene.xml -> p9ToPhos (strict door) -> the
// ordinary .phos load; the caller opens triage on any refusal
/** @param {string} xml @param {string} name */
async function loadP9(xml,name){
  const doc=p9ToPhos(xml,{file:name,sha256:await shaOf(xml)});
  loadDoc(parsePhos(serializePhos(doc)));
  importedSrcText=xml;
}
/** @type {Record<string, (text:string, name:string) => Promise<void>>} */
const IMPORTERS={
  phos:async(text)=>{ loadDoc(parsePhos(text)); importedSrcText=null; },
  milk:async(text,name)=>{
    const doc=milkToPhos(importMilk(text),{file:name,sha256:await shaOf(text)});
    loadDoc(parsePhos(serializePhos(doc)));
    importedSrcText=text;
  },
};
/** @param {File} f */
async function importFile(f){
  const ext=(f.name.split('.').pop()||'').toLowerCase();
  if(ext==='p9c'){
    let xml;
    try{ xml=extractSceneXml(new Uint8Array(await f.arrayBuffer())); }
    catch(e){ alert(errMsg(e)); return; }
    // strict conversion door: a scene inside the convertible shape (the
    // witnessed geometry-free clear graph) loads through the shared
    // executor as an ordinary .phos; any refusal opens per-line triage
    try{ await loadP9(xml,f.name); }
    catch{ openTriage(xml, f.name+' :: scene.xml', assessP9Records(scanP9(xml))); }
    const prior=importedScenes.findIndex(s=>s.name===f.name);
    const entry={name:f.name,text:xml,ext};
    if(prior>=0)importedScenes[prior]=entry; else importedScenes.push(entry);
    return;
  }
  const handler=IMPORTERS[ext];
  if(!handler){ alert('import: unsupported file type ".'+ext+'" — refusing'); return; }
  const text=await f.text();
  try{
    await handler(text,f.name);
    const prior=importedScenes.findIndex(s=>s.name===f.name);
    const entry={name:f.name,text,ext};
    if(prior>=0)importedScenes[prior]=entry; else importedScenes.push(entry);
  }
  catch(e){
    if(ext==='milk')openTriage(text, f.name, assessRecords(scanMilk(text)));
    else alert(errMsg(e));
  }
}
const importFileEl=$in('importFile');
$('importBtn').onclick=()=>importFileEl.click();
importFileEl.onchange=()=>{ const f=importFileEl.files&&importFileEl.files[0]; if(f)void importFile(f); importFileEl.value=''; };
addEventListener('dragover',e=>e.preventDefault());
addEventListener('drop',e=>{ e.preventDefault(); const f=e.dataTransfer&&e.dataTransfer.files[0]; if(f)void importFile(f); });
updateSrcBtn();
