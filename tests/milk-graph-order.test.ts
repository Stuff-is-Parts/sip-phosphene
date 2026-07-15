// Direct semantic tests for milkToGraph's graph.order against the
// source-witnessed pipeline stage sequence at butterchurn
// rendering_renderer.js (evidence at
// docs/evidence/butterchurn/rendering_renderer.js). Every assertion
// pins one ordering rule cited inline.

import { describe, expect, it } from "vitest";
import { parseMilkComplete, milkToGraph } from "../src/import/milk-graph";

// A minimal preset that exercises every pipeline stage: preset frame
// equations, warp, motion vectors, custom shape, custom wave, default
// wave, borders, composite. No warp/comp shader (blur stage does not
// fire), so the base order under test is:
//   frame → warp → motionVectors → shape<index> → wave<index>
//        → defaultWave → borders → composite
const MINIMAL_MILK = `[preset00]
fDecay=0.95
zoom=1.0
per_frame_1=q1 = 1;
wavecode_0_enabled=1
shapecode_0_enabled=1
`;

describe("milkToGraph graph.order — source-defined stage sequence", () => {
  // Butterchurn renderer.js render() runs stages in this order (see the
  // inline comment at src/import/milk-graph.ts:146-149 citing the source):
  //   warp → blur (when needed) → motion vectors → shapes → waves
  //   → basic wave → darken-center+borders → composite
  it("produces the exact stage sequence with no blur stage when no shader present", () => {
    const parsed = parseMilkComplete(MINIMAL_MILK, "test.milk");
    const { graph } = milkToGraph(parsed);
    // graph.order lists node ids in execution order. Filter to the
    // milk-* stages that carry semantic meaning (drop the "canvas"
    // target which is a resource, not a stage).
    const stages = graph.order.filter((id) => id !== "canvas");
    expect(stages).toEqual([
      "frame",
      "warp",
      "motionVectors",
      "shape0",
      "wave0",
      "defaultWave",
      "borders",
      "composite",
    ]);
  });

  it("emits shapes in numeric index order regardless of source line order", () => {
    // Butterchurn's PresetEquationRunner iterates preset.shapes in
    // index order (equations_presetEquationRunner.js:147-176 uses a
    // numeric loop over shape.baseVals.enabled). PHOSPHENE's parser
    // sorts numbered blocks by index, matching that iteration order.
    const src = `[preset00]
shapecode_0_enabled=1
shapecode_2_enabled=1
shapecode_1_enabled=1
`;
    const { graph } = milkToGraph(parseMilkComplete(src, "test.milk"));
    const shapes = graph.order.filter((id) => id.startsWith("shape"));
    expect(shapes).toEqual(["shape0", "shape1", "shape2"]);
  });

  it("emits custom waves in numeric index order before the default wave", () => {
    const src = `[preset00]
wavecode_2_enabled=1
wavecode_0_enabled=1
`;
    const { graph } = milkToGraph(parseMilkComplete(src, "test.milk"));
    const waves = graph.order.filter((id) => id.includes("ave"));
    expect(waves).toEqual(["wave0", "wave2", "defaultWave"]);
  });

  it("places warp immediately after frame (no stages between)", () => {
    const { graph } = milkToGraph(parseMilkComplete(MINIMAL_MILK, "test.milk"));
    const frameIdx = graph.order.indexOf("frame");
    const warpIdx = graph.order.indexOf("warp");
    expect(warpIdx).toBe(frameIdx + 1);
  });

  it("places composite as the last stage", () => {
    const { graph } = milkToGraph(parseMilkComplete(MINIMAL_MILK, "test.milk"));
    expect(graph.order[graph.order.length - 1]).toBe("composite");
  });

  it("places borders immediately before composite (darken-center+borders is one node)", () => {
    const { graph } = milkToGraph(parseMilkComplete(MINIMAL_MILK, "test.milk"));
    const bordersIdx = graph.order.indexOf("borders");
    const compositeIdx = graph.order.indexOf("composite");
    expect(bordersIdx).toBe(compositeIdx - 1);
  });
});
