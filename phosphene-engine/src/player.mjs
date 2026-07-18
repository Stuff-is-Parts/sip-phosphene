/// <reference types="@webgpu/types" />
// PHOSPHENE player application shell — extracted from index.html so the
// five-tool gate (syntax, tsc, eslint, stylelint, knip) covers it like any
// other module. The page keeps only markup and CSS.
import { parsePhos, toRuntime } from './phos.mjs';
import { Engine } from './engine.mjs';
import { feedbackWGSL, compositeWGSL } from './render-wgsl.mjs';
import { buildStripIndices, buildWarpUVs, meshPositions, VERT_COUNT } from './warp-mesh.mjs';
import { AudioEngine } from './audio/sources.mjs';

// DOM lookup helpers: the page ships these elements statically, so absence is
// a build defect — assert once here instead of null-checking every use.
/** @param {string} id @returns {HTMLElement} */
const $ = (id) => { const el = document.getElementById(id); if (!el) throw new Error('missing #' + id); return el; };
/** @param {string} id @returns {HTMLInputElement} */
const $in = (id) => /** @type {HTMLInputElement} */ (/** @type {unknown} */ ($(id)));
/** @param {string} id @returns {HTMLCanvasElement} */
const $cv = (id) => /** @type {HTMLCanvasElement} */ (/** @type {unknown} */ ($(id)));
/** @param {unknown} e @returns {string} */
const errMsg = (e) => e instanceof Error ? e.message : String(e);

const audio = new AudioEngine();
const sceneText = await (await fetch('./scenes/md-101-per_frame.phos')).text();
const initialRt = toRuntime(parsePhos(sceneText));
let engine = new Engine(initialRt);
$('sceneName').textContent = String(initialRt.meta.name);

// open a .phos scene from disk (MUST: portable load — VSLICE-MOSCOW)
/** @param {File} f */
function loadSceneFile(f){
  f.text().then(text => {
    const rt = toRuntime(parsePhos(text));
    engine = new Engine(rt);
    $('sceneName').textContent = String(rt.meta.name);
  }).catch(e => { err.textContent = 'scene load failed: ' + errMsg(e); });
}

const splash = $('splash');
const hud = $('hud');
const err = $('err');
const fileEl = $in('file');

// the renderer runs from page load (silence holds bands at 1.0); the splash
// card only gates AUDIO, which needs a user gesture
initGPU();

// the demo button is a toggle, so it shows the state it will change
function refreshDemoBtn(){
  $('hDemo').textContent = audio.source==='demo' ? '■ STOP' : 'DEMO';
}
function showSourceLabel(){
  $('src').textContent = audio.label;
  refreshDemoBtn();
}
/** @param {() => Promise<void>} startFn */
async function begin(startFn){
  if(!playing) await setPlaying(true); // starting a source resumes the master transport
  try { await startFn(); }
  catch(e){ err.textContent = errMsg(e) || 'audio failed'; return; }
  splash.classList.add('gone');
  showSourceLabel();
}
$('bDemo').onclick = () => begin(()=>audio.startDemo());
$('bMic').onclick = () => begin(()=>audio.startMic());
$('bFile').onclick = () => fileEl.click();
fileEl.onchange = () => { const f=fileEl.files && fileEl.files[0]; if(f) begin(()=>audio.playFile(f)); };
// persistent in-session source switching (HUD) — same sources, same engine
$('hDemo').onclick = async () => {
  if (audio.source==='demo') audio.stop();
  else { if(!playing) await setPlaying(true); await audio.startDemo(); }
  showSourceLabel();
};
$('hMic').onclick = async () => { if(!playing) await setPlaying(true); await audio.startMic(); showSourceLabel(); };
$('hFile').onclick = () => fileEl.click();

// drag-drop audio
addEventListener('dragover', e=>{e.preventDefault();$('dropOverlay').style.display='flex';});
addEventListener('dragleave', ()=>{$('dropOverlay').style.display='none';});
addEventListener('drop', e=>{
  e.preventDefault();$('dropOverlay').style.display='none';
  const f=e.dataTransfer && e.dataTransfer.files[0];
  if(!f)return;
  if(f.name.endsWith('.phos'))loadSceneFile(f);
  else if(f.type.startsWith('audio'))void begin(()=>audio.playFile(f));
});

// keyboard + master transport: pause stops the WORLD — render and audio
// together (AudioEngine.pause suspends the context); sources stay separate.
// Transitions serialize through one promise chain so a rapid pause/resume
// cannot leave rendering and audio in the split state UI-REFERENCE rule 11
// forbids (external review 2026-07-18 finding 2).
let playing = true, uiHidden = false;
const hPauseBtn = $('hPause');
let transportOp = Promise.resolve();
/** @param {boolean} v */
function setPlaying(v){
  transportOp = transportOp.then(async () => {
    playing = v;
    hPauseBtn.textContent = v ? '⏸' : '▶';
    if (v) await audio.resume(); else await audio.pause();
  });
  return transportOp;
}
addEventListener('keydown', e=>{
  if(e.key===' '){e.preventDefault();void setPlaying(!playing);}
  else if(e.key==='f'||e.key==='F'){ if(!document.fullscreenElement)void document.documentElement.requestFullscreen();else void document.exitFullscreen(); }
  else if(e.key==='h'||e.key==='H'){ uiHidden=!uiHidden; hud.classList.toggle('hidden',uiHidden); }
  else if(e.key==='F1'){ e.preventDefault(); const h=$('help'); h.style.display=h.style.display==='none'?'block':'none'; }
  else if(e.key==='Escape'){
    const h=$('help');
    if(h.style.display!=='none') h.style.display='none';
    else splash.classList.add('gone'); // watch in silence — audio can start from the bridge
  }
});
hPauseBtn.onclick=()=>setPlaying(!playing);
$('hFull').onclick=()=>{if(!document.fullscreenElement)void document.documentElement.requestFullscreen();else void document.exitFullscreen();};

