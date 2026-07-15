import { F32, vec, type Ty } from "./ast";
import { parseShader } from "./parser";
import { Emitter, WGSL_RESERVED, type Builtin, type Dialect } from "./emit";
import { mathBuiltins, vecArg } from "./builtins";

/**
 * Plane9-GLSL front end.
 *
 * The `si.*` binding names below are documented ONLY in Plane9 developer
 * Joakim Dahl's blog post 103 ("Conversion to GLSL status update", 2015-05-01,
 * http://www.plane9.com/blog/posts/103/Conversion-to-GLSL-status-update),
 * which shows the exact VERTEXOUTPUT struct and default vertex program the
 * parser generates. That post is the single authoritative artifact for the
 * v2.x GLSL shader ABI: everything else in this file that reaches beyond
 * the seven documented fields — `si.rnd`, `si.aspect`, gMIT, gViewDirection,
 * gFrameNr, gTargetSize, gTextureN Size, the GLSL uniform names for the
 * Shader node's ports, and all the `_lightXxx` / `_perturbNormal` /
 * `_fresnelRoughness` / `_screenSpaceDither` / `_blackBody` / `_liftGammaGain`
 * / `_toneMappingXxx` / `_luminance` / `_palette` / `_bump` / `_rotate` /
 * `_texturePanoramic` / `SampleWithBorder` / non-`fast` noise helpers —
 * has no public source. Blog post 104 confirms: "Only inject shader
 * functions we actually use." The internal library lives inside the
 * Plane9.exe binary and is proprietary.
 *
 * A scan of the shipped 252 scenes finds exactly one (1) helper defined
 * inline (`_union`); the other 251 rely on the injected internal library.
 * Every prelude entry in this file that isn't in the eight publicly-
 * documented helpers (`_hsv2rgb`, `_perm`, `_noisefast`, `_noisegradientfast`,
 * `_fbmfast`, `_turbulencefast`, `_ridgedmffast`, `_voronoi` per
 * https://www.plane9.com/wiki/shaderfunctions) is textbook-derived with the
 * source cited in the entry's comment — NOT the Plane9 implementation.
 */

const RESERVED = new Set([
  "c", "render", "vmain", "fmain", "makeCtx", "img", "spec", "wav", "custSlot",
  "smin", "rot2", "camRay", "warpUV", "waveLine", "sdSphere", "sdBox",
  "sdTorus", "sdCylinder", "opRep", "sdNgon", "U", "Ctx", "uv",
]);

function prepare(glsl: string): { helpers: string; main: string } {
  let src = glsl.replace(/\r\n/g, "\n");
  // strip line comments before block comments: a scene like The Cave contains
  // '//*(x)' where the block-comment regex would otherwise start matching
  // inside the line comment and eat everything up to the next real '*/'
  src = src.replace(/\/\/[^\n]*/g, "");
  src = src.replace(/\/\*[\s\S]*?\*\//g, "");
  // stray-character tolerance: '/' outside comments (line-splice residue) drops
  src = src.replace(/;\s*\/(?=\s*[a-zA-Z_])/g, "; ");
  src = src.replace(/VERTEXOUTPUT\s*\{[^}]*\}/, "");
  // GLSL brace initializers: vec3 x = {a,b,c}  ->  vec3 x = vec3(a,b,c)
  src = src.replace(/\b(vec2|vec3|vec4|ivec2|ivec3|ivec4|mat2|mat3|mat4)(\s+\w+\s*=\s*)\{([^{}]*)\}/g,
    (_m, ty: string, mid: string, body: string) => `${ty}${mid}${ty}(${body})`);
  // GLSL array brace-initializer: `vec4 metals[10] = { vec4(...), ... };` ->
  // `vec4 metals[10] = vec4[](vec4(...), ...);` (single-level braces only —
  // the vec constructors inside have parens, not nested braces).
  src = src.replace(
    /\b(vec2|vec3|vec4|ivec2|ivec3|ivec4|mat2|mat3|mat4|float|int)(\s+\w+\s*\[[^\]]*\]\s*=\s*)\{([^{}]*)\}/g,
    (_m, ty: string, mid: string, body: string) => `${ty}${mid}${ty}[](${body})`);
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

