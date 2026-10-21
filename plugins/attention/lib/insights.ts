import type { DayReport } from "./contract.js";

export interface HourBucket {
  start: number;
  agentMinutes: number;
  inputs: number;
  questions: number;
}

export interface WindowSummary {
  start: number;
  end: number;
  inputs: number;
  agentMinutes: number;
  questions: number;
}

export interface ThreadSummary {
  id: string;
  agentMs: number;
  turns: number;
  inputs: number;
  questions: number;
  firstAt: number | null;
  lastAt: number | null;
}

const HOUR = 3_600_000;
const WINDOW = 30 * 60_000;

export function hourlyBuckets(report: DayReport): HourBucket[] {
  const count = Math.max(
    1,
    Math.ceil((report.dayEnd - report.dayStart) / HOUR),
  );
  const buckets: HourBucket[] = Array.from({ length: count }, (_, index) => ({
    start: report.dayStart + index * HOUR,
    agentMinutes: 0,
    inputs: 0,
    questions: 0,
  }));
  for (const turn of report.turns) {
    const firstHour = Math.floor((turn.start - report.dayStart) / HOUR);
    const lastHour = Math.floor((turn.end - 1 - report.dayStart) / HOUR);
    for (let index = firstHour; index <= lastHour; index += 1) {
      const bucket = buckets[index];
      if (bucket === undefined) continue;
      const from = Math.max(turn.start, bucket.start);
      const to = Math.min(turn.end, bucket.start + HOUR);
      bucket.agentMinutes += Math.max(0, to - from) / 60_000;
    }
  }
  for (const input of report.inputs) {
    if (input.initiator !== "user") continue;
    const index = Math.floor((input.at - report.dayStart) / HOUR);
    if (buckets[index] !== undefined) buckets[index].inputs += 1;
  }
  for (const question of report.questions) {
    const index = Math.floor((question.opened - report.dayStart) / HOUR);
    if (buckets[index] !== undefined) buckets[index].questions += 1;
  }
  return buckets;
}

function overlapMs(
  start: number,
  end: number,
  windowStart: number,
  windowEnd: number,
): number {
  return Math.max(0, Math.min(end, windowEnd) - Math.max(start, windowStart));
}

export function busiestWindows(report: DayReport, count = 3): WindowSummary[] {
  const candidates: WindowSummary[] = [];
  for (let start = report.dayStart; start < report.dayEnd; start += WINDOW) {
    const end = Math.min(start + WINDOW, report.dayEnd);
    const agentMinutes =
      report.turns.reduce(
        (total, turn) => total + overlapMs(turn.start, turn.end, start, end),
        0,
      ) / 60_000;
    const inputs = report.inputs.filter(
      (input) =>
        input.initiator === "user" && input.at >= start && input.at < end,
    ).length;
    const questions = report.questions.filter(
      (question) => question.opened >= start && question.opened < end,
    ).length;
    candidates.push({ start, end, inputs, agentMinutes, questions });
  }
  const ranked = candidates
    .filter((item) => item.inputs > 0 || item.agentMinutes >= 1)
    .sort(
      (a, b) =>
        b.inputs - a.inputs ||
        b.agentMinutes - a.agentMinutes ||
        a.start - b.start,
    );
  const picked: WindowSummary[] = [];
  for (const candidate of ranked) {
    if (picked.length >= count) break;
    const overlaps = picked.some(
      (item) =>
        candidate.start < item.end + WINDOW &&
        item.start < candidate.end + WINDOW,
    );
    if (!overlaps) picked.push(candidate);
  }
  return picked.sort((a, b) => a.start - b.start);
}

export function threadSummaries(report: DayReport): ThreadSummary[] {
  const byThread = new Map<string, ThreadSummary>();
  const ensure = (threadId: string): ThreadSummary => {
    const existing = byThread.get(threadId);
    if (existing !== undefined) return existing;
    const created: ThreadSummary = {
      id: threadId,
      agentMs: 0,
      turns: 0,
      inputs: 0,
      questions: 0,
      firstAt: null,
      lastAt: null,
    };
    byThread.set(threadId, created);
    return created;
  };
  const touch = (summary: ThreadSummary, at: number) => {
    summary.firstAt =
      summary.firstAt === null ? at : Math.min(summary.firstAt, at);
    summary.lastAt =
      summary.lastAt === null ? at : Math.max(summary.lastAt, at);
  };
  for (const turn of report.turns) {
    const summary = ensure(turn.threadId);
    summary.agentMs += turn.end - turn.start;
    summary.turns += 1;
    touch(summary, turn.start);
    touch(summary, turn.end);
  }
  for (const input of report.inputs) {
    touch(ensure(input.threadId), input.at);
    if (input.initiator !== "user") continue;
    ensure(input.threadId).inputs += 1;
  }
  for (const question of report.questions) {
    const summary = ensure(question.threadId);
    summary.questions += 1;
    touch(summary, question.opened);
    touch(summary, question.resolved ?? question.opened);
  }
  return [...byThread.values()].sort(
    (a, b) => b.agentMs - a.agentMs || b.inputs - a.inputs,
  );
}

