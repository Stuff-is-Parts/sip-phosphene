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
  /** Extra render passes, run in order after POST. Each is a post-contract
   *  WGSL body: srcTex = previous output in the chain, prevTex = this pass's
   *  own last frame (per-pass feedback). Covers render-to-texture graphs. */
  passes?: ScenePass[];
  /** Rasterized 3D layer: instanced primitive drawn depth-tested between
   *  BG and FG. `code` implements the mesh contract (see MESH_CONTRACT). */
  mesh?: SceneMesh;
  /** Stateful CPU particle system rendered as additive billboards. `code`
   *  is a per-particle EEL update program (x/y/z, vx/vy/vz, idx in scope). */
  particles?: SceneParticles;
  /** Text rendered into the scene image slot at load (img(uv) samples it). */
  text?: SceneText;
}

export interface ScenePass {
  id: string;
  code: string;
}

export type MeshPrimitive = "cube" | "sphere" | "plane" | "cylinder" | "torus";

export interface SceneMesh {
  primitive: MeshPrimitive;
  /** Instance count (1..1024). */
  count: number;
  /** WGSL body: fn instancePos(idx : f32, t : f32) -> vec4f (xyz + scale)
   *  and fn meshColor(idx : f32, n : vec3f, wp : vec3f, t : f32) -> vec3f. */
  code: string;
}

export interface SceneParticles {
  /** Particle count (1..4096). */
  count: number;
  /** Per-particle EEL update, run each frame: reads/writes x y z vx vy vz
   *  size, reads idx/count/time/dt plus audio vars; respawn by setting them. */
  code: string;
}

export interface SceneText {
  value: string;
  /** Font size in px at 1024-wide canvas (default 160). */
  size?: number;
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
    ...(Array.isArray(x.passes) && x.passes.length
      ? { passes: x.passes.map((p) => ({ id: String(p.id), code: String(p.code) })) } : {}),
    ...(x.mesh ? {
      mesh: {
        primitive: x.mesh.primitive,
        count: Math.max(1, Math.min(1024, Math.trunc(x.mesh.count) || 1)),
        code: String(x.mesh.code),
      },
    } : {}),
    ...(x.particles ? {
      particles: {
        count: Math.max(1, Math.min(4096, Math.trunc(x.particles.count) || 256)),
        code: String(x.particles.code),
      },
    } : {}),
    ...(x.text?.value ? { text: { value: String(x.text.value), ...(x.text.size ? { size: x.text.size } : {}) } } : {}),
  };
}
