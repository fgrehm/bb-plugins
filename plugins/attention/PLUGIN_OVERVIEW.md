See one day of work with coding agents as a timeline: when agents executed, when
you stepped in, and when an agent was waiting for your answer.

## What you get

- **One row per thread** that had activity that day, ordered by how long its
  agents actually ran.
- **Turn bands** showing agent execution, with failed and interrupted turns
  marked separately.
- **Input markers** split by who sent them: you, another agent, or BB itself
  after a child thread finished.
- **Question bands** showing when an agent asked for a decision and how long it
  waited, including timeouts and dismissals.
- **Two summary strips**: how many turns were running at once, and how dense
  your own inputs were across the day.
- A question table with thread, open time, wait, and outcome.

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
recorded inputs, not changes in attention. Only structured agent questions are
shown. Queued messages are timed at dispatch, and per-turn token history is not
retained. Archived threads are included; deleted threads are gone.