export interface ThreadOrderEntry {
  id: string;
  depth: number;
  parentId: string | null;
  childCount: number;
  descendants: number;
  descendantAgentMs: number;
  detached: boolean;
}

export function threadOrder(
  report: DayReport,
  summaries: ThreadSummary[],
): ThreadOrderEntry[] {
  const active = new Map(report.threads.map((thread) => [thread.id, thread]));
  const byId = new Map(summaries.map((summary) => [summary.id, summary]));
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  const detached = new Set<string>();

  for (const summary of summaries) {
    const thread = active.get(summary.id);
    const parentId = thread?.parentThreadId ?? null;
    if (parentId === null) {
      roots.push(summary.id);
      continue;
    }
    if (!active.has(parentId) || parentId === summary.id) {
      roots.push(summary.id);
      detached.add(summary.id);
      continue;
    }
    const siblings = children.get(parentId) ?? [];
    siblings.push(summary.id);
    children.set(parentId, siblings);
  }

  const byAgentTime = (a: string, b: string) =>
    (byId.get(b)?.agentMs ?? 0) - (byId.get(a)?.agentMs ?? 0);
  const byStart = (a: string, b: string) =>
    (byId.get(a)?.firstAt ?? 0) - (byId.get(b)?.firstAt ?? 0);

  roots.sort(byAgentTime);
  for (const siblings of children.values()) siblings.sort(byStart);

  const ordered: ThreadOrderEntry[] = [];
  const seen = new Set<string>();
  const visit = (
    id: string,
    depth: number,
    parentId: string | null,
  ): { count: number; agentMs: number } => {
    if (seen.has(id) || depth > 8) return { count: 0, agentMs: 0 };
    seen.add(id);
    const kids = children.get(id) ?? [];
    const entry: ThreadOrderEntry = {
      id,
      depth,
      parentId,
      childCount: kids.length,
      descendants: 0,
      descendantAgentMs: 0,
      detached: detached.has(id),
    };
    ordered.push(entry);
    for (const child of kids) {
      const nested = visit(child, depth + 1, id);
      entry.descendants += 1 + nested.count;
      entry.descendantAgentMs +=
        (byId.get(child)?.agentMs ?? 0) + nested.agentMs;
    }
    return { count: entry.descendants, agentMs: entry.descendantAgentMs };
  };
  for (const root of roots) visit(root, 0, null);
  for (const summary of summaries) visit(summary.id, 0, null);
  return ordered;
}

export function dayNarrative(report: DayReport): string {
  const { summary } = report;
  if (summary.turns === 0 && summary.humanInputs === 0) {
    return "No agent activity or human input recorded for this day.";
  }
  const agentTime = formatMinutes(summary.turnMinutes);
  const parts = [
    `Agents ran for ${agentTime} across ${summary.threadsActive} ${
      summary.threadsActive === 1 ? "thread" : "threads"
    }.`,
    `${summary.peakConcurrency} ran at once at the peak, and ${
      summary.busyMinutes
    } ${summary.busyMinutes === 1 ? "minute had" : "minutes had"} two or more running.`,
    `You sent ${summary.humanInputs} ${
      summary.humanInputs === 1 ? "input" : "inputs"
    }${
      summary.threadTransitions === 0
        ? "."
        : `, changing thread ${summary.threadTransitions} ${
            summary.threadTransitions === 1 ? "time" : "times"
          } within 30 minutes.`
    }`,
  ];
  if (summary.questions > 0) {
    parts.push(
      `Agents made ${summary.questions} ${
        summary.questions === 1 ? "request" : "requests"
      } for input; ${summary.answeredQuestions} ${
        summary.answeredQuestions === 1 ? "was" : "were"
      } resolved.`,
    );
  }
  return parts.join(" ");
}

function formatMinutes(minutes: number): string {
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes.toFixed(1)} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
