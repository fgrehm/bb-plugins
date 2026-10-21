import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { definePluginApp, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { DayReport, DayThread } from "./lib/contract";
import type { rpcContract } from "./lib/contract";
import { previousDay } from "./lib/day";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
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

function timezoneOptions(): string[] {
  try {
    const supported = Intl.supportedValuesOf?.("timeZone") ?? [];
    const options = new Set<string>(["UTC", ...supported]);
    return [...options];
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

function duration(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 1) return `${Math.round(ms / 1000)}s`;
  if (minutes < 60) return `${minutes.toFixed(1)} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${Math.round(minutes % 60)}m`;
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

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {note === undefined ? null : (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{note}</div>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <i
          className="inline-block h-2.5 w-3 rounded-[2px]"
          style={{
            background: "color-mix(in oklab, var(--primary) 55%, transparent)",
          }}
        />
        turn executing
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i
          className="inline-block h-7 w-[2px]"
          style={{ background: "var(--primary)" }}
        />
        your input
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i
          className="inline-block h-1 w-3 rounded-full"
          style={{ background: "var(--muted-foreground)" }}
        />
        agent waiting for an answer
      </span>
      <span className="inline-flex items-center gap-1.5">
        <i
          className="inline-block h-2.5 w-3 rounded-[2px]"
          style={{
            background:
              "color-mix(in oklab, var(--destructive) 55%, transparent)",
          }}
        />
        failed or interrupted
      </span>
    </div>
  );
}

function ConcurrencyChart({ report }: { report: DayReport }) {
  const values = report.bins.concurrency;
  const peak = Math.max(1, ...values);
  const step = 100 / Math.max(1, values.length);
  const points = values
    .map((value, index) => {
      const x = index * step + step / 2;
      const y = 20 - (value / peak) * 18;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <div className="mt-1" aria-hidden="true">
      <svg
        viewBox="0 0 100 20"
        preserveAspectRatio="none"
        className="h-12 w-full"
      >
        <polygon
          points={`0,20 ${points} 100,20`}
          fill="color-mix(in oklab, var(--primary) 18%, transparent)"
        />
        <polyline
          points={points}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>running turns over the day</span>
        <span>peak {peak}</span>
      </div>
    </div>
  );
}

function InputChart({ report }: { report: DayReport }) {
  const values = report.bins.humanInputs;
  const peak = Math.max(1, ...values);
  return (
    <div className="mt-1" aria-hidden="true">
      <div className="flex h-8 items-end gap-px">
        {values.map((value, index) => (
          <div
            key={index}
            className="flex-1 rounded-t-[1px]"
            style={{
              height: `${(value / peak) * 100}%`,
              background:
                value === 0
                  ? "transparent"
                  : "color-mix(in oklab, var(--primary) 55%, transparent)",
            }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>your inputs per 10 minutes</span>
        <span>peak {peak}</span>
      </div>
    </div>
  );
}

function Row({
  thread,
  report,
  showAutomated,
  onOpen,
}: {
  thread: DayThread;
  report: DayReport;
  showAutomated: boolean;
  onOpen: (threadId: string) => void;
}) {
  const turns = report.turns.filter((turn) => turn.threadId === thread.id);
  const inputs = report.inputs.filter(
    (input) =>
      input.threadId === thread.id &&
      (showAutomated || input.initiator === "user"),
  );
  const questions = report.questions.filter(
    (question) => question.threadId === thread.id,
  );
  return (
    <div className="group grid grid-cols-[10rem_1fr] items-center gap-2 py-0.5">
      <button
        type="button"
        onClick={() => onOpen(thread.id)}
        title={thread.title}
        className="truncate pr-1 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        {thread.archived ? (
          <Icon name="Archive" className="mr-1 inline size-3" />
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
                  ? "color-mix(in oklab, var(--destructive) 55%, transparent)"
                  : "color-mix(in oklab, var(--primary) 55%, transparent)",
                opacity: isRunning ? 0.55 : 1,
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
                question.waitMs === null ? "" : duration(question.waitMs)
              } · ${question.outcome}`}
              className="absolute bottom-1 h-[3px] rounded-full"
              style={{
                left: `${left}%`,
                width: `${Math.max(width, 0.15)}%`,
                background: "var(--muted-foreground)",
                opacity: 0.7,
              }}
            />
          );
        })}
        {inputs.map((input, index) => (
          <div
            key={`${input.at}:${index}`}
            title={`${clock(input.at, report.timezone)} · ${
              input.initiator === "user" ? "you" : input.initiator
            } · ${input.kind}${input.queueDelayMs === null ? "" : ` · dispatch ${duration(input.queueDelayMs)}`}`}
            className="absolute top-0.5 bottom-0.5 w-[2px]"
            style={{
              left: `${percent(input.at, report)}%`,
              background: "var(--primary)",
              opacity: input.initiator === "user" ? 1 : 0.3,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Timeline({
  report,
  showAutomated,
}: {
  report: DayReport;
  showAutomated: boolean;
}) {
  const navigate = useBbNavigate();
  const threads = useMemo(() => {
    const titleById = new Map(report.threads.map((t) => [t.id, t]));
    const totals = new Map<string, number>();
    for (const turn of report.turns) {
      totals.set(
        turn.threadId,
        (totals.get(turn.threadId) ?? 0) + (turn.end - turn.start),
      );
    }
    for (const input of report.inputs) {
      if (input.initiator !== "user") continue;
      totals.set(input.threadId, (totals.get(input.threadId) ?? 0) + 60_000);
    }
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => titleById.get(id))
      .filter((thread): thread is DayThread => thread !== undefined)
      .slice(0, 32);
  }, [report]);

  const marks = hourMarks(report);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[46rem]">
        <div className="grid grid-cols-[10rem_1fr] gap-2">
          <div />
          <div className="relative h-5 text-[10px] text-muted-foreground">
            {marks.map((mark) => (
              <span
                key={mark.at}
                className="absolute -translate-x-1/2 tabular-nums"
                style={{ left: `${percent(mark.at, report)}%` }}
              >
                {mark.label}
              </span>
            ))}
          </div>
        </div>
        {threads.map((thread) => (
          <Row
            key={thread.id}
            thread={thread}
            report={report}
            showAutomated={showAutomated}
            onOpen={(threadId) => navigate.toThread(threadId)}
          />
        ))}
        {threads.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No turns, inputs, or questions recorded that day.
          </div>
        ) : null}
        <div className="mt-4 border-t border-border pt-3">
          <ConcurrencyChart report={report} />
          <InputChart report={report} />
        </div>
      </div>
    </div>
  );
}

function Questions({ report }: { report: DayReport }) {
  const navigate = useBbNavigate();
  const titleById = new Map(report.threads.map((t) => [t.id, t.title]));
  if (report.questions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No structured agent questions that day. Questions typed into a reply are
        not recorded as interactions.
      </p>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Question</th>
            <th className="px-3 py-2 text-left font-medium">Thread</th>
            <th className="px-3 py-2 text-left font-medium">Opened</th>
            <th className="px-3 py-2 text-left font-medium">Waited</th>
            <th className="px-3 py-2 text-left font-medium">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {report.questions.slice(0, 20).map((question) => (
            <tr key={question.id} className="border-t border-border">
              <td
                className="max-w-[22rem] truncate px-3 py-1.5"
                title={question.title}
              >
                {question.title}
              </td>
              <td className="px-3 py-1.5">
                <button
                  type="button"
                  className="max-w-[10rem] truncate text-muted-foreground hover:text-foreground"
                  onClick={() => navigate.toThread(question.threadId)}
                  title={titleById.get(question.threadId) ?? question.threadId}
                >
                  {titleById.get(question.threadId) ?? question.threadId}
                </button>
              </td>
              <td className="px-3 py-1.5 tabular-nums">
                {clock(question.opened, report.timezone)}
              </td>
              <td className="px-3 py-1.5 tabular-nums">
                {question.waitMs === null ? "—" : duration(question.waitMs)}
              </td>
              <td className="px-3 py-1.5">{question.outcome}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.questions.length > 20 ? (
        <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          Showing 20 of {report.questions.length}.
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
      <div className="mx-auto box-border w-full max-w-6xl px-4 pb-8 pt-3 md:px-6 md:pt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              Agent attention
            </h1>
            <p className="text-xs text-muted-foreground">
              Turns, your inputs, and waiting questions across BB threads.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-muted-foreground">
              Day
              <Input
                type="date"
                value={day}
                onChange={(event) => {
                  if (event.target.value !== "") setDay(event.target.value);
                }}
                className="mt-0.5 w-40"
                aria-label="Day"
              />
            </label>
            <label className="text-[11px] text-muted-foreground">
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

        {error === null ? null : (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {report === null ? (
          <div className="mt-6 rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            {loading ? "Reading thread history…" : "No report yet."}
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Metric
                label="Turns"
                value={String(report.summary.turns)}
                note={`${report.summary.turnMinutes} agent-minutes`}
              />
              <Metric
                label="Your inputs"
                value={String(report.summary.humanInputs)}
                note={`${report.summary.agentInputs} agent · ${report.summary.systemInputs} system`}
              />
              <Metric
                label="Questions"
                value={String(report.summary.questions)}
                note={`${report.summary.answeredQuestions} answered`}
              />
              <Metric
                label="Peak running"
                value={String(report.summary.peakConcurrency)}
                note={`${report.summary.busyMinutes} min with 2+`}
              />
              <Metric
                label="Threads"
                value={String(report.summary.threadsActive)}
                note={`${report.summary.threadTransitions} switches`}
              />
              <Metric
                label="Coverage"
                value={`${report.coverage.threadsScanned}`}
                note={`${report.coverage.eventsRead} events read`}
              />
            </div>

            <div className="mt-4 rounded-lg border border-border bg-card p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <Legend />
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
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
            </div>

            <div className="mt-4">
              <h2 className="mb-2 text-sm font-medium">Agent questions</h2>
              <Questions report={report} />
            </div>

            <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
              {report.day} in {report.timezone}. A turn runs while the provider
              is executing; it is not a measure of useful work. Only
              human-initiated inputs are counted as yours. Agent questions are
              structured interactions only. Reading and focus are not recorded
              by BB.
              {report.coverage.truncatedThreads.length > 0
                ? ` ${report.coverage.truncatedThreads.length} thread(s) hit the event page limit, so their history may be incomplete.`
                : ""}
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
