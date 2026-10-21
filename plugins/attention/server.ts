import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  rpcContract,
  type DayReport,
  type DayThread,
  type ListDaysInput,
  type ListDaysResult,
  type RangeReport,
  type ReadDayInput,
  type ReadRangeInput,
  type ReadFamilyInput,
  type FamilyReport,
} from "./lib/contract.js";
import {
  buildReport,
  dayBounds,
  dayStringAt,
  isValidTimeZone,
  type RawEvent,
} from "./lib/day.js";
import { threadSummaries } from "./lib/insights.js";
import { collectFamily } from "./lib/family.js";
import { addDays } from "./lib/calendar.js";

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
const MAX_DAY_SCAN_PAGES = 8;
const DAY_SCAN_CONCURRENCY = 6;
const DAYS_CACHE_TTL_MS = 5 * 60_000;
const REPORT_CACHE_TTL_MS = 5 * 60_000;
const REPORT_CACHE_MAX = 40;
const MAX_RANGE_DAYS = 62;
const MAX_RANGE_THREADS = 250;
const RANGE_EVENT_PAGES = 30;
const QUESTION_LOOKBACK_MS = 7 * 86_400_000;
const QUESTION_LOOKBACK_PAGES = 3;

const daysCache = new Map<string, { at: number; days: string[] }>();
const reportCache = new Map<string, { at: number; value: DayReport }>();
const rangeCache = new Map<string, { at: number; value: RangeReport }>();

function cached<T>(
  store: Map<string, { at: number; value: T }>,
  key: string,
  enabled: boolean,
): T | undefined {
  if (!enabled) return undefined;
  const entry = store.get(key);
  if (entry === undefined) return undefined;
  if (Date.now() - entry.at >= REPORT_CACHE_TTL_MS) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function remember<T>(
  store: Map<string, { at: number; value: T }>,
  key: string,
  value: T,
  enabled: boolean,
): void {
  if (!enabled) return;
  if (store.size >= REPORT_CACHE_MAX) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { at: Date.now(), value });
}

type ThreadRow = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["list"]>
>[number];
type EventRow = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["events"]["list"]>
>[number];

function toDayThread(
  thread: Pick<
    ThreadRow,
    | "id"
    | "title"
    | "titleFallback"
    | "projectId"
    | "providerId"
    | "parentThreadId"
    | "archivedAt"
    | "visibility"
    | "createdAt"
  >,
): DayThread {
  return {
    id: thread.id,
    title: thread.title ?? thread.titleFallback ?? "(untitled)",
    projectId: thread.projectId,
    providerId: thread.providerId,
    parentThreadId: thread.parentThreadId,
    archived: thread.archivedAt !== null,
    hidden: thread.visibility !== "visible",
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
        seq: row.seq,
      };
    }
    default:
      return null;
  }
}

async function readThreadEvents(
  bb: BbPluginApi,
  threadId: string,
  rangeStart: number,
  maxPages = MAX_PAGES_PER_THREAD,
): Promise<{ events: RawEvent[]; truncated: boolean }> {
  const seen = new Map<string, RawEvent>();
  let beforeSeq: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
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
    if (oldest === undefined || oldest.createdAt < rangeStart) {
      return { events: [...seen.values()], truncated: false };
    }
    if (rows.length < PAGE_SIZE) {
      return { events: [...seen.values()], truncated: false };
    }
    beforeSeq = String(oldest.seq);
  }
  return { events: [...seen.values()], truncated: true };
}

