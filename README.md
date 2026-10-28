# bb-plugins

A collection of [BB](https://github.com/get-bb/bb) plugins I maintain, installable from bb's plugin marketplaces as a third-party catalog.

## Project and contributions

This is personal software: I build these plugins primarily for my own use and share them in case they are useful to others. The plugins are pre-release and may change as my needs evolve. Feel free to fork and adapt them under the MIT license. Questions, ideas, and feedback are welcome in GitHub Discussions; issues and pull requests are reserved for my own tracking and development workflow. I may consider a broader contribution model if interest grows.

## Install

Add the catalog once per machine, then install plugins by id:

```sh
bb marketplace add git:github.com/fgrehm/bb-plugins@main
bb plugin install attention@fgrehm-plugins
```

Available ids: `attention`, `chat-timestamps`, `favicon`, `pi-extras`, `rate-your-chat`, `review-workspace`, `rpiv-todo`.

Catalog entries track the `main` branch, so updates are the same on every machine:

```sh
bb plugin outdated
bb plugin update --all
```

A single plugin can still be installed directly, without the catalog:

```sh
bb plugin install git:github.com/fgrehm/bb-plugins@main --subdirectory plugins/pi-extras
```

These are full-trust, pre-release plugins. Review the source before installing. BB records the resolved commit so updates and removal keep working.

For local development, clone the repository and install a plugin by path, or use `bb plugin dev` for live rebuilds:

```sh
bb plugin install path:/path/to/bb-plugins/plugins/<id>
```

The catalog uses marketplace schema v2, so BB versions that only support v1 catalogs cannot read it.

## Plugins

### [Pi Extras](plugins/pi-extras) - `pi-extras`

Pi-focused usage extras in a single sidebar panel with two tabs:

- **Sessions** - estimated token usage and cost computed from local Pi session transcripts, broken down by the backend each session used (Codex, OpenCode Go, Ollama Cloud), with per-provider marks. Backed by a durable parse cache. Adapted from [iamEvanYT/bb-usage-page](https://github.com/iamEvanYT/bb-usage-page), scoped to Pi.
- **Subscriptions** - live subscription usage for Pi-managed Codex, OpenCode Go, and Ollama Cloud credentials (read from Pi's `auth.json`, never logged or displayed), with a short TTL cache for snappy tab switches.
- **Thread titles and commit messages** - registers Pi as a BB AI service for both tasks. Select Pi independently for each under Settings → AI services, with separate model choices in the settings panel.

### [Favicon](plugins/favicon) - `favicon`

Replaces the browser tab favicon with uploaded light/dark SVG artwork. Reacts to bb's theme changes; artwork is managed from the plugin's settings section.

### [Review Workspace](plugins/review-workspace) - `review-workspace`

Diff-first asynchronous review workspaces inside a thread: snapshots uncommitted changes, individual commits, or committed branch diffs as immutable revisions, lets a reviewer select exact line ranges in the diff and anchor comments, carry unresolved comment threads forward to refreshed revisions, and send a batch of feedback to the agent in that same BB thread. The sidebar's Recent reviews page resumes each thread's latest saved review, with pending-comment counts and viewed-file progress.

### [Attention](plugins/attention) - `attention`

A day timeline of work with coding agents: one row per thread, bands for agent
turns, markers for your own inputs, and bands for structured questions waiting
on an answer, with running-turn concurrency and input density below. Reads BB's
thread history through the public SDK and computes on demand; it does not read
message bodies, tool arguments, or tool output. A turn is execution time, not
useful work, and BB records no reading or focus.

### [Chat Timestamps](plugins/chat-timestamps) - `chat-timestamps`

Shows a relative timestamp for sent and received messages in BB's own message action strip, with the exact local date and time in the tooltip. The timestamp appears on hover or focus. Reads message times through the public thread timeline API and fetches older pages only as older messages come into view. A local fork of [pixexid/bb-plugin-chat-timestamps](https://github.com/pixexid/bb-plugin-chat-timestamps) that removes the fixed history window and fixes retry handling.

### [Rate Your Chat](plugins/rate-your-chat) - `rate-your-chat`

Skippable whole-chat feedback offered after archiving. Stores usefulness, use case, notes, and recorded model/reasoning variations in local SQLite, with editing and JSON export. No feedback is sent to providers.

### [RPIV Todo](plugins/rpiv-todo) - `rpiv-todo`

Shows a Pi agent's to-do list above the thread's composer in BB's native to-do card: an `N/M complete` header, a spinner on the active step, in-progress first. The agent owns the list and the plugin only reads it, rebuilding it from the thread's `todo` tool calls because BB's own panel does not recognize Pi's tool. Needs `npm:@juicesharp/rpiv-todo` installed in Pi and a new session for the tool to load.

## Repo layout

Each plugin is self-contained under `plugins/<id>/` with its own `package.json` and lockfile (pnpm). [`marketplace.json`](marketplace.json) at the root is the published v2 catalog BB reads. Its `overview` fields are generated from each catalogued plugin's `PLUGIN_OVERVIEW.md`; other catalog metadata stays hand-authored. Catalog entries point at `main` with a per-plugin `subdir`, so `bb plugin outdated` compares the installed commit with the branch head; there are no release tags to manage. Each plugin's `CHANGELOG.md` is a rolling, dated log rather than a release history, and package versions are not maintained: they stay at `0.1.0`, like BB's bundled plugins, so the installed commit identifies the build.

## Marketplace copy

Keep the short description in the manifest and catalog aligned. Author the longer store description in `plugins/<id>/PLUGIN_OVERVIEW.md`; keep installation, usage, development details, and embedded images in the plugin's `README.md`. BB shows the catalog overview on its plugin detail page, not the README.

After editing an overview, run from the repository root:

```sh
node scripts/sync-marketplace-overviews.mjs
node scripts/sync-marketplace-overviews.mjs --check
node --test scripts/sync-marketplace-overviews.test.mjs
```

The sync command updates only the catalog's overview values for listed plugins. `--check` reports drift without writing; CI and prek run this check and its tests. Missing, empty, or oversized sources fail without updating the catalog.

Store overviews support a restricted Markdown subset, not embedded images. Add image URLs to the separate `screenshots` field in `marketplace.json` for the screenshot gallery. This catalog reuses the existing plugin assets via HTTPS raw-GitHub URLs. See the [overview rules](https://github.com/get-bb/marketplace#long-form-description) and [screenshot guidance](https://github.com/get-bb/marketplace#screenshots-and-icons). Some existing settings captures are narrower than the Community marketplace submission minimum; recapture those before a Community submission rather than upscaling them.

Local `path:` installs do not use catalog overviews or screenshot galleries on their Installed plugin page. Adding `PLUGIN_OVERVIEW.md` alone does not change that page.

## Development

```sh
cd plugins/<id>
pnpm install
pnpm run typecheck   # or pnpm run lint on some plugins
pnpm test            # where tests exist
bb plugin install . --yes   # install into a running bb from the source dir
bb plugin reload <id>       # rebuild + reload after edits
```

Install the repository's [prek](https://prek.ag) hooks before committing:

```sh
prek install
prek run --all-files
```

Pre-commit hooks validate JSON, run plugin typechecks, and check Review Workspace formatting. The heavier plugin test suites run before pushes. GitHub Actions runs the full plugin matrix on pushes and pull requests. Hooks are grouped by plugin and concern, for example `prek run --group pi-extras` or `prek run --group format`.

Requirements: node ≥ 22, pnpm, and a bb ≥ 0.42 install.

Licensed under MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
