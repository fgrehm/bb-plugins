import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { describe, expect, it } from "vitest";
import { createTodoSnapshots, snapshotForThread } from "./snapshot";

type Row = { seq: number; type: string; data: unknown };

function todoRow(
  seq: number,
  args: Record<string, unknown>,
  result = "ok",
): Row {
  return {
    seq,
    type: "item/completed",
    data: {
      item: {
        type: "toolCall",
        tool: "todo",
        status: "completed",
        arguments: args,
        result,
      },
    },
  };
}

const teaList: Row[] = [
  todoRow(24, {
    action: "create",
    tasks: [{ subject: "Boil water" }, { subject: "Warm the teapot" }],
  }),
  todoRow(28, { action: "update", id: 1, status: "completed" }),
];

function fakeBb(
  pages: Row[][] | ((call: number, afterSeq?: string) => Row[]),
  pageSize = 100,
) {
  const limits: string[] = [];
  const types: unknown[] = [];
  const afterSeqs: (string | undefined)[] = [];
  let call = 0;
  const bb = {
    sdk: {
      threads: {
        events: {
          async list({
            limit,
            types: requestedTypes,
            afterSeq,
          }: {
            limit: string;
            types?: unknown;
            afterSeq?: string;
          }) {
            limits.push(limit);
            types.push(requestedTypes);
            afterSeqs.push(afterSeq);
            const rows =
              typeof pages === "function"
                ? pages(call, afterSeq)
                : (pages[call] ?? []);
            call += 1;
            return rows.slice(0, Number(limit) || pageSize);
          },
        },
      },
    },
  };
  return {
    bb: bb as unknown as BbPluginApi,
    limits,
    types,
    afterSeqs,
    calls: () => call,
  };
}

/** A thread whose event log the fake pages the way BB does. */
function liveThread(
  rows: () => Row[],
  mode: "exclusive" | "always" = "exclusive",
) {
  const calls: { limit: string; afterSeq?: string; order?: string }[] = [];
  const bb = {
    sdk: {
      threads: {
        events: {
          async list({
            limit,
            afterSeq,
            order,
          }: {
            limit: string;
            afterSeq?: string;
            order?: "asc" | "desc";
          }) {
            calls.push({ limit, afterSeq, order });
            const from = afterSeq ? Number(afterSeq) : Number.NEGATIVE_INFINITY;
            const visible =
              mode === "exclusive"
                ? rows().filter((row) => row.seq > from)
                : rows();
            const ordered = order === "desc" ? [...visible].reverse() : visible;
            return ordered.slice(0, Number(limit));
          },
        },
      },
    },
  };
  return { bb: bb as unknown as BbPluginApi, calls };
}

describe("snapshotForThread", () => {
  it("never asks for more than BB's 100-event page limit", async () => {
    const { bb, limits, types } = fakeBb([]);
    await snapshotForThread(bb, "thr_test");
    expect(limits).toEqual(["100"]);
    expect(types).toEqual([["item/completed"]]);
  });

  it("pages with afterSeq until a short page", async () => {
    const pages: Row[][] = [
      Array.from({ length: 100 }, (_, index) =>
        todoRow(index + 1, { action: "create", subject: `T${index}` }),
      ),
      [todoRow(101, { action: "create", subject: "last" })],
    ];
    const { bb, afterSeqs, calls } = fakeBb(pages);
    const { items } = await snapshotForThread(bb, "thr_test");
    expect(calls()).toBe(2);
    expect(afterSeqs).toEqual([undefined, "100"]);
    expect(items).toHaveLength(101);
    expect(items.at(-1)?.text).toBe("last");
  });

  it("ignores other tools, failed calls and non-completion events", async () => {
    const { bb } = fakeBb([
      [
        todoRow(1, { action: "create", subject: "kept" }),
        todoRow(2, { action: "create", subject: "failed call" }, "Error: nope"),
        {
          seq: 3,
          type: "item/completed",
          data: {
            item: {
              type: "toolCall",
              tool: "bash",
              status: "completed",
              arguments: { command: "ls" },
            },
          },
        },
        {
          seq: 4,
          type: "item/completed",
          data: {
            item: {
              type: "toolCall",
              tool: "todo",
              status: "running",
              arguments: { action: "create", subject: "x" },
            },
          },
        },
        { seq: 5, type: "thread/updated", data: {} },
      ],
    ]);
    const { items } = await snapshotForThread(bb, "thr_test");
    expect(items.map((item) => item.text)).toEqual(["kept"]);
  });

  it("drops deleted tasks and keeps in-progress state", async () => {
    const { bb } = fakeBb([
      [
        todoRow(1, { action: "create", subject: "A" }),
        todoRow(2, { action: "create", subject: "B" }),
        todoRow(3, {
          action: "update",
          id: 1,
          status: "in_progress",
          activeForm: "doing A",
        }),
        todoRow(4, { action: "delete", id: 2 }),
      ],
    ]);
    const { items } = await snapshotForThread(bb, "thr_test");
    expect(items).toEqual([
      { id: "1", text: "A", activeForm: "doing A", status: "in_progress" },
    ]);
  });

  it("stops at the page cap", async () => {
    const { bb, calls } = fakeBb((call) =>
      Array.from({ length: 100 }, (_, index) => ({
        seq: call * 100 + index + 1,
        type: "thread/updated",
        data: {},
      })),
    );
    const { items } = await snapshotForThread(bb, "thr_test");
    expect(items).toEqual([]);
    expect(calls()).toBe(200);
  });
});

