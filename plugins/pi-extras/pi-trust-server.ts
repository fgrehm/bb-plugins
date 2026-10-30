import type { BbPluginApi, ExperimentalHostClient } from "@get-bb/plugin-sdk";
import type { piExtrasHostContract } from "./contract.js";
import type { TrustCheck } from "./trust-types.js";

const CACHE_TTL_MS = 30_000;
/** Pi's scan finds at most a handful of paths; keep agent instructions short anyway. */
const MAX_RESOURCES_IN_INSTRUCTIONS = 6;
/** BB truncates each instruction contribution at 4096 characters. */
const MAX_INSTRUCTIONS_LENGTH = 3_900;
const MAX_WORKSPACES = 500;

type Workspace = { hostId: string; path: string };
type Cached = { checkedAt: number; check: TrustCheck };
type WorkspaceEntry = Cached & Workspace;

function cacheKey(hostId: string, path: string): string {
  return `${hostId}\u0000${path}`;
}

/** Keeps prompt-injected paths from breaking out of their code span or line. */
function quotePath(path: string, maxLength = 400): string {
  const shortened = path.length > maxLength ? `${path.slice(0, maxLength)}…` : path;
  return `\`${shortened.replace(/[\u0000-\u001f\u007f`]/g, " ")}\``;
}

