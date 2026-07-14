import "./style.css";
import { Renderer } from "./gpu/renderer";
import { AudioEngine } from "./audio/sources";
import { ModEngine } from "./core/mods";
import { clamp } from "./core/params";
import {
  normalizeScene, STAGES,
  type CompileResult, type Scene, type StageId,
} from "./core/types";
import { builtinScenes, TEMPLATE_BLANK } from "./shaders/library";
import { exportJson, importScenes, loadScenes, saveScenes } from "./core/store";
import { ShaderEditor } from "./ui/editor";
import { generateWithRepair, callClaude, stripFences } from "./ai/generate";
import { CanvasRecorder } from "./core/record";
import { parseP9c, p9ToScene } from "./import/p9";
import { parseMilk, milkToScene } from "./import/milk";
import { meshWarpFor } from "./core/meshwarp";
import { $, log } from "./ui/dom";
import { wireAudioButtons, wireAudioDrop } from "./ui/audio-common";
import {
  allModTargets, renderBaseParams, renderCustomParams, renderLibrary, renderMods,
} from "./ui/panels";

/* ------------------------------- state ------------------------------- */
let scenes: Scene[] = builtinScenes();
let cur: Scene = structuredClone(scenes[0]);
let curIdx = 0;
let activeStage: StageId = "bg";

const audio = new AudioEngine();
const mods = new ModEngine();
const renderer = new Renderer();
const recorder = new CanvasRecorder();
let editor: ShaderEditor;

let frozen = false;
let freezeT = 0;
let scrub = 0;
const t0 = performance.now();
const nowT = () => (performance.now() - t0) / 1000;
const renderT = () => (frozen ? freezeT : nowT()) + scrub;

function setDirty(d: boolean): void {
  $("dirtyMark").style.visibility = d ? "visible" : "hidden";
}
const markDirty = () => setDirty(true);

/* ---------------------------- panel refresh --------------------------- */
function refreshPanels(): void {
  renderBaseParams(cur, markDirty);
  renderCustomParams(cur, renderer.stageParams()[activeStage], markDirty);
  renderMods(cur, allModTargets(renderer.stageParams()), markDirty);
  renderLibrary(scenes, curIdx, {
    onPick: (i) => void loadScene(i),
    onDelete: (i) => {
      if (scenes.length <= 1) return;
      scenes.splice(i, 1);
      if (curIdx >= scenes.length) curIdx = scenes.length - 1;
      void saveScenes(scenes);
      refreshPanels();
    },
  });
}

/* ------------------------------ compile ------------------------------- */
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
  refreshPanels();
  return res;
}
async function compileAll(report: boolean): Promise<void> {
  for (const s of STAGES) await compileStage(s, report);
}

/* --------------------------- scene lifecycle -------------------------- */
async function applySceneImage(): Promise<void> {
  const data = cur.assets?.image;
  $("imgLabel").textContent = data ? "embedded (" + Math.round(data.length / 1024) + " KB)" : "none";
  if (!data) { await renderer.setImage(0, null); return; }
  try {
    const blob = await (await fetch(data)).blob();
    await renderer.setImage(0, await createImageBitmap(blob));
  } catch { await renderer.setImage(0, null); }
}

async function loadScene(i: number): Promise<void> {
  curIdx = i;
  cur = structuredClone(scenes[i]);
  mods.reset();
  $<HTMLInputElement>("sceneTitle").value = cur.name;
  editor.setCode(cur.layers[activeStage].code);
  await compileAll(false);
  await applySceneImage();
  setDirty(false);
  refreshPanels();
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
  refreshPanels();
  log("saved: " + cur.name, "ok");
}

function newScene(): void {
  cur = normalizeScene({ name: "UNTITLED" });
  cur.layers.bg.code = TEMPLATE_BLANK;
  cur.layers.fg.code = "fn render(c : Ctx) -> vec3f { return vec3f(0.0); }";
  cur.layers.post.code =
    "fn render(c : Ctx) -> vec3f {\n  var col = srcTex(c.uv);\n  col = max(col, prevTex(c.uv) * c.fb);\n  return col;\n}";
  curIdx = -1;
  $<HTMLInputElement>("sceneTitle").value = cur.name;
  editor.setCode(cur.layers[activeStage].code);
  void compileAll(false);
  void applySceneImage();
  setDirty(true);
  refreshPanels();
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
  const mw = meshWarpFor(cur);
  renderer.setWarpMesh(0, mw ? mw.evaluate(mods.exprSnapshot(), now) : null);
  $("beatLamp").style.opacity = String(0.15 + audio.analysis.beat * 0.85);
  $("bpmTag").textContent = (audio.analysis.bpm || "—") + " BPM";
  drawScopes();
  renderer.frame(renderT(), audio.analysis, p);
}

