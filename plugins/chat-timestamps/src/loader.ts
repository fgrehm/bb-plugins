import type { Cursor, MessageTime } from "./contract";

export type CursorEntry = {
  threadId: string;
  cursor: Cursor | null;
};

export type NewestPages = {
  messages: MessageTime[];
  cursors: CursorEntry[];
};

export type OlderPage = {
  messages: MessageTime[];
  cursor: Cursor | null;
};

export type LoaderOptions = {
  fetchNewest(threadIds: string[]): Promise<NewestPages>;
  fetchOlder(threadId: string, cursor: Cursor): Promise<OlderPage>;
  onUpdate(times: ReadonlyMap<string, MessageTime>): void;
  maxCachedTimes?: number;
};

export type BackfillOutcome = "advanced" | "exhausted" | "in-flight" | "failed";

const DEFAULT_MAX_CACHED_TIMES = 20_000;

/**
 * Holds message times for the visible threads and walks older timeline pages
 * on demand. Cursors only move towards older rows: a polling refresh never
 * rewinds a walk that already happened, and a failed request changes nothing,
 * so the next refresh retries it.
 */
export function createTimestampLoader(options: LoaderOptions) {
  const times = new Map<string, MessageTime>();
  const cursors = new Map<
    string,
    { cursor: Cursor | null; exhausted: boolean }
  >();
  const backfills = new Set<string>();
  const maxCachedTimes = options.maxCachedTimes ?? DEFAULT_MAX_CACHED_TIMES;
  let newestInFlight = false;

  const remember = (messages: readonly MessageTime[]) => {
    for (const message of messages) {
      times.delete(message.id);
      times.set(message.id, message);
    }
    while (times.size > maxCachedTimes) {
      const oldest = times.keys().next().value;
      if (oldest === undefined) break;
      times.delete(oldest);
    }
  };

  const seedCursor = (threadId: string, cursor: Cursor | null) => {
    if (cursors.has(threadId)) return;
    cursors.set(threadId, { cursor, exhausted: cursor === null });
  };

  return {
    getTimes(): ReadonlyMap<string, MessageTime> {
      return times;
    },
    hasOlder(threadId: string): boolean {
      const state = cursors.get(threadId);
      return Boolean(state && !state.exhausted && state.cursor);
    },
    /** Loads the newest timeline page for each thread. */
    async refresh(threadIds: readonly string[]): Promise<boolean> {
      if (threadIds.length === 0 || newestInFlight) return false;
      newestInFlight = true;
      try {
        const page = await options.fetchNewest([...threadIds]);
        remember(page.messages);
        for (const entry of page.cursors) {
          seedCursor(entry.threadId, entry.cursor);
        }
        options.onUpdate(times);
        return true;
      } catch {
        return false;
      } finally {
        newestInFlight = false;
      }
    },
    /** Loads the next older timeline page for one thread. */
    async backfill(threadId: string): Promise<BackfillOutcome> {
      const state = cursors.get(threadId);
      if (!state || state.cursor === null) return "exhausted";
      if (backfills.has(threadId)) return "in-flight";
      backfills.add(threadId);
      try {
        const page = await options.fetchOlder(threadId, state.cursor);
        remember(page.messages);
        cursors.set(threadId, {
          cursor: page.cursor,
          exhausted: page.cursor === null,
        });
        options.onUpdate(times);
        return page.cursor === null ? "exhausted" : "advanced";
      } catch {
        return "failed";
      } finally {
        backfills.delete(threadId);
      }
    },
  };
}

export type TimestampLoader = ReturnType<typeof createTimestampLoader>;
