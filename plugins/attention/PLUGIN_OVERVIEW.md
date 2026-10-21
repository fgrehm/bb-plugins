See one day of work with coding agents as a timeline: when agents executed, when
you stepped in, and when an agent was waiting for your answer.

## What you get

- **A day picker that only enables days with recorded activity.**
- **The shape of the day**: a half-hour heat strip of agent activity with your
  inputs along its base.
- **One row per thread** on a single clock: turn bands, your input ticks, an
  activity span, and structured requests waiting for an answer. Subthreads are
  nested under their parent, collapsed by default, and included in every
  total.
- **Rhythm**: agent-minutes and your inputs per hour on the same axis.
- **Busiest recorded windows**: the half hours where you stepped in most, with
  agent time as the tie-break.
- **Thread cards** for the busiest eight, each with a miniature timeline and
  agent time, turns, inputs, and requests.
- **Agent requests** with thread, wait, and outcome, collapsed until opened.
- **Thread family history** from day thread cards: follow a parent and descendants across days, with adjustable recorded visits, input ticks, request openings, and agent execution. Inspect visits and waits or choose a date window; calendar totals stay unchanged.
- **Week and Month views** with a daily heatmap, daily rhythm, busiest days, and
  top threads; click a day to open its timeline.
- **Estimated human time** for the day or range: interacting plus switching
  time, with adjustable per-item assumptions saved locally.
- Failed and interrupted turns, archived threads, and automated inputs are
  marked rather than blended in.

The page answers a narrow question: did parallel agents run on their own, or did
they keep pulling you back in? It reports recorded activity, not a productivity
or attention score.

## Requirements and privacy

Requires BB 0.46 or newer. The plugin reads BB's own thread history through the
public SDK and computes everything on demand. It does not read message bodies,
tool arguments, or tool output, writes nothing to BB, and makes no network
requests. Nothing leaves your machine.

## Limits

A turn is provider execution time, not useful work. "You" means a local caller
without a sender thread, so the desktop UI and an external script look the same.
BB records no reading or focus, so thread switches are changes between your
recorded inputs, not changes in attention. Only structured agent requests, including approvals, are
shown. The human-time figure is an assumption-based estimate, not measured
attention. Queued messages are timed at dispatch, and per-turn token history is not
retained. Archived threads are included; deleted threads are gone.

## Caching and limits

Day and range reports are cached in the plugin server for five minutes and in
the page for the session. Today and ranges that include today are recomputed.
Refresh bypasses both caches. Ranges are limited to 62 days. Family reads are uncached, limited to 80 members and 30 event pages per member, and show coverage warnings. Family date windows cover at most 366 days. Visits group nearby recorded inputs, not measured focus or attention; unrelated-thread interruptions are not shown.
