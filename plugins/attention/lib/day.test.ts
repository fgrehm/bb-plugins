import { describe, expect, it } from "vitest";
import {
  buildReport,
  dayBounds,
  dayStringAt,
  previousDay,
  type RawEvent,
} from "./day.js";
import type { DayThread } from "./contract.js";

const DAY = "2026-10-20";
const at = (hour: number, minute = 0) =>
  Date.parse(`${DAY}T00:00:00.000Z`) + hour * 3_600_000 + minute * 60_000;

function thread(id: string, title: string): DayThread {
  return {
    id,
    title,
    projectId: "proj_test",
    providerId: "pi",
    parentThreadId: null,
    archived: false,
    createdAt: 0,
  };
}

const A = thread("thr_a", "Thread A");
const B = thread("thr_b", "Thread B");

function request(
  threadId: string,
  requestId: string,
  time: number,
  initiator: "user" | "agent" | "system",
  inputKind: "new-turn" | "steer" | "auto" | "thread-start",
): RawEvent {
  return {
    kind: "request",
    at: time,
    threadId,
    requestId,
    initiator,
    inputKind,
    model: "model-x",
  };
}

function accepted(
  threadId: string,
  requestId: string,
  turnId: string,
  time: number,
): RawEvent {
  return { kind: "accepted", at: time, threadId, requestId, turnId };
}

function start(threadId: string, turnId: string, time: number): RawEvent {
  return { kind: "turn-start", at: time, threadId, turnId };
}

function end(
  threadId: string,
  turnId: string,
  time: number,
  status: "completed" | "failed" | "interrupted" = "completed",
): RawEvent {
  return { kind: "turn-end", at: time, threadId, turnId, status };
}

function question(
  threadId: string,
  interactionId: string,
  time: number,
  status: "pending" | "resolving" | "resolved" | "interrupted",
  options: { title?: string; statusReason?: string | null } = {},
): RawEvent {
  return {
    kind: "question",
    at: time,
    threadId,
    interactionId,
    status,
    title: options.title ?? "Pick one",
    resolutionKind: status === "resolved" ? "plugin_submitted" : null,
    statusReason: options.statusReason ?? null,
  };
}

describe("day bounds", () => {
  it("uses UTC when asked", () => {
    const { start, end } = dayBounds(DAY, "UTC");
    expect(start).toBe(Date.parse(`${DAY}T00:00:00.000Z`));
    expect(end - start).toBe(86_400_000);
    expect(dayStringAt(start, "UTC")).toBe(DAY);
  });

  it("handles the end of daylight saving", () => {
    const { start, end } = dayBounds("2026-10-25", "Europe/Lisbon");
    expect(end - start).toBe(25 * 3_600_000);
    expect(dayStringAt(start, "Europe/Lisbon")).toBe("2026-10-25");
  });

  it("handles the start of daylight saving", () => {
    const { start, end } = dayBounds("2026-03-29", "Europe/Lisbon");
    expect(end - start).toBe(23 * 3_600_000);
  });

  it("yields the previous calendar day in the requested zone", () => {
    const now = Date.parse("2026-10-21T10:00:00.000Z");
    expect(previousDay("Europe/Lisbon", now)).toBe("2026-10-20");
  });
});

