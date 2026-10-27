# Changelog

## 2026-10-27

### Added

- Fork of [`bb-rpiv-todo-renderer`](https://github.com/ZhenHuangLab/bb-rpiv-todo-renderer) 0.1.2 (MIT): renders Pi's `todo` tool calls as BB's composer to-do card.
- Reducer tests and event paging tests.

### Changed

- Pages thread events at 100 instead of 500; BB 0.47 rejects any larger limit, which left every fetch failing.
- Uses `useComposer()` and the current composer scopes, so the banner mounts on Plugin SDK 0.6.x.
- Replays the batch `create` shape emitted by `@juicesharp/rpiv-todo` 2.15.0, and a completed task can only be deleted.
- Caches each thread's replayed state and last event sequence, so a poll no longer re-reads the whole timeline. Handler time dropped from roughly 150 ms to about 2 ms on a long thread; a rewritten log restarts the replay.
- Aligns `@types/better-sqlite3` with the SDK's peer range and drops the native dependency, so a catalog install through npm no longer fails with `ERESOLVE`.
- Publishes the plugin in the catalog, tracking `main`.
