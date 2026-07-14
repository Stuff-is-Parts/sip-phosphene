import "./style.css";
import { Renderer } from "./gpu/renderer";
import { AudioEngine } from "./audio/sources";
import { ModEngine } from "./core/mods";
import { clamp } from "./core/params";
import {
  MOD_SOURCES, STAGES, normalizeScene,
  type CompileResult, type Scene, type StageId,
} from "./core/types";
import { builtinScenes, TEMPLATE_BLANK } from "./shaders/library";
import { exportJson, importScenes, loadScenes, saveScenes } from "./core/store";
import { ShaderEditor } from "./ui/editor";
import { generateWithRepair } from "./ai/generate";
import { CanvasRecorder } from "./core/record";
import { parseP9c, p9ToScene, translateP9Glsl } from "./import/p9";
import { callClaude, stripFences } from "./ai/generate";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

function log(msg: string, cls: "info" | "ok" | "err" | "ai" = "info"): void {
  const c = $("console");
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = msg;
  c.appendChild(d);
  while (c.children.length > 80) c.removeChild(c.firstChild!);
  c.scrollTop = c.scrollHeight;
}

/* ------------------------------- state ------------------------------- */
let scenes: Scene[] = builtinScenes();
let cur: Scene = structuredClone(scenes[0]);
let curIdx = 0;
let activeStage: StageId = "bg";

const audio = new AudioEngine();
const mods = new ModEngine();
const renderer = new Renderer();
let editor: ShaderEditor;
let sceneImageHook: (() => Promise<void>) | null = null;

let frozen = false;
let freezeT = 0;
let scrub = 0;
const t0 = performance.now();
const nowT = () => (performance.now() - t0) / 1000;
const renderT = () => (frozen ? freezeT : nowT()) + scrub;

function setDirty(d: boolean): void {
  $("dirtyMark").style.visibility = d ? "visible" : "hidden";
}

/* ------------------------------ compile ------------------------------ */
async function compileStage(stage: StageId, report = true): Promise<CompileResult> {
  const res = await renderer.compileStage(stage, cur.layers[stage].code);
  for (const p of res.params) {
    if (!(p.name in cur.custom)) cur.custom[p.name] = p.def;
  }
  if (stage === activeStage) editor.showDiagnostics(res.ok ? [] : res.diagnostics);
  if (report) {
    if (res.ok) {
      log(`✓ ${stage.toUpperCase()} compiled (${res.params.length} custom param${res.params.length === 1 ? "" : "s"})`, "ok");
    } else {
      const first = res.diagnostics.find((d) => d.severity === "error");
      log(`✕ ${stage.toUpperCase()}: line ${first?.line}: ${first?.message}`, "err");
    }
  }
  renderCustomParams();
  renderMods();
  return res;
}
async function compileAll(report: boolean): Promise<void> {
  for (const s of STAGES) await compileStage(s, report);
}

