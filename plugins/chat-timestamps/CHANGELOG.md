# Changelog

## 2026-10-28

### Added

- Fork of [`bb-plugin-chat-timestamps`](https://github.com/pixexid/bb-plugin-chat-timestamps) (MIT): relative message times in BB's action strip, with the exact time in the tooltip.
- On-demand backfill of older timeline pages, so messages outside the newest page get their timestamps when scrolled into view.
- Tests for the client state machine, DOM decoration, formatting, and server paging helpers.
- README section comparing this fork with upstream, with provenance and a diff command.

### Changed

- Updated to Plugin SDK 0.6 and the current `zod` 4 range.
- Newest-page and older-page reads are separate RPC methods; one unreadable thread no longer fails the whole poll.
- Timestamps refresh immediately after navigating to a thread instead of waiting for the next poll, which now runs every 30 seconds instead of 15.

### Fixed

- Timestamps never appeared on touch screens unless a message was briefly focused, and tapping made them flicker; they now stay visible at rest when the pointer cannot hover.
- A failed or overlapped initial history request left older messages without timestamps for the rest of the session.
- A fixed 12-page history window meant messages older than it never received a timestamp.
