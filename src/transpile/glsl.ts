import { F32, vec, type Ty } from "./ast";
import { parseShader } from "./parser";
import { Emitter, WGSL_RESERVED, type Builtin, type Dialect } from "./emit";
import { mathBuiltins, vecArg } from "./builtins";

/**
 * Plane9-GLSL front end: binds the engine's inputs (si.*, gTime, gIn*,
 * gTexture samplers), parses the fragment section with the shared parser,
 * and emits a PHOSPHENE `render` body through the typed emitter.
 */

const RESERVED = new Set([
  "c", "render", "vmain", "fmain", "makeCtx", "img", "spec", "wav", "custSlot",
  "smin", "rot2", "camRay", "warpUV", "waveLine", "sdSphere", "sdBox",
  "sdTorus", "sdCylinder", "opRep", "sdNgon", "U", "Ctx", "uv",
]);

function prepare(glsl: string): { helpers: string; main: string } {
  let src = glsl.replace(/\r\n/g, "\n");
  src = src.replace(/\/\*[\s\S]*?\*\//g, "");
  // stray-character tolerance: '/' outside comments (line-splice residue) drops
  src = src.replace(/;\s*\/(?=\s*[a-zA-Z_])/g, "; ");
  src = src.replace(/VERTEXOUTPUT\s*\{[^}]*\}/, "");
  // GLSL brace initializers: vec3 x = {a,b,c}  ->  vec3 x = vec3(a,b,c)
  src = src.replace(/\b(vec2|vec3|vec4|ivec2|ivec3|ivec4|mat2|mat3|mat4)(\s+\w+\s*=\s*)\{([^{}]*)\}/g,
    (_m, ty: string, mid: string, body: string) => `${ty}${mid}${ty}(${body})`);
  // GLSL array-constructor syntax: int dither[64] = int[64](...)  ->
  // int dither[64] = array<i32,64>(...) — WGSL form the parser accepts
  src = src.replace(/=\s*(int|float)\s*\[\s*(\d+)\s*\]\s*\(/g, "= $1[$2]__ctor(");
  // strip #ifdef VERTEX blocks (which are between #ifdef VERTEX ... #endif
  // and may nest with #else) — a simple regex plus a fallback for #else
  src = src.replace(/#ifdef\s+VERTEX[\s\S]*?#endif/g, "");
  src = src.replace(/#ifdef\s+VERTEX[\s\S]*?#else([\s\S]*?)#endif/g, "$1");
  const fm = /#ifdef\s+FRAGMENT([\s\S]*?)#endif/.exec(src);
  if (!fm) throw new Error("no FRAGMENT section found");
  const frag = fm[1];
  const helpers = src.replace(/#ifdef\s+FRAGMENT[\s\S]*?#endif/, "");
  return { helpers, main: frag };
}

/** Engine-binding substitutions: names, not grammar. */
function bindEngine(src: string): string {
  let s = src;
  s = s.replace(/^[ \t]*#define[ \t]+(\w+)[ \t]+([^\s/]+)[ \t]*$/gm, "const float $1 = $2;");
  s = s.replace(/^[ \t]*#.*$/gm, "");
  s = s.replace(/\bPI2\b/g, "6.2831853");
  s = s.replace(/\bPI\b/g, "3.14159265");
  s = s.replace(/\b_noise(fast)?\s*\(/g, "noise(");
  s = s.replace(/\b_fbm(fast)?\s*\(/g, "fbm(");
  s = s.replace(/\b_turbulence(fast)?\s*\(/g, "ridge(");
  s = s.replace(/\b_ridgedmf(fast)?\s*\(/g, "ridge(");
  s = s.replace(/\b_rand\s*\(/g, "hash(");
  s = s.replace(/\b_voronoi\s*\(/g, "p9voronoi(");
  s = s.replace(/\b_stepaa\s*\(/g, "step(");
  s = s.replace(/\b_toneMappingUncharted2\s*\(/g, "p9aces(");
  s = s.replace(/\b_hsv2rgb\s*\(/g, "p9hsv2rgb(");
  s = s.replace(/\b_tonemapACES\s*\(/g, "p9aces(");
  s = s.replace(/\b_luminance\s*\(/g, "p9luma(");
  s = s.replace(/\b_saturate\s*\(/g, "saturate(");
  s = s.replace(/\b_tolinear\s*\(/g, "p9linear(");
  s = s.replace(/\b_rotate\s*\(/g, "p9rot(");
  s = s.replace(/\bsi\.tex\b/g, "p9uv");
  s = s.replace(/\bsi\.diffuse\b/g, "p9diffuse");
  // per-vertex varyings the scene doesn't drive; typed-correct defaults
  s = s.replace(/\bsi\.(normal|vnormal)\b/g, "p9normal");
  s = s.replace(/\bsi\.(vpos|pos|worldPos|wPos)\b/g, "p9wpos");
  s = s.replace(/\bsi\.(view|viewDir|vdir)\b/g, "p9view");
  s = s.replace(/\bsi\.\w+\b/g, "p9diffuse");
  s = s.replace(/\bgTime\b/g, "p9time");
  s = s.replace(/\bgFrameNr\b/g, "(p9time * 60.0)");
  s = s.replace(/\bgColor[12]?\b/g, "p9diffuse");
  s = s.replace(/\bgResolution\b/g, "p9res");
  s = s.replace(/\bgl_FragCoord\b/g, "p9fragcoord");
  s = s.replace(/\bgl_PointCoord\b/g, "p9uv");
  s = s.replace(/\bgTexture\dSize\b/g, "p9res");
  s = s.replace(/\bgTargetSize\b/g, "p9res");
  s = s.replace(/\bgViewPosition\b/g, "vec3(0.0, 0.0, 4.33)");
  s = s.replace(/\bgViewDirection\b/g, "vec3(0.0, 0.0, -1.0)");
  // panoramic sampling (must run before the generic sampler-arg strip)
  s = s.replace(/\b_texturePanoramic(Lod)?\s*\(\s*\w+\s*,\s*/g, "p9pano(");
  s = s.replace(/\btexelFetch\s*\(\s*\w+\s*,\s*/g, "p9texel(");
  s = s.replace(/\btexture(Lod|2D)?\s*\(\s*\w+\s*,\s*/g, "p9tex(");
  // helper fns taking sampler params: strip the param and any remaining
  // sampler-name arguments (unless already consumed by a texture rewrite)
  s = s.replace(/\bsampler([23]D|Cube)\s+\w+\s*,\s*/g, "");
  s = s.replace(/\(\s*(gTexture\d|gPermutation\w*|gNoise\w*)\s*,\s*/g, "(");
  s = s.replace(/\bgTexture\d\b/g, "img(vec2f(0.0))"); // bare uses become neutral
  s = s.replace(/\boColor\b/g, "p9out");
  return s;
}

/**
 * Clean-room implementations of Plane9's stdlib helpers, written against the
 * signatures its scenes call with canonical textbook formulas (Lambert,
 * Blinn-Phong, Schlick fresnel, IQ palette). Injected per referenced name
 * when the scene doesn't define its own.
 */
const PRELUDE: [string, string][] = [
  ["_tosrgb", `vec3 _tosrgb(vec3 v) { return max(vec3(1.055) * pow(v, vec3(0.4167)) - vec3(0.055), vec3(0.0)); }
vec4 _tosrgb4(vec4 v) { return vec4(_tosrgb(v.rgb), v.w); }`],
  ["_palette", `vec3 _palette(float t, vec3 brightness, vec3 contrast, vec3 a, vec3 b) {
  return brightness + contrast * cos(6.2831853 * (a * t + b));
}`],
  ["_bump", `float _bump(float value, float start, float end, float width) {
  return smoothstep(start - width, start, value) * (1.0 - smoothstep(end, end + width, value));
}`],
  ["_lightLambert", `vec3 _lightLambert(vec3 normal, vec3 lightDir, vec3 diffuseCol) {
  return diffuseCol * max(dot(normal, lightDir), 0.0);
}`],
  ["_lightHalfLambert", `vec3 _lightHalfLambert(vec3 normal, vec3 lightDir, vec3 diffuseCol) {
  float hl = dot(normal, lightDir) * 0.5 + 0.5;
  return diffuseCol * hl * hl;
}`],
  ["_lightBlinnPhong", `vec3 _lightBlinnPhong(vec3 normal, vec3 lightDir, vec3 viewDir, vec3 diffuseCol, vec3 specularCol, float specularHardness) {
  vec3 h = normalize(lightDir + viewDir);
  float spec = pow(max(dot(normal, h), 0.0), specularHardness);
  return diffuseCol * max(dot(normal, lightDir), 0.0) + specularCol * spec;
}
vec3 _lightBlinnPhong(vec3 normal, vec3 lightDir, vec3 viewDir, vec3 diffuseCol) {
  return _lightBlinnPhong(normal, lightDir, viewDir, diffuseCol, vec3(0.5), 32.0);
}`],
  ["_lightBlinnPhongHalfLambert", `vec3 _lightBlinnPhongHalfLambert(vec3 normal, vec3 lightDir, vec3 viewDir, vec3 diffuseCol, vec3 specularCol, float specularHardness) {
  vec3 h = normalize(lightDir + viewDir);
  float spec = pow(max(dot(normal, h), 0.0), specularHardness);
  float hl = dot(normal, lightDir) * 0.5 + 0.5;
  return diffuseCol * hl * hl + specularCol * spec;
}`],
  ["_fresnelRoughness", `vec3 _fresnelRoughness(vec3 specularColor, float roughness, vec3 h, vec3 viewDir) {
  float f = pow(1.0 - max(dot(h, viewDir), 0.0), 5.0);
  return specularColor + (max(vec3(1.0 - roughness), specularColor) - specularColor) * f;
}`],
  ["_lightDirectional", `vec3 _lightDirectional(vec3 diffuseAlbedo, vec3 specularAlbedo, vec3 normal, float roughness, vec3 lightColor, vec3 lightDir, vec3 viewDir) {
  vec3 h = normalize(lightDir + viewDir);
  float hardness = 2.0 / max(roughness * roughness, 0.01);
  float spec = pow(max(dot(normal, h), 0.0), hardness);
  return lightColor * (diffuseAlbedo * max(dot(normal, lightDir), 0.0) + specularAlbedo * spec);
}`],
  ["_lightPoint", `vec3 _lightPoint(vec3 diffuseAlbedo, vec3 specularAlbedo, vec3 normal, float roughness, vec3 lightColor, vec3 viewDir, vec3 posWS, vec3 lightPos, float lightRadius) {
  vec3 toLight = lightPos - posWS;
  float dist = length(toLight);
  vec3 lightDir = toLight / max(dist, 0.001);
  float atten = clamp(1.0 - dist / max(lightRadius, 0.001), 0.0, 1.0);
  return _lightDirectional(diffuseAlbedo, specularAlbedo, normal, roughness, lightColor, lightDir, viewDir) * atten * atten;
}`],
  ["_cubicpulse", `float _cubicpulse(float c, float w, float x) {
  x = abs(x - c);
  if (x > w) return 0.0;
  x = x / w;
  return 1.0 - x * x * (3.0 - 2.0 * x);
}`],
  ["_brightnessSaturationContrast", `vec3 _brightnessSaturationContrast(vec3 col, float brt, float sat, float con) {
  vec3 grey = vec3(dot(col, vec3(0.299, 0.587, 0.114)));
  return ((mix(grey, col, sat) - vec3(0.5)) * con + vec3(0.5)) * brt;
}`],
  ["_blendScreen", `vec3 _blendScreen(vec3 a, vec3 b) {
  return vec3(1.0) - (vec3(1.0) - a) * (vec3(1.0) - b);
}`],
  ["_blendTextureNormals", `vec3 _blendTextureNormals(vec3 normal1, vec3 normal2) {
  return normalize(vec3(normal1.xy + normal2.xy, normal1.z * normal2.z));
}`],
  ["_perturbNormalTexture", `vec3 _perturbNormalTexture(vec2 tex, vec3 viewPos, vec3 surfaceNormal, vec3 textureNormal, float normalScale) {
  vec3 t = textureNormal * 2.0 - vec3(1.0);
  return normalize(surfaceNormal + vec3(t.xy * normalScale, 0.0));
}`],
  ["_screenSpaceDither", `vec3 _screenSpaceDither(vec2 screenPos) {
  vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
  return vec3(fract(magic.z * fract(dot(screenPos, magic.xy))) / 255.0);
}
vec3 _screenSpaceDither() { return _screenSpaceDither(p9fragcoord.xy); }`],
  ["_liftGammaGain", `vec3 _liftGammaGain(vec3 col, vec3 lift, vec3 gamma, vec3 gain) {
  return pow(max(col * gain + lift, vec3(0.0)), vec3(1.0) / max(gamma, vec3(0.01)));
}`],
  ["_blackBody", `vec3 _blackBody(float temp) {
  float t = clamp(temp, 1000.0, 12000.0) / 6500.0;
  return normalize(vec3(1.0 / max(t, 0.4), 0.9, clamp(t - 0.4, 0.05, 1.4))) * 1.6;
}`],
  ["_perm", `vec4 _perm(float pos) { return fract(vec4(hash(vec2(pos, 0.13)), hash(vec2(pos, 0.37)), hash(vec2(pos, 0.61)), hash(vec2(pos, 0.83)))); }
vec4 _perm(vec2 pos) { return fract(vec4(hash(pos), hash(pos + vec2(0.17, 0.0)), hash(pos + vec2(0.0, 0.29)), hash(pos + vec2(0.43, 0.51)))); }`],
  ["_noisegradientfast", `vec3 _noisegradientfast(vec3 p, float d) {
  vec2 q = p.xy;
  float e = max(d, 0.001);
  return vec3(noise(q + vec2(e, 0.0)) - noise(q - vec2(e, 0.0)), noise(q + vec2(0.0, e)) - noise(q - vec2(0.0, e)), 0.0) / (2.0 * e);
}`],
];

export function glslToRender(glsl: string): { body: string; warnings: string[] } {
  const warnings: string[] = [];
  const { helpers, main } = prepare(glsl);
  let src = bindEngine(helpers + "\n" + main);
  // pano was already substituted in bindEngine before the sampler strip
  src = src.replace(/\bgZNear\b/g, "0.1");
  src = src.replace(/\bgZFar\b/g, "100.0");
  // inject clean-room stdlib helpers the scene calls but doesn't define,
  // then resolve prelude-internal dependencies (two passes suffice)
  const selected = new Set<string>();
  const needs = (text: string) => PRELUDE
    .filter(([name]) => !selected.has(name) &&
      new RegExp("\\b" + name + "\\s*\\(").test(text) &&
      !new RegExp("(vec[234]|float)\\s+" + name + "\\s*\\(").test(src))
    .map(([name]) => name);
  needs(src).forEach((n) => selected.add(n));
  const selectedText = PRELUDE.filter(([n]) => selected.has(n)).map(([, i]) => i).join("\n");
  needs(selectedText).forEach((n) => selected.add(n));
  const prelude = PRELUDE.filter(([n]) => selected.has(n)).map(([, i]) => i);
  if (prelude.length) src = prelude.join("\n") + "\n" + src;
  for (const g of ["gIn1", "gIn2", "gIn3"]) {
    if (new RegExp("\\b" + g + "\\b").test(src)) {
      warnings.push(`${g} was animated by the node graph — imported as a constant; tune or route via the mod matrix`);
    }
  }
  const bound = src.replace(/\bgIn([123])\b/g, "p9gIn$1");

  const externals: Record<string, Ty> = {
    p9uv: vec(2), p9time: F32, p9diffuse: vec(4), p9res: vec(2),
    p9fragcoord: vec(4), p9out: vec(4),
    p9gIn1: vec(3), p9gIn2: vec(3), p9gIn3: vec(3),
    p9normal: vec(3), p9wpos: vec(3), p9view: vec(3),
  };

  const builtins = mathBuiltins();
  const texBuiltin: Builtin = (args, line, e) => ({
    code: `img(${vecArg(args, 0, 2, line, e)})`,
    ty: vec(4),
  });
  builtins.p9tex = texBuiltin;
  builtins.p9hsv2rgb = (args, line, e) => ({
    code: `(${e.coerce(args[2], F32, line).code} * mix(vec3f(1.0), hue3(${e.coerce(args[0], F32, line).code}), ${e.coerce(args[1], F32, line).code}))`,
    ty: vec(3),
  });
  builtins.p9aces = (args, line, e) => {
    const x = vecArg(args, 0, 3, line, e);
    return { code: `clamp((${x} * (2.51 * ${x} + 0.03)) / (${x} * (2.43 * ${x} + 0.59) + 0.14), vec3f(0.0), vec3f(1.0))`, ty: vec(3) };
  };
  builtins.p9luma = (args, line, e) => ({
    code: `dot(${vecArg(args, 0, 3, line, e)}, vec3f(0.299, 0.587, 0.114))`, ty: F32,
  });
  builtins.p9linear = (args, line, e) => ({
    code: `pow(${vecArg(args, 0, 3, line, e)}, vec3f(2.2))`, ty: vec(3),
  });
  builtins.p9rot = (args, line, e) => ({
    code: `(rot2(${e.coerce(args[1], F32, line).code}) * ${vecArg(args, 0, 2, line, e)})`, ty: vec(2),
  });
  builtins.p9texel = (args, line, e) => ({
    // texelFetch(coords, lod) -> normalized img sample; lod dropped
    code: `img((${vecArg(args, 0, 2, line, e)} + 0.5) / p9res)`, ty: vec(4),
  });
  builtins.p9pano = (args, line, e) => {
    // panoramic lookup: direction vector to equirectangular scene-image uv
    const d = vecArg(args, 0, 3, line, e); // extra lod arg, when present, drops
    return {
      code: `img(vec2f(atan2(${d}.z, ${d}.x) / 6.2831853 + 0.5, acos(clamp(${d}.y, -1.0, 1.0)) / 3.14159265))`,
      ty: vec(4),
    };
  };
  builtins.p9voronoi = (args, line, e) => {
    const p = vecArg(args, 0, 2, line, e);
    // F1-style cellular value from the hash stdlib — cheap stand-in
    return { code: `fract(hash(floor(${p})) + hash(floor(${p}) + vec2f(1.0, 0.0)))`, ty: F32 };
  };

  const dialect: Dialect = {
    externals,
    builtins,
    rename: (n) => (RESERVED.has(n) || WGSL_RESERVED.has(n) ? "u_" + n : n),
  };
  const emitter = new Emitter(dialect);
  const prog = parseShader(bound);
  const { helpers: helperCode, entry, globalInits } = emitter.emitProgram(prog, "main");
  const body = (globalInits ? globalInits + "\n" : "") +
    emitter.emitEntryBody(entry, externals, "p9out.rgb * c.intensity", { k: "void" });
  // engine inputs live at module scope so translated helpers can read them
  const wgsl = `var<private> p9uv : vec2f;
var<private> p9time : f32;
var<private> p9res : vec2f;
var<private> p9fragcoord : vec4f;
var<private> p9diffuse : vec4f;
var<private> p9gIn1 : vec3f;
var<private> p9gIn2 : vec3f;
var<private> p9gIn3 : vec3f;
var<private> p9normal : vec3f;
var<private> p9wpos : vec3f;
var<private> p9view : vec3f;
var<private> p9out : vec4f;
` + (helperCode ? helperCode + "\n" : "") +
    `fn render(c : Ctx) -> vec3f {
  p9uv = c.uv;
  p9time = c.t;
  p9res = c.res;
  p9fragcoord = vec4f(c.uv * c.res, 0.0, 1.0);
  p9diffuse = vec4f(1.0);
  p9gIn1 = vec3f(0.4, 0.0, 0.3);
  p9gIn2 = vec3f(0.2, 0.5, 0.1);
  p9gIn3 = vec3f(0.1, 0.3, 0.6);
  p9normal = vec3f(0.0, 0.0, 1.0);
  p9wpos = vec3f(c.uv * 2.0 - vec2f(1.0), 0.0);
  p9view = vec3f(0.0, 0.0, -1.0);
  p9out = vec4f(0.0);
${body}
  return p9out.rgb * c.intensity;
}`;
  return { body: wgsl, warnings };
}