describe("createTodoSnapshots", () => {
  it("asks one question instead of re-reading history once cached", async () => {
    const thread = liveThread(() => teaList);
    const snapshots = createTodoSnapshots(thread.bb);

    const first = await snapshots.get("thr_test");
    expect(first.items).toHaveLength(2);
    expect(first.items[0].status).toBe("completed");

    const second = await snapshots.get("thr_test");
    expect(second.items).toEqual(first.items);
    expect(thread.calls).toHaveLength(2);
    expect(thread.calls[0]).toMatchObject({ limit: "100" });
    expect(thread.calls[1]).toMatchObject({ limit: "1", order: "desc" });
  });

  it("picks up new events without re-reading history", async () => {
    let rows = [...teaList];
    const thread = liveThread(() => rows);
    const snapshots = createTodoSnapshots(thread.bb);

    await snapshots.get("thr_test");
    rows = [...rows, todoRow(31, { action: "create", subject: "Pour" })];
    const after = await snapshots.get("thr_test");

    expect(after.items.map((item) => item.text)).toEqual([
      "Boil water",
      "Warm the teapot",
      "Pour",
    ]);
    expect(thread.calls).toHaveLength(3);
    expect(thread.calls[2]).toMatchObject({ afterSeq: "28" });
  });

  it("does not duplicate tasks when the API ignores afterSeq", async () => {
    const thread = liveThread(() => teaList, "always");
    const snapshots = createTodoSnapshots(thread.bb);

    const first = await snapshots.get("thr_test");
    const second = await snapshots.get("thr_test");
    const third = await snapshots.get("thr_test");

    expect(second.items).toEqual(first.items);
    expect(third.items).toEqual(first.items);
    expect(third.items).toHaveLength(2);
  });

  it("starts over when the log is rewritten under the cursor", async () => {
    let rows = [...teaList];
    const thread = liveThread(() => rows);
    const snapshots = createTodoSnapshots(thread.bb);

    await snapshots.get("thr_test");
    rows = [
      todoRow(1, { action: "create", subject: "Only" }),
      todoRow(2, { action: "create", subject: "Two" }),
    ];
    const after = await snapshots.get("thr_test");

    expect(after.items.map((item) => item.text)).toEqual(["Only", "Two"]);
  });

  it("caches each thread separately", async () => {
    const threads: Record<string, Row[]> = {
      thr_a: [todoRow(1, { action: "create", subject: "A" })],
      thr_b: [todoRow(1, { action: "create", subject: "B" })],
    };
    const seen: string[] = [];
    const bb = {
      sdk: {
        threads: {
          events: {
            async list({
              threadId,
              limit,
              afterSeq,
              order,
            }: {
              threadId: string;
              limit: string;
              afterSeq?: string;
              order?: "asc" | "desc";
            }) {
              seen.push(threadId);
              const from = afterSeq
                ? Number(afterSeq)
                : Number.NEGATIVE_INFINITY;
              const rows = threads[threadId].filter((row) => row.seq > from);
              const ordered = order === "desc" ? [...rows].reverse() : rows;
              return ordered.slice(0, Number(limit));
            },
          },
        },
      },
    } as unknown as BbPluginApi;
    const snapshots = createTodoSnapshots(bb);

    expect((await snapshots.get("thr_a")).items[0].text).toBe("A");
    expect((await snapshots.get("thr_b")).items[0].text).toBe("B");
    expect((await snapshots.get("thr_a")).items[0].text).toBe("A");
    expect(seen.filter((id) => id === "thr_a")).toHaveLength(2);
  });
});
