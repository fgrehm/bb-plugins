# RPIV Todo

Shows a Pi agent's to-do list in BB, above the thread's composer, using BB's own to-do chrome: an `N/M complete` header, a spinner on the active step, and the list sorted in-progress first.

BB draws that panel itself for Cursor `TodoWrite` and Claude `TaskCreate`/`TaskUpdate`, driven by a `pendingTodos` field plugin UI cannot write. Pi's [`@juicesharp/rpiv-todo`](https://www.npmjs.com/package/@juicesharp/rpiv-todo) tool is named `todo` and is not on that list, so this plugin rebuilds the list from the thread's completed `todo` tool calls and renders it with the same chrome.

## Install

Both halves are needed. The Pi extension produces the list; this plugin only draws it.

```sh
pi install npm:@juicesharp/rpiv-todo
bb plugin install path:/path/to/bb-plugins/plugins/rpiv-todo
```

Start a new Pi session after installing the extension so the `todo` tool loads. The card appears in any thread whose agent writes to-dos, and shows nothing anywhere else.

## Settings

**Expand list when opening a thread** (default on) — Settings → Plugins → RPIV Todo, or:

```sh
bb plugin config rpiv-todo set expandOnEnter false
bb plugin reload rpiv-todo
```

Off keeps only the `N/M complete` header until you expand it.

## What you see

- A card above the composer, collapsed or expanded, with `N/M complete` and the active step's `activeForm` in the header.
- Completed steps checked, the active step spinning with its `activeForm` highlighted in place of the task title, pending steps squared.
- Deleted tasks hidden; `clear` empties the card.

## How it works, and its limits

The plugin is read-only. It reads the thread's event log, replays completed `todo` tool calls through a copy of the extension's reducer (single and batch create, update, delete, clear, legal status transitions, `blockedBy` and cycle checks, `nextId` alignment), and serves the result over RPC. It stores nothing on disk, writes nothing, and makes no network requests.

Each thread's replayed state is cached in memory with the last event sequence it consumed, so a poll asks one one-row probe and then only the events newer than that. The first read of a thread still pages through its history, and a rewritten event log restarts the replay. The cache holds 64 threads and is dropped when the plugin reloads.

- BB does not persist the extension's own `details.tasks` snapshot, so the list is reconstructed from tool calls. A failed tool result is skipped.
- The first read of a thread scans up to 20,000 events, paging 100 at a time, so a very long thread can lose its earliest tasks.
- The reducer mirrors `@juicesharp/rpiv-todo` 2.15.0. If that package changes its rules, this plugin can drift. Keep both updated together.

## Fork

This is a local fork of [ZhenHuangLab/bb-rpiv-todo-renderer](https://github.com/ZhenHuangLab/bb-rpiv-todo-renderer) (MIT, Copyright (c) 2026 Zhen Huang), kept in this repository to hold fixes: upstream pages thread events at 500, which BB 0.47 rejects; it uses the retired `useComposerView()` hook, so the banner cannot mount on Plugin SDK 0.6.x; and its reducer predates the batch `create` shape that `@juicesharp/rpiv-todo` 2.15.0 emits. See `LICENSE` and the repository's [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).

## License

MIT. Upstream copyright is retained in `LICENSE`.
