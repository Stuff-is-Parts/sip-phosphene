// Direct semantic tests for the projectM Filters port at
// src/gpu/milk-filters.ts, verified against
// docs/evidence/projectm/Filters.cpp (pinned SHA
// 2f244141320f6b97b09bf99964cc72a4efdfcfd3). Every assertion cites
// the projectM `glBlendFunc` sequence the port must reproduce.

import { describe, expect, it } from "vitest";
import { planFilterDraws, FILTER_BLENDS } from "../src/gpu/milk-filters";

describe("planFilterDraws — projectM Filters::Draw ordering", () => {
  it("emits no draws when every flag is false", () => {
    expect(planFilterDraws({
      brighten: false, darken: false, solarize: false, invert: false,
    })).toEqual([]);
  });

  it("applies filters in source order brighten → darken → solarize → invert", () => {
    const draws = planFilterDraws({
      brighten: true, darken: true, solarize: true, invert: true,
    });
    const labels = draws.map((d) => d.label);
    expect(labels).toEqual([
      "filter-brighten-0",
      "filter-brighten-1",
      "filter-brighten-2",
      "filter-darken-0",
      "filter-solarize-0",
      "filter-solarize-1",
      "filter-invert-0",
    ]);
  });
});

describe("Filters::Brighten — three draws with projectM blend sequence", () => {
  it("uses (OneMinusDst, Zero) → (Zero, Dst) → (OneMinusDst, Zero)", () => {
    const draws = planFilterDraws({
      brighten: true, darken: false, solarize: false, invert: false,
    });
    expect(draws).toHaveLength(3);
    expect(draws[0].blend).toBe(FILTER_BLENDS.oneMinusDstZero);
    expect(draws[1].blend).toBe(FILTER_BLENDS.zeroDst);
    expect(draws[2].blend).toBe(FILTER_BLENDS.oneMinusDstZero);
  });
});

describe("Filters::Darken — one draw at (Zero, Dst)", () => {
  it("emits a single draw with projectM's darken blend", () => {
    const draws = planFilterDraws({
      brighten: false, darken: true, solarize: false, invert: false,
    });
    expect(draws).toHaveLength(1);
    expect(draws[0].blend).toBe(FILTER_BLENDS.zeroDst);
  });
});

describe("Filters::Solarize — two draws (Zero, OneMinusDst) then (Dst, One)", () => {
  it("emits both draws with projectM's solarize blend order", () => {
    const draws = planFilterDraws({
      brighten: false, darken: false, solarize: true, invert: false,
    });
    expect(draws).toHaveLength(2);
    expect(draws[0].blend).toBe(FILTER_BLENDS.zeroOneMinusDst);
    expect(draws[1].blend).toBe(FILTER_BLENDS.dstOne);
  });
});

describe("Filters::Invert — one draw at (OneMinusDst, Zero)", () => {
  it("emits a single draw with projectM's invert blend", () => {
    const draws = planFilterDraws({
      brighten: false, darken: false, solarize: false, invert: true,
    });
    expect(draws).toHaveLength(1);
    expect(draws[0].blend).toBe(FILTER_BLENDS.oneMinusDstZero);
  });
});

describe("FILTER_BLENDS — projectM blend factor pairs", () => {
  it("maps projectM's four blend functions to WebGPU factor names", () => {
    expect(FILTER_BLENDS.oneMinusDstZero).toEqual({ src: "one-minus-dst", dst: "zero", key: "one-minus-dst--zero" });
    expect(FILTER_BLENDS.zeroDst).toEqual({ src: "zero", dst: "dst", key: "zero--dst" });
    expect(FILTER_BLENDS.zeroOneMinusDst).toEqual({ src: "zero", dst: "one-minus-dst", key: "zero--one-minus-dst" });
    expect(FILTER_BLENDS.dstOne).toEqual({ src: "dst", dst: "one", key: "dst--one" });
  });
});