/* ---------------------------- wiring: editor --------------------------- */
function wireEditorChrome(): void {
  document.querySelectorAll<HTMLButtonElement>("#stageTabs [data-stage]").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll("#stageTabs [data-stage]").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      activeStage = b.dataset.stage as StageId;
      editor.setCode(cur.layers[activeStage].code);
      refreshPanels();
    });
  });
  $("bCompile").addEventListener("click", () => void compileStage(activeStage));
  $("bTemplate").addEventListener("click", () => editor.setCode(TEMPLATE_BLANK));
  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void compileStage(activeStage); }
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveScene(); }
  });
}

/* -------------------------- wiring: scene I/O -------------------------- */
function wireSceneIO(): void {
  $("bNew").addEventListener("click", newScene);
  $("bSave").addEventListener("click", saveScene);
  $("bThumb").addEventListener("click", () => { captureThumb(); refreshPanels(); log("thumbnail captured", "ok"); });
  $("sceneTitle").addEventListener("input", markDirty);

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
      refreshPanels();
      log(`imported ${imported.length} scene${imported.length === 1 ? "" : "s"}`, "ok");
    } catch (err) {
      log("import failed: " + (err as Error).message, "err");
    }
  });

  // scene image
  $("bImg").addEventListener("click", () => $<HTMLInputElement>("fileImg").click());
  $("bImgClear").addEventListener("click", () => {
    cur.assets = { image: null };
    void applySceneImage();
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
      void applySceneImage();
      setDirty(true);
      log("image embedded: sample it with img(c.uv)", "ok");
    };
    r.readAsDataURL(f);
  });
}

/* ------------------------- wiring: Plane9 import ----------------------- */
function wireP9Import(): void {
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
        let res = await compileStage("bg", true);
        for (const s of ["fg", "post"] as const) await compileStage(s, false);
        if (!res.ok && p9.glsl) {
          log("p9c: deterministic translation failed to compile — trying AI repair with the original GLSL…", "ai");
          try {
            const errs = res.diagnostics.filter((d) => d.severity === "error")
              .map((d) => `line ${d.line}: ${d.message}`).join("; ");
            const fixed = stripFences(await callClaude([{
              role: "user",
              content: "Fix this WGSL music-visualizer stage body so it compiles. It must define fn render(c : Ctx) -> vec3f (Ctx and helpers spec/wav/pal/hash/noise/fbm/img etc. are already in scope; do not redeclare). It is a translation of the ORIGINAL GLSL below — preserve the visual math exactly.\n\nWGSL errors: " + errs + "\n\nCurrent WGSL:\n" + cur.layers.bg.code + "\n\nORIGINAL GLSL (reference):\n" + p9.glsl + "\n\nOutput only the corrected WGSL body.",
            }]));
            cur.layers.bg.code = fixed;
            editor.setCode(fixed);
            res = await compileStage("bg", true);
          } catch (err) {
            log("p9c: AI repair unavailable: " + (err as Error).message, "err");
          }
        }
        await applySceneImage();
        setDirty(true);
        refreshPanels();
        log(res.ok ? `p9c: ${cur.name} imported and compiled — SAVE to keep it` : "p9c: imported with errors — see gutter", res.ok ? "ok" : "err");
      } catch (err) {
        log(`p9c: ${f.name}: ${(err as Error).message}`, "err");
      }
    }
  });
}

