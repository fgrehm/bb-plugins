See one day of work with coding agents as a timeline: when agents executed, when
you stepped in, and when an agent was waiting for your answer.

## What you get

- **The shape of the day**: a half-hour heat strip of agent activity with your
  inputs along its base.
- **One row per thread** on a single clock: turn bands, your input ticks, and
  structured requests waiting for an answer.
- **Rhythm**: agent-minutes and your inputs per hour on the same axis.
- **Busiest recorded windows**: the half hours where you stepped in most, with
  agent time as the tie-break.
- **Thread cards** for the busiest eight, each with a miniature timeline and
  agent time, turns, inputs, and requests.
- **Agent requests** with thread, wait, and outcome.
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
shown. Queued messages are timed at dispatch, and per-turn token history is not
retained. Archived threads are included; deleted threads are gone.