async function addQuestionLookback(
  bb: BbPluginApi,
  events: RawEvent[],
  windowStart: number,
): Promise<void> {
  const byThread = new Map<string, RawEvent[]>();
  for (const event of events) {
    if (event.kind !== "question") continue;
    const list = byThread.get(event.threadId) ?? [];
    list.push(event);
    byThread.set(event.threadId, list);
  }

  for (const [threadId, threadEvents] of byThread) {
    const opened = new Set<string>();
    const closed = new Set<string>();
    for (const event of threadEvents) {
      if (event.kind !== "question") continue;
      if (event.status === "pending" || event.status === "resolving") {
        opened.add(event.interactionId);
      } else {
        closed.add(event.interactionId);
      }
    }
    const missing = new Set(
      [...closed].filter((interactionId) => !opened.has(interactionId)),
    );
    if (missing.size === 0) continue;

    const sequences = threadEvents.flatMap((event) =>
      event.kind === "question" && event.seq !== undefined ? [event.seq] : [],
    );
    let beforeSeq =
      sequences.length === 0 ? undefined : String(Math.min(...sequences));
    const floor = windowStart - QUESTION_LOOKBACK_MS;
    for (
      let page = 0;
      page < QUESTION_LOOKBACK_PAGES && missing.size > 0;
      page += 1
    ) {
      const rows = await bb.sdk.threads.events.list({
        threadId,
        types: ["system/interaction/lifecycle"],
        limit: String(PAGE_SIZE),
        order: "desc",
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
      });
      if (rows.length === 0) break;
      let oldest: EventRow | undefined;
      for (const row of rows) {
        if (oldest === undefined || row.seq < oldest.seq) oldest = row;
        if (row.type !== "system/interaction/lifecycle") continue;
        const interaction = row.data.interaction;
        if (!missing.has(interaction.id)) continue;
        if (
          interaction.status !== "pending" &&
          interaction.status !== "resolving"
        ) {
          continue;
        }
        events.push({
          kind: "question",
          at: row.createdAt,
          threadId,
          interactionId: interaction.id,
          status: interaction.status,
          title: interactionTitle(interaction.payload),
          resolutionKind: null,
          statusReason: interaction.statusReason,
          seq: row.seq,
        });
        missing.delete(interaction.id);
      }
      if (oldest === undefined || oldest.createdAt < floor) break;
      if (rows.length < PAGE_SIZE) break;
      beforeSeq = String(oldest.seq);
    }
  }
}

async function computeDay(
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
  await addQuestionLookback(bb, events, start);

  return buildReport({
    day: input.day,
    timezone,
    threads: candidates.map(toDayThread),
    events,
    truncatedThreads,
  });
}

function nextMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year ?? 1970, monthNumber ?? 1, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function mapLimited<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const index = next;
        next += 1;
        const item = items[index];
        if (item === undefined) return;
        await run(item);
      }
    },
  );
  await Promise.all(workers);
}

async function scanThreadDays(
  bb: BbPluginApi,
  threadId: string,
  monthStart: number,
  monthEnd: number,
  timezone: string,
  days: Set<string>,
): Promise<void> {
  let beforeSeq: string | undefined;
  for (let page = 0; page < MAX_DAY_SCAN_PAGES; page += 1) {
    const rows = await bb.sdk.threads.events.list({
      threadId,
      types: ["turn/started"],
      limit: String(PAGE_SIZE),
      order: "desc",
      ...(beforeSeq === undefined ? {} : { beforeSeq }),
    });
    if (rows.length === 0) return;
    let oldest: EventRow | undefined;
    for (const row of rows) {
      if (oldest === undefined || row.seq < oldest.seq) oldest = row;
      if (row.createdAt >= monthStart && row.createdAt < monthEnd) {
        days.add(dayStringAt(row.createdAt, timezone));
      }
    }
    if (oldest === undefined || oldest.createdAt < monthStart) return;
    if (rows.length < PAGE_SIZE) return;
    beforeSeq = String(oldest.seq);
  }
}

async function listDays(
  bb: BbPluginApi,
  input: ListDaysInput,
): Promise<ListDaysResult> {
  const timezone = isValidTimeZone(input.timezone) ? input.timezone : "UTC";
  const cacheKey = `${timezone}|${input.month}`;
  const currentMonth = dayStringAt(Date.now(), timezone).slice(0, 7);
  const cacheable = input.month !== currentMonth;
  const cached = daysCache.get(cacheKey);
  if (
    cacheable &&
    cached !== undefined &&
    Date.now() - cached.at < DAYS_CACHE_TTL_MS
  ) {
    return { days: cached.days };
  }

  const { start: monthStart } = dayBounds(`${input.month}-01`, timezone);
  const { start: monthEnd } = dayBounds(
    `${nextMonth(input.month)}-01`,
    timezone,
  );

  const listed = await bb.sdk.threads.list({
    includeHidden: true,
    limit: THREAD_LIST_LIMIT,
  });
  const candidates = listed.filter(
    (thread) =>
      thread.deletedAt === null &&
      thread.updatedAt >= monthStart &&
      thread.createdAt < monthEnd,
  );

  const days = new Set<string>();
  await mapLimited(candidates, DAY_SCAN_CONCURRENCY, (thread) =>
    scanThreadDays(bb, thread.id, monthStart, monthEnd, timezone, days),
  );

  const sorted = [...days].sort();
  if (cacheable) daysCache.set(cacheKey, { at: Date.now(), days: sorted });
  return { days: sorted };
}

