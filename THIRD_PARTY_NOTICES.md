# Third-party notices

This repository is MIT licensed (see `LICENSE`, which credits Fabio Rehm). Vendored license files retain the upstream authors' copyright notices and credit Fabio Rehm for local modifications. It includes code adapted from the following third-party projects:

## iamEvanYT/bb-usage-page

- Source: https://github.com/iamEvanYT/bb-usage-page
- License: MIT - Copyright (c) 2026 iamEvan (full license text: `plugins/pi-extras/usage-page/LICENSE`)
- Used in: `plugins/pi-extras/usage-page/` (session-transcript usage dashboard, vendored and then scoped down to Pi sessions only - the Claude Code, Codex, and Cursor sources and the Cursor HTTP integration were removed)
- The Codex provider mark is taken from this project.

## get-bb/bb

- Source: https://github.com/get-bb/bb
- License: MIT - Copyright (c) 2026 Michael Yong
- Used in: `plugins/pi-extras/usage-page/components/usage/providers.tsx` (the OpenCode provider mark, from bb's landing icons)
- Used in: `plugins/rate-your-chat/components/ui/` and `plugins/rate-your-chat/lib/utils.ts` (BB scaffold UI controls and styling helpers; full license text: `plugins/rate-your-chat/components/LICENSE`)

## ZhenHuangLab/bb-rpiv-todo-renderer

- Source: https://github.com/ZhenHuangLab/bb-rpiv-todo-renderer
- License: MIT - Copyright (c) 2026 Zhen Huang (full license text: `plugins/rpiv-todo/LICENSE`)
- Used in: `plugins/rpiv-todo/` (forked at 0.1.2; event pages changed from 500 to 100 to match BB 0.47's limit, and reducer/paging tests added)

## pixexid/bb-plugin-chat-timestamps

- Source: https://github.com/pixexid/bb-plugin-chat-timestamps
- License: MIT - Copyright (c) 2026 Pixexid (full license text: `plugins/chat-timestamps/LICENSE`)
- Used in: `plugins/chat-timestamps/` (forked at 0.1.0 commit `d244217`; history loading replaced with on-demand backfill, the client request state and touch-screen visibility fixed, the RPC split, dependencies updated, and tests added; the differences are listed in the plugin README)

## simple-icons/simple-icons

- Source: https://github.com/simple-icons/simple-icons
- License: CC0-1.0 (icon path data; Ollama is a trademark of Ollama Inc.)
- Used in: `plugins/pi-extras/usage-page/components/usage/providers.tsx` (the Ollama provider mark)
