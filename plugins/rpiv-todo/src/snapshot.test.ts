import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { describe, expect, it } from "vitest";
import { snapshotForThread } from "./snapshot";

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