/* ------------------------------ panels ------------------------------- */
const BASE_DEFS = [
  { key: "hue" as const, min: 0, max: 1, step: 0.01 },
  { key: "speed" as const, min: 0.2, max: 2.5, step: 0.05 },
  { key: "int" as const, min: 0.3, max: 2, step: 0.05 },
  { key: "fb" as const, min: 0, max: 0.95, step: 0.02 },
];
function renderBaseParams(): void {
  const box = $("baseParams");
  box.innerHTML = "";
  for (const def of BASE_DEFS) {
    const row = document.createElement("div");
    row.className = "slider";
    row.innerHTML = `<span>${def.key === "int" ? "intensity" : def.key === "fb" ? "trails" : def.key}</span>
      <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${cur.params[def.key]}">
      <output>${cur.params[def.key].toFixed(2)}</output>`;
    const inp = row.querySelector("input")!;
    inp.addEventListener("input", () => {
      cur.params[def.key] = +inp.value;
      row.querySelector("output")!.textContent = (+inp.value).toFixed(2);
      setDirty(true);
    });
    box.appendChild(row);
  }
}
function renderCustomParams(): void {
  const box = $("customParams");
  box.innerHTML = "";
  const params = renderer.stageParams()[activeStage];
  if (!params.length) {
    box.innerHTML = '<div class="hint">none declared in this stage</div>';
    return;
  }
  for (const p of params) {
    const val = cur.custom[p.name] ?? p.def;
    const row = document.createElement("div");
    row.className = "slider";
    row.innerHTML = `<span>${p.name}</span>
      <input type="range" min="${p.min}" max="${p.max}" step="${(p.max - p.min) / 200}" value="${val}">
      <output>${val.toFixed(2)}</output>`;
    const inp = row.querySelector("input")!;
    inp.addEventListener("input", () => {
      cur.custom[p.name] = +inp.value;
      row.querySelector("output")!.textContent = (+inp.value).toFixed(2);
      setDirty(true);
    });
    box.appendChild(row);
  }
}
function allModTargets(): string[] {
  const t = ["hue", "speed", "int", "fb"];
  const sp = renderer.stageParams();
  for (const s of STAGES) for (const p of sp[s]) if (!t.includes(p.name)) t.push(p.name);
  return t;
}
function renderMods(): void {
  const box = $("modRows");
  box.innerHTML = "";
  const targets = allModTargets();
  cur.mods.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = "modRow";
    row.innerHTML = `
      <select aria-label="target">${targets.map((t) => `<option ${t === m.target ? "selected" : ""}>${t}</option>`).join("")}</select>
      <select aria-label="source">${MOD_SOURCES.map((s) => `<option ${s === m.source ? "selected" : ""}>${s}</option>`).join("")}</select>
      <input type="number" step="0.05" value="${m.gain}" title="gain">
      <input type="number" step="0.05" value="${m.base}" title="base">
      <button class="rm" title="remove">✕</button>`;
    const [selT, selS] = row.querySelectorAll("select");
    const [inG, inB] = row.querySelectorAll("input");
    selT.addEventListener("change", () => { m.target = selT.value; setDirty(true); });
    selS.addEventListener("change", () => { m.source = selS.value as typeof m.source; setDirty(true); });
    inG.addEventListener("change", () => { m.gain = +inG.value; setDirty(true); });
    inB.addEventListener("change", () => { m.base = +inB.value; setDirty(true); });
    row.querySelector<HTMLButtonElement>(".rm")!.addEventListener("click", () => {
      cur.mods.splice(i, 1); renderMods(); setDirty(true);
    });
    box.appendChild(row);
  });
  if (!cur.mods.length) {
    box.innerHTML = '<div class="hint">no routes — parameters stay at their slider values</div>';
  }
}
function renderLibrary(): void {
  const el = $("sceneLibrary");
  el.innerHTML = "";
  scenes.forEach((s, i) => {
    const div = document.createElement("div");
    div.className = "libItem" + (i === curIdx ? " active" : "");
    div.innerHTML =
      (s.thumb ? `<img src="${s.thumb}" alt="">` : `<div class="noThumb">no<br>thumb</div>`) +
      `<div class="nm">${s.name}</div><button class="rm" title="delete">✕</button>`;
    div.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("rm")) return;
      void loadScene(i);
    });
    div.querySelector<HTMLButtonElement>(".rm")!.addEventListener("click", () => {
      if (scenes.length <= 1) return;
      scenes.splice(i, 1);
      if (curIdx >= scenes.length) curIdx = scenes.length - 1;
      void saveScenes(scenes);
      renderLibrary();
    });
    el.appendChild(div);
  });
}

/* --------------------------- scene lifecycle -------------------------- */
async function loadScene(i: number): Promise<void> {
  curIdx = i;
  cur = structuredClone(scenes[i]);
  mods.reset();
  $<HTMLInputElement>("sceneTitle").value = cur.name;
  editor.setCode(cur.layers[activeStage].code);
  renderBaseParams();
  await compileAll(false);
  await sceneImageHook?.();
  setDirty(false);
  renderLibrary();
  log("loaded: " + cur.name);
}
function captureThumb(): void {
  const preview = $<HTMLCanvasElement>("preview");
  const off = document.createElement("canvas");
  off.width = 104; off.height = 60;
  off.getContext("2d")!.drawImage(preview, 0, 0, 104, 60);
  cur.thumb = off.toDataURL("image/jpeg", 0.7);
}
function saveScene(): void {
  cur.name = $<HTMLInputElement>("sceneTitle").value.trim() || "UNTITLED";
  captureThumb();
  const copy = structuredClone(cur);
  const i = scenes.findIndex((s) => s.name === copy.name);
  if (i >= 0) { scenes[i] = copy; curIdx = i; } else { scenes.push(copy); curIdx = scenes.length - 1; }
  void saveScenes(scenes);
  setDirty(false);
  renderLibrary();
  log("saved: " + cur.name, "ok");
}

