# Changelog

## 2026-10-21

### Added

- Thread-family attention history from day thread cards: parent and descendants across days, adjustable recorded visits, daily input/request/execution timelines, date windows, expandable visits and waits, and explicit coverage limits. Calendar totals and human-time estimates remain unchanged.
- Period navigation, current-period auto-refresh, Markdown summary copying with estimate assumptions, hidden-thread badges, and bounded lookback for overnight requests.

- An **Attention** page in the sidebar: one day of agent work as a timeline,
  with per-thread turn bands, human input markers, structured agent questions,
  running-turn concurrency, and input density.
- A pure day reconstruction with unit coverage for DST boundaries, turn
  pairing, steer attribution, question outcomes, cross-midnight clipping, and
  concurrency.
- Reads BB thread history through the public SDK; no message bodies, tool
  arguments, tool output, or network access.
