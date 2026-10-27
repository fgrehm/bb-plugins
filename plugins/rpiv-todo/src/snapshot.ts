import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { applyTodoCall } from "./replay";
import {
  EMPTY_STATE,
  TODO_TEXT_MAX_LENGTH,
  type Task,
  type TaskState,
  type TodoItem,
} from "./types";

// BB 0.47 rejects any thread event page above 100 (`Thread event limit cannot
// exceed 100`), so page at the cap and keep the original 20,000-event bound.
const EVENT_PAGE = 100;
const EVENT_PAGE_CAP = 200;

// Each cached thread keeps its replayed state and the last sequence it has
// consumed, so a poll asks for what is new instead of the whole timeline.
const CACHED_THREADS = 64;

interface EventRow {
  seq?: number;
  type: string;
  data: unknown;
}

interface CacheEntry {
  state: TaskState;
  lastSeq: number;
}

interface ListOptions {
  afterSeq?: string;
  order?: "asc" | "desc";
  limit?: string;
}

function trimAndTruncate(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= TODO_TEXT_MAX_LENGTH
    ? trimmed
    : trimmed.slice(0, TODO_TEXT_MAX_LENGTH);
}

export function itemsFromTasks(tasks: readonly Task[]): TodoItem[] {
  const items: TodoItem[] = [];
  for (const task of tasks) {
    if (task.status === "deleted") continue;
    const text = trimAndTruncate(task.subject);
    if (!text) continue;
    const activeForm = task.activeForm ? trimAndTruncate(task.activeForm) : "";
    items.push({
      id: String(task.id),
      text,
      status: task.status,
      ...(activeForm ? { activeForm } : {}),
    });
  }
  return items;
}

function todoArgsFromEvent(row: EventRow): Record<string, unknown> | null {
  if (row.type !== "item/completed") return null;
  const data = row.data;
  if (!data || typeof data !== "object" || !("item" in data)) return null;
  const item = (data as { item?: unknown }).item;
  if (!item || typeof item !== "object") return null;
  const toolCall = item as {
    type?: unknown;
    tool?: unknown;
    status?: unknown;
    arguments?: unknown;
    result?: unknown;
  };
  if (toolCall.type !== "toolCall" || toolCall.tool !== "todo") return null;
  if (toolCall.status !== "completed") return null;
  if (
    typeof toolCall.result === "string" &&
    toolCall.result.startsWith("Error:")
  )
    return null;
  if (
    !toolCall.arguments ||
    typeof toolCall.arguments !== "object" ||
    Array.isArray(toolCall.arguments)
  ) {
    return null;
  }
  return toolCall.arguments as Record<string, unknown>;
}

function seqOf(row: EventRow): number {
  return typeof row.seq === "number" ? row.seq : Number(row.seq);
}

/**
 * Read the to-do list of a thread, replaying only the `todo` calls it has not
 * seen yet. One bounded cache per thread; a rewritten log restarts the replay.
 */
export function createTodoSnapshots(bb: BbPluginApi) {
  const cache = new Map<string, CacheEntry>();

  async function list(threadId: string, options: ListOptions = {}) {
    return (await bb.sdk.threads.events.list({
      threadId,
      types: ["item/completed"],
      limit: options.limit ?? String(EVENT_PAGE),
      ...(options.afterSeq !== undefined ? { afterSeq: options.afterSeq } : {}),
      ...(options.order ? { order: options.order } : {}),
    })) as EventRow[];
  }

  async function replay(
    threadId: string,
    start: CacheEntry | undefined,
  ): Promise<{ state: TaskState; lastSeq?: number }> {
    let state = start?.state ?? EMPTY_STATE;
    let cursor = start?.lastSeq;

    for (let pageIndex = 0; pageIndex < EVENT_PAGE_CAP; pageIndex += 1) {
      const page = await list(
        threadId,
        cursor !== undefined ? { afterSeq: String(cursor) } : {},
      );
      if (page.length === 0) break;

      for (const row of page) {
        const seq = seqOf(row);
        // Defensive: never apply a row the cursor already covers.
        if (cursor !== undefined && Number.isFinite(seq) && seq <= cursor)
          continue;
        const args = todoArgsFromEvent(row);
        if (!args) continue;
        state = applyTodoCall(state, args) ?? state;
      }

      const last = page.at(-1);
      const lastSeq = last ? seqOf(last) : Number.NaN;
      if (!Number.isFinite(lastSeq)) break;
      cursor = lastSeq;
      if (page.length < EVENT_PAGE) break;
    }

    return { state, lastSeq: cursor };
  }

  function remember(threadId: string, entry: CacheEntry) {
    cache.delete(threadId);
    cache.set(threadId, entry);
    while (cache.size > CACHED_THREADS) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  return {
    async get(threadId: string): Promise<{ items: TodoItem[] }> {
      const cached = cache.get(threadId);

      // One-row probe: is there anything newer, and is the log still the one
      // this cache was built from?
      if (cached) {
        const newestPage = await list(threadId, { limit: "1", order: "desc" });
        const newest = newestPage[0] ? seqOf(newestPage[0]) : Number.NaN;
        if (!Number.isFinite(newest)) {
          cache.delete(threadId);
          return { items: [] };
        }
        if (newest === cached.lastSeq) {
          return { items: itemsFromTasks(cached.state.tasks) };
        }
        if (newest < cached.lastSeq) cache.delete(threadId);
      }

      const next = await replay(threadId, cache.get(threadId));
      if (next.lastSeq !== undefined)
        remember(threadId, { state: next.state, lastSeq: next.lastSeq });
      return { items: itemsFromTasks(next.state.tasks) };
    },
  };
}

/** One-shot read with no cache, for tests and callers with no lifetime. */
export async function snapshotForThread(
  bb: BbPluginApi,
  threadId: string,
): Promise<{ items: TodoItem[] }> {
  return createTodoSnapshots(bb).get(threadId);
}
