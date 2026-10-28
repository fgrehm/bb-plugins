# Chat Timestamps

Shows a compact relative timestamp in BB's existing message action strip. On a desktop it appears when you hover or focus a message; on a touch screen it stays visible beside the message actions. It covers messages sent by you, agent replies, and messages delivered from other agent threads. Hover the timestamp for the exact local date and time.

## Install

From this repository's catalog:

```sh
bb plugin install git:github.com/fgrehm/bb-plugins@main --subdirectory plugins/chat-timestamps
```

Or from a local checkout:

```sh
bb plugin install path:/path/to/bb-plugins/plugins/chat-timestamps
```

Requires BB 0.47 or newer.

## How it works

A content script decorates the existing timeline rows, so the timestamp sits in BB's own action strip and follows the theme's muted text color. The plugin server reads message times through the public thread timeline API and serves them over RPC. It stores nothing on disk, writes no thread data, and makes no network requests.

- The client asks for the newest timeline page of each visible thread (the open thread and threads visible in split panes or the sidebar header) immediately after a route change, and every 30 seconds otherwise.
- Older timeline pages are read only when messages without a loaded time appear in view, so scrolling up fills in their timestamps progressively.
- Message times are cached in memory for the current frontend session; the cache is dropped when the plugin reloads.

## Limits

- The timestamp is placed with BB's current timeline markup and class names, not a public message-action API. A BB markup change can move or hide it until the plugin is updated.
- Older pages are backfilled for the open thread. In a split pane, older messages from the other thread keep their timestamps only after the newest page covers them.
- A timestamp appears for conversation messages only; tool rows, turn markers, and other timeline entries do not get one.
- Touch screens show every timestamp at rest, because there is no hover to reveal it.
- The exact time uses the browser's local time zone and locale.

## Fork

This is a local fork of [pixexid/bb-plugin-chat-timestamps](https://github.com/pixexid/bb-plugin-chat-timestamps), forked at its only commit [`d244217`](https://github.com/pixexid/bb-plugin-chat-timestamps/commit/d244217f0b9e5681c3a82edcec84facc5470165a) (MIT, Copyright (c) 2026 Pixexid, version 0.1.0). It is kept here to hold fixes rather than as a tracking copy.

### Changes from upstream

| Area                           | Upstream                                                                                                                             | This fork                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Refresh cadence                | Polls every 15 seconds, including after navigating to a different thread.                                                            | Refreshes immediately when the route changes, then polls every 30 seconds.                                                                   |
| History loading                | Imports up to 12 timeline pages on first sight of a thread, and re-imports them when the visible thread set changes.                 | Reads the newest page per visible thread and walks older pages one at a time while unlabeled messages are in view. Loaded times stay cached. |
| Failed request                 | Records a thread's history as loaded before the request succeeds, so a failure leaves older messages unlabeled for the session.      | A failed refresh changes no state, so the next poll retries it.                                                                              |
| Thread switch during a request | A refresh that starts while another is in flight can skip the new thread and still record it as loaded.                              | The in-flight refresh is ignored; the next poll reads the new thread.                                                                        |
| One unreadable thread          | Fails the whole refresh, so no thread decorates.                                                                                     | Logs the failure, skips that thread, and returns the others.                                                                                 |
| RPC                            | One `messageTimes({ threadIds, includeHistory })` method.                                                                            | `messageTimes({ threadIds })` returns per-thread cursors, and `olderMessageTimes({ threadId, cursor })` walks one page further back.         |
| Touch screens                  | The timestamp is revealed only by `:hover`/`:focus-within`, so it stays invisible at rest and flickers when a tap focuses a message. | `(hover: none)`/`(pointer: coarse)` keeps it visible at rest, matching BB's own message actions.                                             |
| Toolchain                      | Plugin SDK 0.4.34, `zod` 4.3, `node:test`, npm lockfile.                                                                             | Plugin SDK 0.6.79, `zod` 4.6, Vitest with jsdom, pnpm, Prettier.                                                                             |
| Tests                          | One server test for collecting message times.                                                                                        | Server paging, loader retry/cursor behavior, DOM decoration, and formatting.                                                                 |

### Unchanged from upstream

- The visual placement, relative thresholds (`just now`, `Nm ago`, `Nh ago`, `Nd ago`), exact-time tooltip, and eight-thread cap.
- The read-only model: no disk writes, no thread changes, no outbound network requests.

### Why this stays a fork

Upstream still imports a fixed history window and still records history before its request succeeds. No upstream contribution is planned for now, so those fixes live here. If upstream adopts them, this fork can be retired.

### Why the plugin works this way

BB has no plugin surface for inline per-message metadata. `app.messageAction` renders host-owned icon buttons with a static title, not custom inline content, and a content script gets no SDK access. An inline timestamp therefore needs DOM decoration for placement and a server RPC for the message times. The built-in exact time in BB's Message actions menu is unchanged and still available.

### Diffing against upstream

```sh
git clone https://github.com/pixexid/bb-plugin-chat-timestamps /tmp/chat-timestamps-upstream
git -C /tmp/chat-timestamps-upstream checkout d244217
diff -ru --exclude=node_modules --exclude=dist /tmp/chat-timestamps-upstream . | less
```

See `LICENSE` for the upstream and modification copyright lines, and the repository's [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) for the attribution summary.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm test
bb plugin build
bb plugin install .
```

## License

MIT. See `LICENSE`.
