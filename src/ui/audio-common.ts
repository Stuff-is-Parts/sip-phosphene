import type { AudioEngine } from "../audio/sources";
import { $ } from "./dom";

interface AudioButtonIds {
  demo: string;
  file: string;
  mic: string;
  input: string; // hidden <input type=file>
}

/** Wire demo/file/mic controls shared by both entries. */
export function wireAudioButtons(
  audio: AudioEngine,
  ids: AudioButtonIds,
  onSource: (label: string) => void,
  onError: (msg: string) => void,
): void {
  $(ids.demo).addEventListener("click", () => {
    audio.startDemo();
    onSource(audio.label);
  });
  $(ids.mic).addEventListener("click", async () => {
    try {
      await audio.startMic();
      onSource(audio.label);
    } catch (e) {
      onError("microphone unavailable (" + (e as Error).name + ")");
    }
  });
  $(ids.file).addEventListener("click", () => $<HTMLInputElement>(ids.input).click());
  $<HTMLInputElement>(ids.input).addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = "";
    if (!f) return;
    try {
      await audio.playFile(f);
      onSource(audio.label);
    } catch {
      onError("couldn't decode that audio file");
    }
  });
}

/** Whole-window drag-and-drop of audio files, shared by both entries. */
export function wireAudioDrop(
  audio: AudioEngine,
  overlayId: string,
  onSource: (label: string) => void,
): void {
  let depth = 0;
  const overlay = $(overlayId);
  addEventListener("dragenter", (e) => { e.preventDefault(); depth++; overlay.style.display = "flex"; });
  addEventListener("dragleave", (e) => { e.preventDefault(); if (--depth <= 0) { depth = 0; overlay.style.display = "none"; } });
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    overlay.style.display = "none";
    const f = [...(e.dataTransfer?.files ?? [])].find(
      (f) => f.type.startsWith("audio") || /\.(mp3|wav|ogg|m4a|flac)$/i.test(f.name));
    if (f) void audio.playFile(f).then(() => onSource(audio.label));
  });
}
