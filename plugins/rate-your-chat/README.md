# Rate Your Chat

Local whole-chat feedback with recorded model and reasoning variations for later analysis.

This is an uncatalogued experiment for [BB](https://github.com/get-bb/bb). It never sends feedback to providers and runs no analysis of its own. A retro is drafted by the chat's own agent only when you ask for one, and nothing becomes a rating until you confirm it.

## Workflow

1. Archive a visible chat normally. Once the archive completes, a skippable rating dialog appears. There is no always-visible rating button, and archiving is never blocked by the plugin.
2. Choose usefulness from **1 (Not useful)** to **5 (Very useful)**, select one or more use cases (for example coding and review for a mixed chat), and optionally leave a note.
3. **Save rating** captures the chat's recorded model and reasoning variations and saves feedback locally. **Skip this chat**, Escape, or clicking outside dismisses this archive's prompt without storing a rating.
4. Open **Chat ratings** in the sidebar to review, edit, delete, or export saved feedback as JSON. Editing feedback preserves its captured history; archiving the chat again offers another prompt and saving updates that history.
5. Ask a chat for a retro when you want one. The agent can draft a retro for itself or for a direct subthread it spawned. Drafts wait under **Chat ratings** as retros for you to **Confirm** or **Discard**, and confirming one turns it into that chat's rating. The plugin does not tell agents when to file retros; they appear only when asked.

There is one editable rating per chat, shared across BB clients. A retro draft is not a rating: it lives in the plugin's drafts table, appears only in the sidebar list and as a prefill in the archive dialog, and is deleted when you confirm or discard it, when you delete that chat's rating, or when the chat is deleted. Ratings saved before multiple purposes were supported are read as a single-item use-case list and rewritten in the new shape when edited. Concurrent stale edits are refused instead of overwriting newer feedback, including after deletion and recreation. Failed saves retain the draft. Skipped prompts stay dismissed across reloads. Multiple archives, including cascade archives, are queued oldest first; hidden threads are ignored. Pending prompts survive plugin reloads. Before offering a prompt, the plugin checks current local thread metadata and removes obsolete prompts, including when an unarchive or delete event was missed while disabled. Reconciliation checks up to 20 queued prompts per request with a 10-second deadline; lookup failures retain prompts for retry. Archives made while the plugin is disabled or before installation are not backfilled.

## Screenshots

These captures use illustrative feedback in the live BB interface, not real user ratings.

### After archiving

A short, optional whole-chat rating, shown only after an archive.

![Optional rating dialog after archiving a chat](assets/screenshots/archive-rating.png)

### Review your feedback

Saved ratings show the use cases and recorded model/reasoning variations, with edit, delete, and export controls. Retros an agent drafted wait above them for confirmation.

![Local chat ratings with model and reasoning variations](assets/screenshots/chat-ratings.png)

## What model history means

The plugin reads filtered, paginated **local BB event history** when you save. It records each dispatch's requested model and reasoning level, returns to earlier combinations, and provider-reported model fallbacks. Model identifiers are kept exactly as BB recorded them, including backend prefixes for Pi. Provider identity comes from the thread metadata.

The score belongs to the whole conversation. A mixed-model chat is not several independent ratings, and the plugin does not assign its score to each model. Variation counts are recorded observations, not guaranteed completed turns. Rejected dispatches are preserved in the export and SQLite observations but excluded from displayed variation counts. Companion lifecycle records are deduplicated when they repeat modern request metadata. When a retro is confirmed, history is captured at confirmation time, not when the draft was filed.

Capture reflects available evidence, not an assertion that every provider actually used every requested setting. Missing legacy metadata is flagged as partial, fallback reasoning is marked unknown, and no current defaults are substituted. BB does not record unused picker changes or all provider-internal routing. Child and source-thread histories are not folded into this chat's history. Capture stops at a fixed metadata sequence boundary; later turns require rearchiving and saving again.

Each save has a 30-second read deadline and captures up to 10,000 relevant events. Exceeding the event limit produces an explicit partial-history warning. Read failures do not replace existing feedback or its history. No transcripts are scanned from disk, and no background history collection runs.

## Storage and privacy

Uses BB's plugin-owned SQLite database at `<BB dataDir>/plugins/rate-your-chat/data.db`, on the **BB server**, not necessarily the device running your browser. The `ratings` table holds the feedback and captured history, `observations` has SQL-queryable model/reasoning evidence, `retro_drafts` holds unconfirmed agent retros, the `prompts` table tracks pending archive prompts, and `revision_clock` retains a counter to prevent stale writes after feedback deletion. The database is not encrypted by this plugin.

Feedback includes thread/project identifiers, a thread title snapshot, provider ID, archive/save times, usefulness, use cases, notes, execution metadata, and, for confirmed retros, which thread drafted it and when. A rating confirmed on a live chat has no archive time. Filtered request events can contain prompt content in memory, but only execution metadata is extracted: prompt text, replies, tool output, credentials, and raw event payloads are never copied into the feedback database or export. Notes and titles may still be sensitive.

Confirmed feedback is not added to chat messages, thread metadata, instructions, logs, or bundled skills. The plugin registers one agent tool, `file_retro`, which writes only draft records to its own local database and refuses any subject other than the calling chat or a direct subthread with the same project. Drafts are excluded from the JSON export. No external service, telemetry, API key, or account is used. BB plugins and local agents are full-trust code; the parentage check is a sanity bound, not an access-control boundary. All clients connected to the same BB server share this dataset.

Ratings survive thread archival and deletion until explicitly deleted in **Chat ratings**. Deletion removes the saved feedback and observations, not BB's original chat history. SQLite can retain deleted bytes in free pages or WAL files; this is not secure erasure. JSON export is an explicit browser download at `schemaVersion` 3, includes all captured observations and each rating's draft provenance, and pages through saved records. Unconfirmed drafts are never exported. Avoid concurrent edits during export if you need a consistent dataset. Uninstall/backup behavior is governed by BB's plugin storage lifecycle.

## Installation

Review the source before installing, BB plugins run with full trust. From a local checkout:

```sh
cd plugins/rate-your-chat
pnpm install
bb plugin build
bb plugin install . --yes
```

The plugin has no configuration settings, CLI commands, or provider integration. It registers one agent tool, `file_retro`, and contributes no instructions, so agents use it only when you ask. Disable it in Installed plugins to stop new prompts and unload the tool. Existing ratings remain in local storage.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run format
bb plugin build
bb plugin dev
```

Tests cover archive-only prompting, local persistence, skips and reloads, stale-write protection, filtered history pagination, model/reasoning variations, fallbacks, missing metadata, draft retention after errors, retro parentage checks, draft upserts and discards, provenance on confirmation, and cleanup when a chat or its rating is deleted. Vendored BB UI controls retain their [MIT license](components/LICENSE).
