import { describe, expect, it } from "vitest";
import { summaryMarkdown } from "./export.js";
import type { DaySummary } from "./contract.js";

const summary: DaySummary = {
  threadsActive: 9,
  turns: 96,
  turnMinutes: 312,
  humanInputs: 89,
  agentInputs: 8,
  systemInputs: 6,
  questions: 2,
  answeredQuestions: 2,
  peakConcurrency: 3,
  busyMinutes: 98,
  threadTransitions: 35,
};

describe("summary markdown", () => {
  it("includes totals, estimate, threads, and coverage", () => {
    const text = summaryMarkdown({
      title: "Tuesday, 20 October 2026",
      narrative: "Agents ran for 5h 12m.",
      summary,
      estimate: {
        interactingMs: 32 * 60_000,
        switchingMs: 18 * 60_000,
        totalMs: 50 * 60_000,
      },
      assumptions: {
        inputSeconds: 20,
        requestSeconds: 60,
        switchSeconds: 30,
      },
      threads: [
        {
          title: "library next steps",
          agentMs: 93 * 60_000,
          turns: 16,
          inputs: 17,
        },
      ],
      timezone: "UTC",
      threadsScanned: 12,
      eventsRead: 727,
    });
    expect(text).toContain("# Tuesday, 20 October 2026");
    expect(text).toContain("- Turns: 96");
    expect(text).toContain("- Your inputs: 89");
    expect(text).toContain("~50 min");
    expect(text).toContain("library next steps");
    expect(text).toContain("12 threads scanned, 727 events read");
    expect(text).toContain("not a measure of attention");
  });
});
