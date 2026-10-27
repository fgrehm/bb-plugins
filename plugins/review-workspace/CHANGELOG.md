# Changelog

## 2026-10-27

- Render tour narrative notes and the tour overview as Markdown, so notes show inline code, lists, and links.
- Capture large changesets: a snapshot with 100 changed files still records every patch.
- Review on a phone with a bottom-sheet comment composer that shows the file and line context it is anchored to; dismissing the sheet with a typed draft keeps it anchored behind a "Resume draft" banner.
- Keep phone chrome to three rows: the header holds the back link, title, and a `•••` menu (revision history, full screen, review target), the mode row holds Files/Tour plus the line wrap and unified/split layout toggles, and one document toolbar row holds prev/next, the changed-file sheet trigger, More, and Viewed & next.
- Open the full-width changed-file sheet for per-file status, add/delete counts, viewed state, open-thread badges, path search, and comment/viewed filters; per-file headers use compact icon actions and truncate long paths.
- Step through tour sections with progress ("Section n of N") and previous/next controls, an inline section list, quieter tour excerpts with compact headers, a one-line caveat, and a slim coverage summary.
- Suggest the base branch for **Committed vs base** and **Everything vs base** from the thread's environment (host merge base, the branch the environment came from, the branch's upstream, or the remote default), show where the suggestion came from, prefill the blank field only, and add one-click **Committed vs <base>** / **Everything vs <base>** presets.
- Start a review from the panel itself: a thread without a snapshot shows a start card with the target controls and its **Open review** action, and the phone `•••` menu names the same action **Open a review…**.
- List the files each tour section shows as chips that jump to their excerpt, mark sections **Reviewed** with revision-scoped progress that stays separate from file viewed state, and switch any diff between unified and split layout from the mode row.
- Keep tour excerpts focused: excerpt diffs use simple hunk separators rather than the unanchored remainder of a large file, and phone sheets are anchored below their trigger so the host header and status bar stay clear.
- Create immutable review snapshots of uncommitted changes, a single commit, or committed changes against a base branch, and compare each file against its latest explicitly marked viewed revision.
- Read changes in two modes: Files, one continuous document with jump navigation and per-file collapse/viewed controls, or Tour, agent-authored sections that interleave explanation with exact code excerpts across files.
- Leave inline or whole-file comments, a review note, and replies to AI comments; edit or delete your own unsent feedback, and send everything unsent and unresolved in one explicit batch to the owning thread.
- Resume reviews from the sidebar's Recent reviews page, and rely on automatic cleanup of archived-thread reviews and deleted threads.
- Use Vim-style keyboard navigation, bounded deferred loading for generated or oversized diffs, and cached image previews for binary changes.