/* ------------------------------ render loop --------------------------- */
const scopeCtx = $<HTMLCanvasElement>("scopes").getContext("2d")!;
function drawScopes(): void {
  const a = audio.analysis;
  const w = 150, h = 54;
  scopeCtx.clearRect(0, 0, w, h);
  scopeCtx.strokeStyle = "#7df2c8";
  scopeCtx.beginPath();
  for (let i = 0; i < 64; i++) {
    const x = (i / 63) * w, y = h - 4 - a.spec[i] * (h - 10);
    if (i) scopeCtx.lineTo(x, y); else scopeCtx.moveTo(x, y);
  }
  scopeCtx.stroke();
  scopeCtx.strokeStyle = "#c87df2";
  scopeCtx.beginPath();
  for (let i = 0; i < 64; i++) {
    const x = (i / 63) * w, y = h * 0.5 - a.wave[i] * h * 0.4;
    if (i) scopeCtx.lineTo(x, y); else scopeCtx.moveTo(x, y);
  }
  scopeCtx.stroke();
}
function frame(): void {
  requestAnimationFrame(frame);
  const now = nowT();
  audio.analysis.update(now);
  const p = mods.evaluate(cur, renderer.stageParams(), audio.analysis, now);
  $("beatLamp").style.opacity = String(0.15 + audio.analysis.beat * 0.85);
  $("bpmTag").textContent = (audio.analysis.bpm || "—") + " BPM";
  drawScopes();
  renderer.frame(renderT(), audio.analysis, p);
}