/**
 * Rewrite `_voronoi(pos, f1, pos1, f2, pos2[, jitter[, type]]);` statement
 * calls into a struct-return + assignment sequence.
 *
 * The wiki-documented Plane9 signature
 * (https://www.plane9.com/wiki/shaderfunctions):
 *   void _voronoi(vec2 position, out float f1, out vec2 pos1,
 *                 out float f2, out vec2 pos2,
 *                 float jitter = 0.9, int type = 0)
 *
 * Our parser doesn't emit pointer/out-param calls, so we rewrite each
 * matching statement into `{ vec4 _vr = _voronoi_impl(pos); f1 = _vr.x;
 * pos1 = _vr.yz; f2 = _vr.w; pos2 = vec2(0.0); }`. pos2 (second-closest
 * feature-point position) is dropped because it's rarely used and packing
 * it into the return would require a vec5 or a struct.
 *
 * The first-arg expression may contain nested commas (e.g., `vec2(a, b)`),
 * so a plain regex won't split correctly — this walks the parenthesis depth.
 */
function rewriteVoronoiCalls(s: string): string {
  const out: string[] = [];
  let i = 0;
  const rx = /\b_voronoi\s*\(/g;
  for (;;) {
    rx.lastIndex = i;
    const match = rx.exec(s);
    if (!match) { out.push(s.slice(i)); break; }
    out.push(s.slice(i, match.index));
    const argStart = match.index + match[0].length;
    let depth = 1;
    let j = argStart;
    while (j < s.length && depth > 0) {
      const c = s[j];
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (depth === 0) break; }
      j++;
    }
    if (j >= s.length) { out.push(s.slice(match.index)); break; }
    // args are s[argStart..j), s[j] is closing ')'
    const argsRaw = s.slice(argStart, j);
    const args: string[] = [];
    let d = 0, last = 0;
    for (let k = 0; k < argsRaw.length; k++) {
      const c = argsRaw[k];
      if (c === "(") d++;
      else if (c === ")") d--;
      else if (c === "," && d === 0) {
        args.push(argsRaw.slice(last, k).trim());
        last = k + 1;
      }
    }
    args.push(argsRaw.slice(last).trim());
    let after = j + 1;
    while (after < s.length && /\s/.test(s[after])) after++;
    if (args.length >= 5 && s[after] === ";") {
      const [pos, f1, pos1, f2, pos2] = args;
      out.push(`{ vec4 _vr = _voronoi_impl(${pos}); ${f1} = _vr.x; ${pos1} = _vr.yz; ${f2} = _vr.w; ${pos2} = vec2(0.0); }`);
      i = after + 1;
    } else {
      // Non-statement or wrong-arity call: leave for the plain-builtin path
      out.push(s.slice(match.index, j + 1));
      i = j + 1;
    }
  }
  return out.join("");
}

