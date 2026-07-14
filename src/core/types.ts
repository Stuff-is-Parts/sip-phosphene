/** PHOSPHENE scene format v3 — WGSL-native, portable JSON. */

export type StageId = "bg" | "fg" | "post";
export const STAGES: StageId[] = ["bg", "fg", "post"];

export interface LayerDef {
  /** WGSL body implementing `fn render(c: Ctx) -> vec3f` (+ optional //@param lines). */
  code: string;
}

export interface ModRoute {
  /** Parameter name: built-in (hue/speed/int/fb) or a //@param name. */
  target: string;
  source: ModSource;
  gain: number;
  base: number;
  /** source "expr": per-frame program evaluated in the shared expression env. */
  expr?: string;
  /** source "expr": env variable read as the route value (default: target, then `out`). */
  readVar?: string;
  /** source "expr": program run once (per engine reset) before the first frame. */
  init?: string;
  /** source "expr": namespace — routes sharing one ns run in a scoped env
   *  (MilkDrop wave/shape equations reuse var names like x/y/r/g across units). */
  ns?: string;
}

export type ModSource =
  | "bass" | "mid" | "treble" | "beat" | "energy"
  | "bpmPhase" | "specLow" | "specHigh"
  | "lfoSlow" | "lfoFast" | "beatRamp" | "beatRand"
  | "midi1" | "midi2" | "midi3" | "midi4"
  | "expr";

export const MOD_SOURCES: ModSource[] = [
  "bass", "mid", "treble", "beat", "energy", "bpmPhase", "specLow", "specHigh",
  "lfoSlow", "lfoFast", "beatRamp", "beatRand",
  "midi1", "midi2", "midi3", "midi4",
];

export interface BaseParams {
  hue: number;
  speed: number;
  int: number;
  fb: number;
}

export interface Scene {
  version: 3;
  name: string;
  layers: Record<StageId, LayerDef>;
  params: BaseParams;
  /** Values for //@param-declared custom uniforms, by name. */
  custom: Record<string, number>;
  mods: ModRoute[];
  /** JPEG data-URL thumbnail, captured from the preview. */
  thumb: string | null;
  /** Optional embedded assets (kept small — scenes stay portable JSON). */
  assets?: { image?: string | null };
  /** Attribution for ported/derived scenes. */
  credit?: string;
  /** License of THIS scene file (e.g. ported CC BY-NC-SA content). */
  license?: string;
  /** Per-vertex warp-mesh program (MilkDrop per-pixel equations): evaluated
   *  on a coarse grid each frame, sampled by POST via meshOff(uv). */
  warpMesh?: string;
  /** Built-in bloom pass strength 0..1 (0/absent = off). */
  bloom?: number;
}

export interface CustomParam {
  name: string;
  min: number;
  max: number;
  def: number;
  /** Slot index into the packed custom-uniform array (0..15). */
  slot: number;
}

export interface AudioFeatures {
  /** Monotonic count of detected beats (for beat-held sources). */
  beatCount: number;
  /** Time (sec, caller clock) of the most recent beat. */
  lastBeat: number;
  bass: number;
  mid: number;
  treble: number;
  beat: number;
  energy: number;
  bpm: number;
  spec: Float32Array; // 64
  wave: Float32Array; // 64
}

export interface CompileDiagnostic {
  /** 1-based line in the USER body (header offset already removed). */
  line: number;
  message: string;
  severity: "error" | "warning" | "info";
}

export interface CompileResult {
  ok: boolean;
  diagnostics: CompileDiagnostic[];
  params: CustomParam[];
}

export function defaultParams(): BaseParams {
  return { hue: 0, speed: 1, int: 1, fb: 0.3 };
}

export function isScene(x: unknown): x is Scene {
  const s = x as Scene;
  return (
    !!s && typeof s === "object" &&
    !!s.layers && !!s.layers.bg && !!s.layers.fg && !!s.layers.post &&
    typeof s.layers.bg.code === "string"
  );
}

/** Migrate/patch an imported scene to a complete v3 object. */
export function normalizeScene(x: Partial<Scene>): Scene {
  return {
    version: 3,
    name: x.name ?? "UNTITLED",
    layers: {
      bg: { code: x.layers?.bg?.code ?? "" },
      fg: { code: x.layers?.fg?.code ?? "" },
      post: { code: x.layers?.post?.code ?? "" },
    },
    params: { ...defaultParams(), ...(x.params ?? {}) },
    custom: { ...(x.custom ?? {}) },
    mods: Array.isArray(x.mods) ? x.mods.map((m) => ({ ...m })) : [],
    thumb: x.thumb ?? null,
    assets: { image: x.assets?.image ?? null },
    ...(x.credit ? { credit: x.credit } : {}),
    ...(x.license ? { license: x.license } : {}),
    ...(x.warpMesh ? { warpMesh: x.warpMesh } : {}),
    ...(typeof x.bloom === "number" && x.bloom > 0 ? { bloom: x.bloom } : {}),
  };
}