/* -------------------------------- wiring ------------------------------ */
function wire(): void {
  document.querySelectorAll<HTMLButtonElement>("#stageTabs [data-stage]").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#stageTabs [data-stage]").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      activeStage = b.dataset.stage as StageId;
      editor.setCode(cur.layers[activeStage].code);
      renderCustomParams();
    });
  });
  $("bCompile").addEventListener("click", () => void compileStage(activeStage));
  $("bTemplate").addEventListener("click", () => {
    editor.setCode(TEMPLATE_BLANK);
  });
  $("bNew").addEventListener("click", () => {
    cur = normalizeScene({ name: "UNTITLED" });
    cur.layers.bg.code = TEMPLATE_BLANK;
    cur.layers.fg.code = "fn render(c : Ctx) -> vec3f { return vec3f(0.0); }";
    cur.layers.post.code = "fn render(c : Ctx) -> vec3f {\n  var col = srcTex(c.uv);\n  col = max(col, prevTex(c.uv) * c.fb);\n  return col;\n}";
    curIdx = -1;
    $<HTMLInputElement>("sceneTitle").value = cur.name;
    editor.setCode(cur.layers[activeStage].code);
    renderBaseParams();
    void compileAll(false);
    setDirty(true);
    renderLibrary();
  });
  $("bSave").addEventListener("click", saveScene);
  $("bThumb").addEventListener("click", () => { captureThumb(); renderLibrary(); log("thumbnail captured", "ok"); });
  $("sceneTitle").addEventListener("input", () => setDirty(true));

  $("bExportOne").addEventListener("click", () =>
    void exportJson((cur.name || "scene").toLowerCase().replace(/\s+/g, "-") + ".phos.json", cur));
  $("bExportAll").addEventListener("click", () =>
    void exportJson("phosphene-library.json", scenes));
  $("bImport").addEventListener("click", () => $<HTMLInputElement>("fileJson").click());
  $<HTMLInputElement>("fileJson").addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    try {
      const imported = importScenes(await f.text());
      scenes.push(...imported);
      void saveScenes(scenes);
      renderLibrary();
      log(`imported ${imported.length} scene${imported.length === 1 ? "" : "s"}`, "ok");
    } catch (err) {
      log("import failed: " + (err as Error).message, "err");
    }
  });

  // Plane9 import
  $("bImportP9").addEventListener("click", () => $<HTMLInputElement>("fileP9").click());
  $<HTMLInputElement>("fileP9").addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = "";
    for (const f of files) {
      try {
        const p9 = parseP9c(await f.arrayBuffer(), f.name);
        log(`p9c: ${p9.name} by ${p9.author} [${p9.licenseType}] — nodes: ${p9.nodeTypes.join(", ")}`);
        const { scene, report } = p9ToScene(p9);
        report.forEach((r) => log("p9c: " + r, "ai"));
        cur = scene;
        curIdx = -1;
        $<HTMLInputElement>("sceneTitle").value = cur.name;
        editor.setCode(cur.layers.bg.code);
        renderBaseParams();
        renderMods();
        let res = await compileStage("bg", true);
        for (const s of ["fg", "post"] as const) await compileStage(s, false);
        if (!res.ok && p9.glsl) {
          // deterministic transpile missed a dialect corner — AI repair with the original as reference
          log("p9c: deterministic translation failed to compile — trying AI repair with the original GLSL…", "ai");
          try {
            const errs = res.diagnostics.filter((d) => d.severity === "error")
              .map((d) => `line ${d.line}: ${d.message}`).join("; ");
            const fixed = stripFences(await callClaude([{
              role: "user",
              content: `Fix this WGSL music-visualizer stage body so it compiles. It must define fn render(c : Ctx) -> vec3f (Ctx and helpers spec/wav/pal/hash/noise/fbm/img etc. are already in scope; do not redeclare). It is a translation of the ORIGINAL GLSL below — preserve the visual math exactly.\n\nWGSL errors: ${errs}\n\nCurrent WGSL:\n${cur.layers.bg.code}\n\nORIGINAL GLSL (reference):\n${p9.glsl}\n\nOutput only the corrected WGSL body.`,
            }]));
            cur.layers.bg.code = fixed;
            editor.setCode(fixed);
            res = await compileStage("bg", true);
          } catch (err) {
            log("p9c: AI repair unavailable: " + (err as Error).message, "err");
          }
        }
        await sceneImageHook?.();
        setDirty(true);
        renderLibrary();
        log(res.ok ? `p9c: ${cur.name} imported and compiled — SAVE to keep it` : `p9c: imported with errors — see gutter`, res.ok ? "ok" : "err");
      } catch (err) {
        log(`p9c: ${f.name}: ${(err as Error).message}`, "err");
      }
    }
  });
  void translateP9Glsl; // (exported for tests/tooling)

  // audio / transport
  $("aDemo").addEventListener("click", () => { audio.startDemo(); $("trackLabel").textContent = audio.label; log("audio: demo track"); });
  $("aMic").addEventListener("click", async () => {
    try { await audio.startMic(); $("trackLabel").textContent = audio.label; log("audio: microphone"); }
    catch (e) { log("mic unavailable (" + (e as Error).name + ")", "err"); }
  });
  $("aFile").addEventListener("click", () => $<HTMLInputElement>("fileAudio").click());
  $<HTMLInputElement>("fileAudio").addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    try { await audio.playFile(f); $("trackLabel").textContent = audio.label; log("audio: " + f.name); }
    catch (err) { log("couldn't decode audio: " + (err as Error).message, "err"); }
  });
  $("aBeat").addEventListener("click", () => audio.analysis.inject(nowT()));

  // scene image
  const applyImage = async () => {
    const data = cur.assets?.image;
    $("imgLabel").textContent = data ? "embedded (" + Math.round(data.length / 1024) + " KB)" : "none";
    if (!data) { await renderer.setImage(0, null); return; }
    try {
      const blob = await (await fetch(data)).blob();
      await renderer.setImage(0, await createImageBitmap(blob));
    } catch { await renderer.setImage(0, null); }
  };
  sceneImageHook = applyImage;
  $("bImg").addEventListener("click", () => $<HTMLInputElement>("fileImg").click());
  $("bImgClear").addEventListener("click", () => {
    cur.assets = { image: null };
    void applyImage();
    setDirty(true);
  });
  $<HTMLInputElement>("fileImg").addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    if (f.size > 1_500_000) { log("image too large: keep under ~1.5 MB so scenes stay portable", "err"); return; }
    const r = new FileReader();
    r.onload = () => {
      cur.assets = { image: String(r.result) };
      void applyImage();
      setDirty(true);
      log("image embedded: sample it with img(c.uv)", "ok");
    };
    r.readAsDataURL(f);
  });
  const recorder = new CanvasRecorder();
  $("sRec").addEventListener("click", (e) => {
    const b = e.currentTarget as HTMLElement;
    if (recorder.active) {
      recorder.stop((cur.name || "scene").toLowerCase().replace(/\s+/g, "-") + ".webm");
      b.classList.remove("on");
      b.textContent = "● REC";
      log("recording saved", "ok");
    } else {
      recorder.start($<HTMLCanvasElement>("preview"));
      b.classList.add("on");
      b.textContent = "■ STOP";
      log("recording preview canvas…");
    }
  });
  $("tFreeze").addEventListener("click", (e) => {
    frozen = !frozen;
    if (frozen) freezeT = nowT();
    (e.currentTarget as HTMLElement).classList.toggle("on", frozen);
  });
  $<HTMLInputElement>("tScrub").addEventListener("input", (e) =>
    { scrub = +(e.target as HTMLInputElement).value; });

  // drag & drop audio
  let dragDepth = 0;
  addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; $("dropOverlay").style.display = "flex"; });
  addEventListener("dragleave", (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $("dropOverlay").style.display = "none"; } });
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    $("dropOverlay").style.display = "none";
    const f = [...(e.dataTransfer?.files ?? [])].find(
      (f) => f.type.startsWith("audio") || /\.(mp3|wav|ogg|m4a|flac)$/i.test(f.name));
    if (f) void audio.playFile(f).then(() => { $("trackLabel").textContent = audio.label; });
  });

  // keyboard
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void compileStage(activeStage); }
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveScene(); }
  });

  // splitters
  const app = $("app");
  const makeSplitter = (el: HTMLElement, side: "L" | "R") => {
    let drag = false;
    el.addEventListener("pointerdown", (e) => { drag = true; el.setPointerCapture(e.pointerId); });
    el.addEventListener("pointerup", () => { drag = false; });
    el.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const r = app.getBoundingClientRect();
      const cols = getComputedStyle(app).gridTemplateColumns.split(" ");
      if (side === "L") {
        const w = clamp(e.clientX - r.left, 140, 420);
        app.style.gridTemplateColumns = `${w}px 5px 1fr 5px ${cols[4]}`;
      } else {
        const w = clamp(r.right - e.clientX, 260, 640);
        app.style.gridTemplateColumns = `${cols[0]} 5px 1fr 5px ${w}px`;
      }
    });
  };
  makeSplitter($("splitL"), "L");
  makeSplitter($("splitR"), "R");

  // AI
  $("bAI").addEventListener("click", () => {
    $("aiStage").textContent = activeStage.toUpperCase();
    $<HTMLDialogElement>("aiDialog").showModal();
  });
  $("aiCancel").addEventListener("click", () => $<HTMLDialogElement>("aiDialog").close());
  $("aiGo").addEventListener("click", async () => {
    const desc = $<HTMLTextAreaElement>("aiPrompt").value.trim();
    $<HTMLDialogElement>("aiDialog").close();
    if (!desc) return;
    const btn = $<HTMLButtonElement>("bAI");
    btn.disabled = true;
    try {
      const { code, result } = await generateWithRepair(
        activeStage, desc,
        (body) => {
          cur.layers[activeStage].code = body;
          return renderer.compileStage(activeStage, body);
        },
        (m) => log("✦ " + m, "ai"),
      );
      cur.layers[activeStage].code = code;
      editor.setCode(code);
      editor.showDiagnostics(result.ok ? [] : result.diagnostics);
      if (result.ok) { log("✦ generated and compiled", "ok"); setDirty(true); renderCustomParams(); renderMods(); }
      else log("✦ still failing after repair — code left in editor", "err");
    } catch (e) {
      log("✦ AI generation unavailable: " + (e as Error).message, "err");
    }
    btn.disabled = false;
  });
}

