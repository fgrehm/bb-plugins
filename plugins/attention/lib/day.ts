import type {
  DayInput,
  DayQuestion,
  DayReport,
  DayThread,
  DayTurn,
} from "./contract.js";

export type RawEvent =
  | {
      kind: "request";
      at: number;
      threadId: string;
      requestId: string;
      initiator: "user" | "agent" | "system";
      inputKind: "new-turn" | "steer" | "auto" | "thread-start";
      model: string | null;
    }
  | {
      kind: "accepted";
      at: number;
      threadId: string;
      requestId: string;
      turnId: string;
    }
  | {
      kind: "turn-start";
      at: number;
      threadId: string;
      turnId: string;
    }
  | {
      kind: "turn-end";
      at: number;
      threadId: string;
      turnId: string;
      status: "completed" | "failed" | "interrupted";
    }
  | {
      kind: "question";
      at: number;
      threadId: string;
      interactionId: string;
      status: "pending" | "resolving" | "resolved" | "interrupted";
      title: string;
      resolutionKind: string | null;
      statusReason: string | null;
      seq?: number;
    };

export interface BuildReportArgs {
  day: string;
  timezone: string;
  threads: DayThread[];
  events: RawEvent[];
  truncatedThreads: string[];
  window?: { start: number; end: number };
  includeBins?: boolean;
  now?: number;
}

const MINUTE = 60_000;
const TRANSITION_GAP_MS = 30 * MINUTE;

