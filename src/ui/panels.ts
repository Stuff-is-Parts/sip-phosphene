import { MOD_SOURCES, type CustomParam, type Scene, type StageId } from "../core/types";
import { $, esc } from "./dom";

/** Base-parameter sliders (hue / speed / intensity / trails). */
const BASE_DEFS = [
  { key: "hue" as const, label: "hue", min: 0, max: 1, step: 0.01 },
  { key: "speed" as const, label: "speed", min: 0.2, max: 2.5, step: 0.05 },
  { key: "int" as const, label: "intensity", min: 0.3, max: 2, step: 0.05 },
  { key: "fb" as const, label: "trails", min: 0, max: 0.95, step: 0.02 },
];

export function renderBaseParams(cur: Scene, onChange: () => void): void {
  const box = $("baseParams");
  box.innerHTML = "";
  for (const def of BASE_DEFS) {
    const row = document.createElement("div");
    row.className = "slider";
    row.innerHTML = `<span>${def.label}</span>
      <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${cur.params[def.key]}">
      <output>${cur.params[def.key].toFixed(2)}</output>`;
    const inp = row.querySelector("input")!;
    inp.addEventListener("input", () => {
      cur.params[def.key] = +inp.value;
      row.querySelector("output")!.textContent = (+inp.value).toFixed(2);
      onChange();
    });
    box.appendChild(row);
  }
}

export function renderCustomParams(
  cur: Scene,
  params: CustomParam[],
  onChange: () => void,
): void {
  const box = $("customParams");
  box.innerHTML = "";
  if (!params.length) {
    box.innerHTML = '<div class="hint">none declared in this stage</div>';
    return;
  }
  for (const p of params) {
    const val = cur.custom[p.name] ?? p.def;
    const row = document.createElement("div");
    row.className = "slider";
    row.innerHTML = `<span>${esc(p.name)}</span>
      <input type="range" min="${p.min}" max="${p.max}" step="${(p.max - p.min) / 200}" value="${val}">
      <output>${val.toFixed(2)}</output>`;
    const inp = row.querySelector("input")!;
    inp.addEventListener("input", () => {
      cur.custom[p.name] = +inp.value;
      row.querySelector("output")!.textContent = (+inp.value).toFixed(2);
      onChange();
    });
    box.appendChild(row);
  }
}

export function renderMods(
  cur: Scene,
  targets: string[],
  onChange: () => void,
): void {
  const box = $("modRows");
  box.innerHTML = "";
  cur.mods.forEach((m, i) => {
    const row = document.createElement("div");
    row.className = "modRow";
    row.innerHTML = `
      <select aria-label="target">${targets.map((t) => `<option ${t === m.target ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
      <select aria-label="source">${MOD_SOURCES.map((s) => `<option ${s === m.source ? "selected" : ""}>${s}</option>`).join("")}</select>
      <input type="number" step="0.05" value="${m.gain}" title="gain">
      <input type="number" step="0.05" value="${m.base}" title="base">
      <button class="rm" title="remove">✕</button>`;
    const [selT, selS] = row.querySelectorAll("select");
    const [inG, inB] = row.querySelectorAll("input");
    selT.addEventListener("change", () => { m.target = selT.value; onChange(); });
    selS.addEventListener("change", () => { m.source = selS.value as typeof m.source; onChange(); });
    inG.addEventListener("change", () => { m.gain = +inG.value; onChange(); });
    inB.addEventListener("change", () => { m.base = +inB.value; onChange(); });
    row.querySelector<HTMLButtonElement>(".rm")!.addEventListener("click", () => {
      cur.mods.splice(i, 1);
      renderMods(cur, targets, onChange);
      onChange();
    });
    box.appendChild(row);
  });
  if (!cur.mods.length) {
    box.innerHTML = '<div class="hint">no routes — parameters stay at their slider values</div>';
  }
}

export interface LibraryCallbacks {
  onPick: (i: number) => void;
  onDelete: (i: number) => void;
}

export function renderLibrary(scenes: Scene[], curIdx: number, cb: LibraryCallbacks): void {
  const el = $("sceneLibrary");
  el.innerHTML = "";
  scenes.forEach((s, i) => {
    const div = document.createElement("div");
    div.className = "libItem" + (i === curIdx ? " active" : "");
    div.innerHTML =
      (s.thumb ? `<img src="${s.thumb}" alt="">` : `<div class="noThumb">no<br>thumb</div>`) +
      `<div class="nm">${esc(s.name)}</div><button class="rm" title="delete">✕</button>`;
    div.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("rm")) return;
      cb.onPick(i);
    });
    div.querySelector<HTMLButtonElement>(".rm")!.addEventListener("click", () => cb.onDelete(i));
    el.appendChild(div);
  });
}

/** All routable mod targets: builtins + every stage's //@param names. */
export function allModTargets(stageParams: Record<StageId, CustomParam[]>): string[] {
  const t = ["hue", "speed", "int", "fb"];
  for (const stage of ["bg", "fg", "post"] as const) {
    for (const p of stageParams[stage]) if (!t.includes(p.name)) t.push(p.name);
  }
  return t;
}