function unknownCheck(path: string, reason: string, hostId: string | null = null): TrustCheck {
  return {
    path,
    hostId,
    storePath: "",
    canonicalPath: path,
    resources: [],
    savedDecision: null,
    savedDecisionPath: null,
    defaultProjectTrust: "ask",
    trusted: true,
    status: "unknown",
    canTrust: false,
    error: reason,
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export interface TrustSupport {
  /** Warms the synchronous cache `configure` reads, for one thread. */
  warm(threadId: string): void;
  /** Per-thread checks for the sidebar badge and the trust panel. */
  readChecks(threadIds: readonly string[]): Promise<Record<string, TrustCheck>>;
  /** Re-reads one thread's state, bypassing server and host caches. */
  refresh(threadId: string): Promise<TrustCheck>;
  /** Saves the decision for the workspace the user saw, refusing a changed target. */
  trustWorkspace(
    threadId: string,
    confirm: true,
    expected: { hostId: string; canonicalPath: string },
  ): Promise<TrustCheck>;
  /** Dynamic instructions for Pi threads whose workspace is not trusted. */
  instructionsFor(context: {
    provider: { id: string };
    environment: { path: string | null };
    host: { id: string };
  }): string | null;
}

export function createTrustSupport(
  bb: BbPluginApi,
  host: Pick<ExperimentalHostClient<typeof piExtrasHostContract>, "call">,
): TrustSupport {
  const byThread = new Map<string, Cached>();
  const byWorkspace = new Map<string, WorkspaceEntry>();
  /**
   * Bumped on every save. A read that started before a save must not install
   * its pre-save answer; it retries instead.
   */
  let epoch = 0;

  type ThreadInfo = { providerId: string; workspace: Workspace | null };

  async function threadInfo(threadId: string): Promise<ThreadInfo> {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.providerId !== "pi" || thread.environmentId === null) {
      return { providerId: thread.providerId, workspace: null };
    }
    const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    return {
      providerId: thread.providerId,
      workspace:
        environment.path === null || environment.hostId === null
          ? null
          : { hostId: environment.hostId, path: environment.path },
    };
  }

  function storeWorkspace(key: string, workspace: Workspace, check: TrustCheck, checkedAt: number): void {
    // Unknown answers recover on the next read, so they never enter the cache.
    if (check.status === "unknown") return;
    if (!byWorkspace.has(key) && byWorkspace.size >= MAX_WORKSPACES) byWorkspace.clear();
    byWorkspace.set(key, { ...workspace, checkedAt, check });
  }

  async function checkWorkspace(
    hostId: string,
    path: string,
    force: boolean,
    forceHost = false,
  ): Promise<Cached> {
    const key = cacheKey(hostId, path);
    const cached = byWorkspace.get(key);
    if (!force && cached !== undefined && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
      return { check: cached.check, checkedAt: cached.checkedAt };
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const startEpoch = epoch;
      const { checks } = await host.call(
        "readTrustChecks",
        forceHost ? { paths: [path], force: true } : { paths: [path] },
        { hostId },
      );
      const answer = checks[path];
      const check = answer === undefined
        ? unknownCheck(path, "Pi trust is unknown for this workspace.", hostId)
        : { ...answer, hostId };
      const checkedAt = Date.now();
      if (epoch !== startEpoch) continue;
      storeWorkspace(key, { hostId, path }, check, checkedAt);
      return { check, checkedAt };
    }
    // A save interrupted every attempt. Never return the invalidated answer;
    // the UI can ask for a fresh read.
    return {
      check: unknownCheck(path, "Pi trust changed while reading it; refresh.", hostId),
      checkedAt: Date.now(),
    };
  }

  async function checkThread(threadId: string, force: boolean): Promise<TrustCheck> {
    const cached = byThread.get(threadId);
    if (!force && cached !== undefined && Date.now() - cached.checkedAt < CACHE_TTL_MS) return cached.check;
    try {
      const info = await threadInfo(threadId);
      if (info.providerId !== "pi") return unknownCheck("", "This is not a Pi thread.");
      if (info.workspace === null) return unknownCheck("", "This thread has no Pi workspace path.");
      const { check, checkedAt } = await checkWorkspace(info.workspace.hostId, info.workspace.path, force);
      // A workspace path can appear after the thread starts, and a failed read
      // can recover. Never cache unknown: it would hide the badge and notice.
      if (check.status !== "unknown") byThread.set(threadId, { checkedAt, check });
      if (byThread.size > MAX_WORKSPACES) byThread.clear();
      return check;
    } catch (cause) {
      return unknownCheck("", errorMessage(cause));
    }
  }

  function buildInstructions(check: TrustCheck, maxResources: number): string {
    const shown = check.resources.slice(0, maxResources).map((resource) => quotePath(resource));
    const omitted = check.resources.length - shown.length;
    const resourceList = omitted > 0 ? `${shown.join(", ")}, and ${omitted} more` : shown.join(", ");
    return [
      `Pi project trust: the saved trust state for this workspace (${quotePath(check.canonicalPath)}) is not trusted.`,
      `Unless a project_trust extension answers otherwise, a new Pi session here skips these project resources: ${resourceList}.`,
      "Begin your first reply by telling the user that Pi would skip those resources and why.",
      "Suggest they open this thread's Pi trust panel in BB to save a trust decision for this workspace,",
      `or run \`pi\` in ${quotePath(check.canonicalPath)} and use /trust.`,
      "A saved decision applies to the next Pi session.",
    ].join(" ");
  }

  return {
    warm(threadId) {
      void checkThread(threadId, false).catch((cause: unknown) => {
        bb.log.debug(`pi trust check failed for ${threadId}: ${errorMessage(cause)}`);
      });
    },

    async readChecks(threadIds) {
      // Resolve the threads first, then read each workspace once: a sidebar can
      // hold many threads in the same checkout, and one host read is enough.
      // A batch that spans a save is recomputed: a cached row captured before
      // the save must not be installed or returned afterward.
      for (let attempt = 0; attempt < 3; attempt++) {
        const startEpoch = epoch;
        const threads = await Promise.all(
          threadIds.map(async (threadId) => {
            const cached = byThread.get(threadId);
            if (cached !== undefined && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
              return { threadId, workspace: null, check: cached.check, checkedAt: cached.checkedAt };
            }
            try {
              const info = await threadInfo(threadId);
              if (info.providerId !== "pi") {
                return {
                  threadId,
                  workspace: null,
                  check: unknownCheck("", "This is not a Pi thread."),
                  checkedAt: Date.now(),
                };
              }
              return {
                threadId,
                workspace: info.workspace,
                check: info.workspace === null ? unknownCheck("", "This thread has no Pi workspace path.") : null,
                checkedAt: Date.now(),
              };
            } catch (cause) {
              return {
                threadId,
                workspace: null,
                check: unknownCheck("", errorMessage(cause)),
                checkedAt: Date.now(),
              };
            }
          }),
        );

        const workspaces = new Map<string, Workspace>();
        for (const entry of threads) {
          if (entry.workspace !== null) {
            workspaces.set(cacheKey(entry.workspace.hostId, entry.workspace.path), entry.workspace);
          }
        }
        const checked = new Map(
          await Promise.all(
            [...workspaces.entries()].map(async ([key, workspace]) => {
              try {
                return [key, await checkWorkspace(workspace.hostId, workspace.path, false)] as const;
              } catch (cause) {
                // One offline host must not discard the healthy host's rows.
                return [
                  key,
                  { check: unknownCheck(workspace.path, errorMessage(cause), workspace.hostId), checkedAt: Date.now() },
                ] as const;
              }
            }),
          ),
        );

        const result: Record<string, TrustCheck> = {};
        for (const entry of threads) {
          result[entry.threadId] =
            entry.check ??
            (entry.workspace === null
              ? unknownCheck("", "This thread has no Pi workspace path.")
              : checked.get(cacheKey(entry.workspace.hostId, entry.workspace.path))?.check ??
                unknownCheck("", "Pi trust is unknown for this workspace."));
        }
        if (epoch !== startEpoch) continue;

        for (const entry of threads) {
          const check = result[entry.threadId]!;
          if (check.status !== "unknown") {
            const checkedAt =
              entry.workspace === null
                ? entry.checkedAt
                : checked.get(cacheKey(entry.workspace.hostId, entry.workspace.path))?.checkedAt ??
                  entry.checkedAt;
            byThread.set(entry.threadId, { checkedAt, check });
          }
        }
        if (byThread.size > MAX_WORKSPACES) byThread.clear();
        return result;
      }
      // Saves kept landing across every attempt. Never return a snapshot that
      // a save invalidated; ask the UI to refresh instead.
      return Object.fromEntries(
        threadIds.map((threadId) => [
          threadId,
          unknownCheck("", "Pi trust changed while reading it; refresh."),
        ]),
      );
    },

    async trustWorkspace(threadId, _confirm, expected) {
      const info = await threadInfo(threadId);
      if (info.providerId !== "pi") throw new Error("This is not a Pi thread.");
      const workspace = info.workspace;
      if (workspace === null) throw new Error("This thread has no workspace path to trust.");
      if (workspace.hostId !== expected.hostId) {
        throw new Error("This thread now runs on a different machine; review its Pi trust panel again.");
      }
      const check = await host.call(
        "saveTrustDecision",
        {
          path: workspace.path,
          confirm: true,
          expectedCanonicalPath: expected.canonicalPath,
        },
        { hostId: workspace.hostId },
      );
      epoch += 1;
      const checkedAt = Date.now();
      // Every alias of this canonical directory shares the decision. Drop them
      // so the next read asks the host again instead of reusing an alias entry.
      for (const [key, entry] of byWorkspace) {
        if (entry.hostId === workspace.hostId && entry.check.canonicalPath === check.canonicalPath) {
          byWorkspace.delete(key);
        }
      }
      for (const [cachedThreadId, cached] of byThread) {
        if (cached.check.canonicalPath === check.canonicalPath) byThread.delete(cachedThreadId);
      }
      storeWorkspace(cacheKey(workspace.hostId, workspace.path), workspace, check, checkedAt);
      byThread.set(threadId, { checkedAt, check });
      bb.realtime.publish("pi-trust", { threadId });
      return check;
    },

    async refresh(threadId) {
      // The explicit control must bypass every cache layer, including the
      // host's short cache, or an external /trust change would go unseen.
      const info = await threadInfo(threadId);
      if (info.providerId !== "pi") return unknownCheck("", "This is not a Pi thread.");
      if (info.workspace === null) return unknownCheck("", "This thread has no Pi workspace path.");
      const workspace = info.workspace;
      const key = cacheKey(workspace.hostId, workspace.path);
      const previous = byWorkspace.get(key)?.check;
      const { check, checkedAt } = await checkWorkspace(workspace.hostId, workspace.path, true, true);
      if (check.status === "unknown") {
        // A failed forced read invalidates what was previously observed: the
        // panel must not fall back to a known answer the host no longer gives.
        const affectedPaths = new Set([workspace.path]);
        if (previous !== undefined) affectedPaths.add(previous.canonicalPath);
        for (const [entryKey, entry] of byWorkspace) {
          if (entry.hostId === workspace.hostId && affectedPaths.has(entry.check.canonicalPath)) {
            byWorkspace.delete(entryKey);
          }
        }
        byWorkspace.delete(key);
        for (const [cachedThreadId, cached] of byThread) {
          if (cached.check.canonicalPath === workspace.path || (previous !== undefined && cached.check.canonicalPath === previous.canonicalPath)) {
            byThread.delete(cachedThreadId);
          }
        }
        byThread.delete(threadId);
      } else {
        byThread.set(threadId, { checkedAt, check });
        if (byThread.size > MAX_WORKSPACES) byThread.clear();
      }
      return check;
    },

    instructionsFor(context) {
      if (context.provider.id !== "pi" || context.environment.path === null) return null;
      const cached = byWorkspace.get(cacheKey(context.host.id, context.environment.path));
      // Instructions are built for a session that is starting now; an expired
      // observation must not claim what that session loaded.
      if (cached === undefined || Date.now() - cached.checkedAt >= CACHE_TTL_MS) return null;
      if (cached.check.status !== "untrusted" || cached.check.trusted) return null;
      const check = cached.check;
      for (const max of [MAX_RESOURCES_IN_INSTRUCTIONS, 4, 2, 1]) {
        const text = buildInstructions(check, max);
        if (text.length <= MAX_INSTRUCTIONS_LENGTH) return text;
      }
      const compact = [
        `Pi project trust: ${quotePath(check.canonicalPath)} is not trusted for Pi, so it skipped ${check.resources.length} project resources.`,
        "Begin your first reply by telling the user that, and suggest this thread's Pi trust panel or `pi /trust`.",
        "A saved decision applies to the next Pi session, not this one.",
      ].join(" ");
      return compact.slice(0, MAX_INSTRUCTIONS_LENGTH);
    },
  };
}