async function readDay(
  bb: BbPluginApi,
  input: ReadDayInput,
): Promise<DayReport> {
  const timezone = isValidTimeZone(input.timezone) ? input.timezone : "UTC";
  const today = dayStringAt(Date.now(), timezone);
  const cacheable = !input.fresh && input.day !== today;
  const key = [
    timezone,
    input.day,
    input.projectId ?? "",
    input.includeHidden === false ? "0" : "1",
  ].join("|");
  const hit = cached(reportCache, key, cacheable);
  if (hit !== undefined) return hit;
  const report = await computeDay(bb, { ...input, timezone });
  remember(reportCache, key, report, cacheable);
  return report;
}

function nextDay(day: string): string {
  const next = new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000);
  return next.toISOString().slice(0, 10);
}

function enumerateDays(startDay: string, endDay: string): string[] {
  const days: string[] = [];
  let current = startDay;
  while (current <= endDay && days.length < MAX_RANGE_DAYS + 1) {
    days.push(current);
    current = nextDay(current);
  }
  return days;
}

async function computeRange(
  bb: BbPluginApi,
  input: ReadRangeInput,
): Promise<RangeReport> {
  const timezone = isValidTimeZone(input.timezone) ? input.timezone : "UTC";
  if (input.startDay > input.endDay) {
    throw new Error("The range start must not be after its end");
  }
  const days = enumerateDays(input.startDay, input.endDay);
  if (days.length > MAX_RANGE_DAYS) {
    throw new Error(`Ranges are limited to ${MAX_RANGE_DAYS} days`);
  }
  const { start } = dayBounds(input.startDay, timezone);
  const { start: end } = dayBounds(nextDay(input.endDay), timezone);

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
    .slice(0, MAX_RANGE_THREADS);

  const truncatedThreads: string[] = [];
  const events: RawEvent[] = [];
  for (const thread of candidates) {
    const result = await readThreadEvents(
      bb,
      thread.id,
      start,
      RANGE_EVENT_PAGES,
    );
    if (result.truncated) truncatedThreads.push(thread.id);
    events.push(...result.events);
  }
  await addQuestionLookback(bb, events, start);

  const threadRows = candidates.map(toDayThread);
  const dayReports = days.map((day) =>
    buildReport({
      day,
      timezone,
      threads: threadRows,
      events,
      truncatedThreads,
      includeBins: false,
    }),
  );
  const totalsReport = buildReport({
    day: input.startDay,
    timezone,
    threads: threadRows,
    events,
    truncatedThreads,
    window: { start, end },
    includeBins: false,
  });

  const byId = new Map(threadRows.map((thread) => [thread.id, thread]));
  const threads = threadSummaries(totalsReport)
    .slice(0, 12)
    .flatMap((summary) => {
      const thread = byId.get(summary.id);
      if (thread === undefined) return [];
      return [
        {
          thread,
          agentMs: summary.agentMs,
          turns: summary.turns,
          inputs: summary.inputs,
          questions: summary.questions,
        },
      ];
    });

  return {
    startDay: input.startDay,
    endDay: input.endDay,
    timezone,
    generatedAt: Date.now(),
    days: dayReports.map((report, index) => ({
      day: days[index] ?? input.startDay,
      summary: report.summary,
    })),
    totals: totalsReport.summary,
    threads,
    coverage: {
      threadsScanned: candidates.length,
      eventsRead: events.length,
      truncatedThreads,
    },
  };
}

async function readRange(
  bb: BbPluginApi,
  input: ReadRangeInput,
): Promise<RangeReport> {
  const timezone = isValidTimeZone(input.timezone) ? input.timezone : "UTC";
  const today = dayStringAt(Date.now(), timezone);
  const cacheable = !input.fresh && input.endDay < today;
  const key = [
    timezone,
    input.startDay,
    input.endDay,
    input.projectId ?? "",
    input.includeHidden === false ? "0" : "1",
  ].join("|");
  const hit = cached(rangeCache, key, cacheable);
  if (hit !== undefined) return hit;
  const report = await computeRange(bb, { ...input, timezone });
  remember(rangeCache, key, report, cacheable);
  return report;
}

