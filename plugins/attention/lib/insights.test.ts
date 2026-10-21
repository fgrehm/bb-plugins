import { describe, expect, it } from "vitest";
import { buildReport, type RawEvent } from "./day.js";
import {
  busiestWindows,
  dayNarrative,
  hourlyBuckets,
  threadOrder,
  threadSummaries,
} from "./insights.js";
import type { DayThread } from "./contract.js";

const DAY = "2026-10-20";
const at = (hour: number, minute = 0) =>
  Date.parse(`${DAY}T00:00:00.000Z`) + hour * 3_600_000 + minute * 60_000;

const thread = (id: string): DayThread => ({
  id,
  title: id,
  projectId: "proj_test",
  providerId: "pi",
  parentThreadId: null,
  archived: false,
  createdAt: 0,
});

const events: RawEvent[] = [
  {
    kind: "request",
    at: at(9),
    threadId: "thr_a",
    requestId: "req_1",
    initiator: "user",
    inputKind: "new-turn",
    model: null,
  },
  {
    kind: "accepted",
    at: at(9),
    threadId: "thr_a",
    requestId: "req_1",
    turnId: "t1",
  },
  { kind: "turn-start", at: at(9), threadId: "thr_a", turnId: "t1" },
  {
    kind: "turn-end",
    at: at(10, 30),
    threadId: "thr_a",
    turnId: "t1",
    status: "completed",
  },
  {
    kind: "request",
    at: at(9, 40),
    threadId: "thr_b",
    requestId: "req_2",
    initiator: "user",
    inputKind: "new-turn",
    model: null,
  },
  {
    kind: "accepted",
    at: at(9, 40),
    threadId: "thr_b",
    requestId: "req_2",
    turnId: "t2",
  },
  { kind: "turn-start", at: at(9, 40), threadId: "thr_b", turnId: "t2" },
  {
    kind: "turn-end",
    at: at(10),
    threadId: "thr_b",
    turnId: "t2",
    status: "completed",
  },
  {
    kind: "question",
    at: at(9, 10),
    threadId: "thr_a",
    interactionId: "q1",
    status: "pending",
    title: "Which branch?",
    resolutionKind: null,
    statusReason: null,
  },
  {
    kind: "question",
    at: at(9, 12),
    threadId: "thr_a",
    interactionId: "q1",
    status: "resolved",
    title: "Which branch?",
    resolutionKind: "plugin_submitted",
    statusReason: null,
  },
];

const report = buildReport({
  day: DAY,
  timezone: "UTC",
  threads: [thread("thr_a"), thread("thr_b")],
  events,
  truncatedThreads: [],
});

describe("hourly buckets", () => {
  it("sums agent minutes, inputs, and questions per hour", () => {
    const buckets = hourlyBuckets(report);
    expect(buckets).toHaveLength(24);
    expect(buckets[9]?.agentMinutes).toBe(80);
    expect(buckets[10]?.agentMinutes).toBe(30);
    expect(buckets[9]?.inputs).toBe(2);
  });
});

describe("busiest windows", () => {
  it("picks ranked, non-overlapping windows and returns them chronologically", () => {
    const windows = busiestWindows(report, 3);
    expect(windows.map((item) => item.start)).toEqual([at(9, 30)]);
    const busiest = windows[0];
    expect(busiest?.inputs).toBe(1);
    expect(busiest?.agentMinutes).toBe(50);
    for (let index = 1; index < windows.length; index += 1) {
      const previous = windows[index - 1]!;
      const current = windows[index]!;
      expect(current.start).toBeGreaterThanOrEqual(previous.end);
    }
  });
});

describe("thread summaries", () => {
  it("orders threads by agent time and counts activity", () => {
    const summaries = threadSummaries(report);
    expect(summaries.map((item) => item.id)).toEqual(["thr_a", "thr_b"]);
    expect(summaries[0]?.agentMs).toBe(90 * 60_000);
    expect(summaries[1]?.inputs).toBe(1);
    expect(summaries[1]?.firstAt).toBe(at(9, 40));
  });
});

describe("narrative", () => {
  it("states recorded facts without a score", () => {
    const text = dayNarrative(report);
    expect(text).toContain("Agents ran for 1h 50m");
    expect(text).toContain("2 ran at once");
    expect(text).toContain("You sent 2 inputs");
    expect(text).toContain("1 request for input");
    expect(text).not.toMatch(/score|productiv|focus/i);
  });
});

describe("thread order", () => {
  it("nests subthreads under their parent and sorts by agent time", () => {
    const parent: DayThread = { ...thread("thr_parent"), parentThreadId: null };
    const child: DayThread = {
      ...thread("thr_child"),
      parentThreadId: "thr_parent",
    };
    const orphan: DayThread = {
      ...thread("thr_orphan"),
      parentThreadId: "thr_missing",
    };
    const events: RawEvent[] = [
      {
        kind: "turn-start",
        at: at(9),
        threadId: "thr_parent",
        turnId: "p1",
      },
      {
        kind: "turn-end",
        at: at(9, 30),
        threadId: "thr_parent",
        turnId: "p1",
        status: "completed",
      },
      { kind: "turn-start", at: at(9, 5), threadId: "thr_child", turnId: "c1" },
      {
        kind: "turn-end",
        at: at(9, 10),
        threadId: "thr_child",
        turnId: "c1",
        status: "completed",
      },
      {
        kind: "turn-start",
        at: at(9, 20),
        threadId: "thr_orphan",
        turnId: "o1",
      },
      {
        kind: "turn-end",
        at: at(9, 25),
        threadId: "thr_orphan",
        turnId: "o1",
        status: "completed",
      },
    ];
    const nested = buildReport({
      day: DAY,
      timezone: "UTC",
      threads: [parent, child, orphan],
      events,
      truncatedThreads: [],
    });
    const order = threadOrder(nested, threadSummaries(nested));
    expect(order.map((entry) => [entry.id, entry.depth])).toEqual([
      ["thr_parent", 0],
      ["thr_child", 1],
      ["thr_orphan", 0],
    ]);
    expect(order[0]?.childCount).toBe(1);
    expect(order[0]?.descendants).toBe(1);
    expect(order[0]?.descendantAgentMs).toBe(5 * 60_000);
    expect(order[2]?.detached).toBe(true);
  });
});
