import { expect, test } from "vitest";
import { collectMessageTimes, pageCursor, pageRequest } from "./server";

test("collects user, assistant, and nested agent message times", () => {
  const times = collectMessageTimes([
    {
      id: "sent",
      kind: "conversation",
      role: "user",
      initiator: "user",
      createdAt: 1,
    },
    {
      id: "turn",
      kind: "turn",
      children: [
        {
          id: "reply",
          kind: "conversation",
          role: "assistant",
          createdAt: 2,
        },
        {
          id: "delegation",
          kind: "delegation",
          childRows: [
            {
              id: "inbound",
              kind: "conversation",
              role: "user",
              initiator: "agent",
              createdAt: 3,
            },
          ],
        },
      ],
    },
    { id: "tool", kind: "tool", createdAt: 4 },
  ]);

  expect(Array.from(times.values())).toEqual([
    { id: "sent", createdAt: 1, direction: "sent" },
    { id: "reply", createdAt: 2, direction: "received" },
    { id: "inbound", createdAt: 3, direction: "received" },
  ]);
});

test("ignores conversation rows without a message id or time", () => {
  const times = collectMessageTimes([
    { kind: "conversation", role: "assistant", createdAt: 1 },
    { id: "missing-time", kind: "conversation", role: "assistant" },
    { id: "system", kind: "conversation", role: "system", createdAt: 2 },
  ]);

  expect(Array.from(times.values())).toEqual([]);
});

test("maps timeline page cursors to the next older page request", () => {
  expect(
    pageCursor({ olderCursor: { anchorSeq: 42, anchorId: "row-42" } }),
  ).toEqual({ anchorSeq: "42", anchorId: "row-42" });
  expect(pageCursor({ olderCursor: null })).toBeNull();
  expect(pageCursor({})).toBeNull();

  expect(pageRequest({ anchorSeq: "41", anchorId: "row-41" })).toEqual({
    beforeAnchorSeq: "41",
    beforeAnchorId: "row-41",
  });
  expect(pageRequest()).toEqual({});
  expect(pageRequest(null)).toEqual({});
});
