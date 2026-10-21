import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  rpcContract,
  type DayReport,
  type DayThread,
  type ReadDayInput,
} from "./lib/contract.js";
import {
  buildReport,
  dayBounds,
  isValidTimeZone,
  type RawEvent,
} from "./lib/day.js";

const EVENT_TYPES = [
  "client/turn/requested",
  "turn/input/accepted",
  "turn/started",
  "turn/completed",
  "system/interaction/lifecycle",
] as const;

const PAGE_SIZE = 100;
const MAX_PAGES_PER_THREAD = 12;
const MAX_THREADS = 80;
const THREAD_LIST_LIMIT = 500;

type ThreadRow = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["list"]>
>[number];
type EventRow = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["events"]["list"]>
>[number];

function toDayThread(thread: ThreadRow): DayThread {
  return {
    id: thread.id,
    title: thread.title ?? thread.titleFallback ?? "(untitled)",
    projectId: thread.projectId,
    providerId: thread.providerId,
    parentThreadId: thread.parentThreadId,
    archived: thread.archivedAt !== null,
    createdAt: thread.createdAt,
  };
}

function interactionTitle(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "Question";
  const record = payload as Record<string, unknown>;
  if (typeof record.title === "string" && record.title.length > 0) {
    return record.title;
  }
  if (typeof record.kind === "string") return record.kind;
  return "Question";
}

function mapRow(row: EventRow): RawEvent | null {
  switch (row.type) {
    case "client/turn/requested": {
      const target = row.data.target.kind;
      if (
        target !== "new-turn" &&
        target !== "steer" &&
        target !== "auto" &&
        target !== "thread-start"
      ) {
        return null;
      }
      return {
        kind: "request",
        at: row.createdAt,
        threadId: row.threadId,
        requestId: row.data.requestId,
        initiator: row.data.initiator,
        inputKind: target,
        model: row.data.execution.model ?? null,
      };
    }
    case "turn/input/accepted": {
      if (row.scope.kind !== "turn") return null;
      return {
        kind: "accepted",
        at: row.createdAt,
        threadId: row.threadId,
        requestId: row.data.clientRequestId,
        turnId: row.scope.turnId,
      };
    }
    case "turn/started": {
      if (row.scope.kind !== "turn") return null;
      return {
        kind: "turn-start",
        at: row.createdAt,
        threadId: row.threadId,
        turnId: row.scope.turnId,
      };
    }
    case "turn/completed": {
      if (row.scope.kind !== "turn") return null;
      const status = row.data.status;
      if (
        status !== "completed" &&
        status !== "failed" &&
        status !== "interrupted"
      ) {
        return null;
      }
      return {
        kind: "turn-end",
        at: row.createdAt,
        threadId: row.threadId,
        turnId: row.scope.turnId,
        status,
      };
    }
    case "system/interaction/lifecycle": {
      const interaction = row.data.interaction;
      return {
        kind: "question",
        at: row.createdAt,
        threadId: row.threadId,
        interactionId: interaction.id,
        status: interaction.status,
        title: interactionTitle(interaction.payload),
        resolutionKind:
          interaction.resolution !== null && "kind" in interaction.resolution
            ? interaction.resolution.kind
            : null,
        statusReason: interaction.statusReason,
      };
    }
    default:
      return null;
  }
}

async function readThreadEvents(
  bb: BbPluginApi,
  threadId: string,
  dayStart: number,
): Promise<{ events: RawEvent[]; truncated: boolean }> {
  const seen = new Map<string, RawEvent>();
  let beforeSeq: string | undefined;
  for (let page = 0; page < MAX_PAGES_PER_THREAD; page += 1) {
    const rows = await bb.sdk.threads.events.list({
      threadId,
      types: EVENT_TYPES,
      limit: String(PAGE_SIZE),
      order: "desc",
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
    });
    if (rows.length === 0) {
      return { events: [...seen.values()], truncated: false };
    }
    let oldest: EventRow | undefined;
    for (const row of rows) {
      const mapped = mapRow(row);
      if (mapped !== null) seen.set(row.id, mapped);
      if (oldest === undefined || row.seq < oldest.seq) oldest = row;
    }
    if (oldest === undefined || oldest.createdAt < dayStart) {
      return { events: [...seen.values()], truncated: false };
    }
    if (rows.length < PAGE_SIZE) {
      return { events: [...seen.values()], truncated: false };
    }
    beforeSeq = String(oldest.seq);
  }
  return { events: [...seen.values()], truncated: true };
}

async function readDay(
  bb: BbPluginApi,
  input: ReadDayInput,
): Promise<DayReport> {
  const timezone = isValidTimeZone(input.timezone) ? input.timezone : "UTC";
  const { start, end } = dayBounds(input.day, timezone);

  const listed = await bb.sdk.threads.list({
    includeHidden: input.includeHidden ?? true,
    limit: THREAD_LIST_LIMIT,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
  });

  const candidates = listed
    .filter(
      (thread) =>
        thread.deletedAt === null &&
        thread.createdAt < end &&
        thread.updatedAt >= start,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_THREADS);

  const truncatedThreads: string[] = [];
  const events: RawEvent[] = [];
  for (const thread of candidates) {
    const result = await readThreadEvents(bb, thread.id, start);
    if (result.truncated) truncatedThreads.push(thread.id);
    events.push(...result.events);
  }

  return buildReport({
    day: input.day,
    timezone,
    threads: candidates.map(toDayThread),
    events,
    truncatedThreads,
  });
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("attention: loaded");

  bb.rpc.register(rpcContract, {
    read_day: (input) => readDay(bb, input),
  });

  bb.onDispose(() => {
    bb.log.info("attention: disposed");
  });
}
