import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  cursorSchema,
  rpcContract,
  type Cursor,
  type MessageTime,
} from "./src/contract";

type TimelineNode = {
  id?: string;
  kind?: string;
  role?: string;
  initiator?: string;
  createdAt?: number;
  children?: TimelineNode[] | null;
  childRows?: TimelineNode[] | null;
};

type TimelinePageInfo = {
  olderCursor?: { anchorSeq: number; anchorId: string } | null;
};

export function collectMessageTimes(
  rows: readonly TimelineNode[] | undefined,
  into = new Map<string, MessageTime>(),
): Map<string, MessageTime> {
  for (const row of rows ?? []) {
    if (
      row.kind === "conversation" &&
      (row.role === "user" || row.role === "assistant") &&
      typeof row.id === "string" &&
      typeof row.createdAt === "number"
    ) {
      into.set(row.id, {
        id: row.id,
        createdAt: row.createdAt,
        direction:
          row.role === "user" && row.initiator === "user" ? "sent" : "received",
      });
    }
    collectMessageTimes(row.children ?? undefined, into);
    collectMessageTimes(row.childRows ?? undefined, into);
  }
  return into;
}

/** Timeline args that page immediately before a cursor. */
export function pageRequest(cursor?: Cursor | null): {
  beforeAnchorSeq?: string;
  beforeAnchorId?: string;
} {
  if (!cursor) return {};
  return {
    beforeAnchorSeq: cursor.anchorSeq,
    beforeAnchorId: cursor.anchorId,
  };
}

/** The cursor for the next older page, or null when history is exhausted. */
export function pageCursor(page: TimelinePageInfo | undefined): Cursor | null {
  const older = page?.olderCursor;
  if (!older) return null;
  return cursorSchema.parse({
    anchorSeq: String(older.anchorSeq),
    anchorId: older.anchorId,
  });
}

export default function plugin(bb: BbPluginApi) {
  const readPage = async (threadId: string, cursor?: Cursor | null) => {
    const timeline = await bb.sdk.threads.timeline({
      threadId,
      includeNestedRows: "true",
      ...pageRequest(cursor),
    });
    return {
      messages: Array.from(
        collectMessageTimes(timeline.rows as TimelineNode[]).values(),
      ),
      cursor: pageCursor(timeline.timelinePage),
    };
  };

  bb.rpc.register(rpcContract, {
    async messageTimes({ threadIds }) {
      const messages = new Map<string, MessageTime>();
      const cursors: Array<{ threadId: string; cursor: Cursor | null }> = [];

      for (const threadId of new Set(threadIds)) {
        try {
          const page = await readPage(threadId);
          for (const message of page.messages) {
            messages.set(message.id, message);
          }
          cursors.push({ threadId, cursor: page.cursor });
        } catch {
          bb.log.warn(
            `chat-timestamps: could not read the newest timeline page for ${threadId}`,
          );
        }
      }

      return { messages: Array.from(messages.values()), cursors };
    },

    async olderMessageTimes({ threadId, cursor }) {
      const page = await readPage(threadId, cursor);
      return { messages: page.messages, cursor: page.cursor };
    },
  });
}
