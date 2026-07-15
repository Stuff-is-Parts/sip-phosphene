import { F32, tyEq, vec, wgslTy, type Ty } from "./ast";
import { err } from "./lexer";
import type { Builtin, Emitter, Val } from "./emit";

/** Harmonize args: any vector operand pulls scalars up via splat; ints float. */
function harmonize(args: Val[], line: number, e: Emitter): { args: Val[]; ty: Ty } {
  if (!args.length) throw err("call with no arguments", line);
  const v = args.find((a) => a.ty.k === "vec");
  const want = v ? v.ty : F32;
  const out = args.map((a) => {
    if (!a) throw err("missing argument", line);
    const f = a.ty.k === "i32" || a.ty.k === "bool" ? e.coerce(a, F32, line) : a;
    if (want.k === "vec" && !tyEq(f.ty, want)) return e.coerce(f, want, line);
    return f;
  });
  return { args: out, ty: want };
}

const pass = (name: string, arity: number): Builtin => (args, line, e) => {
  if (args.length !== arity) throw err(`${name} expects ${arity} args`, line);
  const h = harmonize(args, line, e);
  return { code: `${name}(${h.args.map((a) => a.code).join(", ")})`, ty: h.ty };
};

const toScalar = (name: string, arity: number): Builtin => (args, line, e) => {
  if (args.length !== arity) throw err(`${name} expects ${arity} args`, line);
  const h = harmonize(args, line, e);
  return { code: `${name}(${h.args.map((a) => a.code).join(", ")})`, ty: F32 };
};

/** GLSL/HLSL math intrinsics shared by both front ends. */
export function mathBuiltins(): Record<string, Builtin> {
  const b: Record<string, Builtin> = {};
  for (const n of ["sin", "cos", "tan", "asin", "acos", "sqrt", "exp", "log",
    "exp2", "log2", "abs", "sign", "floor", "ceil", "fract", "round", "trunc",
    "normalize", "sinh", "cosh", "tanh"]) b[n] = pass(n, 1);
  for (const n of ["pow", "min", "max", "step", "reflect"]) b[n] = pass(n, 2);
  for (const n of ["clamp", "mix", "smoothstep", "faceforward", "fma"]) b[n] = pass(n, 3);
  b.length = toScalar("length", 1);
  b.distance = toScalar("distance", 2);
  b.dot = toScalar("dot", 2);
  b.cross = (args, line, e) => {
    const a = e.coerce(args[0], vec(3), line);
    const c = e.coerce(args[1], vec(3), line);
    return { code: `cross(${a.code}, ${c.code})`, ty: vec(3) };
  };
  b.inversesqrt = (args, line, e) => {
    const h = harmonize(args, line, e);
    return { code: `inverseSqrt(${h.args[0].code})`, ty: h.ty };
  };
  b.rsqrt = b.inversesqrt;
  b.refract = (args, line, e) => {
    const h = harmonize(args.slice(0, 2), line, e);
    const eta = e.coerce(args[2], F32, line);
    return { code: `refract(${h.args[0].code}, ${h.args[1].code}, ${eta.code})`, ty: h.ty };
  };
  b.atan = (args, line, e) => {
    const h = harmonize(args, line, e);
    if (args.length === 1) return { code: `atan(${h.args[0].code})`, ty: h.ty };
    return { code: `atan2(${h.args[0].code}, ${h.args[1].code})`, ty: h.ty };
  };
  b.atan2 = (args, line, e) => {
    const h = harmonize(args, line, e);
    return { code: `atan2(${h.args[0].code}, ${h.args[1].code})`, ty: h.ty };
  };
  b.mod = (args, line, e) => {
    const h = harmonize(args, line, e);
    const [a, x] = h.args.map((v) => v.code);
    return { code: `(${a} - ${x} * floor(${a} / ${x}))`, ty: h.ty };
  };
  b.fmod = (args, line, e) => {
    const h = harmonize(args, line, e);
    return { code: `(${h.args[0].code} % ${h.args[1].code})`, ty: h.ty };
  };
  b.lerp = pass("mix", 3);
  b.frac = pass("fract", 1);
  b.saturate = (args, line, e) => {
    const h = harmonize(args, line, e);
    const zero = h.ty.k === "vec" ? `vec${h.ty.n}f(0.0)` : "0.0";
    const one = h.ty.k === "vec" ? `vec${h.ty.n}f(1.0)` : "1.0";
    return { code: `clamp(${h.args[0].code}, ${zero}, ${one})`, ty: h.ty };
  };
  b.mul = (args, line, e) => {
    if (args.length !== 2) throw err("mul expects 2 args", line);
    const [a, c] = args;
    const ty = a.ty.k === "mat" && c.ty.k === "vec" ? c.ty
      : c.ty.k === "mat" && a.ty.k === "vec" ? a.ty
      : a.ty.k === "mat" ? a.ty : c.ty;
    return { code: `(${a.code} * ${c.code})`, ty };
  };
  for (const [g, w] of [["dFdx", "dpdx"], ["dFdy", "dpdy"], ["ddx", "dpdx"], ["ddy", "dpdy"]]) {
    b[g] = (args, line, e) => {
      const h = harmonize(args, line, e);
      return { code: `${w}(${h.args[0].code})`, ty: h.ty };
    };
  }
  b.fwidth = (args, line, e) => {
    const h = harmonize(args, line, e);
    return { code: `fwidth(${h.args[0].code})`, ty: h.ty };
  };
  // PHOSPHENE stdlib visible to translated code; Plane9 variants pass an
  // octave count or vec3 that the vec2 stdlib versions absorb
  const noiseLike = (name: string): Builtin => (args, line, e) => {
    const p = e.coerce(args[0].ty.k === "vec" && args[0].ty.n > 2
      ? { code: `(${args[0].code}).xy`, ty: vec(2) } : args[0], vec(2), line);
    return { code: `${name}(${p.code})`, ty: F32 };
  };
  b.noise = noiseLike("noise");
  b.hash = noiseLike("hash");
  b.fbm = noiseLike("fbm");
  b.ridge = noiseLike("ridge");
  b.pal = (args, line, e) => ({ code: `pal(${e.coerce(args[0], F32, line).code})`, ty: vec(3) });
  b.hue3 = (args, line, e) => ({ code: `hue3(${e.coerce(args[0], F32, line).code})`, ty: vec(3) });
  return b;
}

export function vecArg(args: Val[], i: number, n: 2 | 3 | 4, line: number, e: Emitter): string {
  if (!args[i]) throw err(`missing argument ${i + 1}`, line);
  return e.coerce(args[i], vec(n), line).code;
}

export { wgslTy };
