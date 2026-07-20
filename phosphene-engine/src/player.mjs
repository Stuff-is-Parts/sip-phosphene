/// <reference types="@webgpu/types" />
// PHOSPHENE player application shell — extracted from index.html so the
// five-tool gate (syntax, tsc, eslint, stylelint, knip) covers it like any
// other module. The page keeps only markup and CSS.
import { parsePhos, toRuntime } from './phos.mjs';
import { Engine } from './engine.mjs';
import { createRenderContext } from './render-executor.mjs';
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

// open a .phos scene from disk (native graph portability requirement)
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
    const resize=()=>{canvas.width=innerWidth*dpr;canvas.height=innerHeight*dpr;renderCtx.resize();};
    ctx.configure({device,format:fmt,alphaMode:'opaque'});
    const renderCtx=createRenderContext(device,canvas,ctx,fmt);
    resize();addEventListener('resize',resize);
    const bassEl=$('bass'), fpsEl=$('pfps');
    let last=performance.now(),fpsAcc=0,fpsN=0;
    /** @param {number} now */
    function frame(now){
      const dt=Math.min(0.05,(now-last)/1000);last=now;
      audio.analysis.update(dt);
      if(playing){
        const a=audio.analysis;
        engine.setViewport(canvas.width,canvas.height,renderCtx.texW,renderCtx.texH);
        // Plane9 Beat runs INACTIVE in PHOSPHENE — the upstream detector
        // that produces rawBeat is unresolved (Plane9Engine.dll RVA
        // 0x100DF5A0 evaluator known, but the raw-signal source is
        // compiled code without exported entry per PLANE9-CONTRACT.md).
        const plan=engine.step(dt,{bass:a.bass,mid:a.mid,treb:a.treb,bass_att:a.bassAtt,mid_att:a.midAtt,treb_att:a.trebAtt,musicActive:false,rawBeat:0});
        renderCtx.executeFrame(plan);
        bassEl.textContent='bass '+a.bass.toFixed(2);
        fpsAcc+=1/dt;fpsN++; if(fpsN>=15){fpsEl.textContent=Math.round(fpsAcc/fpsN)+' fps';fpsAcc=0;fpsN=0;}
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}
