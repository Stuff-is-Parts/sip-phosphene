import type { CompileResult, StageId } from "../core/types";

export function systemPrompt(stage: StageId): string {
  return `You write WGSL fragment-shader stage BODIES for a music visualizer. Output ONLY WGSL code — no markdown fences, no commentary.

The body must define exactly: fn render(c : Ctx) -> vec3f
Already in scope (do NOT redeclare any of it):
struct Ctx { uv:vec2f /*0..1*/, q:vec2f /*aspect-corrected centered*/, res:vec2f, t:f32 /*speed-scaled time*/, rawT:f32, bass:f32, mid:f32, treble:f32, beat:f32 /*decaying pulse*/, energy:f32, hue:f32, speed:f32, intensity:f32, fb:f32 }
fn spec(i:i32)->f32 (64-bin log spectrum 0..1); fn wav(i:i32)->f32 (waveform -1..1); fn pal(t:f32)->vec3f (hue palette); fn hash(p:vec2f)->f32; fn noise(p:vec2f)->f32; fn fbm(p:vec2f)->f32; fn ridge(p:vec2f)->f32; fn hue3(h:f32)->vec3f.${stage === "post" ? `
This is a POST stage. Also in scope: fn srcTex(uv:vec2f)->vec3f (current frame), fn prevTex(uv:vec2f)->vec3f (previous output). Base your output on srcTex and blend trails, e.g. col = max(col, prevTex(c.uv) * c.fb);` : ""}${stage === "fg" ? `
This is a FOREGROUND stage, additively blended over the background: output only the light you add (black = transparent).` : ""}

Tunable values: declare up to 3 with the exact comment form //@param name min max default (each on its own line, floats), then read each as a zero-arg call: name().

WGSL rules to respect: it is NOT GLSL — use let/var (var for anything reassigned), f32/i32 suffix-free float literals like 1.0, vec2f/vec3f constructors, atan2(y,x) not atan(y,x), fract not mod-based hacks are fine, no ternary (use select(f,t,cond) or if), loops \`for (var k = 0; k < N; k++)\` with N <= 24, indexing spec()/wav() takes i32. Multiply the final color by c.intensity. Scale motion with c.speed or use c.t. Make it react musically: bass = body/mass, treble = sparkle, c.beat = percussive accents that decay.

Write the body only: optional //@param lines, optional helper fns, then fn render.`;
}

interface ApiTextBlock { type: string; text?: string }

export async function callClaude(messages: { role: string; content: string }[]): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1200, messages }),
  });
  const data = await r.json();
  if (!data.content) throw new Error(data.error?.message ?? "no response");
  return (data.content as ApiTextBlock[])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text as string)
    .join("\n");
}

export function stripFences(s: string): string {
  return s.replace(/```(?:wgsl|rust|glsl)?/g, "").replace(/```/g, "").trim();
}

/**
 * Generate a stage body; on compile failure, feed the real WGSL diagnostics
 * back for one automatic repair pass.
 */
export async function generateWithRepair(
  stage: StageId,
  description: string,
  tryCompile: (body: string) => Promise<CompileResult>,
  onStatus: (msg: string) => void,
): Promise<{ code: string; result: CompileResult }> {
  const sys = systemPrompt(stage);
  onStatus(`generating ${stage} shader…`);
  let code = stripFences(await callClaude([
    { role: "user", content: sys + "\n\nVisual description: " + description },
  ]));
  let result = await tryCompile(code);
  if (!result.ok) {
    const errs = result.diagnostics
      .filter((d) => d.severity === "error")
      .map((d) => `line ${d.line}: ${d.message}`)
      .join("; ");
    onStatus(`first attempt failed (${errs}) — repair pass…`);
    code = stripFences(await callClaude([
      { role: "user", content: sys + "\n\nVisual description: " + description },
      { role: "assistant", content: code },
      {
        role: "user",
        content: `That body failed WGSL compilation with: ${errs}. Output the corrected full body, code only.`,
      },
    ]));
    result = await tryCompile(code);
  }
  return { code, result };
}
