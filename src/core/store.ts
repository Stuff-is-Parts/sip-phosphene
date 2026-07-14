import { get, set } from "idb-keyval";
import { isScene, normalizeScene, type Scene } from "./types";

const KEY = "phosphene:scenes:v3";

export async function loadScenes(): Promise<Scene[] | null> {
  try {
    const raw = await get<string>(KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length && arr.every(isScene)) {
      return arr.map(normalizeScene);
    }
  } catch { /* corrupt or unavailable — fall through */ }
  return null;
}

export async function saveScenes(scenes: Scene[]): Promise<void> {
  try {
    await set(KEY, JSON.stringify(scenes));
  } catch { /* storage unavailable — export JSON is the durable path */ }
}

/** File System Access API when present; anchor download otherwise. */
export async function exportJson(filename: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  const picker = (window as unknown as {
    showSaveFilePicker?: (opts: object) => Promise<FileSystemFileHandle>;
  }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [{ description: "PHOSPHENE scenes", accept: { "application/json": [".json"] } }],
      });
      const w = await handle.createWritable();
      await w.write(json);
      await w.close();
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // user cancelled
      // fall through to download
    }
  }
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function importScenes(text: string): Scene[] {
  const j = JSON.parse(text);
  const arr = Array.isArray(j) ? j : [j];
  const valid = arr.filter(isScene).map(normalizeScene);
  if (!valid.length) throw new Error("no valid PHOSPHENE scenes in file");
  return valid;
}
