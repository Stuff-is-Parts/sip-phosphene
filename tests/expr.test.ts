import { describe, it, expect } from "vitest";
import { compile } from "../src/core/expr";

function run(src: string, env: Record<string, number> = {}): Record<string, number> {
  compile(src).run(env);
  return env;
}

describe("expression compiler", () => {
  it("evaluates arithmetic with precedence", () => {
    expect(run("out = 2 + 3 * 4;").out).toBe(14);
    expect(run("out = (2 + 3) * 4;").out).toBe(20);
    expect(run("out = 2 ^ 3 ^ 2;").out).toBe(512); // right-assoc
    expect(run("out = -3 + 1;").out).toBe(-2);
  });

  it("divides by zero to 0 instead of Infinity", () => {
    expect(run("out = 1 / 0;").out).toBe(0);
    expect(run("out = 5 % 0;").out).toBe(0);
  });

  it("reads unknown variables as 0 and persists assignments", () => {
    const env = run("a = a + 1;");
    expect(env.a).toBe(1);
    compile("a = a + 1;").run(env);
    expect(env.a).toBe(2);
  });

  it("supports EEL functions and comparisons", () => {
    expect(run("out = if(above(3, 2), 10, 20);").out).toBe(10);
    expect(run("out = min(4, max(1, 2));").out).toBe(2);
    expect(run("out = band(1, 0);").out).toBe(0);
    expect(run("out = bor(1, 0);").out).toBe(1);
    expect(run("out = 3 > 2;").out).toBe(1);
    expect(run("out = frac(1.75);").out).toBe(0.75);
    expect(run("out = sqr(3);").out).toBe(9);
  });

  it("is case-insensitive like MilkDrop equations", () => {
    expect(run("OUT = SIN(0);").out).toBe(0);
  });

  it("runs a real MilkDrop per-frame shape of program", () => {
    const env = run(
      `zoom = 1.01;
       rot = 0.02;
       q1 = q1*0.9 + bass*0.1;
       zoom = zoom + 0.02*sin(time*0.8) + q1*0.05;
       rot = rot + 0.01*sin(time*0.4);`,
      { time: 0, bass: 1 },
    );
    expect(env.zoom).toBeCloseTo(1.01 + 0.1 * 0.05);
    expect(env.q1).toBeCloseTo(0.1);
    expect(env.rot).toBeCloseTo(0.02); // sin(0) contributes nothing at time=0
  });

  it("reports assigned variable names", () => {
    expect(compile("zoom = 1; rot = zoom * 2;").assigns).toEqual(["zoom", "rot"]);
  });

  it("throws on syntax errors with position info", () => {
    expect(() => compile("out = 1 +")).toThrow();
    expect(() => compile("out = nosuchfn(1);")).toThrow(/unknown function/);
    expect(() => compile("3 = x;")).toThrow();
  });

  it("stores raw doubles (witnessed converter assignment: no sanitization)", () => {
    // log(0) * 0 = -Infinity * 0 = NaN; exp(9999) = Infinity; sum = NaN.
    // The oracle's generated JS assigns the raw value (butterchurn
    // loadPreset new Function bodies — docs/evidence/butterchurn).
    expect(Number.isNaN(run("out = log(0) * 0 + exp(9999);").out)).toBe(true);
    // pow is the witnessed exception: non-finite results return 0.
    expect(run("out = pow(-1, 0.5);").out).toBe(0);
  });

  it("applies witnessed MilkDrop EEL semantics (converter + presetBase evidence)", () => {
    expect(run("out = 7.9 % 3.2;").out).toBe(1);            // floor-mod: 7 % 3
    expect(run("out = 5 % 0;").out).toBe(0);                // zero guard
    expect(run("out = 0.300000001 == 0.3;").out).toBe(1);   // epsilon equality
    expect(run("out = 6 & 3;").out).toBe(2);                // bitwise and
    expect(run("out = 6 | 3;").out).toBe(7);                // bitwise or
    expect(run("out = 2 && 0;").out).toBe(0);               // logical
    expect(run("out = int(3.9);").out).toBe(3);             // int = floor
    expect(run("out = int(0 - 1.5);").out).toBe(-2);        // floor, not trunc
    expect(run("out = sqrt(0 - 4);").out).toBe(2);          // sqrt(|x|)
    expect(run("out = if(0.000001, 1, 2);").out).toBe(2);   // epsilon condition
    expect(run("out = !0.000001;").out).toBe(1);            // bnot epsilon
    const r = run("out = rand(0.5);").out;                  // arg<1 -> [0,1)
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(1);
  });

  it("runs loop() bodies with statement lists", () => {
    const env = run("i = 0; s = 0; loop(10, s = s + i; i = i + 1);");
    expect(env.s).toBe(45);
    expect(env.i).toBe(10);
  });

  it("reads and writes megabuf/gmegabuf cells, including compound stores", () => {
    const env = run("megabuf(5) = 7; megabuf(5) += 3; out = megabuf(5) + gmegabuf(9);");
    expect(env.out).toBe(10);
  });

  it("supports compound assignment as expression and statement", () => {
    const env = run("a = 10; a *= 2; b = if(above(a, 5), a += 1, a -= 1);");
    expect(env.a).toBe(21);
    expect(env.b).toBe(21);
  });

  it("executes only the taken if() branch", () => {
    const env = run("x = 0; y = 0; if(1, x = 5, y = 5);");
    expect(env.x).toBe(5);
    expect(env.y).toBe(0);
  });

  it("accepts statement blocks with doubled semicolons as arguments", () => {
    const env = run("if(1, a = 1; b = 2;; , 0); out = a + b;");
    expect(env.out).toBe(3);
  });

  it("accepts $PI constants and trailing-dot numbers", () => {
    expect(run("out = sin($PI);").out).toBeCloseTo(0, 10);
    expect(run("out = 2. + .5;").out).toBe(2.5);
  });

  it("shares gmegabuf storage across compiled programs when the same Float64Array is installed", () => {
    // Witnessed butterchurn presetEquationRunner behavior: mdVSBase.gmegabuf
    // is one Array(1048576) shared between the preset runtime and every
    // wave/shape runtime, so a write in per-frame is visible to a read in
    // per-pixel/per-wave/per-shape within the same frame. Two independently
    // compiled Programs sharing the same Float64Array must see each other's
    // writes; passing null (the default) isolates them.
    const shared = new Float64Array(1048576);
    const writer = compile("gmegabuf(42) = 7.5;");
    const reader = compile("out = gmegabuf(42);");
    writer.setGmegabuf(shared);
    reader.setGmegabuf(shared);
    const wEnv: Record<string, number> = {};
    const rEnv: Record<string, number> = {};
    writer.run(wEnv);
    reader.run(rEnv);
    expect(rEnv.out).toBe(7.5);
    expect(shared[42]).toBe(7.5);
    // Independent programs without a shared array (default) do NOT
    // see each other's writes — they fall back to per-pool storage.
    const isolatedW = compile("gmegabuf(42) = 99;");
    const isolatedR = compile("out = gmegabuf(42);");
    const iwEnv: Record<string, number> = {};
    const irEnv: Record<string, number> = {};
    isolatedW.run(iwEnv);
    isolatedR.run(irEnv);
    expect(irEnv.out).toBe(0);
  });

  it("clamps gmegabuf indexes to the 1M-cell range and silently discards out-of-range writes", () => {
    const shared = new Float64Array(1048576);
    const writer = compile("gmegabuf(1048576) = 1; gmegabuf(-1) = 1;");
    const reader = compile("a = gmegabuf(1048576); b = gmegabuf(-1);");
    writer.setGmegabuf(shared);
    reader.setGmegabuf(shared);
    writer.run({});
    const env: Record<string, number> = {};
    reader.run(env);
    expect(env.a).toBe(0);
    expect(env.b).toBe(0);
    // Nothing written to the shared array either.
    let touched = 0;
    for (let i = 0; i < shared.length; i++) if (shared[i] !== 0) touched++;
    expect(touched).toBe(0);
  });

  it("reports usesGmegabuf on programs that reference the buffer", () => {
    expect(compile("out = megabuf(0);").usesGmegabuf).toBe(false);
    expect(compile("out = gmegabuf(0);").usesGmegabuf).toBe(true);
    expect(compile("gmegabuf(3) = 1;").usesGmegabuf).toBe(true);
    // Case-insensitive at tokenize (identifiers lowercased).
    expect(compile("out = GMEGABUF(0);").usesGmegabuf).toBe(true);
  });
});
