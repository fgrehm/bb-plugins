import { describe, expect, it, vi } from "vitest";
import type { Cursor, MessageTime } from "./contract";
import {
  createTimestampLoader,
  type NewestPages,
  type OlderPage,
} from "./loader";

const cursor = (anchorSeq: number): Cursor => ({
  anchorSeq: String(anchorSeq),
  anchorId: `row-${anchorSeq}`,
});

const message = (id: string, createdAt: number): MessageTime => ({
  id,
  createdAt,
  direction: "received",
});

function newestPage(
  threadId: string,
  messages: MessageTime[],
  nextCursor: Cursor | null,
): NewestPages {
  return { messages, cursors: [{ threadId, cursor: nextCursor }] };
}

describe("createTimestampLoader", () => {
  it("keeps the newest-page cursor and loads older pages until exhausted", async () => {
    const fetchNewest = vi
      .fn()
      .mockResolvedValue(newestPage("a", [message("m3", 3)], cursor(3)));
    const fetchOlder = vi
      .fn<() => Promise<OlderPage>>()
      .mockResolvedValueOnce({
        messages: [message("m2", 2)],
        cursor: cursor(2),
      })
      .mockResolvedValueOnce({ messages: [message("m1", 1)], cursor: null });
    const onUpdate = vi.fn();
    const loader = createTimestampLoader({
      fetchNewest,
      fetchOlder,
      onUpdate,
    });

    await expect(loader.refresh(["a"])).resolves.toBe(true);
    expect(loader.hasOlder("a")).toBe(true);
    expect(fetchOlder).not.toHaveBeenCalled();

    await expect(loader.backfill("a")).resolves.toBe("advanced");
    expect(fetchOlder).toHaveBeenLastCalledWith("a", cursor(3));
    await expect(loader.backfill("a")).resolves.toBe("exhausted");
    expect(fetchOlder).toHaveBeenLastCalledWith("a", cursor(2));
    await expect(loader.backfill("a")).resolves.toBe("exhausted");

    expect(loader.getTimes().size).toBe(3);
    expect(loader.hasOlder("a")).toBe(false);
    expect(onUpdate).toHaveBeenCalledTimes(3);
  });

  it("does not rewind an older-page walk when polling refreshes", async () => {
    const fetchNewest = vi
      .fn()
      .mockResolvedValue(newestPage("a", [message("m3", 3)], cursor(3)));
    const fetchOlder = vi
      .fn()
      .mockResolvedValue({ messages: [message("m2", 2)], cursor: cursor(2) });
    const loader = createTimestampLoader({
      fetchNewest,
      fetchOlder,
      onUpdate: vi.fn(),
    });

    await loader.refresh(["a"]);
    await loader.backfill("a");
    await loader.refresh(["a"]);
    await loader.backfill("a");

    expect(fetchOlder).toHaveBeenLastCalledWith("a", cursor(2));
  });

  it("retries the newest page after a failed request", async () => {
    const fetchNewest = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(newestPage("a", [message("m1", 1)], null));
    const loader = createTimestampLoader({
      fetchNewest,
      fetchOlder: vi.fn(),
      onUpdate: vi.fn(),
    });

    await expect(loader.refresh(["a"])).resolves.toBe(false);
    expect(loader.hasOlder("a")).toBe(false);

    await expect(loader.refresh(["a"])).resolves.toBe(true);
    expect(fetchNewest).toHaveBeenCalledTimes(2);
    expect(loader.getTimes().get("m1")).toEqual(message("m1", 1));
  });

  it("ignores a refresh while one is in flight, then loads the new thread", async () => {
    let resolveFirst: (page: NewestPages) => void = () => undefined;
    const fetchNewest = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<NewestPages>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(newestPage("b", [message("mb", 2)], null));
    const loader = createTimestampLoader({
      fetchNewest,
      fetchOlder: vi.fn(),
      onUpdate: vi.fn(),
    });

    const first = loader.refresh(["a"]);
    await expect(loader.refresh(["b"])).resolves.toBe(false);
    expect(fetchNewest).toHaveBeenCalledTimes(1);

    resolveFirst(newestPage("a", [message("ma", 1)], null));
    await first;

    await expect(loader.refresh(["b"])).resolves.toBe(true);
    expect(fetchNewest).toHaveBeenLastCalledWith(["b"]);
    expect(loader.getTimes().has("mb")).toBe(true);
  });

  it("retries an older page from the same cursor after a failure", async () => {
    let failures = 1;
    const fetchOlder = vi.fn(async (): Promise<OlderPage> => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("offline");
      }
      return { messages: [message("m1", 1)], cursor: null };
    });
    const loader = createTimestampLoader({
      fetchNewest: vi
        .fn()
        .mockResolvedValue(newestPage("a", [message("m2", 2)], cursor(2))),
      fetchOlder,
      onUpdate: vi.fn(),
    });

    await loader.refresh(["a"]);
    await expect(loader.backfill("a")).resolves.toBe("failed");
    expect(loader.hasOlder("a")).toBe(true);
    await expect(loader.backfill("a")).resolves.toBe("exhausted");
    expect(fetchOlder).toHaveBeenLastCalledWith("a", cursor(2));
  });

  it("keeps a thread without older rows out of the walk", async () => {
    const loader = createTimestampLoader({
      fetchNewest: vi
        .fn()
        .mockResolvedValue(newestPage("a", [message("m1", 1)], null)),
      fetchOlder: vi.fn(),
      onUpdate: vi.fn(),
    });

    await loader.refresh(["a"]);
    expect(loader.hasOlder("a")).toBe(false);
    await expect(loader.backfill("a")).resolves.toBe("exhausted");
  });
});
