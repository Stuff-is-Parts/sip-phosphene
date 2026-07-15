import type { Scene } from "./types";

/**
 * Text rendering: draws the scene's text into a canvas and returns a PNG
 * data URL for the scene image slot, where img(uv) samples it. Runs only
 * where a 2D canvas exists (browser); callers treat null as "no text".
 */
export function renderTextImage(scene: Scene): string | null {
  if (!scene.text?.value) return null;
  return renderText(scene.text.value, scene.text.size);
}

/** Value-based form: used by the graph executor for `texture` nodes with
 *  a text source (same rasterization as the legacy scene path). */
export function renderText(value: string, size?: number): string | null {
  if (!value || typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const px = size ?? 160;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${px}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = value.split("\n");
  lines.forEach((line, i) => {
    ctx.fillText(line, canvas.width / 2, canvas.height / 2 + (i - (lines.length - 1) / 2) * px * 1.15, canvas.width - 40);
  });
  return canvas.toDataURL("image/png");
}
