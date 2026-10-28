// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { MessageTime } from "./contract";
import { clearDecorations, decorate, hasUndecoratedMessageRows } from "./dom";

const TIME_ATTR = "data-bb-chat-timestamp";

const messageRow = (id: string, classes = "group/message") => `
  <div data-timeline-row-id="${id}">
    <div class="${classes}">
      <div class="relative w-full">
        <div class="absolute" title="Original title"></div>
      </div>
    </div>
  </div>
`;

const time = (direction: "sent" | "received"): MessageTime => ({
  id: "m1",
  createdAt: Date.now() - 5 * 60_000,
  direction,
});

describe("decorate", () => {
  beforeEach(() => {
    document.body.innerHTML = messageRow("m1");
  });

  it("adds the relative time and an exact sent time to the action strip", () => {
    decorate(new Map([["m1", time("sent")]]));

    const host = document.querySelector<HTMLElement>(".absolute");
    expect(host?.getAttribute(TIME_ATTR)).toBe("5m ago");
    expect(host?.title).toMatch(/^Sent /);
  });

  it("labels agent and inbound messages as received", () => {
    decorate(new Map([["m1", time("received")]]));

    const host = document.querySelector<HTMLElement>(".absolute");
    expect(host?.title).toMatch(/^Received /);
  });

  it("restores the previous title and drops times for unknown rows", () => {
    decorate(new Map([["m1", time("sent")]]));
    decorate(new Map());

    const host = document.querySelector<HTMLElement>(".absolute");
    expect(host?.hasAttribute(TIME_ATTR)).toBe(false);
    expect(host?.title).toBe("Original title");
  });

  it("clears every decoration on teardown", () => {
    decorate(new Map([["m1", time("sent")]]));
    clearDecorations();

    expect(document.querySelector(`[${TIME_ATTR}]`)).toBeNull();
    expect(document.querySelector<HTMLElement>(".absolute")?.title).toBe(
      "Original title",
    );
  });
});

describe("hasUndecoratedMessageRows", () => {
  it("reports conversation rows whose time is missing", () => {
    document.body.innerHTML = messageRow("m1");
    expect(hasUndecoratedMessageRows(new Map())).toBe(true);
    expect(hasUndecoratedMessageRows(new Map([["m1", time("sent")]]))).toBe(
      false,
    );
  });

  it("ignores timeline rows that are not conversation messages", () => {
    document.body.innerHTML = `
      <div data-timeline-row-id="tool">
        <div class="group/timeline-row"><button>tool output</button></div>
      </div>
    `;
    expect(hasUndecoratedMessageRows(new Map())).toBe(false);
  });
});
