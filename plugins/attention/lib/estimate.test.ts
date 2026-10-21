import { describe, expect, it } from "vitest";
import {
  clampAssumptions,
  DEFAULT_ASSUMPTIONS,
  estimateHumanTime,
} from "./estimate.js";

describe("human time estimate", () => {
  it("adds inputs and requests as interacting time", () => {
    const estimate = estimateHumanTime(
      { inputs: 10, requests: 2, switches: 0 },
      { inputSeconds: 20, requestSeconds: 60, switchSeconds: 30 },
    );
    expect(estimate.interactingMs).toBe(320_000);
    expect(estimate.switchingMs).toBe(0);
    expect(estimate.totalMs).toBe(320_000);
  });

  it("adds switching time separately", () => {
    const estimate = estimateHumanTime(
      { inputs: 1, requests: 0, switches: 4 },
      { inputSeconds: 10, requestSeconds: 10, switchSeconds: 30 },
    );
    expect(estimate.interactingMs).toBe(10_000);
    expect(estimate.switchingMs).toBe(120_000);
    expect(estimate.totalMs).toBe(130_000);
  });

  it("treats negative assumptions and counts as zero", () => {
    const estimate = estimateHumanTime(
      { inputs: 5, requests: -1, switches: -2 },
      { inputSeconds: -10, requestSeconds: 60, switchSeconds: 30 },
    );
    expect(estimate.totalMs).toBe(0);
  });

  it("clamps assumptions to sane bounds", () => {
    expect(
      clampAssumptions({
        inputSeconds: 999,
        requestSeconds: -5,
        switchSeconds: 12.6,
      }),
    ).toEqual({
      inputSeconds: 300,
      requestSeconds: 0,
      switchSeconds: 13,
    });
    expect(clampAssumptions(DEFAULT_ASSUMPTIONS)).toEqual(DEFAULT_ASSUMPTIONS);
  });
});
