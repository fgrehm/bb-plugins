import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { definePluginApp, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { DayReport, DayThread, RangeReport } from "./lib/contract";
import type { rpcContract } from "./lib/contract";
import { dayStringAt, previousDay } from "./lib/day";
import {
  addDays,
  dayLabel,
  monthGrid,
  monthOf,
  monthRange,
  monthTitle,
  shiftMonth,
  shiftPeriod,
  weekRange,
  weekdayLabels,
} from "./lib/calendar.js";
import {
  clampAssumptions,
  DEFAULT_ASSUMPTIONS,
  estimateHumanTime,
  type EstimateAssumptions,
} from "./lib/estimate";
import { summaryMarkdown } from "./lib/export";
import {
  activeDays,
  busiestWindows,
  dayNarrative,
  hourlyBuckets,
  rangeNarrative,
  threadOrder,
  threadSummaries,
} from "./lib/insights";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const FALLBACK_TIMEZONES = [
  "UTC",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Australia/Sydney",
];

const MINUTE = 60_000;
const ASSUMPTIONS_KEY = "bb-attention:assumptions:v1";

function loadAssumptions(): EstimateAssumptions {
  try {
    const raw = localStorage.getItem(ASSUMPTIONS_KEY);
    if (raw === null) return DEFAULT_ASSUMPTIONS;
    const parsed = JSON.parse(raw) as Partial<EstimateAssumptions>;
    const numberOr = (value: unknown, fallback: number) => {
      const parsedValue = Number(value);
      return Number.isFinite(parsedValue) ? parsedValue : fallback;
    };
    return clampAssumptions({
      inputSeconds: numberOr(
        parsed.inputSeconds,
        DEFAULT_ASSUMPTIONS.inputSeconds,
      ),
      requestSeconds: numberOr(
        parsed.requestSeconds,
        DEFAULT_ASSUMPTIONS.requestSeconds,
      ),
      switchSeconds: numberOr(
        parsed.switchSeconds,
        DEFAULT_ASSUMPTIONS.switchSeconds,
      ),
    });
  } catch {
    return DEFAULT_ASSUMPTIONS;
  }
}

function saveAssumptions(assumptions: EstimateAssumptions): void {
  try {
    localStorage.setItem(ASSUMPTIONS_KEY, JSON.stringify(assumptions));
  } catch {
    // Storage is optional; the estimates still work for this session.
  }
}

function remember<T>(map: Map<string, T>, key: string, value: T, max: number) {
  if (map.size >= max) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

function timezoneOptions(): string[] {
  try {
    const supported = Intl.supportedValuesOf?.("timeZone") ?? [];
    return [...new Set<string>(["UTC", ...supported])];
  } catch {
    return FALLBACK_TIMEZONES;
  }
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function clock(ms: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function longDate(report: DayReport): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: report.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(report.dayStart + 12 * 3_600_000));
}

function duration(ms: number): string {
  const minutes = ms / MINUTE;
  if (minutes < 1) return `${Math.round(ms / 1000)}s`;
  if (minutes < 60) return `${minutes.toFixed(0)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function percent(ms: number, report: DayReport): number {
  const span = report.dayEnd - report.dayStart;
  if (span <= 0) return 0;
  return ((ms - report.dayStart) / span) * 100;
}

function hourMarks(report: DayReport): Array<{ at: number; label: string }> {
  const marks: Array<{ at: number; label: string }> = [];
  for (let hour = 0; hour <= 24; hour += 3) {
    const at =
      report.dayStart + ((report.dayEnd - report.dayStart) * hour) / 24;
    marks.push({ at, label: clock(at, report.timezone) });
  }
  return marks;
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 truncate text-2xl font-semibold tabular-nums tracking-tight">
        {value}
      </div>
      {note === undefined ? null : (
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {note}
        </div>
      )}
    </div>
  );
}

function Legend() {
  const item = (
    color: string,
    label: string,
    shape: "bar" | "tick" | "line",
  ) => (
    <span className="inline-flex items-center gap-1.5">
      <i
        className="inline-block"
        style={{
          width: shape === "tick" ? 2 : 12,
          height: shape === "bar" ? 10 : shape === "tick" ? 18 : 3,
          borderRadius: 2,
          background: color,
        }}
      />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {item("var(--success)", "turn executing", "bar")}
      {item("var(--attention)", "your input", "tick")}
      {item("var(--warning)", "agent waiting for an answer", "line")}
      {item("var(--destructive)", "failed or interrupted", "bar")}
    </div>
  );
}

function DayStrip({ report }: { report: DayReport }) {
  const cells = useMemo(() => {
    const span = report.dayEnd - report.dayStart;
    const count = Math.max(1, Math.ceil(span / (30 * MINUTE)));
    const minutes = Array<number>(count).fill(0);
    for (const turn of report.turns) {
      const first = Math.max(
        0,
        Math.floor((turn.start - report.dayStart) / MINUTE),
      );
      const last = Math.min(
        report.bins.concurrency.length,
        Math.ceil((turn.end - report.dayStart) / MINUTE),
      );
      for (let index = first; index < last; index += 1) {
        const cell = Math.floor(index / 30);
        if (cell < count) minutes[cell] = (minutes[cell] ?? 0) + 1;
      }
    }
    const inputs = Array<number>(count).fill(0);
    for (const input of report.inputs) {
      if (input.initiator !== "user") continue;
      const cell = Math.floor((input.at - report.dayStart) / (30 * MINUTE));
      if (cell >= 0 && cell < count) inputs[cell] = (inputs[cell] ?? 0) + 1;
    }
    return { minutes, inputs, count };
  }, [report]);

  return (
    <div>
      <div className="flex items-end gap-1">
        {Array.from({ length: cells.count }, (_, index) => {
          const busy = cells.minutes[index] ?? 0;
          const level =
            busy === 0
              ? 0
              : busy >= 25
                ? 4
                : busy >= 15
                  ? 3
                  : busy >= 5
                    ? 2
                    : 1;
          const at = report.dayStart + index * 30 * MINUTE;
          const inputs = cells.inputs[index] ?? 0;
          return (
            <div
              key={index}
              className="relative h-12 flex-1 overflow-hidden rounded-[2px]"
              title={`${clock(at, report.timezone)} · ${busy} agent-minutes · ${inputs} ${
                inputs === 1 ? "input" : "inputs"
              }`}
              style={{
                background:
                  level === 0
                    ? "var(--muted)"
                    : `color-mix(in oklab, var(--success) ${level * 20}%, transparent)`,
                outline: level === 0 ? "1px solid var(--border)" : undefined,
              }}
            >
              {inputs > 0 ? (
                <div
                  className="absolute inset-x-0 bottom-0"
                  style={{
                    height: 3,
                    background: "var(--attention)",
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>
          half-hour activity · agent minutes, with your inputs at the base
        </span>
        <span className="tabular-nums">{workWindow(report)}</span>
      </div>
    </div>
  );
}

function workWindow(report: DayReport): string {
  const human = report.inputs.filter((input) => input.initiator === "user");
  if (human.length === 0) return "no inputs recorded";
  const first = Math.min(...human.map((input) => input.at));
  const last = Math.max(...human.map((input) => input.at));
  return `first input ${clock(first, report.timezone)} · last ${clock(
    last,
    report.timezone,
  )}`;
}

function Timeline({
  report,
  showAutomated,
}: {
  report: DayReport;
  showAutomated: boolean;
}) {
  const navigate = useBbNavigate();
  const summaries = useMemo(() => threadSummaries(report), [report]);
  const order = useMemo(
    () => threadOrder(report, summaries),
    [report, summaries],
  );
  const summaryById = useMemo(
    () => new Map(summaries.map((summary) => [summary.id, summary])),
    [summaries],
  );
  const threadById = useMemo(
    () => new Map(report.threads.map((thread) => [thread.id, thread])),
    [report],
  );
  const parentIds = useMemo(
    () =>
      order.filter((entry) => entry.childCount > 0).map((entry) => entry.id),
    [order],
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(parentIds),
  );
  const dayKey = `${report.day}|${report.timezone}`;
  const lastDayKey = useRef(dayKey);
  useEffect(() => {
    if (lastDayKey.current === dayKey) return;
    lastDayKey.current = dayKey;
    setCollapsed(new Set(parentIds));
  }, [dayKey, parentIds]);
  const marks = hourMarks(report);

  const visible = order.filter((entry) => {
    let parentId = entry.parentId;
    while (parentId !== null) {
      if (collapsed.has(parentId)) return false;
      parentId = threadById.get(parentId)?.parentThreadId ?? null;
    }
    return true;
  });
  const shown = visible.slice(0, 40);
  const hiddenCount = visible.length - shown.length;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[56rem]">
        <div className="grid grid-cols-[18rem_1fr] gap-2">
          <div />
          <div className="relative h-5 text-xs text-muted-foreground">
            {marks.map((mark, index) => (
              <span
                key={mark.at}
                className="absolute tabular-nums"
                style={{
                  left: `${percent(mark.at, report)}%`,
                  transform:
                    index === 0
                      ? "none"
                      : index === marks.length - 1
                        ? "translateX(-100%)"
                        : "translateX(-50%)",
                }}
              >
                {mark.label}
              </span>
            ))}
          </div>
        </div>
        {shown.map((entry) => {
          const thread = threadById.get(entry.id);
          const summary = summaryById.get(entry.id);
          if (thread === undefined || summary === undefined) return null;
          const turns = report.turns.filter(
            (turn) => turn.threadId === thread.id,
          );
          const inputs = report.inputs.filter(
            (input) =>
              input.threadId === thread.id &&
              (showAutomated || input.initiator === "user"),
          );
          const questions = report.questions.filter(
            (question) => question.threadId === thread.id,
          );
          const isCollapsed = collapsed.has(thread.id);
          const hasChildren = entry.childCount > 0;
          const parentTitle =
            entry.parentId === null
              ? null
              : (threadById.get(entry.parentId)?.title ?? null);
          const spanStart = summary.firstAt;
          const spanEnd = summary.lastAt;
          return (
            <div
              key={thread.id}
              className="grid grid-cols-[18rem_1fr] items-center gap-2 py-0.5"
            >
              <div
                className="flex min-w-0 items-start gap-1"
                style={{ paddingLeft: entry.depth * 14 }}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(thread.id)) next.delete(thread.id);
                        else next.add(thread.id);
                        return next;
                      })
                    }
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${
                      thread.title
                    } and ${entry.childCount} subthread${
                      entry.childCount === 1 ? "" : "s"
                    }`}
                    className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded hover:bg-accent"
                  >
                    <Icon
                      name="ChevronDown"
                      className={cn(
                        "size-3 text-muted-foreground transition-transform",
                        isCollapsed && "-rotate-90",
                      )}
                    />
                  </button>
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <button
                  type="button"
                  onClick={() => navigate.toThread(thread.id)}
                  title={
                    entry.depth > 0 && parentTitle !== null
                      ? `Subthread of ${parentTitle}`
                      : entry.detached
                        ? "Subthread whose parent is not active today"
                        : thread.title
                  }
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    {entry.depth > 0 ? (
                      <Icon
                        name="CornerDownRight"
                        className="size-3 shrink-0 opacity-60"
                      />
                    ) : null}
                    {thread.archived ? (
                      <Icon
                        name="Archive"
                        className="size-3 shrink-0 opacity-70"
                      />
                    ) : null}
                    {thread.hidden ? (
                      <span
                        title="Hidden thread"
                        className="shrink-0 rounded border border-border px-1 text-xs uppercase tracking-wide text-muted-foreground"
                      >
                        hidden
                      </span>
                    ) : null}
                    <span className="truncate">{thread.title}</span>
                  </span>
                  <span className="block truncate text-xs tabular-nums text-muted-foreground/80">
                    {duration(summary.agentMs)} · {summary.turns}{" "}
                    {summary.turns === 1 ? "turn" : "turns"} · {summary.inputs}{" "}
                    {summary.inputs === 1 ? "input" : "inputs"}
                    {isCollapsed && entry.descendants > 0
                      ? ` · +${entry.descendants} sub (${duration(
                          entry.descendantAgentMs,
                        )})`
                      : ""}
                  </span>
                </button>
              </div>
              <div
                className="relative h-9 rounded-sm"
                style={{
                  background:
                    "repeating-linear-gradient(90deg, transparent 0, transparent calc(12.5% - 1px), var(--border) calc(12.5% - 1px), var(--border) 12.5%)",
                }}
              >
                {spanStart !== null && spanEnd !== null ? (
                  <div
                    className="absolute top-1/2 h-[2px] -translate-y-1/2 rounded-full"
                    style={{
                      left: `${percent(spanStart, report)}%`,
                      width: `${Math.max(percent(spanEnd, report) - percent(spanStart, report), 0.2)}%`,
                      background:
                        "color-mix(in oklab, var(--muted-foreground) 22%, transparent)",
                    }}
                    title={`Recorded activity ${clock(
                      spanStart,
                      report.timezone,
                    )} → ${clock(spanEnd, report.timezone)}`}
                  />
                ) : null}
                {turns.map((turn) => {
                  const left = percent(turn.start, report);
                  const width = percent(turn.end, report) - left;
                  const isProblem =
                    turn.status === "failed" || turn.status === "interrupted";
                  const isRunning = turn.status === "running";
                  return (
                    <div
                      key={`${turn.threadId}:${turn.turnId}`}
                      title={`${clock(turn.start, report.timezone)}–${clock(
                        turn.end,
                        report.timezone,
                      )} · ${turn.status} · ${turn.initiator}${
                        turn.model === null ? "" : ` · ${turn.model}`
                      }`}
                      className="absolute top-2 h-3 rounded-[2px]"
                      style={{
                        left: `${left}%`,
                        width: `${Math.max(width, 0.12)}%`,
                        background: isProblem
                          ? "var(--destructive)"
                          : "var(--success)",
                        opacity: isRunning ? 0.45 : 0.85,
                        outline: isRunning
                          ? "1px dashed var(--muted-foreground)"
                          : undefined,
                      }}
                    />
                  );
                })}
                {questions.map((question) => {
                  const left = percent(question.opened, report);
                  const end = question.resolved ?? report.dayEnd;
                  const width = percent(end, report) - left;
                  return (
                    <div
                      key={question.id}
                      title={`${clock(question.opened, report.timezone)} · waiting ${
                        question.waitMs === null
                          ? ""
                          : duration(question.waitMs)
                      } · ${question.outcome}`}
                      className="absolute bottom-1 h-[3px] rounded-full"
                      style={{
                        left: `${left}%`,
                        width: `${Math.max(width, 0.15)}%`,
                        background: "var(--warning)",
                        opacity: 0.8,
                      }}
                    />
                  );
                })}
                {inputs.map((input, index) => {
                  const steer = input.kind === "steer" || input.kind === "auto";
                  return (
                    <div
                      key={`${input.at}:${index}`}
                      title={`${clock(input.at, report.timezone)} · ${
                        input.initiator === "user" ? "you" : input.initiator
                      } · ${input.kind}${
                        input.queueDelayMs === null
                          ? ""
                          : ` · dispatch ${duration(input.queueDelayMs)}`
                      }`}
                      className="absolute w-[2px]"
                      style={{
                        top: steer ? 12 : 4,
                        bottom: steer ? 12 : 4,
                        left: `${percent(input.at, report)}%`,
                        background:
                          input.initiator === "user"
                            ? "var(--attention)"
                            : "var(--muted-foreground)",
                        opacity: input.initiator === "user" ? 1 : 0.4,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
        {hiddenCount > 0 ? (
          <p className="py-2 pl-5 text-xs text-muted-foreground">
            {hiddenCount} more threads not shown.
          </p>
        ) : null}
        {shown.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No turns, inputs, or questions recorded that day.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Rhythm({ report }: { report: DayReport }) {
  const buckets = useMemo(() => hourlyBuckets(report), [report]);
  const maxAgent = Math.max(1, ...buckets.map((bucket) => bucket.agentMinutes));
  const maxInputs = Math.max(1, ...buckets.map((bucket) => bucket.inputs));
  return (
    <div>
      <div className="flex h-24 items-end gap-1" aria-hidden="true">
        {buckets.map((bucket) => (
          <div
            key={bucket.start}
            className="flex h-full flex-1 flex-col justify-end"
            title={`${clock(bucket.start, report.timezone)} · ${bucket.agentMinutes.toFixed(
              0,
            )} agent-minutes · ${bucket.inputs} inputs`}
          >
            <div
              className="w-full rounded-t-[2px]"
              style={{
                height: `${(bucket.agentMinutes / maxAgent) * 100}%`,
                background:
                  bucket.agentMinutes === 0
                    ? "var(--muted)"
                    : "color-mix(in oklab, var(--success) 55%, transparent)",
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex h-10 items-end gap-1" aria-hidden="true">
        {buckets.map((bucket) => (
          <div
            key={bucket.start}
            className="flex h-full flex-1 flex-col justify-end"
            title={`${clock(bucket.start, report.timezone)} · ${bucket.inputs} inputs`}
          >
            <div
              className="w-full rounded-t-[2px]"
              style={{
                height: `${(bucket.inputs / maxInputs) * 100}%`,
                background:
                  bucket.inputs === 0 ? "transparent" : "var(--attention)",
              }}
            />
          </div>
        ))}
      </div>
      <div className="relative mt-1 h-4 text-xs text-muted-foreground">
        {hourMarks(report).map((mark, index, marks) => (
          <span
            key={mark.at}
            className="absolute tabular-nums"
            style={{
              left: `${percent(mark.at, report)}%`,
              transform:
                index === 0
                  ? "none"
                  : index === marks.length - 1
                    ? "translateX(-100%)"
                    : "translateX(-50%)",
            }}
          >
            {mark.label}
          </span>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>agent-minutes per hour, then your inputs per hour</span>
        <span>
          peak {maxAgent.toFixed(0)} agent-min · {maxInputs} inputs
        </span>
      </div>
    </div>
  );
}

function ThreadCards({ report }: { report: DayReport }) {
  const navigate = useBbNavigate();
  const cards = useMemo(() => {
    const byId = new Map(report.threads.map((thread) => [thread.id, thread]));
    return threadSummaries(report)
      .slice(0, 8)
      .flatMap((summary) => {
        const thread = byId.get(summary.id);
        return thread === undefined ? [] : [{ summary, thread }];
      });
  }, [report]);

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(({ summary, thread }) => {
        const turns = report.turns.filter(
          (turn) => turn.threadId === thread.id,
        );
        return (
          <button
            key={thread.id}
            type="button"
            onClick={() => navigate.toThread(thread.id)}
            className="group rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent/40"
            title={thread.title}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="line-clamp-2 text-xs font-medium leading-snug">
                {thread.title}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {thread.hidden ? (
                  <span
                    title="Hidden thread"
                    className="rounded border border-border px-1 text-xs uppercase tracking-wide text-muted-foreground"
                  >
                    hidden
                  </span>
                ) : null}
                {thread.archived ? (
                  <Icon
                    name="Archive"
                    className="mt-0.5 size-3 text-muted-foreground"
                  />
                ) : null}
              </span>
            </div>
            <div
              className="relative mt-2 h-5 overflow-hidden rounded-sm"
              style={{ background: "var(--muted)" }}
            >
              {turns.map((turn) => {
                const left = percent(turn.start, report);
                const width = percent(turn.end, report) - left;
                return (
                  <div
                    key={turn.turnId}
                    className="absolute top-1 h-3 rounded-[1px]"
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(width, 0.4)}%`,
                      background:
                        turn.status === "failed" ||
                        turn.status === "interrupted"
                          ? "var(--destructive)"
                          : "var(--success)",
                      opacity: 0.85,
                    }}
                  />
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className="tabular-nums text-foreground">
                {duration(summary.agentMs)}
              </span>
              <span>· {summary.turns} turns</span>
              <span>· {summary.inputs} inputs</span>
              {summary.questions > 0 ? (
                <span>
                  · {summary.questions}{" "}
                  {summary.questions === 1 ? "request" : "requests"}
                </span>
              ) : null}
            </div>
          </button>
        );
      })}
      {cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">No threads that day.</p>
      ) : null}
    </div>
  );
}

function Busiest({ report }: { report: DayReport }) {
  const windows = useMemo(() => busiestWindows(report, 3), [report]);
  const maxInputs = Math.max(1, ...windows.map((window) => window.inputs));
  if (windows.length === 0) {
    return <p className="text-sm text-muted-foreground">No busy windows.</p>;
  }
  return (
    <div className="space-y-2">
      {windows.map((window) => (
        <div key={window.start}>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-medium tabular-nums">
              {clock(window.start, report.timezone)}–
              {clock(window.end, report.timezone)}
            </span>
            <span className="text-muted-foreground">
              {window.inputs} {window.inputs === 1 ? "input" : "inputs"} ·{" "}
              {window.agentMinutes.toFixed(0)} agent-min
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(window.inputs / maxInputs) * 100}%`,
                background: "var(--attention)",
              }}
            />
          </div>
        </div>
      ))}
      <p className="pt-1 text-xs text-muted-foreground">
        Ranked by your recorded inputs, then agent minutes.
      </p>
    </div>
  );
}

function Questions({ report }: { report: DayReport }) {
  const navigate = useBbNavigate();
  const titleById = useMemo(
    () => new Map(report.threads.map((thread) => [thread.id, thread.title])),
    [report],
  );
  if (report.questions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No structured agent requests that day.
      </p>
    );
  }
  const outcomeColor: Record<string, string> = {
    answered: "var(--success)",
    timeout: "var(--warning)",
    dismissed: "var(--muted-foreground)",
    interrupted: "var(--destructive)",
    open: "var(--attention)",
  };
  return (
    <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Request</th>
            <th className="px-3 py-2 text-left font-medium">Thread</th>
            <th className="px-3 py-2 text-left font-medium">Waited</th>
            <th className="px-3 py-2 text-left font-medium">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {report.questions.map((question) => (
            <tr key={question.id} className="border-t border-border">
              <td
                className="max-w-[20rem] truncate px-3 py-1.5"
                title={question.title}
              >
                {question.title}
              </td>
              <td className="px-3 py-1.5">
                <button
                  type="button"
                  className="max-w-[9rem] truncate text-muted-foreground hover:text-foreground"
                  onClick={() => navigate.toThread(question.threadId)}
                  title={titleById.get(question.threadId) ?? question.threadId}
                >
                  {titleById.get(question.threadId) ?? question.threadId}
                </button>
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">
                {question.waitMs === null ? "—" : duration(question.waitMs)}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5">
                <span className="inline-flex items-center gap-1.5">
                  <i
                    className="inline-block size-1.5 rounded-full"
                    style={{ background: outcomeColor[question.outcome] }}
                  />
                  {question.outcome === "answered"
                    ? "resolved"
                    : question.outcome}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayPicker({
  value,
  timezone,
  resetToken,
  onChange,
}: {
  value: string;
  timezone: string;
  resetToken: number;
  onChange: (day: string) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthOf(value));
  const [days, setDays] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(false);
  const cache = useRef(new Map<string, string[]>());
  const wrapper = useRef<HTMLDivElement>(null);
  const today = dayStringAt(Date.now(), timezone);
  const currentMonth = monthOf(today);

  useEffect(() => {
    if (!open) setMonth(monthOf(value));
  }, [open, value]);

  useEffect(() => {
    if (resetToken > 0) cache.current.clear();
  }, [resetToken]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const cached = cache.current.get(`${month}|${timezone}`);
    if (cached !== undefined) {
      setDays(new Set(cached));
      setLoading(false);
      return;
    }
    setLoading(true);
    rpc
      .call("list_days", { month, timezone })
      .then((result) => {
        cache.current.set(`${month}|${timezone}`, result.days);
        if (!cancelled) setDays(new Set(result.days));
      })
      .catch(() => {
        if (!cancelled) setDays(new Set());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, month, timezone, rpc, resetToken]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const grid = useMemo(() => monthGrid(month), [month]);

  return (
    <div className="relative" ref={wrapper}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Choose day, ${dayLabel(value)}`}
        className="flex h-9 w-44 items-center justify-between gap-2 rounded-md border border-input px-2 text-sm"
      >
        <span className="tabular-nums">{dayLabel(value)}</span>
        <Icon
          name="ChevronDown"
          className={cn(
            "size-3.5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Choose a day with activity"
          className="absolute left-0 z-50 mt-1 w-72 rounded-lg border border-border bg-card p-2 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Previous month"
              onClick={() => setMonth((current) => shiftMonth(current, -1))}
              disabled={loading}
            >
              <Icon name="ChevronLeft" className="size-4" />
            </Button>
            <span className="text-xs font-medium">{monthTitle(month)}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Next month"
              onClick={() => setMonth((current) => shiftMonth(current, 1))}
              disabled={loading || month >= currentMonth}
            >
              <Icon name="ChevronRight" className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">
            {weekdayLabels().map((weekday) => (
              <span key={weekday} className="py-1">
                {weekday.slice(0, 2)}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {grid.map((day, index) => {
              if (day === null) {
                return <span key={`blank-${index}`} />;
              }
              const unavailable =
                loading || days === null || !days.has(day) || day > today;
              return (
                <button
                  key={day}
                  type="button"
                  disabled={unavailable}
                  onClick={() => {
                    onChange(day);
                    setOpen(false);
                  }}
                  aria-label={dayLabel(day)}
                  aria-current={day === value ? "date" : undefined}
                  className={cn(
                    "size-8 rounded-md text-xs tabular-nums transition-colors",
                    day === value
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent",
                    unavailable &&
                      "cursor-not-allowed opacity-25 hover:bg-transparent",
                  )}
                >
                  {Number(day.slice(8))}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {loading
              ? "Loading days with activity…"
              : `${days?.size ?? 0} ${
                  (days?.size ?? 0) === 1 ? "day" : "days"
                } with activity`}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function EstimateCard({
  counts,
  assumptions,
  onChange,
}: {
  counts: { inputs: number; requests: number; switches: number };
  assumptions: EstimateAssumptions;
  onChange: (next: EstimateAssumptions) => void;
}) {
  const estimate = estimateHumanTime(counts, assumptions);
  const set = (key: keyof EstimateAssumptions, value: string) => {
    onChange(
      clampAssumptions({
        ...assumptions,
        [key]: Number(value),
      } as EstimateAssumptions),
    );
  };
  const sliders: Array<{
    key: keyof EstimateAssumptions;
    label: string;
    max: number;
    step: number;
  }> = [
    { key: "inputSeconds", label: "Seconds per input", max: 120, step: 5 },
    { key: "requestSeconds", label: "Seconds per request", max: 300, step: 15 },
    {
      key: "switchSeconds",
      label: "Seconds per thread switch",
      max: 300,
      step: 15,
    },
  ];
  const stats: Array<{ label: string; value: number }> = [
    { label: "Inputs", value: counts.inputs },
    { label: "Requests", value: counts.requests },
    { label: "Switches", value: counts.switches },
  ];
  return (
    <section className="mt-3 rounded-xl border border-border bg-card px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Estimated human time
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            ~{duration(estimate.totalMs)}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {duration(estimate.interactingMs)} interacting ·{" "}
            {duration(estimate.switchingMs)} switching
          </div>
        </div>
        <div className="flex gap-5 text-xs">
          {stats.map((stat) => (
            <div key={stat.label}>
              <div className="text-muted-foreground">{stat.label}</div>
              <div className="tabular-nums">{stat.value}</div>
            </div>
          ))}
        </div>
      </div>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          Assumptions
        </summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          {sliders.map((slider) => (
            <label key={slider.key} className="block">
              <span className="flex items-baseline justify-between gap-2 text-muted-foreground">
                <span>{slider.label}</span>
                <span className="tabular-nums">{assumptions[slider.key]}s</span>
              </span>
              <input
                type="range"
                min={0}
                max={slider.max}
                step={slider.step}
                value={assumptions[slider.key]}
                onChange={(event) => set(slider.key, event.target.value)}
                aria-label={slider.label}
                className="mt-1 w-full"
                style={{ accentColor: "var(--primary)" }}
              />
            </label>
          ))}
        </div>
        <p className="mt-2 leading-relaxed text-muted-foreground">
          A model, not a measurement: each input and request adds a fixed
          handling time, and each recorded thread change adds a reorientation
          cost. It excludes reading turns, waiting, and work outside BB.
        </p>
      </details>
    </section>
  );
}

function weekLabel(startDay: string, endDay: string): string {
  const start = new Date(`${startDay}T12:00:00.000Z`);
  const end = new Date(`${endDay}T12:00:00.000Z`);
  const sameMonth = startDay.slice(0, 7) === endDay.slice(0, 7);
  const startText = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    ...(sameMonth ? {} : { month: "short" }),
  }).format(start);
  const endText = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(end);
  return `${startText}–${endText}`;
}

function RangeHeatmap({
  range,
  mode,
  selectedDay,
  onOpenDay,
}: {
  range: RangeReport;
  mode: "week" | "month";
  selectedDay: string;
  onOpenDay: (day: string) => void;
}) {
  const byDay = useMemo(
    () => new Map(range.days.map((entry) => [entry.day, entry.summary])),
    [range],
  );
  const maxAgent = Math.max(
    1,
    ...range.days.map((entry) => entry.summary.turnMinutes),
  );
  const cells =
    mode === "month"
      ? monthGrid(monthOf(range.startDay))
      : Array.from({ length: 7 }, (_, index) => addDays(range.startDay, index));
  const cellHeight = mode === "week" ? "h-24" : "h-16";
  return (
    <div>
      <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">
        {weekdayLabels().map((weekday) => (
          <span key={weekday} className="py-1">
            {weekday.slice(0, 2)}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (day === null) return <span key={`blank-${index}`} />;
          const summary = byDay.get(day);
          const inRange = day >= range.startDay && day <= range.endDay;
          if (!inRange) {
            return <span key={day} className={cn(cellHeight, "rounded-md")} />;
          }
          const active =
            summary !== undefined &&
            (summary.turns > 0 ||
              summary.humanInputs > 0 ||
              summary.questions > 0);
          const agent = summary?.turnMinutes ?? 0;
          const inputs = summary?.humanInputs ?? 0;
          return (
            <button
              key={day}
              type="button"
              disabled={!active}
              onClick={() => onOpenDay(day)}
              title={`${dayLabel(day)} · ${agent.toFixed(
                0,
              )} agent-min · ${inputs} ${inputs === 1 ? "input" : "inputs"}`}
              aria-label={`Open ${dayLabel(day)}`}
              className={cn(
                "relative flex flex-col items-center justify-end gap-1 rounded-md border p-1 transition-colors",
                cellHeight,
                day === selectedDay ? "border-primary" : "border-border",
                active ? "hover:bg-accent" : "cursor-not-allowed opacity-30",
              )}
            >
              <span className="absolute left-1.5 top-1 text-xs tabular-nums">
                {Number(day.slice(8))}
              </span>
              {active ? (
                <span
                  className="w-full rounded-sm"
                  style={{
                    height: `${Math.max(6, (agent / maxAgent) * 64)}%`,
                    background:
                      "color-mix(in oklab, var(--success) 55%, transparent)",
                  }}
                />
              ) : null}
              {inputs > 0 ? (
                <span
                  className="absolute right-1.5 top-1.5 size-1.5 rounded-full"
                  style={{ background: "var(--attention)" }}
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Click a day to open its timeline. Bars are agent minutes; dots are your
        inputs.
      </p>
    </div>
  );
}

function RangeTrend({ range }: { range: RangeReport }) {
  const maxAgent = Math.max(
    1,
    ...range.days.map((entry) => entry.summary.turnMinutes),
  );
  const maxInputs = Math.max(
    1,
    ...range.days.map((entry) => entry.summary.humanInputs),
  );
  const step = Math.max(1, Math.ceil(range.days.length / 9));
  return (
    <div>
      <div className="flex h-24 items-end gap-1" aria-hidden="true">
        {range.days.map((entry) => (
          <div
            key={entry.day}
            className="flex h-full flex-1 flex-col justify-end"
            title={`${entry.day} · ${entry.summary.turnMinutes.toFixed(
              0,
            )} agent-min`}
          >
            <div
              className="w-full rounded-t-[2px]"
              style={{
                height: `${(entry.summary.turnMinutes / maxAgent) * 100}%`,
                background:
                  entry.summary.turnMinutes === 0
                    ? "var(--muted)"
                    : "color-mix(in oklab, var(--success) 55%, transparent)",
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex h-10 items-end gap-1" aria-hidden="true">
        {range.days.map((entry) => (
          <div
            key={entry.day}
            className="flex h-full flex-1 flex-col justify-end"
            title={`${entry.day} · ${entry.summary.humanInputs} inputs`}
          >
            <div
              className="w-full rounded-t-[2px]"
              style={{
                height: `${(entry.summary.humanInputs / maxInputs) * 100}%`,
                background:
                  entry.summary.humanInputs === 0
                    ? "transparent"
                    : "var(--attention)",
              }}
            />
          </div>
        ))}
      </div>
      <div className="relative mt-1 h-4 text-xs text-muted-foreground">
        {range.days.map((entry, index) =>
          index % step === 0 ? (
            <span
              key={entry.day}
              className="absolute tabular-nums"
              style={{
                left: `${((index + 0.5) / range.days.length) * 100}%`,
                transform: "translateX(-50%)",
              }}
            >
              {Number(entry.day.slice(8))}
            </span>
          ) : null,
        )}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>agent-minutes per day, then your inputs per day</span>
        <span>
          peak {maxAgent.toFixed(0)} agent-min · {maxInputs} inputs
        </span>
      </div>
    </div>
  );
}

function RangeBusiestDays({
  range,
  onOpenDay,
}: {
  range: RangeReport;
  onOpenDay: (day: string) => void;
}) {
  const days = useMemo(
    () =>
      [...range.days]
        .filter(
          (entry) =>
            entry.summary.humanInputs > 0 || entry.summary.turnMinutes > 0,
        )
        .sort(
          (a, b) =>
            b.summary.humanInputs - a.summary.humanInputs ||
            b.summary.turnMinutes - a.summary.turnMinutes,
        )
        .slice(0, 3)
        .sort((a, b) => a.day.localeCompare(b.day)),
    [range],
  );
  const maxInputs = Math.max(
    1,
    ...days.map((entry) => entry.summary.humanInputs),
  );
  if (days.length === 0) {
    return <p className="text-sm text-muted-foreground">No busy days.</p>;
  }
  return (
    <div className="space-y-2">
      {days.map((entry) => (
        <button
          key={entry.day}
          type="button"
          onClick={() => onOpenDay(entry.day)}
          className="w-full text-left"
        >
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-medium tabular-nums">
              {dayLabel(entry.day)}
            </span>
            <span className="text-muted-foreground">
              {entry.summary.humanInputs} inputs ·{" "}
              {entry.summary.turnMinutes.toFixed(0)} agent-min
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(entry.summary.humanInputs / maxInputs) * 100}%`,
                background: "var(--attention)",
              }}
            />
          </div>
        </button>
      ))}
      <p className="pt-1 text-xs text-muted-foreground">
        Ranked by your recorded inputs, then agent minutes.
      </p>
    </div>
  );
}

function RangeThreads({ range }: { range: RangeReport }) {
  const navigate = useBbNavigate();
  const maxAgent = Math.max(1, ...range.threads.map((entry) => entry.agentMs));
  return (
    <div className="space-y-2">
      {range.threads.map((entry) => (
        <button
          key={entry.thread.id}
          type="button"
          onClick={() => navigate.toThread(entry.thread.id)}
          title={entry.thread.title}
          className="w-full text-left"
        >
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="flex min-w-0 items-center gap-1">
              {entry.thread.archived ? (
                <Icon
                  name="Archive"
                  className="size-3 shrink-0 text-muted-foreground"
                />
              ) : null}
              {entry.thread.hidden ? (
                <span
                  title="Hidden thread"
                  className="shrink-0 rounded border border-border px-1 text-xs uppercase tracking-wide text-muted-foreground"
                >
                  hidden
                </span>
              ) : null}
              <span className="truncate">{entry.thread.title}</span>
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {duration(entry.agentMs)} · {entry.turns} turns · {entry.inputs}{" "}
              inputs
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(entry.agentMs / maxAgent) * 100}%`,
                background:
                  "color-mix(in oklab, var(--success) 55%, transparent)",
              }}
            />
          </div>
        </button>
      ))}
      {range.threads.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No threads in this range.
        </p>
      ) : null}
    </div>
  );
}

function RangeView({
  range,
  mode,
  selectedDay,
  onOpenDay,
}: {
  range: RangeReport;
  mode: "week" | "month";
  selectedDay: string;
  onOpenDay: (day: string) => void;
}) {
  return (
    <>
      <section className="mt-3 rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Days in this range</h2>
          <Legend />
        </div>
        <RangeHeatmap
          range={range}
          mode={mode}
          selectedDay={selectedDay}
          onOpenDay={onOpenDay}
        />
      </section>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.35fr_1fr]">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">Daily rhythm</h2>
          <RangeTrend range={range} />
        </section>
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-medium">Busiest days</h2>
          <RangeBusiestDays range={range} onOpenDay={onOpenDay} />
        </section>
      </div>

      <section className="mt-3 rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Threads</h2>
          <span className="text-xs text-muted-foreground">
            top {range.threads.length} by agent time
          </span>
        </div>
        <RangeThreads range={range} />
      </section>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        A turn is provider execution time, not a measure of useful work. "Your
        inputs" counts local callers without a sender thread, so a plain CLI
        call looks like you. Agent questions are structured interactions such as
        questions and approvals only; reading and focus are not recorded by BB.
        {range.coverage.truncatedThreads.length > 0
          ? ` ${range.coverage.truncatedThreads.length} thread(s) hit the event page limit.`
          : ""}{" "}
        {range.coverage.threadsScanned} threads scanned,{" "}
        {range.coverage.eventsRead} events read.
      </p>
    </>
  );
}

function DayPage() {
  const rpc = useRpc<typeof rpcContract>();
  const timezones = useMemo(timezoneOptions, []);
  const [timezone, setTimezone] = useState(browserTimezone);
  const [day, setDay] = useState(() => previousDay(browserTimezone()));
  const [mode, setMode] = useState<"day" | "week" | "month">("day");
  const [showAutomated, setShowAutomated] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [report, setReport] = useState<DayReport | null>(null);
  const [range, setRange] = useState<RangeReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [assumptions, setAssumptions] =
    useState<EstimateAssumptions>(loadAssumptions);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const forceFresh = useRef(false);
  const dayCache = useRef(new Map<string, DayReport>());
  const rangeCache = useRef(new Map<string, RangeReport>());
  const dayRequest = useRef(0);
  const rangeRequest = useRef(0);

  const bounds = useMemo(() => {
    if (mode === "week") return weekRange(day);
    if (mode === "month") return monthRange(day);
    return null;
  }, [mode, day]);

  const today = dayStringAt(Date.now(), timezone);
  const canGoNext =
    mode === "day" ? day < today : bounds !== null && bounds.endDay < today;
  const includesToday =
    mode === "day"
      ? day === today
      : bounds !== null && bounds.startDay <= today && bounds.endDay >= today;

  const threadCounts = useMemo(() => {
    if (report === null) return null;
    const order = threadOrder(report, threadSummaries(report));
    return {
      threads: order.length,
      subthreads: order.filter((entry) => entry.depth > 0).length,
    };
  }, [report]);

  useEffect(() => {
    saveAssumptions(assumptions);
  }, [assumptions]);

  const loadDay = useCallback(async () => {
    const id = dayRequest.current + 1;
    dayRequest.current = id;
    const fresh = forceFresh.current;
    forceFresh.current = false;
    const key = `${timezone}|${day}`;
    if (!fresh) {
      const cached = dayCache.current.get(key);
      if (cached !== undefined) {
        setReport(cached);
        setError(null);
        setLoading(false);
        return;
      }
    }
    setLoading(true);
    try {
      const result = await rpc.call("read_day", {
        day,
        timezone,
        ...(fresh ? { fresh: true } : {}),
      });
      if (dayRequest.current !== id) return;
      remember(dayCache.current, key, result, 60);
      setReport(result);
      setError(null);
    } catch (cause) {
      if (dayRequest.current !== id) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (dayRequest.current === id) setLoading(false);
    }
  }, [day, timezone, rpc]);

  const loadRange = useCallback(async () => {
    if (bounds === null) return;
    const id = rangeRequest.current + 1;
    rangeRequest.current = id;
    const fresh = forceFresh.current;
    forceFresh.current = false;
    const key = `${timezone}|${bounds.startDay}|${bounds.endDay}`;
    if (!fresh) {
      const cached = rangeCache.current.get(key);
      if (cached !== undefined) {
        setRange(cached);
        setRangeError(null);
        setRangeLoading(false);
        return;
      }
    }
    setRangeLoading(true);
    try {
      const result = await rpc.call("read_range", {
        startDay: bounds.startDay,
        endDay: bounds.endDay,
        timezone,
        ...(fresh ? { fresh: true } : {}),
      });
      if (rangeRequest.current !== id) return;
      remember(rangeCache.current, key, result, 24);
      setRange(result);
      setRangeError(null);
    } catch (cause) {
      if (rangeRequest.current !== id) return;
      setRangeError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (rangeRequest.current === id) setRangeLoading(false);
    }
  }, [bounds, timezone, rpc]);

  useEffect(() => {
    if (mode !== "day") return;
    void loadDay();
  }, [mode, loadDay, refreshToken]);

  useEffect(() => {
    if (mode === "day") return;
    void loadRange();
  }, [mode, loadRange, refreshToken]);

  useEffect(() => {
    if (!includesToday) return;
    const timer = setInterval(() => {
      if (mode === "day") {
        dayCache.current.delete(`${timezone}|${day}`);
        void loadDay();
      } else if (bounds !== null) {
        rangeCache.current.delete(
          `${timezone}|${bounds.startDay}|${bounds.endDay}`,
        );
        void loadRange();
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [includesToday, mode, timezone, day, bounds, loadDay, loadRange]);

  const refresh = () => {
    dayCache.current.clear();
    rangeCache.current.clear();
    forceFresh.current = true;
    setRefreshToken((current) => current + 1);
  };

  const modeLabels: Array<{ id: "day" | "week" | "month"; label: string }> = [
    { id: "day", label: "Day" },
    { id: "week", label: "Week" },
    { id: "month", label: "Month" },
  ];

  const dayMatches =
    report !== null && report.day === day && report.timezone === timezone;
  const rangeMatches =
    range !== null &&
    bounds !== null &&
    range.startDay === bounds.startDay &&
    range.endDay === bounds.endDay &&
    range.timezone === timezone;
  const currentReport = dayMatches ? report : null;
  const currentRange = rangeMatches ? range : null;

  const title =
    mode === "day"
      ? currentReport === null
        ? "Agent attention"
        : longDate(currentReport)
      : bounds === null
        ? "Attention"
        : mode === "week"
          ? weekLabel(bounds.startDay, bounds.endDay)
          : `${monthTitle(monthOf(bounds.startDay))}`;

  const narrative =
    mode === "day"
      ? currentReport === null
        ? "Reading one day of agent turns, your inputs, and waiting questions."
        : dayNarrative(currentReport)
      : currentRange === null
        ? `Reading this ${mode}.`
        : rangeNarrative(currentRange);

  const summary =
    mode === "day" ? currentReport?.summary : currentRange?.totals;
  const active = mode === "day" ? loading : rangeLoading;
  const activeError = mode === "day" ? error : rangeError;

  const copySummary = async () => {
    if (summary === undefined) return;
    const threads =
      mode === "day"
        ? currentReport === null
          ? []
          : (() => {
              const titles = new Map(
                currentReport.threads.map((thread) => [
                  thread.id,
                  thread.title,
                ]),
              );
              return threadSummaries(currentReport)
                .slice(0, 5)
                .map((entry) => ({
                  title: titles.get(entry.id) ?? entry.id,
                  agentMs: entry.agentMs,
                  turns: entry.turns,
                  inputs: entry.inputs,
                }));
            })()
        : (currentRange?.threads.slice(0, 5).map((entry) => ({
            title: entry.thread.title,
            agentMs: entry.agentMs,
            turns: entry.turns,
            inputs: entry.inputs,
          })) ?? []);
    const estimate = estimateHumanTime(
      {
        inputs: summary.humanInputs,
        requests: summary.questions,
        switches: summary.threadTransitions,
      },
      assumptions,
    );
    const coverage =
      mode === "day" ? currentReport?.coverage : currentRange?.coverage;
    const markdown = summaryMarkdown({
      title,
      narrative,
      summary,
      estimate,
      assumptions,
      threads,
      timezone,
      threadsScanned: coverage?.threadsScanned ?? 0,
      eventsRead: coverage?.eventsRead ?? 0,
    });
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 2000);
  };

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-6xl px-4 pb-10 pt-3 md:px-6 md:pt-4">
        <section className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-4 md:px-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Attention · {timezone}
                </div>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
                  {title}
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                  {narrative}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label="Previous period"
                    onClick={() => setDay(shiftPeriod(day, mode, -1))}
                  >
                    <Icon name="ChevronLeft" className="size-4" />
                  </Button>
                  <div className="inline-flex rounded-md border border-border p-0.5">
                    {modeLabels.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setMode(entry.id)}
                        aria-pressed={mode === entry.id}
                        className={cn(
                          "rounded px-2.5 py-1 text-xs transition-colors",
                          mode === entry.id
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    aria-label="Next period"
                    disabled={!canGoNext}
                    onClick={() => setDay(shiftPeriod(day, mode, 1))}
                  >
                    <Icon name="ChevronRight" className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="text-xs text-muted-foreground">
                  Anchor day
                  <div className="mt-0.5">
                    <DayPicker
                      value={day}
                      timezone={timezone}
                      resetToken={refreshToken}
                      onChange={(next) => {
                        setDay(next);
                      }}
                    />
                  </div>
                </div>
                <label className="text-xs text-muted-foreground">
                  Timezone
                  <select
                    value={timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                    className="mt-0.5 flex h-9 w-52 rounded-md border border-input bg-transparent px-2 text-sm"
                    aria-label="Timezone"
                  >
                    {timezones.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone}
                      </option>
                    ))}
                  </select>
                </label>
                {includesToday ? (
                  <span
                    title="Refreshes every minute while this period includes today"
                    className="flex items-center gap-1 pb-2 text-xs text-muted-foreground"
                  >
                    <span
                      className="inline-block size-1.5 rounded-full"
                      style={{ background: "var(--success)" }}
                    />
                    auto 60s
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void copySummary()}
                  disabled={summary === undefined}
                >
                  <Icon name="Copy" className="mr-1 size-3.5" />
                  {copyState === "copied"
                    ? "Copied"
                    : copyState === "error"
                      ? "Copy failed"
                      : "Copy summary"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={refresh}
                  disabled={active}
                >
                  <Icon
                    name="RotateCcw"
                    className={cn("mr-1 size-3.5", active && "animate-spin")}
                  />
                  Refresh
                </Button>
              </div>
            </div>
          </div>
          {summary === undefined ? (
            <div className="px-4 py-8 text-sm text-muted-foreground md:px-5">
              {active ? "Reading thread history…" : "No report yet."}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 px-4 py-4 sm:grid-cols-3 lg:grid-cols-6 md:px-5">
              <Stat
                label="Agent time"
                value={duration(summary.turnMinutes * MINUTE)}
                note={`${summary.turns} turns`}
              />
              <Stat
                label="Your inputs"
                value={String(summary.humanInputs)}
                note={`${summary.agentInputs} agent · ${summary.systemInputs} system`}
              />
              <Stat
                label="Peak running"
                value={String(summary.peakConcurrency)}
                note={`${summary.busyMinutes} min with 2+`}
              />
              {mode === "day" ? (
                <>
                  <Stat
                    label="Threads"
                    value={String(summary.threadsActive)}
                    note={`${summary.threadTransitions} switches`}
                  />
                  <Stat
                    label="Requests"
                    value={String(summary.questions)}
                    note={`${summary.answeredQuestions} resolved`}
                  />
                  <Stat
                    label="Turn length"
                    value={
                      summary.turns === 0
                        ? "—"
                        : duration(
                            (summary.turnMinutes * MINUTE) / summary.turns,
                          )
                    }
                    note="average"
                  />
                </>
              ) : (
                <>
                  <Stat
                    label="Active days"
                    value={String(
                      currentRange === null ? 0 : activeDays(currentRange),
                    )}
                    note={`${currentRange?.days.length ?? 0} in range`}
                  />
                  <Stat
                    label="Requests"
                    value={String(summary.questions)}
                    note={`${summary.answeredQuestions} resolved`}
                  />
                  <Stat
                    label="Threads"
                    value={String(summary.threadsActive)}
                    note={`${currentRange?.threads.length ?? 0} in top list`}
                  />
                </>
              )}
            </div>
          )}
        </section>

        {summary === undefined ? null : (
          <EstimateCard
            counts={{
              inputs: summary.humanInputs,
              requests: summary.questions,
              switches: summary.threadTransitions,
            }}
            assumptions={assumptions}
            onChange={setAssumptions}
          />
        )}

        {activeError === null ? null : (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {activeError}
          </p>
        )}

        {mode === "day" ? (
          currentReport === null || report === null ? null : (
            <>
              <section className="mt-3 rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-medium">The shape of the day</h2>
                  <Legend />
                </div>
                <DayStrip report={report} />
              </section>

              <section className="mt-3 rounded-xl border border-border bg-card p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-medium">
                    Threads on one clock
                    <span className="ml-2 text-xs font-normal text-muted-foreground md:hidden">
                      swipe to scroll
                    </span>
                  </h2>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      {threadCounts?.threads ?? 0} threads ·{" "}
                      {threadCounts?.subthreads ?? 0} subthreads
                    </span>
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={showAutomated}
                        onCheckedChange={(checked) =>
                          setShowAutomated(checked === true)
                        }
                        aria-label="Show agent and system inputs"
                      />
                      automated inputs
                    </label>
                  </div>
                </div>
                <Timeline report={report} showAutomated={showAutomated} />
              </section>

              <div className="mt-3 grid gap-3 lg:grid-cols-[1.35fr_1fr]">
                <section className="rounded-xl border border-border bg-card p-4">
                  <h2 className="mb-3 text-sm font-medium">Rhythm</h2>
                  <Rhythm report={report} />
                </section>
                <section className="rounded-xl border border-border bg-card p-4">
                  <h2 className="mb-3 text-sm font-medium">
                    Busiest recorded windows
                  </h2>
                  <Busiest report={report} />
                </section>
              </div>

              <section className="mt-3 rounded-xl border border-border bg-card p-4">
                <div className="mb-3 flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-medium">Threads</h2>
                  <span className="text-xs text-muted-foreground">
                    top {Math.min(8, report.summary.threadsActive)} by agent
                    time
                  </span>
                </div>
                <ThreadCards report={report} />
              </section>

              <section className="mt-3 rounded-xl border border-border bg-card p-4">
                <button
                  type="button"
                  onClick={() => setShowRequests((current) => !current)}
                  aria-expanded={showRequests}
                  className="flex w-full items-center justify-between gap-2 text-left"
                >
                  <span className="text-sm font-medium">Agent requests</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {report.summary.questions} made ·{" "}
                    {report.summary.answeredQuestions} resolved
                    <Icon
                      name="ChevronDown"
                      className={cn(
                        "size-3.5 transition-transform",
                        showRequests && "rotate-180",
                      )}
                    />
                  </span>
                </button>
                {showRequests ? (
                  <div className="mt-3">
                    <Questions report={report} />
                  </div>
                ) : null}
              </section>

              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                A turn is provider execution time, not a measure of useful work.
                "Your inputs" counts local callers without a sender thread, so a
                plain CLI call looks like you. Agent questions are structured
                interactions such as questions and approvals only; reading and
                focus are not recorded by BB.
                {report.coverage.truncatedThreads.length > 0
                  ? ` ${report.coverage.truncatedThreads.length} thread(s) hit the event page limit.`
                  : ""}{" "}
                {report.coverage.threadsScanned} threads scanned,{" "}
                {report.coverage.eventsRead} events read.
              </p>
            </>
          )
        ) : currentRange === null ? (
          <div className="mt-3 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            {rangeLoading ? `Reading this ${mode}…` : "No report yet."}
          </div>
        ) : (
          <RangeView
            range={currentRange}
            mode={mode}
            selectedDay={day}
            onOpenDay={(next) => {
              setDay(next);
              setMode("day");
            }}
          />
        )}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "attention",
    title: "Attention",
    icon: "Clock",
    path: "attention",
    component: DayPage,
  });
});
