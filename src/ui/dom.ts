/** Shared DOM utilities for both entry points. */

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

/** Escape untrusted text (community/imported scene names) before innerHTML. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type LogClass = "info" | "ok" | "err" | "ai";

/** Append to the studio console (#console); no-op if absent (player). */
export function log(msg: string, cls: LogClass = "info"): void {
  const c = document.getElementById("console");
  if (!c) return;
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = msg;
  c.appendChild(d);
  while (c.children.length > 80) c.removeChild(c.firstChild!);
  c.scrollTop = c.scrollHeight;
}
