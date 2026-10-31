# Changelog

## 2026-10-31

### Changed

- Tune the archive-rating modal for small screens: tighter padding and spacing, smaller type for the title, description, legends, chips, score cards, and footer, and full-height touch targets for score cards, chips, and the Save and Skip buttons (reverting to desktop sizes above the `sm` breakpoint).

## 2026-10-27

- Let an agent draft a retro for its own chat or a direct subthread through the `file_retro` tool, with confirmation or discarding in the sidebar.
- Record which thread drafted a confirmed rating.
- Offer skippable whole-chat ratings only after archiving a visible chat, with no always-visible rating action.
- Rate usefulness from 1 to 5, select one or more purposes (coding, design, debugging, review, research, planning, writing, other), and add an optional note.
- Capture recorded model and reasoning variations, provider fallbacks, and partial-metadata warnings from local BB event history when saving.
- Keep one editable rating per chat in local SQLite, shared across clients, with stale-write protection and retained drafts after failed saves.
- Review, edit, delete, and export saved ratings as JSON from the sidebar, with no provider calls.
