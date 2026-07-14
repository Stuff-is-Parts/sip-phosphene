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

  it("clamps non-finite results to 0", () => {
    expect(run("out = log(0) * 0 + exp(9999);").out).toBe(0);
  });
});
