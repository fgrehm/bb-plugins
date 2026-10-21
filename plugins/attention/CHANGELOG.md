# Changelog

## [Unreleased]

### Added

- An **Attention** page in the sidebar: one day of agent work as a timeline,
  with per-thread turn bands, human input markers, structured agent questions,
  running-turn concurrency, and input density.
- A pure day reconstruction with unit coverage for DST boundaries, turn
  pairing, steer attribution, question outcomes, cross-midnight clipping, and
  concurrency.
- Reads BB thread history through the public SDK; no message bodies, tool
  arguments, tool output, or network access.
