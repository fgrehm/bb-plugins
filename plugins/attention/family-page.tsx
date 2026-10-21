import { useEffect, useMemo, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { FamilyReport, rpcContract } from "./lib/contract";
import { dayBounds, dayStringAt } from "./lib/day";
import { addDays } from "./lib/calendar";
import { recordedVisits } from "./lib/family";
import { Button } from "@/components/ui/button";

function clock(at: number, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

export function FamilyPage({
  threadId,
  timezone,
  onBack,
}: {
  threadId: string;
  timezone: string;
  onBack: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<FamilyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [gap, setGap] = useState(15);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [window, setWindow] = useState<{ startDay?: string; endDay?: string }>(
    {},
  );
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    rpc
      .call("read_family", { threadId, timezone, ...window })
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setStart(dayStringAt(result.report.dayStart, timezone));
        setEnd(dayStringAt(result.report.dayEnd - 1, timezone));
      })
      .catch((cause) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, threadId, timezone, window, refresh]);
  const report = data?.report;
  const visits = useMemo(
    () => recordedVisits(report?.inputs ?? [], timezone, gap),
    [report, timezone, gap],
  );
  const days = useMemo(() => {
    if (!report) return [];
    const result: string[] = [];
    const last = dayStringAt(report.dayEnd - 1, timezone);
    for (
      let day = dayStringAt(report.dayStart, timezone);
      day <= last && result.length < 366;
      day = addDays(day, 1)
    )
      result.push(day);
    return result;
  }, [report, timezone]);
  const title =
    report?.threads.find((t) => t.id === data?.rootId)?.title ??
    "Thread family history";
  const titleById = new Map(report?.threads.map((t) => [t.id, t.title]) ?? []);
  const activeDays = days.filter((day) => {
    const { start, end } = dayBounds(day, timezone);
    return (
      report?.turns.some((t) => t.start < end && t.end > start) ||
      report?.inputs.some((i) => i.at >= start && i.at < end) ||
      report?.questions.some(
        (q) => q.opened < end && (q.resolved ?? report.dayEnd) > start,
      )
    );
  }).length;
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-4 md:px-6">
        <Button type="button" variant="ghost" onClick={onBack}>
          ← Back to Attention
        </Button>
        <section className="mt-3 rounded-xl border border-border bg-card p-4 md:p-6">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Thread family history · {timezone}
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {title}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Parent and descendants across days. Your recorded returns are the
            focus, not a measure of attention.
          </p>
          <form
            className="mt-4 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (start && end) setWindow({ startDay: start, endDay: end });
            }}
          >
            <label className="text-xs text-muted-foreground">
              From
              <input
                type="date"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="mt-1 block rounded border border-border bg-background p-2 text-foreground"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Through
              <input
                type="date"
                required
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="mt-1 block rounded border border-border bg-background p-2 text-foreground"
              />
            </label>
            <Button type="submit" variant="secondary" disabled={loading}>
              Apply dates
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => setWindow({})}
            >
              Available history
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => setRefresh((v) => v + 1)}
            >
              Refresh
            </Button>
          </form>
          {loading ? (
            <p role="status" className="mt-4 text-sm text-muted-foreground">
              Reading family history…
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {data && !loading && !error && report ? (
            <>
              {data.warnings.map((warning, index) => (
                <p
                  key={index}
                  role="status"
                  className="mt-3 rounded border border-border p-3 text-sm"
                >
                  {warning}
                </p>
              ))}
              <p className="mt-3 text-xs text-muted-foreground">
                Available recorded history: {data.firstDay}–{data.lastDay}.
                Selected-window totals below.
              </p>
              <h2 className="mt-6 text-xl font-medium">
                {visits.length
                  ? `${visits.length} recorded visits across ${activeDays} active days`
                  : "No recorded user visits in this window"}
              </h2>
              <div className="my-5 grid grid-cols-2 gap-4 border-y border-border py-4 sm:grid-cols-4">
                {[
                  ["Recorded visits", visits.length],
                  ["Your inputs", report.summary.humanInputs],
                  ["Requests overlapping window", report.questions.length],
                  ["Family threads", report.threads.length],
                ].map(([label, value]) => (
                  <div key={label}>
                    <div className="text-2xl font-semibold tabular-nums">
                      {value}
                    </div>
                    <div className="text-xs text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>
              <label className="flex flex-wrap items-center gap-3 rounded-lg bg-muted p-3 text-sm">
                Group inputs within <strong>{gap} minutes</strong> as one visit
                <input
                  aria-label="Visit gap in minutes"
                  type="range"
                  min={5}
                  max={60}
                  step={5}
                  value={gap}
                  onChange={(e) => setGap(Number(e.target.value))}
                />
                <span className="text-xs text-muted-foreground">
                  Assumption, not measured focus. Visits break at local
                  midnight.
                </span>
              </label>
              <h2 className="mt-7 font-medium">When did you come back?</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Input ticks and grouped visits above, requests and turn
                execution below. Quiet days are retained. This does not show
                interruptions in unrelated threads.
              </p>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span style={{ color: "var(--warning)" }}>
                  ┃ Your input / shaded visit
                </span>
                <span style={{ color: "var(--attention)" }}>
                  ◆ Request opened
                </span>
                <span style={{ color: "var(--success)" }}>━ Agent turn</span>
              </div>
              {days.map((day) => {
                const bounds = dayBounds(day, timezone);
                const span = bounds.end - bounds.start;
                const pos = (at: number) =>
                  Math.max(
                    0,
                    Math.min(100, ((at - bounds.start) / span) * 100),
                  );
                const dailyVisits = visits.filter((v) => v.day === day);
                const inputs = report.inputs.filter(
                  (i) =>
                    i.initiator === "user" &&
                    i.at >= bounds.start &&
                    i.at < bounds.end,
                );
                const turns = report.turns.filter(
                  (t) => t.start < bounds.end && t.end > bounds.start,
                );
                const questions = report.questions.filter(
                  (q) => q.opened >= bounds.start && q.opened < bounds.end,
                );
                return (
                  <div key={day} className="border-b border-border py-4">
                    <div className="flex flex-wrap justify-between gap-2 text-xs">
                      <strong>{day}</strong>
                      <span className="text-muted-foreground">
                        {dailyVisits.length} visits · {inputs.length} inputs
                      </span>
                    </div>
                    <div
                      role="img"
                      aria-label={`${day}: ${dailyVisits.length} visits, ${inputs.length} user inputs, ${questions.length} request openings, ${turns.length} overlapping turns. See details below.`}
                      className="relative mt-3 border-x border-border"
                      style={{
                        height: 80 + Math.min(report.threads.length, 8) * 5,
                        background:
                          "repeating-linear-gradient(to right, transparent 0, transparent calc(25% - 1px), var(--border) calc(25% - 1px), var(--border) 25%)",
                      }}
                    >
                      {dailyVisits.map((v) => (
                        <span
                          key={v.start}
                          className="absolute top-2 h-7 rounded-sm"
                          style={{
                            left: `${pos(v.start)}%`,
                            width: `${Math.max(0.3, pos(v.end) - pos(v.start))}%`,
                            background: "var(--warning)",
                            opacity: 0.25,
                          }}
                        />
                      ))}
                      {inputs.map((i, index) => (
                        <span
                          key={index}
                          className="absolute top-2 h-7 w-0.5"
                          title={`${clock(i.at, timezone)} · ${titleById.get(i.threadId)} · ${i.kind}`}
                          style={{
                            left: `${pos(i.at)}%`,
                            background: "var(--warning)",
                          }}
                        />
                      ))}
                      {questions.map((q) => (
                        <span
                          key={q.id}
                          className="absolute top-11 size-1.5 rotate-45"
                          title={`${clock(q.opened, timezone)} · ${q.title}`}
                          style={{
                            left: `${pos(q.opened)}%`,
                            background: "var(--attention)",
                          }}
                        />
                      ))}
                      {turns.map((t) => (
                        <span
                          key={`${t.threadId}-${t.turnId}`}
                          className="absolute h-1 rounded-sm"
                          title={`${titleById.get(t.threadId)} · ${clock(t.start, timezone)}–${clock(t.end, timezone)} · ${t.status}`}
                          style={{
                            top:
                              64 +
                              (Math.max(
                                0,
                                report.threads.findIndex(
                                  (thread) => thread.id === t.threadId,
                                ),
                              ) %
                                8) *
                                5,
                            left: `${pos(t.start)}%`,
                            width: `${Math.max(0.15, pos(t.end) - pos(t.start))}%`,
                            background:
                              t.status === "failed" ||
                              t.status === "interrupted"
                                ? "var(--destructive)"
                                : "var(--success)",
                            opacity: 0.7,
                          }}
                        />
                      ))}
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                        <span key={f}>
                          {clock(bounds.start + span * f, timezone)}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
              <details className="mt-5">
                <summary className="cursor-pointer text-sm font-medium">
                  Inspect recorded visits ({visits.length})
                </summary>
                {visits.map((v) => (
                  <div
                    key={v.start}
                    className="border-b border-border py-3 text-xs"
                  >
                    <strong>
                      {v.day} · {clock(v.start, timezone)}–
                      {clock(v.end, timezone)}
                    </strong>
                    <p className="mt-1 text-muted-foreground">
                      {v.inputs.length} inputs ·{" "}
                      {new Set(v.inputs.map((i) => i.threadId)).size} family
                      threads ·{" "}
                      {v.inputs.filter((i) => i.kind === "steer").length}{" "}
                      steering inputs
                    </p>
                    <ul className="mt-2 space-y-1">
                      {v.inputs.map((i, index) => (
                        <li key={index}>
                          {clock(i.at, timezone)} · {titleById.get(i.threadId)}{" "}
                          · {i.kind}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </details>
              <details className="mt-5">
                <summary className="cursor-pointer text-sm font-medium">
                  Requests and waits ({report.questions.length})
                </summary>
                <p className="mt-2 text-xs text-muted-foreground">
                  One row per lifecycle. Wait uses the available opening event;
                  an open request's wait runs through the selected window or
                  now, whichever is earlier. Openings on the timeline are
                  clipped to the window.
                </p>
                {report.questions.map((q) => (
                  <div
                    key={`${q.threadId}-${q.id}`}
                    className="border-b border-border py-3 text-xs"
                  >
                    <strong>{q.title}</strong>
                    <p className="mt-1 text-muted-foreground">
                      {titleById.get(q.threadId)} · {q.outcome} ·{" "}
                      {q.waitMs === null
                        ? "unknown wait"
                        : `${Math.round(q.waitMs / 60_000)} min wait`}{" "}
                      ·{" "}
                      {q.resolved === null
                        ? "No resolution in this window"
                        : `resolved ${dayStringAt(q.resolved, timezone)} ${clock(q.resolved, timezone)}`}
                    </p>
                  </div>
                ))}
              </details>
              <details className="mt-5">
                <summary className="cursor-pointer text-sm font-medium">
                  Family and coverage
                </summary>
                <ul className="mt-2 space-y-2 text-xs">
                  {report.threads.map((t) => (
                    <li key={t.id}>
                      {t.id === data.rootId ? "Parent: " : "Descendant: "}
                      {t.title}
                      {t.archived ? " · archived" : ""}
                      {t.hidden ? " · hidden" : ""}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  {report.coverage.threadsScanned} threads scanned ·{" "}
                  {report.coverage.eventsRead} normalized events read. At most
                  80 family members and 30 pages of 100 events per member.
                  Available history, not guaranteed lifetime coverage.
                </p>
              </details>
              <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
                Visits describe adjacent recorded inputs, not continuous
                handling. Reading and focus are not recorded. User-classified
                inputs can include scripts or CLI callers. Later parent inputs
                are not automatically coordination overhead. Turn execution
                includes waiting on models and tools. Open or unfinished records
                do not prove an agent is still running. Separate continuation
                threads are not linked automatically. No human-time estimate or
                calendar totals are changed.
              </p>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
