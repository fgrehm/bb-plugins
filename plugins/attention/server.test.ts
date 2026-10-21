import { afterEach, describe, expect, it, vi } from "vitest";
afterEach(() => vi.restoreAllMocks());
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { readFamily } from "./server.js";
import { familyReportSchema } from "./lib/contract.js";

// Isolated public SDK boundary. No database or message bodies are needed.
function fixture() {
  const threads = [
    {
      id: "root",
      title: "Parent",
      titleFallback: null,
      parentThreadId: null,
      createdAt: Date.parse("2026-10-11T09:00Z"),
      deletedAt: null,
      archivedAt: 1,
      visibility: "visible",
      projectId: "p",
      providerId: "pi",
    },
    {
      id: "child",
      title: "Hidden child",
      titleFallback: null,
      parentThreadId: "root",
      createdAt: Date.parse("2026-10-11T09:00Z"),
      deletedAt: null,
      archivedAt: 1,
      visibility: "hidden",
      projectId: "p",
      providerId: "pi",
    },
  ];
  const lifecycle = (seq: number, at: string, status: string) => ({
    id: `q${seq}`,
    seq,
    threadId: "child",
    type: "system/interaction/lifecycle",
    createdAt: Date.parse(at),
    data: {
      interaction: {
        id: "question",
        status,
        payload: { title: "Proceed?" },
        resolution: status === "resolved" ? { kind: "plugin_submitted" } : null,
        statusReason: null,
      },
    },
  });
  const rows = [
    lifecycle(1, "2026-10-11T23:50Z", "pending"),
    lifecycle(2, "2026-10-12T00:10Z", "resolved"),
  ];
  const list = vi.fn(async ({ parentThreadId }: { parentThreadId: string }) =>
    threads.filter((t) => t.parentThreadId === parentThreadId),
  );
  const get = vi.fn(async ({ threadId }: { threadId: string }) => {
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) throw new Error("missing");
    return thread;
  });
  const events = vi.fn(
    async ({
      threadId,
      beforeSeq,
    }: {
      threadId: string;
      beforeSeq?: string;
    }) =>
      threadId === "child"
        ? rows
            .filter((r) => beforeSeq === undefined || r.seq < Number(beforeSeq))
            .reverse()
        : [],
  );
  const bb = {
    sdk: { threads: { get, list, events: { list: events } } },
  } as unknown as BbPluginApi;
  return { bb, list, events };
}
describe("family RPC reconstruction", () => {
  it("includes hidden archived descendants when opened from a child and preserves overnight waits", async () => {
    const { bb, list } = fixture();
    const result = await readFamily(bb, { threadId: "child", timezone: "UTC" });
    expect(familyReportSchema.safeParse(result).success).toBe(true);
    expect(result.rootId).toBe("root");
    expect(result.report.threads).toHaveLength(2);
    expect(result.report.threads[1]).toMatchObject({
      hidden: true,
      archived: true,
    });
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ includeHidden: true, parentThreadId: "root" }),
    );
    expect(result.report.questions).toHaveLength(1);
    expect(result.report.questions[0]).toMatchObject({
      waitMs: 20 * 60_000,
      outcome: "answered",
    });
  });
  it("does not invent a request opening on the selected window boundary", async () => {
    const { bb } = fixture();
    const result = await readFamily(bb, {
      threadId: "root",
      timezone: "UTC",
      startDay: "2026-10-12",
      endDay: "2026-10-12",
    });
    expect(result.report.questions[0]!.opened).toBe(
      Date.parse("2026-10-11T23:50Z"),
    );
    expect(result.report.questions[0]!.waitMs).toBe(20 * 60_000);
  });
  it("bounds unresolved waits at now rather than the end of a future window", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-11T23:55Z"));
    const { bb, events } = fixture();
    events.mockImplementation(async ({ threadId }) =>
      threadId === "child"
        ? [
            {
              id: "pending",
              seq: 1,
              threadId: "child",
              type: "system/interaction/lifecycle",
              createdAt: Date.parse("2026-10-11T23:50Z"),
              data: {
                interaction: {
                  id: "question",
                  status: "pending",
                  payload: { title: "Proceed?" },
                  resolution: null,
                  statusReason: null,
                },
              },
            },
          ]
        : [],
    );
    const result = await readFamily(bb, {
      threadId: "root",
      timezone: "UTC",
      startDay: "2026-10-11",
      endDay: "2026-10-12",
    });
    expect(result.report.questions[0]!.waitMs).toBe(5 * 60_000);
  });

  it("rejects invalid, reversed, and oversized windows", async () => {
    const { bb } = fixture();
    await expect(
      readFamily(bb, {
        threadId: "root",
        timezone: "UTC",
        startDay: "2026-02-31",
      }),
    ).rejects.toThrow("valid calendar");
    await expect(
      readFamily(bb, {
        threadId: "root",
        timezone: "UTC",
        startDay: "2026-10-13",
        endDay: "2026-10-11",
      }),
    ).rejects.toThrow("ordered window");
    await expect(
      readFamily(bb, {
        threadId: "root",
        timezone: "UTC",
        startDay: "2024-01-01",
        endDay: "2026-10-11",
      }),
    ).rejects.toThrow();
  });
  it("surfaces exhausted history paging", async () => {
    const { bb, events } = fixture();
    events.mockImplementation(async () =>
      Array.from({ length: 100 }, (_, i) => ({
        id: `q${i}`,
        seq: 100 - i,
        threadId: "child",
        type: "system/interaction/lifecycle",
        createdAt: Date.parse("2026-10-12T00:10Z"),
        data: {
          interaction: {
            id: `request${i}`,
            status: "pending",
            payload: { title: "Question" },
            resolution: null,
            statusReason: null,
          },
        },
      })),
    );
    const result = await readFamily(bb, { threadId: "root", timezone: "UTC" });
    expect(result.report.coverage.truncatedThreads).toHaveLength(2);
    expect(result.warnings.join(" ")).toContain("30 event pages");
  });
});