function key(...parts: Array<string | number>): string {
  return parts.join("\u0000");
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

function zoneParts(
  ms: number,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function zoneOffsetMs(ms: number, timeZone: string): number {
  const parts = zoneParts(ms, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - ms;
}

function utcDayStart(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

function addDays(day: string, days: number): string {
  const next = new Date(utcDayStart(day) + days * 86_400_000);
  return next.toISOString().slice(0, 10);
}

export function dayStartAt(day: string, timeZone: string): number {
  const target = utcDayStart(day);
  let start = target - zoneOffsetMs(target, timeZone);
  start = target - zoneOffsetMs(start, timeZone);
  return start;
}

export function dayBounds(
  day: string,
  timeZone: string,
): { start: number; end: number } {
  const start = dayStartAt(day, timeZone);
  const end = dayStartAt(addDays(day, 1), timeZone);
  return { start, end };
}

export function dayStringAt(ms: number, timeZone: string): string {
  const parts = zoneParts(ms, timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function previousDay(timeZone: string, now = Date.now()): string {
  return dayStringAt(now - 86_400_000, timeZone);
}

function turnStatus(value: string): DayTurn["status"] {
  if (value === "completed" || value === "failed" || value === "interrupted") {
    return value;
  }
  return "unknown";
}

export function buildReport(args: BuildReportArgs): DayReport {
  const { day, timezone, threads, events } = args;
  const { start: dayStart, end: dayEnd } =
    args.window ?? dayBounds(day, timezone);
  const now = args.now ?? Date.now();

  const acceptedByRequest = new Map<string, { turnId: string; at: number }>();
  for (const event of events) {
    if (event.kind === "accepted") {
      acceptedByRequest.set(key(event.threadId, event.requestId), {
        turnId: event.turnId,
        at: event.at,
      });
    }
  }

  const requestByTurn = new Map<string, RawEvent & { kind: "request" }>();
  for (const pass of [false, true]) {
    for (const event of events) {
      if (event.kind !== "request") continue;
      const steerish =
        event.inputKind === "steer" || event.inputKind === "auto";
      if (pass === false && steerish) continue;
      const accepted = acceptedByRequest.get(
        key(event.threadId, event.requestId),
      );
      if (accepted === undefined) continue;
      const turnKey = key(event.threadId, accepted.turnId);
      if (!requestByTurn.has(turnKey)) requestByTurn.set(turnKey, event);
    }
  }

  const turnStarts = new Map<string, number>();
  const turnEnds = new Map<string, { at: number; status: DayTurn["status"] }>();
  for (const event of events) {
    if (event.kind === "turn-start") {
      const turnKey = key(event.threadId, event.turnId);
      const current = turnStarts.get(turnKey);
      if (current === undefined || event.at < current) {
        turnStarts.set(turnKey, event.at);
      }
    }
    if (event.kind === "turn-end") {
      const turnKey = key(event.threadId, event.turnId);
      const current = turnEnds.get(turnKey);
      if (current === undefined || event.at > current.at) {
        turnEnds.set(turnKey, {
          at: event.at,
          status: turnStatus(event.status),
        });
      }
    }
  }

  const turns: DayTurn[] = [];
  for (const [turnKey, start] of turnStarts) {
    const separator = turnKey.indexOf("\u0000");
    const threadId = turnKey.slice(0, separator);
    const turnId = turnKey.slice(separator + 1);
    const end = turnEnds.get(turnKey);
    const endAt = end?.at ?? Math.min(now, dayEnd);
    if (endAt <= dayStart || start >= dayEnd) continue;
    const request = requestByTurn.get(turnKey);
    turns.push({
      threadId,
      turnId,
      start: Math.max(start, dayStart),
      end: Math.min(endAt, dayEnd),
      status: end?.status ?? "running",
      initiator: request?.initiator ?? "unknown",
      kind: request?.inputKind ?? null,
      model: request?.model ?? null,
    });
  }
  turns.sort((a, b) => a.start - b.start);

  const inputs: DayInput[] = [];
  for (const event of events) {
    if (event.kind !== "request") continue;
    if (event.at < dayStart || event.at >= dayEnd) continue;
    const accepted = acceptedByRequest.get(
      key(event.threadId, event.requestId),
    );
    inputs.push({
      threadId: event.threadId,
      at: event.at,
      kind: event.inputKind,
      initiator: event.initiator,
      model: event.model,
      queueDelayMs:
        accepted !== undefined && accepted.at >= event.at
          ? accepted.at - event.at
          : null,
    });
  }
  inputs.sort((a, b) => a.at - b.at);

  const questionsById = new Map<
    string,
    {
      threadId: string;
      opened: number | null;
      resolved: number | null;
      title: string;
      outcome: DayQuestion["outcome"];
    }
  >();
  for (const event of events) {
    if (event.kind !== "question") continue;
    const id = key(event.threadId, event.interactionId);
    const entry = questionsById.get(id) ?? {
      threadId: event.threadId,
      opened: null,
      resolved: null,
      title: event.title,
      outcome: "open" as DayQuestion["outcome"],
    };
    if (event.title.length > 0) entry.title = event.title;
    if (event.status === "pending" || event.status === "resolving") {
      if (entry.opened === null || event.at < entry.opened) {
        entry.opened = event.at;
      }
    }
    if (event.status === "resolved") {
      entry.resolved = Math.max(entry.resolved ?? 0, event.at);
      entry.outcome = "answered";
    }
    if (event.status === "interrupted") {
      entry.resolved = Math.max(entry.resolved ?? 0, event.at);
      const reason = (event.statusReason ?? "").toLowerCase();
      entry.outcome =
        reason.includes("timeout") || reason.includes("expired")
          ? "timeout"
          : reason.includes("user")
            ? "dismissed"
            : "interrupted";
    }
    questionsById.set(id, entry);
  }

  const questions: DayQuestion[] = [];
  for (const [id, entry] of questionsById) {
    if (entry.opened === null) continue;
    if (entry.opened >= dayEnd) continue;
    if (entry.resolved !== null && entry.resolved <= dayStart) continue;
    const opened = Math.max(entry.opened, dayStart);
    const resolved =
      entry.resolved === null ? null : Math.min(entry.resolved, dayEnd);
    const bounded = entry.resolved !== null && entry.resolved > dayEnd;
    questions.push({
      id: id.slice(id.indexOf("\u0000") + 1),
      threadId: entry.threadId,
      opened,
      resolved: bounded ? null : resolved,
      title: entry.title,
      outcome: bounded ? "open" : entry.outcome,
      waitMs: bounded
        ? dayEnd - entry.opened
        : resolved === null
          ? dayEnd - entry.opened
          : resolved - entry.opened,
    });
  }
  questions.sort((a, b) => a.opened - b.opened);

  const minuteCount = Math.max(1, Math.ceil((dayEnd - dayStart) / MINUTE));
  const concurrency = new Array<number>(minuteCount).fill(0);
  for (const turn of turns) {
    const first = Math.max(0, Math.floor((turn.start - dayStart) / MINUTE));
    const last = Math.min(
      minuteCount,
      Math.ceil((turn.end - dayStart) / MINUTE),
    );
    for (let index = first; index < last; index += 1) {
      concurrency[index] = (concurrency[index] ?? 0) + 1;
    }
  }

  const inputBinMs = 10 * MINUTE;
  const inputBins = new Array<number>(
    Math.max(1, Math.ceil((dayEnd - dayStart) / inputBinMs)),
  ).fill(0);
  for (const input of inputs) {
    if (input.initiator !== "user") continue;
    const index = Math.floor((input.at - dayStart) / inputBinMs);
    if (index >= 0 && index < inputBins.length) {
      inputBins[index] = (inputBins[index] ?? 0) + 1;
    }
  }

  const humanInputs = inputs.filter((input) => input.initiator === "user");
  let threadTransitions = 0;
  for (let index = 1; index < humanInputs.length; index += 1) {
    const previous = humanInputs[index - 1];
    const current = humanInputs[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      current.threadId !== previous.threadId &&
      current.at - previous.at <= TRANSITION_GAP_MS
    ) {
      threadTransitions += 1;
    }
  }

  const threadIds = new Set<string>([
    ...turns.map((turn) => turn.threadId),
    ...inputs.map((input) => input.threadId),
    ...questions.map((question) => question.threadId),
  ]);

  return {
    day,
    timezone,
    dayStart,
    dayEnd,
    generatedAt: Date.now(),
    threads: threads.filter((thread) => threadIds.has(thread.id)),
    turns,
    inputs,
    questions,
    summary: {
      threadsActive: threadIds.size,
      turns: turns.length,
      turnMinutes:
        Math.round(
          (turns.reduce((total, turn) => total + turn.end - turn.start, 0) /
            MINUTE) *
            10,
        ) / 10,
      humanInputs: humanInputs.length,
      agentInputs: inputs.filter((input) => input.initiator === "agent").length,
      systemInputs: inputs.filter((input) => input.initiator === "system")
        .length,
      questions: questions.length,
      answeredQuestions: questions.filter(
        (question) => question.outcome === "answered",
      ).length,
      peakConcurrency: concurrency.length === 0 ? 0 : Math.max(...concurrency),
      busyMinutes: concurrency.filter((count) => count >= 2).length,
      threadTransitions,
    },
    bins:
      args.includeBins === false
        ? { binMs: MINUTE, concurrency: [], humanInputs: [] }
        : {
            binMs: MINUTE,
            concurrency,
            humanInputs: inputBins,
          },
    coverage: {
      threadsScanned: threads.length,
      eventsRead: events.length,
      truncatedThreads: args.truncatedThreads,
    },
  };
}
