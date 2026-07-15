import { F32, vec, type Ty } from "./ast";
import { parseShader } from "./parser";
import { Emitter, WGSL_RESERVED, type Builtin, type Dialect } from "./emit";
import { mathBuiltins, vecArg } from "./builtins";

/**
 * MilkDrop-2 HLSL front end for warp and comp shaders. Binds the preset
 * shader contract (uv/uv_orig/rad/ang/ret/q-vars/texsize, sampler_main),
 * parses with the shared parser, and emits either a POST body (warp) or an
 * extra-pass body (comp) through the typed emitter.
 */

const RESERVED = new Set([
  "c", "render", "vmain", "fmain", "makeCtx", "img", "spec", "wav", "custSlot",
  "smin", "rot2", "camRay", "warpUV", "waveLine", "sdSphere", "sdBox",
  "sdTorus", "sdCylinder", "opRep", "sdNgon", "U", "Ctx", "noise", "hash",
  "fbm", "ridge", "pal", "hue3",
]);

function bindContract(src: string): string {
  let s = src.replace(/\r\n/g, "\n");
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/^[ \t]*#define[ \t]+(\w+)[ \t]+([^\s/]+)[ \t]*$/gm, "const float $1 = $2;");
  s = s.replace(/^[ \t]*#.*$/gm, "");
  s = s.replace(/\bsampler(2D|3D)?\s+\w+\s*(=[^;]*)?;/g, "");
  s = s.replace(/\btex[23]D\s*\(\s*sampler_\w+\s*,\s*/g, "mdtex(");
  s = s.replace(/\btex[23]D\s*\(\s*\w+\s*,\s*/g, "mdtex(");
  s = s.replace(/\bGetMain\s*\(/g, "mdtex(");
  s = s.replace(/\bGetPixel\s*\(/g, "mdtex(");
  s = s.replace(/\bGetBlur[123]\s*\(/g, "mdtexblur(");
  s = s.replace(/\blum\s*\(/g, "mdlum(");
  s = s.replace(/\bshader_body\b/g, "void main()");
  // noise-texture metrics: fixed 256^2 (lq/mq/hq/vol variants)
  s = s.replace(/\btexsize_noise\w*\b/g, "float4(256.0, 256.0, 0.00390625, 0.00390625)");
  return s;
}

export type HlslKind = "warp" | "comp";

export function hlslToBody(hlsl: string, kind: HlslKind): { body: string; warnings: string[] } {
  const warnings: string[] = [];
  const bound = bindContract(hlsl);

  const externals: Record<string, Ty> = {
    uv: vec(2), uv_orig: vec(2), rad: F32, ang: F32,
    ret: vec(3), texsize: vec(4), aspect: vec(4),
    time: F32, bass: F32, mid: F32, treb: F32, vol: F32,
    bass_att: F32, mid_att: F32, treb_att: F32, vol_att: F32,
    frame: F32, fps: F32, progress: F32, decay: F32,
    hue_shader: vec(3), rand_preset: vec(4), rand_frame: vec(4),
    roam_cos: vec(4), roam_sin: vec(4), slow_roam_cos: vec(4), slow_roam_sin: vec(4),
  };
  for (let i = 1; i <= 32; i++) externals[`q${i}`] = F32;

  const sampleFn = kind === "warp" ? "prevTex" : "srcTex";
  const builtins = mathBuiltins();
  const tex: Builtin = (args, line, e) => ({
    code: `vec4f(${sampleFn}(${vecArg(args, 0, 2, line, e)}), 1.0)`,
    ty: vec(4),
  });
  builtins.mdtex = tex;
  builtins.mdtexblur = tex; // blur chain approximated by the direct sample
  builtins.mdlum = (args, line, e) => ({
    code: `dot(${vecArg(args, 0, 3, line, e)}, vec3f(0.32, 0.49, 0.29))`,
    ty: F32,
  });

  const dialect: Dialect = {
    externals,
    builtins,
    rename: (n) => (RESERVED.has(n) || WGSL_RESERVED.has(n) ? "u_" + n : n),
  };
  const emitter = new Emitter(dialect);
  emitter.entryOutVar = "ret";
  emitter.entryOutTy = vec(3);
  const prog = parseShader(bound);
  const { helpers, entry, globalInits } = emitter.emitProgram(prog, "main");
  const retExpr = kind === "warp" ? "max(ret, srcTex(c.uv))" : "ret";
  const stmts = (globalInits ? globalInits + "\n" : "") +
    emitter.emitEntryBody(entry, externals, retExpr, { k: "void" });

  // contract vars are module privates (helpers read them) and writable
  // (presets assign to q-vars, rad, even uv freely)
  const names: [string, string][] = [
    ["uv", "vec2f"], ["uv_orig", "vec2f"], ["rad", "f32"], ["ang", "f32"],
    ["texsize", "vec4f"], ["aspect", "vec4f"], ["time", "f32"],
    ["bass", "f32"], ["mid", "f32"], ["treb", "f32"], ["vol", "f32"],
    ["bass_att", "f32"], ["mid_att", "f32"], ["treb_att", "f32"], ["vol_att", "f32"],
    ["frame", "f32"], ["fps", "f32"], ["progress", "f32"], ["decay", "f32"],
    ["hue_shader", "vec3f"], ["rand_preset", "vec4f"], ["rand_frame", "vec4f"],
    ["roam_cos", "vec4f"], ["roam_sin", "vec4f"],
    ["slow_roam_cos", "vec4f"], ["slow_roam_sin", "vec4f"], ["ret", "vec3f"],
  ];
  for (let i = 1; i <= 32; i++) names.push([`q${i}`, "f32"]);
  const privates = names.map(([n, t]) => `var<private> ${n} : ${t};`).join("\n");

  const uvInit = kind === "warp"
    ? `  uv = warpUV(c.uv, mdZoom(), mdRot(), vec2f(mdDx(), mdDy()), mdWarp(), c.t) + meshOff(c.uv);`
    : `  uv = c.uv;`;
  const qInits = Array.from({ length: 32 }, (_, i) =>
    `  q${i + 1} = ${i < 8 ? `mdQ${i + 1}()` : "0.0"};`).join("\n");
  const composite = kind === "warp"
    ? `  return max(ret, srcTex(c.uv));`
    : `  return ret;`;

  const body = privates + "\n" + (helpers ? helpers + "\n" : "") +
    `fn render(c : Ctx) -> vec3f {
${uvInit}
  uv_orig = c.uv;
  rad = length(c.q) * 0.7071;
  ang = atan2(c.q.y, c.q.x);
  texsize = vec4f(c.res, 1.0 / c.res);
  aspect = vec4f(c.res.x / c.res.y, c.res.y / c.res.x, 1.0, 1.0);
  time = c.t;
  bass = c.bass; mid = c.mid; treb = c.treble;
  vol = (c.bass + c.mid + c.treble) / 3.0;
  bass_att = bass; mid_att = mid; treb_att = treb; vol_att = vol;
  frame = c.rawT * 60.0;
  fps = 60.0; progress = 0.0;
  decay = mdDecay();
  hue_shader = pal(0.5);
  rand_preset = vec4f(0.42, 0.71, 0.13, 0.88);
  rand_frame = fract(vec4f(sin(c.rawT * 91.7), sin(c.rawT * 57.3), sin(c.rawT * 23.1), sin(c.rawT * 77.9)));
  roam_cos = cos(vec4f(c.rawT * 0.3, c.rawT * 1.3, c.rawT * 5.0, c.rawT * 20.0));
  roam_sin = sin(vec4f(c.rawT * 0.3, c.rawT * 1.3, c.rawT * 5.0, c.rawT * 20.0));
  slow_roam_cos = cos(vec4f(c.rawT * 0.005, c.rawT * 0.008, c.rawT * 0.013, c.rawT * 0.022));
  slow_roam_sin = sin(vec4f(c.rawT * 0.005, c.rawT * 0.008, c.rawT * 0.013, c.rawT * 0.022));
${qInits}
  ret = vec3f(0.0);
${stmts}
${composite}
}`;
  return { body, warnings };
}
