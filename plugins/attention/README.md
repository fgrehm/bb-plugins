# Attention

See one day of work with coding agents as a timeline: which threads were
executing, when you stepped in, and when an agent was waiting for an answer.

The question it helps answer is narrow: **did parallel agents run on their own,
or did they keep pulling me back in?** It shows recorded activity. It does not
score productivity, attention, or cognitive load.

## What it shows

- **The shape of the day**: a half-hour strip of agent activity, with your
  inputs marked along its base.
- **Threads on one clock**: one row per thread with turn bands, your input
  ticks, and bands for structured requests waiting on an answer.
- **Rhythm**: agent-minutes and your inputs per hour, on the same axis.
- **Busiest recorded windows**: the half hours with the most of your inputs,
  with agent time as the tie-break.
- **Thread cards**: agent time, turns, inputs, and requests for the eight
  busiest threads, each with a miniature timeline.
- **Agent requests**: every structured ask from an agent, with thread, wait,
  and outcome.

Click a thread name or card to open it.

## What it reads

The plugin reads BB's own thread history through the public SDK:

- `threads.list` for thread metadata;
- `threads.events.list` for turn, input, and interaction lifecycle events;
- `threads.events` carries `initiator`, `target.kind`, `turn_id`, and
  interaction status, which is what makes the timeline possible.

It does not read message bodies, tool arguments, or tool output. It writes
nothing to BB, opens no network connection, and sends nothing anywhere. All
data stays in the BB server and is computed on demand.

## Limits worth knowing

- **A turn is not useful work.** It is provider execution time, including model
  latency and tool time.
- **"You" means a local caller without a sender thread.** The desktop UI, a
  plain `bb thread tell` in a shell, and an external script look the same.
  `bb thread tell` run from inside a BB thread is correctly marked as another
  agent.
- **Reading and focus are not recorded by BB.** Thread switches count changes
  between your recorded inputs, not changes in what you were looking at.
- **Only structured requests count.** Questions and approvals raised through an
  interaction are recorded. A question typed into an assistant reply is
  invisible, and a request opened before the selected day and answered during
  it is not shown.
- **Queued messages are timed at dispatch.** BB deletes the queue row when the
  message goes out, so the wait between typing and sending is not in history.
- **Token and context history is not per turn.** BB keeps only the latest
  snapshot per thread, so this plugin does not show cost.
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