/* -------------------------------- boot -------------------------------- */
async function boot(): Promise<void> {
  if (!Renderer.supported()) {
    $("unsupported").hidden = false;
    return;
  }
  const preview = $<HTMLCanvasElement>("preview");
  await renderer.init(preview);

  renderer.onDeviceLost = (reason) => {
    log("GPU device lost (" + reason + ") — reinitializing…", "err");
    void renderer.init(preview).then(() => compileAll(false)).then(
      () => log("GPU device recovered; scene state preserved", "ok"),
      () => { $("unsupported").hidden = false; },
    );
  };

  const sizePreview = () => {
    const r = $("previewBox").getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    preview.width = Math.max(4, Math.floor(r.width * dpr));
    preview.height = Math.max(4, Math.floor(r.height * dpr));
    renderer.resize(preview.width, preview.height);
  };
  new ResizeObserver(sizePreview).observe($("previewBox"));
  sizePreview();

  const persisted = await loadScenes();
  if (persisted) scenes = persisted;

  editor = new ShaderEditor($("editorHost"), scenes[0].layers.bg.code, (code) => {
    cur.layers[activeStage].code = code;
    setDirty(true);
    clearTimeout(debounceId);
    debounceId = setTimeout(() => void compileStage(activeStage), 500);
  });
  let debounceId: ReturnType<typeof setTimeout>;

  wire();
  await loadScene(0);
  log("PHOSPHENE STUDIO ready — Ctrl+Enter compiles, Ctrl+S saves. Start DEMO for reactivity.");
  frame();
}

void boot();
