import type { Scene } from "./types";

/**
 * Text rendering: draws the scene's text into a canvas and returns a PNG
 * data URL for the scene image slot, where img(uv) samples it. Runs only
 * where a 2D canvas exists (browser); callers treat null as "no text".
 */
export function renderTextImage(scene: Scene): string | null {
  if (!scene.text?.value || typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const size = scene.text.size ?? 160;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = scene.text.value.split("\n");
  lines.forEach((line, i) => {
    ctx.fillText(line, canvas.width / 2, canvas.height / 2 + (i - (lines.length - 1) / 2) * size * 1.15, canvas.width - 40);
  });
  return canvas.toDataURL("image/png");
}
