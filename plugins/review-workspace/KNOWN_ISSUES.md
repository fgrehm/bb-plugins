# Known issues

## Review behavior

- Review snapshots are immutable. Refreshing creates a new revision and carries unresolved comment threads and the review note forward. Resolved comments stay on their original revision; comments are never silently remapped.
- Tours stored with the retired per-step body/anchors/card format remain preserved but are not rendered by the current block-based Tour view. Author a new tour on that revision if needed; files and comments remain accessible.
- A refresh includes at most 100 changed files, fetched in batches of 50 paths because the host rejects a single environment diff-patch request that carries more. The environment API may truncate individual patches. Since-viewed comparisons with missing identities, truncated sides, or incompatible bases are marked unknown rather than unchanged.

## Diff limitations

- Large and selected generated patches are captured in the snapshot but deferred from the initial review payload and loaded on demand.
- Files mode mounts diffs as they approach the viewport. Until then, a short placeholder is shown; selecting a file in navigation mounts it immediately.
- Pierre's worker-rendered diff theme can differ from the host theme in some BB views. The plugin disables its worker pool to keep line selection and rendering consistent, so large diffs may render more slowly.
- Safe raster images (PNG, JPEG, WebP, GIF, BMP) can show bounded immutable old/new previews and accept file-level comments. Other binary formats remain file-level only. A side that the environment cannot provide shows as unavailable.

## Mobile sheet follow-ups

- The file sheet and the compare sheet dismiss by tapping the backdrop, but they do not handle Escape, move focus on open, or restore it on close, and the file sheet labels a container of filters and buttons as a listbox. Closing them by pointer works; keyboard and screen-reader use is the gap. The feedback dialog and the comment composer already use proper dialog primitives with focus handling.

## Base branch suggestion

- The suggestion trusts the host's environment metadata for the current branch; if that metadata is stale it could name the branch you are already on, which would capture nothing. It also assumes `origin` when the branch has no configured upstream, and needs the host's default-branch metadata to probe a remote ref at all. Neither case refuses the target, so the field stays editable and the note keeps naming its source.

## Review checks

Files mode shows the current scope as a continuous document. Path search and comment/viewed filters live in the changed-file sheet on phones and narrow navigation only. Tour mode shows one selected logical section at a time, stepped with the progress control or its section list. Keyboard navigation alone never advances viewed state.

On phones, review actions live in the header `•••` menu (revision history, full screen, review target) and the feedback dialog opens from the bottom Feedback tab. The new-comment composer opens in a bottom sheet that names the file and line range; dismissing it with a typed draft keeps the draft behind a "Resume draft" banner. Reply and edit editors stay inline in the diff. Line wrap and unified/split layout toggles live in the mode row; split view is cramped below tablet width.

After installing or reloading the plugin, check the base-branch suggestion (prefilled field, the one-line note, and the **Committed vs <base>** / **Everything vs <base>** presets) in a checkout on the default branch and in a detached-HEAD or remote-less one, check starting a review in a thread that has none (the start card and the phone `•••` **Open a review…** item), Files/Tour switching, file navigation while scrolling and via the changed-file sheet (including its search and filters), mark-viewed collapse and expansion, section chips and the section Reviewed mark (plus the "n of N" count) staying independent from file viewed state, the wrap and unified/split layout toggles, old/new keyboard range selection, per-file feedback, and explicit batch send in desktop and narrow layouts.
