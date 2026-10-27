# Changelog

## 2026-10-27

- Updates zod to 4.6.7 for a memory-exhaustion advisory in versions below 4.6.6.

## 2026-10-18

- Let an agent draft a retro for its own chat or a direct subthread through the `file_retro` tool, with confirmation or discarding in the sidebar.
- Record which thread drafted a confirmed rating and bump the JSON export schema to 3.
- Offer skippable whole-chat ratings only after archiving a visible chat, with no always-visible rating action.
- Rate usefulness from 1 to 5, select one or more purposes (coding, design, debugging, review, research, planning, writing, other), and add an optional note.
- Capture recorded model and reasoning variations, provider fallbacks, and partial-metadata warnings from local BB event history when saving.
- Keep one editable rating per chat in local SQLite, shared across clients, with stale-write protection and retained drafts after failed saves.
- Review, edit, delete, and export saved ratings as JSON from the sidebar, with no provider calls.
