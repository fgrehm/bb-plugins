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

## Desktop chrome

- Closing the review panel with BB's pane close button returns to BB's home rather than the thread that opened it; the panel's **Back** button returns to the thread. The plugin cannot intercept the host's close action. Opening the review beside the conversation, on a thread-scoped surface, would close back into the thread; that change is not scheduled.

## Base branch suggestion

- The suggestion trusts the host's environment metadata for the current branch; if that metadata is stale it could name the branch you are already on, which would capture nothing. It also assumes `origin` when the branch has no configured upstream, and needs the host's default-branch metadata to probe a remote ref at all. Neither case refuses the target, so the field stays editable and the note keeps naming its source.

## Review checks

Files mode shows the current scope as a continuous document. Path search and comment/viewed filters live in the changed-file sheet on phones and narrow navigation only. Tour mode shows one selected logical section at a time, stepped with the progress control or its section list. Keyboard navigation alone never advances viewed state.

On phones, review actions live in the header `•••` menu (revision history, full screen, review target) and the feedback dialog opens from the bottom Feedback tab. The new-comment composer opens in a bottom sheet that names the file and line range; dismissing it with a typed draft keeps the draft behind a "Resume draft" banner. Reply and edit editors stay inline in the diff. Line wrap and the unified/split layout sit with Files/Tour in a **Diff display** group, carry hover labels, and are remembered across reloads; split view is cramped below tablet width. **Viewed & next** is in the phone toolbar and in the desktop controls row, so a file can be marked viewed at any scroll position. The header `Compare / refresh` menu appears only once a snapshot exists, and both header menus close on Escape or a click outside.

After installing or reloading the plugin, check the base-branch suggestion (prefilled field, the one-line note, and the **Committed vs <base>** / **Everything vs <base>** presets) in a checkout on the default branch and in a detached-HEAD or remote-less one, check starting a review in a thread that has none (the start card and the phone `•••` **Open a review…** item), Files/Tour switching, file navigation while scrolling and via the changed-file sheet (including its search and filters), mark-viewed collapse and expansion, marking viewed from the desktop toolbar at the top and bottom of a long document, section chips and the section Reviewed mark (plus the "n of N" count) staying independent from file viewed state, the wrap and unified/split layout toggles surviving a reload, Escape and outside-click dismissal of both header menus, old/new keyboard range selection, per-file feedback, and explicit batch send in desktop and narrow layouts.