function initGPU(){
  const canvas=$cv('stage');
  if(!navigator.gpu){err.textContent='WebGPU not available in this browser';return;}
  void navigator.gpu.requestAdapter().then(async adapter=>{
    if(!adapter){err.textContent='WebGPU adapter unavailable';return;}
    const device=await adapter.requestDevice();
    const maybeCtx=canvas.getContext('webgpu');
    if(!maybeCtx){err.textContent='WebGPU canvas context unavailable';return;}
    const ctx=maybeCtx;
    const fmt=navigator.gpu.getPreferredCanvasFormat();
    const dpr=devicePixelRatio||1;
    const U=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING;
    /** @type {GPUTexture|undefined} */ let tA;
    /** @type {GPUTexture|undefined} */ let tB;
    let texW=0,texH=0;
    // render targets follow the window (nTexSize -1 auto-exact, plugin.cpp:1851-1852)
    // snapped to 16-pixel blocks (:1879-1880); resize recreates them, restarting
    // the feedback history as the source's target reallocation does
    const rebuildTargets=()=>{
      const w=Math.max(16,Math.ceil(canvas.width/16)*16), h=Math.max(16,Math.ceil(canvas.height/16)*16);
      if(w===texW&&h===texH)return;
      texW=w;texH=h;
      if(tA)tA.destroy();if(tB)tB.destroy();
      tA=device.createTexture({size:[texW,texH],format:'rgba8unorm',usage:U});
      tB=device.createTexture({size:[texW,texH],format:'rgba8unorm',usage:U});
    };
    const resize=()=>{canvas.width=innerWidth*dpr;canvas.height=innerHeight*dpr;rebuildTargets();};
    resize();addEventListener('resize',resize);
    ctx.configure({device,format:fmt,alphaMode:'opaque'});
    const mod=device.createShaderModule({code:feedbackWGSL});
    const blitMod=device.createShaderModule({code:compositeWGSL});
    // warp-pass address mode follows the wrap variable per frame (texaddr,
    // WarpedBlit_NoShaders milkdropfs.cpp:1991); composite keeps WRAP for the
    // overscan edge per the :4086-4088 comment
    const sampWrap=device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'repeat',addressModeV:'repeat'});
    const sampClamp=device.createSampler({magFilter:'linear',minFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
    const ubuf=device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    // warp mesh: static positions + strip-derived indices + per-frame UVs
    // computed CPU-side (src/warp-mesh.mjs)
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
    const bassEl=$('bass'), fpsEl=$('pfps');
    let last=performance.now(),fpsAcc=0,fpsN=0;
    /** @param {number} now */
    function frame(now){
      const dt=Math.min(0.05,(now-last)/1000);last=now;
      audio.analysis.update(dt);
      if(playing&&tA&&tB){
        const a=audio.analysis;
        // derived relative-loudness values pass straight to the pool — no scaling
        // belongs between analyzer and engine (sources/AUDIO-PATH.md implication 1)
        engine.setViewport(canvas.width,canvas.height,texW,texH); // live dims each frame (scene swaps replace the engine)
        // Plane9 Beat runs INACTIVE in PHOSPHENE — the upstream detector
        // that produces rawBeat is unresolved (Plane9Engine.dll RVA
        // 0x100DF5A0 evaluator known, but the raw-signal source is
        // compiled code without exported entry per PLANE9-CONTRACT.md).
        // Passing musicActive=false makes any Beat node in the scene
        // return NoMusic; MilkDrop bass/mid/treb are independent.
        const plan=engine.step(dt,{bass:a.bass,mid:a.mid,treb:a.treb,bass_att:a.bassAtt,mid_att:a.midAtt,treb_att:a.trebAtt,musicActive:false,rawBeat:0});
        if(!plan) throw new Error('engine.step returned no render plan — the graph has no presentation sink');
        // Execute the sink's render plan generically per pass — the graph
        // is the sole render-execution authority, not a mode switch on
        // state field presence (reviewer foundation 2026-07-18).
        const enc=device.createCommandEncoder();
        let swapNeeded=false;
        for(const p of plan.passes){
          if(p.kind==='clear-color'){
            const rp=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:p.clear.r,g:p.clear.g,b:p.clear.b,a:p.clear.a}}]});
            rp.end();
          }else if(p.kind==='warp-feedback'){
            const m=p.motion;
            // borders fold into the warp-feedback pass; a warp-feedback pass
            // whose borders were never populated draws zero-alpha rings
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
            // stash motion so a subsequent composite pass can read aspect/crop
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
        bassEl.textContent='bass '+a.bass.toFixed(2);
        fpsAcc+=1/dt;fpsN++; if(fpsN>=15){fpsEl.textContent=Math.round(fpsAcc/fpsN)+' fps';fpsAcc=0;fpsN=0;}
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}