describe("buildReport", () => {
  const events: RawEvent[] = [
    request("thr_a", "req_1", at(9), "user", "new-turn"),
    accepted("thr_a", "req_1", "t1", at(9, 0) + 1_000),
    start("thr_a", "t1", at(9, 0) + 1_000),
    request("thr_a", "req_2", at(9, 5), "user", "steer"),
    accepted("thr_a", "req_2", "t1", at(9, 5) + 500),
    end("thr_a", "t1", at(9, 10)),
    request("thr_a", "req_3", at(9, 20), "system", "new-turn"),
    accepted("thr_a", "req_3", "t2", at(9, 20)),
    start("thr_a", "t2", at(9, 20)),
    end("thr_a", "t2", at(9, 30)),
    request("thr_a", "req_4", at(9, 40), "agent", "new-turn"),
    accepted("thr_a", "req_4", "t3", at(9, 40)),
    start("thr_a", "t3", at(9, 40)),
    end("thr_a", "t3", at(9, 45)),
    start("thr_b", "t4", at(9, 5)),
    end("thr_b", "t4", at(9, 25)),
    request("thr_b", "req_5", at(9, 30), "user", "steer"),
    accepted("thr_b", "req_5", "t4", at(9, 30) + 1_000),
    question("thr_a", "q1", at(9, 6), "pending"),
    question("thr_a", "q1", at(9, 7), "resolved", { title: "Pick one" }),
    question("thr_a", "q2", at(9, 50), "pending"),
    question("thr_a", "q2", at(10), "interrupted", {
      statusReason: "timeout",
    }),
    // Started the previous day and clipped at midnight.
    start("thr_b", "t0", at(0) - 3_600_000),
    end("thr_b", "t0", at(0, 10)),
  ];

  const report = buildReport({
    day: DAY,
    timezone: "UTC",
    threads: [A, B],
    events,
    truncatedThreads: [],
  });

  it("pairs turns and keeps steer attribution on the original request", () => {
    const turn = report.turns.find((candidate) => candidate.turnId === "t1");
    expect(turn).toBeDefined();
    expect(turn?.start).toBe(at(9, 0) + 1_000);
    expect(turn?.end).toBe(at(9, 10));
    expect(turn?.initiator).toBe("user");
    expect(turn?.status).toBe("completed");
    expect(turn?.model).toBe("model-x");
  });

  it("counts inputs by initiator", () => {
    expect(report.summary.humanInputs).toBe(3);
    expect(report.summary.agentInputs).toBe(1);
    expect(report.summary.systemInputs).toBe(1);
    expect(report.summary.turns).toBe(5);
  });

  it("records dispatch delay only for accepted sends", () => {
    const steer = report.inputs.find(
      (input) => input.threadId === "thr_a" && input.kind === "steer",
    );
    expect(steer?.queueDelayMs).toBe(500);
  });

  it("derives question outcomes and waits", () => {
    const answered = report.questions.find((item) => item.id === "q1");
    expect(answered?.outcome).toBe("answered");
    expect(answered?.waitMs).toBe(60_000);
    const timedOut = report.questions.find((item) => item.id === "q2");
    expect(timedOut?.outcome).toBe("timeout");
    expect(timedOut?.waitMs).toBe(10 * 60_000);
  });

  it("does not extend an unfinished turn into a future day", () => {
    const unfinished: RawEvent[] = [
      start("thr_a", "open", at(9) - 24 * 3_600_000),
    ];
    const future = buildReport({
      day: DAY,
      timezone: "UTC",
      threads: [A],
      events: unfinished,
      truncatedThreads: [],
      window: {
        start: at(0) + 24 * 3_600_000,
        end: at(0) + 48 * 3_600_000,
      },
      now: at(12),
      includeBins: false,
    });
    expect(future.turns).toHaveLength(0);
  });

  it("stops an unfinished turn at now on the current day", () => {
    const open: RawEvent[] = [start("thr_a", "open", at(9))];
    const current = buildReport({
      day: DAY,
      timezone: "UTC",
      threads: [A],
      events: open,
      truncatedThreads: [],
      now: at(10),
      includeBins: false,
    });
    expect(current.turns).toHaveLength(1);
    expect(current.turns[0]?.end).toBe(at(10));
    expect(current.turns[0]?.status).toBe("running");
  });

  it("clips a turn that started the day before", () => {
    const clipped = report.turns.find((candidate) => candidate.turnId === "t0");
    expect(clipped?.start).toBe(Date.parse(`${DAY}T00:00:00.000Z`));
    expect(clipped?.end).toBe(at(0, 10));
  });

  it("computes concurrency, busy minutes, and thread transitions", () => {
    expect(report.summary.peakConcurrency).toBe(2);
    expect(report.summary.busyMinutes).toBe(10);
    expect(report.summary.threadTransitions).toBe(1);
    expect(report.bins.concurrency).toHaveLength(1440);
  });

  it("keeps only threads with activity", () => {
    expect(report.threads.map((item) => item.id)).toEqual(["thr_a", "thr_b"]);
    expect(report.coverage.eventsRead).toBe(events.length);
  });
});