/** Engine-binding substitutions: names, not grammar. */
function bindEngine(src: string): string {
  let s = src;
  // Type-aware #define: infer const type from RHS prefix so a define whose
  // value is `vec3(1,.9,.8)` doesn't get wrapped as `const float`
  s = s.replace(/^[ \t]*#define[ \t]+(\w+)[ \t]+(.+?)[ \t]*$/gm, (_m, name: string, val: string) => {
    val = val.trim();
    if (!val || /[a-zA-Z_]\w*\s*[^,)(a-zA-Z_0-9. ]/.test(val)) return ""; // function-like or complex
    let ty = "float";
    if (/^vec2\b/.test(val)) ty = "vec2";
    else if (/^vec3\b/.test(val)) ty = "vec3";
    else if (/^vec4\b/.test(val)) ty = "vec4";
    else if (/^mat[234]\b/.test(val)) ty = val.slice(0, 4);
    else if (/^-?\d+$/.test(val)) ty = "int";
    return `const ${ty} ${name} = ${val};`;
  });
  s = s.replace(/^[ \t]*#.*$/gm, "");
  // Wiki-documented constants at https://www.plane9.com/wiki/shaderfunctions
  s = s.replace(/\bPI2\b/g, "6.2831853");
  s = s.replace(/\bPI\b/g, "3.14159265");
  // Wiki-documented noise/fbm/turbulence/ridged (both `fast` and non-`fast`
  // — non-`fast` variants are not publicly documented; we alias to `fast`
  // rather than fail, since the shipped scenes use both names)
  s = s.replace(/\b_noise(fast)?\s*\(/g, "noise(");
  s = s.replace(/\b_fbm(fast)?\s*\(/g, "fbm(");
  s = s.replace(/\b_turbulence(fast)?\s*\(/g, "ridge(");
  s = s.replace(/\b_ridgedmf(fast)?\s*\(/g, "ridge(");
  s = s.replace(/\b_rand\s*\(/g, "hash(");
  s = s.replace(/\b_stepaa\s*\(/g, "step(");
  s = s.replace(/\b_hsv2rgb\s*\(/g, "p9hsv2rgb(");
  // Uncharted-2 tone map — Hable curve, distinct from ACES. Was previously
  // aliased to p9aces (WRONG per John Hable, "Filmic Tonemapping Operators",
  // http://filmicworlds.com/blog/filmic-tonemapping-operators/). Now routes
  // to a dedicated prelude implementation of Hable's curve.
  s = s.replace(/\b_toneMappingUncharted2\s*\(/g, "_uncharted2Impl(");
  s = s.replace(/\b_tonemapACES\s*\(/g, "p9aces(");
  s = s.replace(/\b_luminance\s*\(/g, "p9luma(");
  s = s.replace(/\b_saturate\s*\(/g, "saturate(");
  s = s.replace(/\b_tolinear\s*\(/g, "_tolinearP9(");
  s = s.replace(/\b_rotate\s*\(/g, "p9rot(");

  // Blog 103 documents the VERTEXOUTPUT struct with 7 fields:
  //   { vec4 diffuse; vec2 tex; vec3 wnormal; vec3 viewdir;
  //     vec3 worldpos; vec3 pos; vec3 viewpos; }
  s = s.replace(/\bsi\.tex\b/g, "p9uv");
  s = s.replace(/\bsi\.diffuse\b/g, "p9diffuse");
  s = s.replace(/\bsi\.wnormal\b/g, "p9normal");
  s = s.replace(/\bsi\.worldpos\b/g, "p9wpos");
  s = s.replace(/\bsi\.viewdir\b/g, "p9view");
  s = s.replace(/\bsi\.pos\b/g, "p9objpos");
  s = s.replace(/\bsi\.viewpos\b/g, "p9viewpos");
  // Undocumented fields many shipped scenes still reference — no public
  // source explains their semantics. Best-effort mappings:
  //   si.normal / si.vnormal → p9normal (assume geometric normal like si.wnormal)
  //   si.vpos / si.wpos / si.worldPos / si.wPos → p9wpos (assume world-space position)
  //   si.view / si.viewDir / si.vdir → p9view (assume view direction)
  //   si.aspect → res-derived aspect ratio scalar
  //   si.rnd → per-pixel varying (approximates a per-vertex random tag)
  //   any other si.* → p9diffuse fallback so the shader compiles
  s = s.replace(/\bsi\.(normal|vnormal)\b/g, "p9normal");
  s = s.replace(/\bsi\.(vpos|worldPos|wPos|wpos)\b/g, "p9wpos");
  s = s.replace(/\bsi\.(view|viewDir|vdir)\b/g, "p9view");
  s = s.replace(/\bsi\.aspect\b/g, "(p9res.x / p9res.y)");
  s = s.replace(/\bsi\.rnd\b/g, "p9diffuse");
  s = s.replace(/\bsi\.\w+\b/g, "p9diffuse");

  // gTime is confirmed in wiki tutorial code. gFrameNr, gTargetSize, and
  // gTextureN Size are not publicly documented; approximated below.
  s = s.replace(/\bgTime\b/g, "p9time");
  s = s.replace(/\bgFrameNr\b/g, "(p9time * 60.0)");
  s = s.replace(/\bgColor[12]?\b/g, "p9diffuse");
  s = s.replace(/\bgResolution\b/g, "p9res");
  s = s.replace(/\bgl_FragCoord\b/g, "p9fragcoord");
  s = s.replace(/\bgl_PointCoord\b/g, "p9uv");
  // Plane9 texture-size convention is vec4(w, h, 1/w, 1/h) — inferred from
  // shipped scenes that read `.zw` for reciprocal size.
  s = s.replace(/\bgTexture\dSize\b/g, "p9texsize");
  s = s.replace(/\bgTargetSize\b/g, "p9texsize");
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
  // bare uses of gTexture become neutral vec4
  s = s.replace(/\bgTexture\d\b/g, "p9tex(vec2(0.0))");
  s = s.replace(/\boColor\b/g, "p9out");

  // _voronoi call rewrite runs LAST so we operate on identifier-substituted
  // args (`si.tex` inside the pos arg has already become `p9uv`).
  s = rewriteVoronoiCalls(s);
  return s;
}

/**
 * PRELUDE — injected on-demand when a scene calls a helper it doesn't
 * define. Each entry declares its authority:
 *
 * [wiki]      — signature from https://www.plane9.com/wiki/shaderfunctions
 *               or https://www.plane9.com/wiki/distancefields
 *               or https://www.plane9.com/wiki/shadersnippets
 *               (Plane9 v1.x Cg-era docs; still the only public source).
 * [inferred]  — helper name appears in shipped scenes but has no public
 *               documentation; implementation is textbook-derived with the
 *               textbook cited on the line above the code.
 */
const PRELUDE: [string, string][] = [
  // [inferred] sRGB encode; Plane9 doesn't publish its version. Textbook
  // approximation of IEC 61966-2-1 EOTF^-1 (gamma 2.2 approximation).
  ["_tosrgb", `vec3 _tosrgb(vec3 v) { return max(vec3(1.055) * pow(v, vec3(0.4167)) - vec3(0.055), vec3(0.0)); }
vec4 _tosrgb4(vec4 v) { return vec4(_tosrgb(v.rgb), v.w); }`],

  // [inferred] Iñigo Quilez, "Palettes" (https://iquilezles.org/articles/palettes/):
  // color(t) = a + b * cos(2π * (c*t + d))
  ["_palette", `vec3 _palette(float t, vec3 brightness, vec3 contrast, vec3 a, vec3 b) {
  return brightness + contrast * cos(6.2831853 * (a * t + b));
}`],

  // [inferred] Rectangular smoothstep pulse; textbook form.
  ["_bump", `float _bump(float value, float start, float end, float width) {
  return smoothstep(start - width, start, value) * (1.0 - smoothstep(end, end + width, value));
}`],

  // [inferred] Lambert diffuse; textbook (max(N·L, 0) times albedo).
  ["_lightLambert", `vec3 _lightLambert(vec3 normal, vec3 lightDir, vec3 diffuseCol) {
  return diffuseCol * max(dot(normal, lightDir), 0.0);
}`],

  // [inferred] Half-Lambert (Valve, "Half Life 2 shading model", GDC 2004).
  ["_lightHalfLambert", `vec3 _lightHalfLambert(vec3 normal, vec3 lightDir, vec3 diffuseCol) {
  float hl = dot(normal, lightDir) * 0.5 + 0.5;
  return diffuseCol * hl * hl;
}`],

  // [inferred] Blinn-Phong specular + diffuse (Blinn 1977, "Models of Light
  // Reflection for Computer Synthesized Pictures"). Three overloads for the
  // signatures shipped scenes use.
  ["_lightBlinnPhong", `vec3 _lightBlinnPhong(vec3 normal, vec3 lightDir, vec3 viewDir, vec3 diffuseCol, vec3 specularCol, float specularHardness) {
  vec3 h = normalize(lightDir + viewDir);
  float spec = pow(max(dot(normal, h), 0.0), specularHardness);
  return diffuseCol * max(dot(normal, lightDir), 0.0) + specularCol * spec;
}
vec3 _lightBlinnPhong(vec3 normal, vec3 lightDir, vec3 viewDir, vec3 diffuseCol) {
  return _lightBlinnPhong(normal, lightDir, viewDir, diffuseCol, vec3(0.5), 32.0);
}
float _lightBlinnPhong(vec3 normal, vec3 lightDir, vec3 viewDir, float specularHardness) {
  vec3 h = normalize(lightDir + viewDir);
  return pow(max(dot(normal, h), 0.0), specularHardness);
}`],

  // [inferred] Blinn-Phong + Half-Lambert combination.
  ["_lightBlinnPhongHalfLambert", `vec3 _lightBlinnPhongHalfLambert(vec3 normal, vec3 lightDir, vec3 viewDir, vec3 diffuseCol, vec3 specularCol, float specularHardness) {
  vec3 h = normalize(lightDir + viewDir);
  float spec = pow(max(dot(normal, h), 0.0), specularHardness);
  float hl = dot(normal, lightDir) * 0.5 + 0.5;
  return diffuseCol * hl * hl + specularCol * spec;
}`],

  // [inferred] Schlick fresnel with roughness modulation (Sébastien Lagarde,
  // "Adopting a physically based shading model",
  // https://seblagarde.wordpress.com/2011/08/17/hello-world/).
  ["_fresnelRoughness", `vec3 _fresnelRoughness(vec3 specularColor, float roughness, vec3 h, vec3 viewDir) {
  float f = pow(1.0 - max(dot(h, viewDir), 0.0), 5.0);
  return specularColor + (max(vec3(1.0 - roughness), specularColor) - specularColor) * f;
}`],

  // [inferred] Blinn-Phong direct lighting with roughness-to-hardness
  // remap (Karis, "Real Shading in Unreal Engine 4", SIGGRAPH 2013 —
  // hardness ≈ 2/α² where α = roughness²). Not modern Cook-Torrance;
  // period-appropriate for Plane9's era.
  ["_lightDirectional", `vec3 _lightDirectional(vec3 diffuseAlbedo, vec3 specularAlbedo, vec3 normal, float roughness, vec3 lightColor, vec3 lightDir, vec3 viewDir) {
  vec3 h = normalize(lightDir + viewDir);
  float hardness = 2.0 / max(roughness * roughness, 0.01);
  float spec = pow(max(dot(normal, h), 0.0), hardness);
  return lightColor * (diffuseAlbedo * max(dot(normal, lightDir), 0.0) + specularAlbedo * spec);
}`],

  // [inferred] Point light = directional light with 1/r² falloff.
  ["_lightPoint", `vec3 _lightPoint(vec3 diffuseAlbedo, vec3 specularAlbedo, vec3 normal, float roughness, vec3 lightColor, vec3 viewDir, vec3 posWS, vec3 lightPos, float lightRadius) {
  vec3 toLight = lightPos - posWS;
  float dist = length(toLight);
  vec3 lightDir = toLight / max(dist, 0.001);
  float atten = clamp(1.0 - dist / max(lightRadius, 0.001), 0.0, 1.0);
  return _lightDirectional(diffuseAlbedo, specularAlbedo, normal, roughness, lightColor, lightDir, viewDir) * atten * atten;
}`],

  // [inferred] Gamma-2.2 sRGB approximation (Plane9's `_tolinear` — actual
  // implementation not published; the piecewise IEC 61966-2-1 EOTF is
  // slightly more accurate in the shadows).
  ["_tolinearP9", `vec3 _tolinearP9(vec3 v) { return pow(v, vec3(2.2)); }
vec4 _tolinearP9(vec4 v) { return vec4(_tolinearP9(v.rgb), v.a); }`],

  // [inferred] Iñigo Quilez, "useful little functions"
  // (https://iquilezles.org/articles/functions/) — cubicPulse.
  ["_cubicpulse", `float _cubicpulse(float c, float w, float x) {
  x = abs(x - c);
  if (x > w) return 0.0;
  x = x / w;
  return 1.0 - x * x * (3.0 - 2.0 * x);
}`],

  // [inferred] Classical BSC — Rec.601 luma dot for gray, then saturation
  // lerp + midpoint-anchored contrast + brightness scale.
  ["_brightnessSaturationContrast", `vec3 _brightnessSaturationContrast(vec3 col, float brt, float sat, float con) {
  vec3 grey = vec3(dot(col, vec3(0.299, 0.587, 0.114)));
  return ((mix(grey, col, sat) - vec3(0.5)) * con + vec3(0.5)) * brt;
}`],

  // [inferred] Separable Screen blend (Adobe PDF blend-mode spec).
  ["_blendScreen", `vec3 _blendScreen(vec3 a, vec3 b) {
  return vec3(1.0) - (vec3(1.0) - a) * (vec3(1.0) - b);
}`],

  // [inferred] Reoriented Normal Map (RNM) reduction. Full RNM per
  // Christopher Oat & Natasha Tatarchuk 2009; this is the cheap variant.
  ["_blendTextureNormals", `vec3 _blendTextureNormals(vec3 normal1, vec3 normal2) {
  return normalize(vec3(normal1.xy + normal2.xy, normal1.z * normal2.z));
}`],

  // [inferred] Perturb surface normal from a decoded normal map. Textbook
  // world-space adaptation (surface-normal + tangent-plane-projected
  // perturbation).
  ["_perturbNormalTexture", `vec3 _perturbNormalTexture(vec2 tex, vec3 viewPos, vec3 surfaceNormal, vec3 textureNormal, float normalScale) {
  vec3 t = textureNormal * 2.0 - vec3(1.0);
  return normalize(surfaceNormal + vec3(t.xy * normalScale, 0.0));
}`],

  // [inferred] Derivative-based normal perturbation. Simplified form of
  // Blinn 1978, "Simulation of wrinkled surfaces" (SIGGRAPH '78):
  // project the perturbation onto surfaceNormal's tangent plane, add.
  // Christian Schueler's screen-space cotangent-frame form
  // ("Normal Mapping Without Precomputed Tangents") is more accurate
  // but requires dFdx/dFdy on position, which not every scene provides
  // as its third argument.
  ["_perturbNormal", `vec3 _perturbNormal(vec3 pos, vec3 surfaceNormal, vec3 derivs) {
  vec3 dp = derivs - surfaceNormal * dot(derivs, surfaceNormal);
  return normalize(surfaceNormal + dp);
}`],

  // [inferred] Interleaved Gradient Noise (Jorge Jimenez, "Next Generation
  // Post Processing in Call of Duty: Advanced Warfare", SIGGRAPH 2014).
  // Divided by 255 for use as an 8-bit-quantization dither offset.
  ["_screenSpaceDither", `vec3 _screenSpaceDither(vec2 screenPos) {
  vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
  return vec3(fract(magic.z * fract(dot(screenPos, magic.xy))) / 255.0);
}
vec3 _screenSpaceDither() { return _screenSpaceDither(p9fragcoord.xy); }`],

  // [inferred] Lift / Gamma / Gain (Unity HDRP / Adobe SpeedGrade / DaVinci
  // convention — 1/gamma so raising the slider brightens midtones).
  ["_liftGammaGain", `vec3 _liftGammaGain(vec3 col, vec3 lift, vec3 gamma, vec3 gain) {
  return pow(max(col * gain + lift, vec3(0.0)), vec3(1.0) / max(gamma, vec3(0.01)));
}`],

  // [inferred] Tanner Helland's Kelvin-to-RGB piecewise fit
  // (https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html).
  // Input in Kelvin, output normalized [0,1] RGB.
  ["_blackBody", `vec3 _blackBody(float temp) {
  float t = clamp(temp, 1000.0, 40000.0) / 100.0;
  float r; float g; float b;
  if (t <= 66.0) {
    r = 1.0;
    g = clamp(99.4708 * log(t) - 161.1195, 0.0, 255.0) / 255.0;
    b = t <= 19.0 ? 0.0 : clamp(138.5177 * log(t - 10.0) - 305.0448, 0.0, 255.0) / 255.0;
  } else {
    r = clamp(329.698727446 * pow(t - 60.0, -0.1332047592), 0.0, 255.0) / 255.0;
    g = clamp(288.1221695283 * pow(t - 60.0, -0.0755148492), 0.0, 255.0) / 255.0;
    b = 1.0;
  }
  return vec3(r, g, b);
}`],

  // [wiki] _perm signature is publicly documented; implementation is not.
  // Textbook 2D+1D hash-based approximation of the Perlin permutation.
  ["_perm", `vec4 _perm(float pos) { return fract(vec4(hash(vec2(pos, 0.13)), hash(vec2(pos, 0.37)), hash(vec2(pos, 0.61)), hash(vec2(pos, 0.83)))); }
vec4 _perm(vec2 pos) { return fract(vec4(hash(pos), hash(pos + vec2(0.17, 0.0)), hash(pos + vec2(0.0, 0.29)), hash(pos + vec2(0.43, 0.51)))); }`],

  // [wiki] _noisegradientfast signature is publicly documented; body is not.
  ["_noisegradientfast", `vec3 _noisegradientfast(vec3 p, float d) {
  vec2 q = p.xy;
  float e = max(d, 0.001);
  return vec3(noise(q + vec2(e, 0.0)) - noise(q - vec2(e, 0.0)), noise(q + vec2(0.0, e)) - noise(q - vec2(0.0, e)), 0.0) / (2.0 * e);
}`],

  // [inferred] John Hable, "Filmic Tonemapping Operators"
  // (http://filmicworlds.com/blog/filmic-tonemapping-operators/) —
  // Uncharted-2 tonemap with the original A,B,C,D,E,F constants and W=11.2
  // linear-white point normalization.
  ["_uncharted2Impl", `vec3 _uncharted2Impl(vec3 x) {
  float A = 0.15; float B = 0.50; float C = 0.10;
  float D = 0.20; float E = 0.02; float F = 0.30; float W = 11.2;
  vec3 curr = ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - vec3(E / F);
  vec3 wv = vec3(W);
  vec3 white = ((wv * (A * wv + C * B) + D * E) / (wv * (A * wv + B) + D * F)) - vec3(E / F);
  return curr / white;
}
vec4 _uncharted2Impl(vec4 x) { return vec4(_uncharted2Impl(x.rgb), x.a); }`],

  // [inferred] Iñigo Quilez, "Voronoi/Voronoi lines"
  // (https://iquilezles.org/articles/voronoilines/) — 3x3-cell F1
  // computation. Returns vec4(F1, p1.x, p1.y, F2). p2 is dropped by the
  // bindEngine rewrite that unpacks this into scene locals.
  ["_voronoi_impl", `vec2 _p9hash2(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}
vec4 _voronoi_impl(vec2 x) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  float f1 = 8.0;
  float f2 = 8.0;
  vec2 p1 = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = _p9hash2(n + g);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; p1 = n + g + o; }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec4(sqrt(f1), p1.x, p1.y, sqrt(f2));
}`],

  // [wiki] Distance-field primitives per https://www.plane9.com/wiki/distancefields
  // (Cg era — signatures carried forward to GLSL era near-verbatim per the
  // shipped scenes that call them).
  ["DistToPlane", `float DistToPlane(vec3 p, vec3 normal, float dist) { return dot(p, normal) - dist; }`],
  ["DistToSphere", `float DistToSphere(vec3 p, float radius) { return length(p) - radius; }`],
  ["DistToCylinderY", `float DistToCylinderY(vec3 p, float radius) { return length(vec2(p.x, p.z)) - radius; }`],
  ["DistToConeY", `float DistToConeY(vec3 p, float angle) { return length(vec2(p.x, p.z)) * cos(angle) - abs(p.y) * sin(angle); }`],
  ["DistToCube", `float DistToCube(vec3 p, vec3 size) { return max(max(abs(p.x) - size.x, abs(p.y) - size.y), abs(p.z) - size.z); }`],
  ["DistToRoundedCube", `float DistToRoundedCube(vec3 p, vec3 boxExtents, float rad) { return length(max(abs(p) - boxExtents + vec3(rad), 0.0)) - rad; }`],
  ["DistToTorus", `float DistToTorus(vec3 p, float radiusMin, float radiusMax) { return length(vec2(length(vec2(p.x, p.z)) - radiusMax, p.y)) - radiusMin; }`],

  // [wiki] Rotation snippets per https://www.plane9.com/wiki/shadersnippets
  ["rotateX", `vec3 rotateX(vec3 v, float angle) { float c = cos(angle); float s = sin(angle); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }`],
  ["rotateY", `vec3 rotateY(vec3 v, float angle) { float c = cos(angle); float s = sin(angle); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }`],
  ["rotateZ", `vec3 rotateZ(vec3 v, float angle) { float c = cos(angle); float s = sin(angle); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }`],
];

/** Debug: dump the fully-bound source (prelude + prepared + engine-bound) the parser sees. */
export function glslPreParseSource(glsl: string): string {
  const { helpers, main } = prepare(glsl);
  let src = bindEngine(helpers + "\n" + main);
  src = src.replace(/\bgZNear\b/g, "0.1");
  src = src.replace(/\bgZFar\b/g, "100.0");
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
  return src.replace(/\bgIn([123])\b/g, "p9gIn$1");
}

export function glslToRender(glsl: string): { body: string; warnings: string[] } {
  const warnings: string[] = [];
  const { helpers, main } = prepare(glsl);
  let src = bindEngine(helpers + "\n" + main);
  src = src.replace(/\bgZNear\b/g, "0.1");
  src = src.replace(/\bgZFar\b/g, "100.0");
  // Inject helpers the scene calls but doesn't define, then resolve
  // prelude-internal dependencies (two passes suffice for our depth).
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
    p9objpos: vec(3), p9viewpos: vec(3),
    p9texsize: vec(4),
  };

  const builtins = mathBuiltins();
  const texBuiltin: Builtin = (args, line, e) => ({
    code: `img(${vecArg(args, 0, 2, line, e)})`,
    ty: vec(4),
  });
  builtins.p9tex = texBuiltin;
  builtins.img = texBuiltin;
  // [wiki] _hsv2rgb has two forms per shaderfunctions:
  //   float3 _hsv2rgb(float3 HSV)
  //   float3 _hsv2rgb(float h, float s, float v)
  // Implementation not published; textbook value+saturation blend used here.
  builtins.p9hsv2rgb = (args, line, e) => {
    const [h, s, v] = args.length === 1
      ? [{ code: `(${args[0].code}).x`, ty: F32 },
         { code: `(${args[0].code}).y`, ty: F32 },
         { code: `(${args[0].code}).z`, ty: F32 }]
      : [e.coerce(args[0], F32, line), e.coerce(args[1], F32, line), e.coerce(args[2], F32, line)];
    return {
      code: `(${v.code} * mix(vec3f(1.0), hue3(${h.code}), ${s.code}))`,
      ty: vec(3),
    };
  };
  // [inferred] ACES film tonemap fit (Krzysztof Narkowicz, "ACES Filmic
  // Tone Mapping Curve", https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/)
  // — routed here for `_tonemapACES` calls; NOT the same as Uncharted-2
  // (which lives in _uncharted2Impl in PRELUDE).
  builtins.p9aces = (args, line, e) => {
    const x = vecArg(args, 0, 3, line, e);
    return { code: `clamp((${x} * (2.51 * ${x} + 0.03)) / (${x} * (2.43 * ${x} + 0.59) + 0.14), vec3f(0.0), vec3f(1.0))`, ty: vec(3) };
  };
  // [inferred] Rec.601 luma coefficients — matches the historical Photoshop
  // grayscale weighting many older visualizers assume.
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
    code: `img((${vecArg(args, 0, 2, line, e)} + 0.5) / p9res)`, ty: vec(4),
  });
  builtins.p9pano = (args, line, e) => {
    const d = vecArg(args, 0, 3, line, e);
    return {
      code: `img(vec2f(atan2(${d}.z, ${d}.x) / 6.2831853 + 0.5, acos(clamp(${d}.y, -1.0, 1.0)) / 3.14159265))`,
      ty: vec(4),
    };
  };
  // SampleWithBorder(borderColor, sampler, uv[, lod]) — border is what the
  // shader gets outside [0,1] uv; WebGPU's sampler modes cover the same
  // behavior. args[1] is the (rewritten) sampler value we discard; args[2]
  // is uv. Not documented publicly; inferred from shipped-scene use pattern.
  builtins.SampleWithBorder = (args, line, e) => ({
    code: `img(${vecArg(args, 2, 2, line, e)})`,
    ty: vec(4),
  });
  builtins.SampleWithBorderLod = builtins.SampleWithBorder;

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

  // Module-scope engine inputs. The seven fields listed with a [blog 103]
  // tag are the ones Joakim Dahl's post explicitly documents; the rest
  // are our undocumented-but-observed additions.
  const wgsl = `var<private> p9uv : vec2f;         // [blog 103] si.tex — mesh UV
var<private> p9time : f32;         // gTime — seconds
var<private> p9res : vec2f;        // viewport pixels
var<private> p9fragcoord : vec4f;  // gl_FragCoord equivalent
var<private> p9diffuse : vec4f;    // [blog 103] si.diffuse — vertex color × color uniform
var<private> p9gIn1 : vec3f;       // Shader-node In1 port (vector; runtime range undocumented)
var<private> p9gIn2 : vec3f;       // Shader-node In2 port
var<private> p9gIn3 : vec3f;       // Shader-node In3 port
var<private> p9normal : vec3f;     // [blog 103] si.wnormal — world-space normal
var<private> p9wpos : vec3f;       // [blog 103] si.worldpos — world-space position
var<private> p9view : vec3f;       // [blog 103] si.viewdir — world-space fragment→camera
var<private> p9objpos : vec3f;     // [blog 103] si.pos — object-space vertex position
var<private> p9viewpos : vec3f;    // [blog 103] si.viewpos — view/camera-space position
var<private> p9texsize : vec4f;    // vec4(w, h, 1/w, 1/h) — inferred from shipped-scene use
var<private> p9out : vec4f;        // oColor equivalent
` + (helperCode ? helperCode + "\n" : "") +
    `fn render(c : Ctx) -> vec3f {
  p9uv = c.uv;
  p9time = c.t;
  p9res = c.res;
  p9fragcoord = vec4f(c.uv * c.res, 0.0, 1.0);
  // Per-fragment varying diffuse: shipped scenes read si.diffuse as an
  // interpolated per-vertex color that varies spatially. We synthesise
  // (uv.x, uv.y, sin(...), 0.35) so scenes gating on si.rnd.r > threshold
  // and scenes multiplying by 1.0 - si.diffuse.a both light up somewhere.
  p9diffuse = vec4f(c.uv.x, c.uv.y, 0.5 + 0.5 * sin(c.uv.x * 12.0 + c.uv.y * 8.0), 0.35);
  p9gIn1 = vec3f(0.5, 0.5, 0.5);
  p9gIn2 = vec3f(0.5, 0.5, 0.5);
  p9gIn3 = vec3f(0.5, 0.5, 0.5);
  p9normal = vec3f(0.0, 0.0, 1.0);
  // z < 0 so scenes that multiply by smoothstep(0, 1, -wpos.z) light up.
  // wpos.xy in [-1, 1] simulates a fullscreen quad centered at origin.
  p9wpos = vec3f(c.uv * 2.0 - vec2f(1.0), -0.5);
  p9view = vec3f(0.0, 0.0, -1.0);
  // Object-space position: same as world when the model matrix is identity.
  // For 3D scenes rendered as a fullscreen quad, this is a defensible proxy.
  p9objpos = p9wpos;
  // View-space position: same as world when the view matrix is identity.
  p9viewpos = p9wpos;
  p9texsize = vec4f(c.res, 1.0 / c.res);
  p9out = vec4f(0.0);
${body}
  return p9out.rgb * c.intensity;
}`;
  return { body: wgsl, warnings };
}
