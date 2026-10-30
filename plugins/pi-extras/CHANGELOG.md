# Changelog

## 2026-10-30

### Added

- Warn when a Pi thread's workspace has trust-gated resources but no saved Pi project-trust decision: a warning segment above the message box, a sidebar row badge, a first-turn agent notice naming the skipped paths, and a thread panel with an explicit **Trust <workspace> for Pi** action that writes Pi's per-directory decision exactly as `pi /trust` does.
- Read Pi's trust store and `defaultProjectTrust` read-only, mirroring Pi's own resource scan, parent lookup, and canonicalization; the store is written only on the panel's button press.
- Add a Refresh control that bypasses the plugin and host caches and re-reads trust state, including from the unknown and no-resources states.

### Fixed

- Fail closed when Pi's trust store exists but cannot be read. Saves resolve a symlinked store to its target and replace it atomically while preserving its mode, so a failed write leaves existing decisions intact.
- Bind the Trust action to the machine and canonical workspace shown on the button, and reject the write if either changed before it landed.
- Keep cache entries from outliving their observation window, never cache unknown answers, invalidate sibling threads and path aliases after a save, and discard reads or keyed batches that started before one.
- Isolate an offline machine so it cannot fail a keyed read for threads on other machines, bound workspace cache growth, and return unknown rather than an invalidated snapshot when saves interrupt every retry.
- Describe trust as observed policy for the next Pi session rather than what the running session loaded, bound the generated instruction length, and stop warming or reading the host for non-Pi threads.
- Resolve `PI_CODING_AGENT_DIR` like Pi, including `file://` URLs and Windows shell paths, and follow dangling symlink chains rather than replacing an intermediate link.
- Use the `SecurityCheck` glyph for the trust tab; `ShieldAlert` is not in BB's icon set and fell back to `Zap`.

## 2026-10-27

- Estimate token usage and cost from local Pi session transcripts, with backend, model, project, and day breakdowns.
- Show subscription usage for Pi-managed Codex, OpenCode Go, and Ollama Cloud accounts.
- Manage Pi defaults, model scope, runtime settings, model catalogs, and extension updates from BB.
- Register Pi-powered thread-title and commit-message services, selectable independently in BB AI service settings.
