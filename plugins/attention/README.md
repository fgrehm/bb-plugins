# Attention

See one day of work with coding agents as a timeline: which threads were
executing, when you stepped in, and when an agent was waiting for an answer.

The question it helps answer is narrow: **did parallel agents run on their own,
or did they keep pulling me back in?** It shows recorded activity. It does not
score productivity, attention, or cognitive load.

## What it shows

- **A day picker that only enables days with recorded activity**, so empty dates
  cannot be selected by accident.
- **The shape of the day**: a half-hour strip of agent activity, with your
  inputs marked along its base.
- **Threads on one clock**: one row per thread with turn bands, your input
  ticks, a faint first-to-last activity span, and bands for structured requests
  waiting on an answer. Subthreads are nested under their parent and
  collapsed by default; a collapsed parent shows how much work its children
  hold, and expanding it reveals them. Each
  row carries agent time, turns, and your inputs.
- **Rhythm**: agent-minutes and your inputs per hour, on the same axis.
- **Busiest recorded windows**: the half hours with the most of your inputs,
  with agent time as the tie-break.
- **Thread cards**: agent time, turns, inputs, and requests for the eight
  busiest threads, each with a miniature timeline.
- **Agent requests**: every structured ask from an agent, with thread, wait,
  and outcome. Collapsed until you open it.
- **Week and Month reports**: switch the view to get a daily heatmap, a daily
  agent/input rhythm, the busiest days, and the top threads for the range.
  Click any day in the heatmap to jump to its timeline.
- **Estimated human time**, for the day or the range: interacting time (inputs
  and requests) plus switching time (recorded thread changes). The per-item
  seconds are assumptions you can adjust, and they are saved locally.

Click a thread name to open it. Select **Explore family** on a day thread card to follow the parent and all descendants across days.

## Thread family history

The family page puts your recorded returns first: input ticks and shaded visits, structured request openings, and turn execution on daily timelines. It includes quiet days and inactive relatives, including archived and hidden threads. Opening a child resolves its available ancestors and includes siblings and descendants. Separate continuation threads are not linked automatically.

A visit groups adjacent user-classified inputs within an adjustable gap (5–60 minutes, default 15) and always breaks at local midnight. The gap is an assumption, not measured focus. Activity in other thread families can interrupt a visit without appearing here. Expand the visits to inspect individual input times, threads, and input kinds. Expand requests to see one row per lifecycle and its available full wait across midnight.

Choose a date window or **Available history**. All counts on this page refer to the selected window, except the explicitly labeled available-history dates. Calendar totals and human-time estimates are unchanged. **Back to Attention** preserves the mounted calendar's selection. BB can remount the page on reload or a responsive layout change, which resets its local view state.

Family reads are uncached and refreshed on opening, changing dates, or **Refresh**. Traversal is limited to 80 threads and 30 pages of 100 events per member. Warnings identify partial ancestry, family truncation, and event-page limits. The default window covers at most the latest 366 days of available history; choose dates for earlier windows. Older events outside the paging limit cannot be recovered by choosing earlier dates.

## What it reads

The plugin reads BB's own thread history through the public SDK:

- `threads.list` and `threads.get` for thread metadata and family ancestry;
- `threads.events.list` for turn, input, and interaction lifecycle events;
- `threads.events` carries `initiator`, `target.kind`, `turn_id`, and
  interaction status, which is what makes the timeline possible.

It does not read message bodies, tool arguments, or tool output. It writes
nothing to BB, opens no network connection, and sends nothing anywhere. All
data stays in the BB server and is computed on demand.

## Caching

Day and range reports are cached in the plugin server's memory for five
minutes, and in the page for the current session. Past days and past ranges are
cached; the server recomputes today and current ranges when requested. The page refreshes periods that include today every 60 seconds while the calendar is open. **Refresh** clears the page caches and tells the server to bypass its
cache. The calendar's availability is cached separately.

Ranges are limited to 62 days. Range thread lists show the top 12 by agent
time; the day view remains the place for full per-thread and per-request detail.

## Limits worth knowing

- **A turn is not useful work.** It is provider execution time, including model
  latency and tool time.
- **"You" means a local caller without a sender thread.** The desktop UI, a
  plain `bb thread tell` in a shell, and an external script look the same.
  `bb thread tell` run from inside a BB thread is correctly marked as another
  agent.
- **Reading and focus are not recorded by BB.** Thread switches count changes
  between your recorded inputs, not changes in what you were looking at.
- **Subthreads are included.** Every thread with activity that day is a row and
  counts in the totals, including child threads, side chats, and archived
  threads. A child whose parent is inactive that day appears at the top level.
- **Only structured requests count.** Questions and approvals raised through an
  interaction are recorded. A question typed into an assistant reply is
  invisible. Calendar reports attempt a bounded lookback for requests closed in the window whose opening is missing (up to three lifecycle-event pages, scanning toward seven days earlier). Older or still-pending requests may be missed. The family view reconstructs lifecycles from its available event history.
- **Queued messages are timed at dispatch.** BB deletes the queue row when the
  message goes out, so the wait between typing and sending is not in history.
- **Token and context history is not per turn.** BB keeps only the latest
  snapshot per thread, so this plugin does not show cost.
- **The human-time estimate is a model, not a measurement.** It adds a fixed
  handling time per input and request and a reorientation cost per recorded
  thread change. Defaults are 20s, 60s, and 30s. It does not include reading
  turns, waiting, or work outside BB, and it is not a measure of attention or
  cognitive load.
- **Deleted threads are gone.** Archived threads are included.

## Requirements

- BB 0.46 or newer.
- Historical data in the local BB database. Nothing else.

## Install

```sh
bb plugin install path:/path/to/bb-plugins/plugins/attention
```

Or install from Git and select the plugin subdirectory:

```sh
bb plugin install git:github.com/fgrehm/bb-plugins@main --subdirectory plugins/attention
```

Open **Attention** in the sidebar. Pick a day and a timezone. The default day
is yesterday in your browser's timezone.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm test
bb plugin build
bb plugin install . --yes
```

`bb plugin dev` rebuilds and reloads on change while BB is running.

The day reconstruction is a pure function in `lib/day.ts` with unit tests
covering DST boundaries, turn pairing, steer attribution, question outcomes,
cross-midnight clipping, and concurrency. `app.tsx` is covered by the plugin
SDK's slot test harness.
