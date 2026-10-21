import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { definePluginApp, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { DayReport, DayThread } from "./lib/contract";
import type { rpcContract } from "./lib/contract";
import { dayStringAt, previousDay } from "./lib/day";
import {
  dayLabel,
  monthGrid,
  monthOf,
  monthTitle,
  shiftMonth,
  weekdayLabels,
} from "./lib/calendar.js";
import {
  busiestWindows,
  dayNarrative,
  hourlyBuckets,
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
  const titleById = useMemo(
    () => new Map(report.threads.map((thread) => [thread.id, thread])),
    [report],
  );
  const rows = summaries
    .map((summary) => titleById.get(summary.id))
    .filter((thread): thread is DayThread => thread !== undefined)
    .slice(0, 32);
  const marks = hourMarks(report);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[46rem]">
        <div className="grid grid-cols-[12rem_1fr] gap-2">
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
        {rows.map((thread) => {
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
          return (
            <div
              key={thread.id}
              className="grid grid-cols-[12rem_1fr] items-center gap-2 py-0.5"
            >
              <button
                type="button"
                onClick={() => navigate.toThread(thread.id)}
                title={thread.title}
                className="truncate pr-1 text-left text-xs text-muted-foreground hover:text-foreground"
              >
                {thread.archived ? (
                  <Icon
                    name="Archive"
                    className="mr-1 inline size-3 opacity-70"
                  />
                ) : null}
                {thread.title}
              </button>
              <div
                className="relative h-8 rounded-sm"
                style={{
                  background:
                    "repeating-linear-gradient(90deg, transparent 0, transparent calc(12.5% - 1px), var(--border) calc(12.5% - 1px), var(--border) 12.5%)",
                }}
              >
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
                      className="absolute top-1.5 h-3 rounded-[2px]"
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
                {inputs.map((input, index) => (
                  <div
                    key={`${input.at}:${index}`}
                    title={`${clock(input.at, report.timezone)} · ${
                      input.initiator === "user" ? "you" : input.initiator
                    } · ${input.kind}${
                      input.queueDelayMs === null
                        ? ""
                        : ` · dispatch ${duration(input.queueDelayMs)}`
                    }`}
                    className="absolute top-0.5 bottom-0.5 w-[2px]"
                    style={{
                      left: `${percent(input.at, report)}%`,
                      background:
                        input.initiator === "user"
                          ? "var(--attention)"
                          : "var(--muted-foreground)",
                      opacity: input.initiator === "user" ? 1 : 0.4,
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
        {rows.length === 0 ? (
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
              {thread.archived ? (
                <Icon
                  name="Archive"
                  className="mt-0.5 size-3 shrink-0 text-muted-foreground"
                />
              ) : null}
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
  onChange,
}: {
  value: string;
  timezone: string;
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
  }, [open, month, timezone, rpc]);

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

function DayPage() {
  const rpc = useRpc<typeof rpcContract>();
  const timezones = useMemo(timezoneOptions, []);
  const [timezone, setTimezone] = useState(browserTimezone);
  const [day, setDay] = useState(() => previousDay(browserTimezone()));
  const [showAutomated, setShowAutomated] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [report, setReport] = useState<DayReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    try {
      const result = await rpc.call("read_day", { day, timezone });
      if (requestId.current !== id) return;
      setReport(result);
      setError(null);
    } catch (cause) {
      if (requestId.current !== id) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [day, timezone, rpc]);

  useEffect(() => {
    void load();
  }, [load]);

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
                  {report === null ? "Agent attention" : longDate(report)}
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                  {report === null
                    ? "Reading one day of agent turns, your inputs, and waiting questions."
                    : dayNarrative(report)}
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="text-xs text-muted-foreground">
                  Day
                  <div className="mt-0.5">
                    <DayPicker
                      value={day}
                      timezone={timezone}
                      onChange={setDay}
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
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void load()}
                  disabled={loading}
                >
                  <Icon
                    name="RotateCcw"
                    className={cn("mr-1 size-3.5", loading && "animate-spin")}
                  />
                  Refresh
                </Button>
              </div>
            </div>
          </div>
          {report === null ? (
            <div className="px-4 py-8 text-sm text-muted-foreground md:px-5">
              {loading ? "Reading thread history…" : "No report yet."}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 px-4 py-4 sm:grid-cols-3 lg:grid-cols-6 md:px-5">
              <Stat
                label="Agent time"
                value={duration(report.summary.turnMinutes * MINUTE)}
                note={`${report.summary.turns} turns`}
              />
              <Stat
                label="Your inputs"
                value={String(report.summary.humanInputs)}
                note={`${report.summary.agentInputs} agent · ${report.summary.systemInputs} system`}
              />
              <Stat
                label="Peak running"
                value={String(report.summary.peakConcurrency)}
                note={`${report.summary.busyMinutes} min with 2+`}
              />
              <Stat
                label="Threads"
                value={String(report.summary.threadsActive)}
                note={`${report.summary.threadTransitions} switches`}
              />
              <Stat
                label="Requests"
                value={String(report.summary.questions)}
                note={`${report.summary.answeredQuestions} resolved`}
              />
              <Stat
                label="Turn length"
                value={
                  report.summary.turns === 0
                    ? "—"
                    : duration(
                        (report.summary.turnMinutes * MINUTE) /
                          report.summary.turns,
                      )
                }
                note="average"
              />
            </div>
          )}
        </section>

        {error === null ? null : (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {report === null ? null : (
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
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
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
                  top {Math.min(8, report.summary.threadsActive)} by agent time
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