/* ------------------------ wiring: MilkDrop import ---------------------- */
function wireMilkImport(): void {
  $("bImportMilk").addEventListener("click", () => $<HTMLInputElement>("fileMilk").click());
  $<HTMLInputElement>("fileMilk").addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = "";
    for (const f of files) {
      try {
        const preset = parseMilk(await f.text(), f.name);
        const { scene, report } = milkToScene(preset);
        log(`milk: ${scene.name} — ${scene.mods.length} equation route(s)`);
        report.forEach((r) => log("milk: " + r, "ai"));
        cur = scene;
        curIdx = -1;
        $<HTMLInputElement>("sceneTitle").value = cur.name;
        editor.setCode(cur.layers.bg.code);
        const res = await compileStage("bg", true);
        for (const s of ["fg", "post"] as const) await compileStage(s, false);
        if (preset.warpShader) {
          log("milk: translating MilkDrop 2 warp HLSL via AI…", "ai");
          try {
            const translated = stripFences(await callClaude([{
              role: "user",
              content: "Translate this MilkDrop 2 warp HLSL into a WGSL POST stage body for a music visualizer. It must define fn render(c : Ctx) -> vec3f (Ctx, spec/wav/pal/hash/noise/fbm, srcTex(uv), prevTex(uv), meshOff(uv), warpUV are in scope; do not redeclare). Preserve the visual math. Keep the //@param lines from the current body so equation routing still works.\n\nCurrent WGSL POST body:\n" + cur.layers.post.code + "\n\nHLSL warp shader:\n" + preset.warpShader + "\n\nOutput only the WGSL body.",
            }]));
            const prev = cur.layers.post.code;
            cur.layers.post.code = translated;
            const postRes = await compileStage("post", false);
            if (postRes.ok) log("milk: warp HLSL translated and compiled", "ok");
            else {
              cur.layers.post.code = prev;
              await compileStage("post", false);
              log("milk: HLSL translation did not compile — parametric warp kept", "err");
            }
          } catch (err) {
            log("milk: AI translation unavailable: " + (err as Error).message, "err");
          }
        }
        await applySceneImage();
        setDirty(true);
        refreshPanels();
        log(res.ok ? `milk: ${cur.name} imported — SAVE to keep it` : "milk: imported with errors — see gutter", res.ok ? "ok" : "err");
      } catch (err) {
        log(`milk: ${f.name}: ${(err as Error).message}`, "err");
      }
    }
  });
}

/* -------------------- wiring: transport, mods, AI ---------------------- */
function wireTransport(): void {
  wireAudioButtons(audio,
    { demo: "aDemo", file: "aFile", mic: "aMic", input: "fileAudio" },
    (label) => { $("trackLabel").textContent = label; log("audio: " + label); },
    (msg) => log(msg, "err"));
  wireAudioDrop(audio, "dropOverlay", (label) => { $("trackLabel").textContent = label; });

  $("aBeat").addEventListener("click", () => audio.analysis.inject(nowT()));
  $("tFreeze").addEventListener("click", (e) => {
    frozen = !frozen;
    if (frozen) freezeT = nowT();
    (e.currentTarget as HTMLElement).classList.toggle("on", frozen);
  });
  $<HTMLInputElement>("tScrub").addEventListener("input", (e) => {
    scrub = +(e.target as HTMLInputElement).value;
  });
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
  $("bAddMod").addEventListener("click", () => {
    cur.mods.push({ target: "hue", source: "bass", gain: 0.3, base: 0 });
    refreshPanels();
    setDirty(true);
  });
}

function wireAI(): void {
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
        (m) => log("✦ " + m, "ai"));
      cur.layers[activeStage].code = code;
      editor.setCode(code);
      editor.showDiagnostics(result.ok ? [] : result.diagnostics);
      if (result.ok) {
        log("✦ generated and compiled", "ok");
        setDirty(true);
        refreshPanels();
      } else {
        log("✦ still failing after repair — code left in editor", "err");
      }
    } catch (e) {
      log("✦ AI generation unavailable: " + (e as Error).message, "err");
    }
    btn.disabled = false;
  });
}

function wireSplitters(): void {
  const app = $("app");
  const make = (el: HTMLElement, side: "L" | "R") => {
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
  make($("splitL"), "L");
  make($("splitR"), "R");
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
      () => { $("unsupported").hidden = false; });
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

  let debounceId: ReturnType<typeof setTimeout>;
  editor = new ShaderEditor($("editorHost"), scenes[0].layers.bg.code, (code) => {
    cur.layers[activeStage].code = code;
    setDirty(true);
    clearTimeout(debounceId);
    debounceId = setTimeout(() => void compileStage(activeStage), 500);
  });

  wireEditorChrome();
  wireSceneIO();
  wireP9Import();
  wireMilkImport();
  wireTransport();
  wireAI();
  wireSplitters();

  await loadScene(0);
  log("PHOSPHENE STUDIO ready — Ctrl+Enter compiles, Ctrl+S saves. Start DEMO for reactivity.");
  frame();
}

void boot();
