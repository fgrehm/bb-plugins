// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "./lib/contract";
import { buildReport, type RawEvent } from "./lib/day";
import type { DayThread } from "./lib/contract";

afterEach(cleanup);

const DAY = "2026-10-20";
const at = (hour: number, minute = 0) =>
  Date.parse(`${DAY}T00:00:00.000Z`) + hour * 3_600_000 + minute * 60_000;

const thread: DayThread = {
  id: "thr_a",
  title: "Ship the attention page",
  projectId: "proj_test",
  providerId: "pi",
  parentThreadId: null,
  archived: false,
  createdAt: at(8),
};

const events: RawEvent[] = [
  {
    kind: "request",
    at: at(9),
    threadId: "thr_a",
    requestId: "req_1",
    initiator: "user",
    inputKind: "new-turn",
    model: "model-x",
  },
  {
    kind: "accepted",
    at: at(9) + 1_000,
    threadId: "thr_a",
    requestId: "req_1",
    turnId: "t1",
  },
  { kind: "turn-start", at: at(9) + 1_000, threadId: "thr_a", turnId: "t1" },
  {
    kind: "turn-end",
    at: at(9, 30),
    threadId: "thr_a",
    turnId: "t1",
    status: "completed",
  },
  {
    kind: "question",
    at: at(9, 10),
    threadId: "thr_a",
    interactionId: "q1",
    status: "pending",
    title: "Which branch should this land on?",
    resolutionKind: null,
    statusReason: null,
  },
  {
    kind: "question",
    at: at(9, 12),
    threadId: "thr_a",
    interactionId: "q1",
    status: "resolved",
    title: "Which branch should this land on?",
    resolutionKind: "plugin_submitted",
    statusReason: null,
  },
];

const report = buildReport({
  day: DAY,
  timezone: "UTC",
  threads: [thread],
  events,
  truncatedThreads: [],
});

describe("attention panel", () => {
  it("renders the day summary, timeline row, and question", async () => {
    const app = await loadPluginApp(() => import("./app"));
    expect(app.navPanels).toHaveLength(1);
    const panel = app.navPanels[0]!;
    expect(panel.path).toBe("attention");

    const slot = renderSlot<{ subPath: string }, typeof rpcContract>(
      panel,
      { subPath: "" },
      { rpc: { read_day: () => report, list_days: () => ({ days: [DAY] }) } },
    );

    await waitFor(() =>
      expect(slot.queryByText("Agent attention")).not.toBe(null),
    );
    expect(
      slot.queryAllByText("Ship the attention page").length,
    ).toBeGreaterThan(0);
    expect(slot.queryByText("Your inputs")).not.toBe(null);
    expect(slot.queryByText("Which branch should this land on?")).toBe(null);

    fireEvent.click(slot.getByText("Agent requests"));
    await waitFor(() =>
      expect(slot.queryByText("Which branch should this land on?")).not.toBe(
        null,
      ),
    );

    fireEvent.click(slot.getByLabelText(/^Choose day,/));
    await waitFor(() =>
      expect(slot.getByText("1 day with activity")).not.toBe(null),
    );
    expect(
      (slot.getByLabelText("Mon, 19 Oct 2026") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (slot.getByLabelText("Tue, 20 Oct 2026") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain(
      "read_day",
    );

    slot.lifecycle.unmount();
  });

  it("shows the empty state when no activity was recorded", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const empty = buildReport({
      day: DAY,
      timezone: "UTC",
      threads: [],
      events: [],
      truncatedThreads: [],
    });
    const slot = renderSlot<{ subPath: string }, typeof rpcContract>(
      app.navPanels[0]!,
      { subPath: "" },
      { rpc: { read_day: () => empty, list_days: () => ({ days: [] }) } },
    );
    await waitFor(() =>
      expect(
        slot.queryByText("No turns, inputs, or questions recorded that day."),
      ).not.toBe(null),
    );
    slot.lifecycle.unmount();
  });
});