export async function readFamily(
  bb: BbPluginApi,
  input: ReadFamilyInput,
): Promise<FamilyReport> {
  const timezone = isValidTimeZone(input.timezone) ? input.timezone : "UTC";
  for (const day of [input.startDay, input.endDay]) {
    if (
      day !== undefined &&
      (!Number.isFinite(Date.parse(`${day}T00:00:00Z`)) ||
        new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day)
    ) {
      throw new Error("Choose valid calendar dates.");
    }
  }
  const selected = await bb.sdk.threads.get({ threadId: input.threadId });
  if (selected.deletedAt !== null)
    throw new Error("This thread has been deleted.");
  const family = await collectFamily(
    toDayThread(selected),
    async (id) => toDayThread(await bb.sdk.threads.get({ threadId: id })),
    async (id) => {
      const children = await bb.sdk.threads.list({
        parentThreadId: id,
        includeHidden: true,
        limit: MAX_THREADS + 1,
      });
      return children
        .filter((thread) => thread.deletedAt === null)
        .map(toDayThread);
    },
    MAX_THREADS,
  );
  const events: RawEvent[] = [];
  const truncatedThreads: string[] = [];
  for (const thread of family.threads) {
    const result = await readThreadEvents(bb, thread.id, 0, RANGE_EVENT_PAGES);
    events.push(...result.events);
    if (result.truncated) truncatedThreads.push(thread.id);
  }
  const now = Date.now();
  const timestamps = events
    .filter((event) => event.at <= now)
    .map((event) => event.at);
  const earliest = timestamps.reduce(
    (a, b) => Math.min(a, b),
    timestamps[0] ?? selected.createdAt,
  );
  const latest = timestamps.reduce(
    (a, b) => Math.max(a, b),
    timestamps[0] ?? selected.createdAt,
  );
  const firstDay = dayStringAt(earliest, timezone);
  const lastDay = dayStringAt(latest, timezone);
  const floor = addDays(lastDay, -365);
  const startDay = input.startDay ?? (firstDay < floor ? floor : firstDay);
  const endDay = input.endDay ?? lastDay;
  const { start } = dayBounds(startDay, timezone);
  const { end } = dayBounds(endDay, timezone);
  if (startDay > endDay || end - start > 367 * 86_400_000) {
    throw new Error("Choose an ordered window of at most 366 calendar days.");
  }
  if (addDays(startDay, 365) < endDay)
    throw new Error("Family windows are limited to 366 days.");
  const warnings = [...family.warnings];
  if (firstDay < floor && input.startDay === undefined)
    warnings.push(
      "Showing the latest 366 days of available family history. Choose dates to inspect an earlier window.",
    );
  if (truncatedThreads.length)
    warnings.push(
      "Some thread history exceeded 30 event pages. Available-history dates and totals may be incomplete.",
    );
  const report = buildReport({
    day: startDay,
    timezone,
    threads: family.threads,
    events,
    truncatedThreads,
    window: { start, end },
    includeBins: false,
    now,
  });
  // Keep inactive relatives visible, including a quiet root or a child outside the window.
  report.threads = family.threads;
  // Family markers use actual available openings, not the day view's clipped bands.
  const openings = new Map<string, number>();
  for (const event of events) {
    if (event.kind !== "question") continue;
    const key = `${event.threadId}\u0000${event.interactionId}`;
    openings.set(key, Math.min(openings.get(key) ?? event.at, event.at));
  }
  report.questions = report.questions.map((question) => {
    const opened =
      openings.get(`${question.threadId}\u0000${question.id}`) ??
      question.opened;
    return {
      ...question,
      opened,
      waitMs: Math.max(
        0,
        Math.min(question.resolved ?? now, now, end) - opened,
      ),
    };
  });
  return { rootId: family.root.id, firstDay, lastDay, warnings, report };
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("attention: loaded");

  bb.rpc.register(rpcContract, {
    read_family: (input) => readFamily(bb, input),
    read_day: (input) => readDay(bb, input),
    list_days: (input) => listDays(bb, input),
    read_range: (input) => readRange(bb, input),
  });

  bb.onDispose(() => {
    bb.log.info("attention: disposed");
  });
}
