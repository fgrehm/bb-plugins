import { useCallback, useState } from "react";
import {
  experimental_useRpcKeyedQuery,
  experimental_useSidebarThreads,
  useRealtime,
  useRpc,
  type ExperimentalThreadContextSegmentInput,
  type ExperimentalThreadContextSegmentProps,
  type ExperimentalThreadRowMetadataDataInput,
  type ExperimentalThreadRowMetadataProps,
} from "@get-bb/plugin-sdk/app";
import { piExtrasRpcContract } from "./contract";
import type { TrustCheck } from "./trust-types";

type RowThread = { providerId: string; environment: { path: string | null } | null };

function isPiThread(thread: RowThread): boolean {
  return thread.providerId === "pi" && thread.environment?.path != null;
}

/**
 * One shared read for the sidebar badge and the trust panel. Both pass thread
 * ids as keys, so the badge populates the panel's row before it opens.
 */
export function useThreadTrust(threadIds: readonly string[]) {
  // The host caps a keyed read, and bb's sidebar can show more rows than that.
  const keys = threadIds.slice(0, 1000);
  const query = experimental_useRpcKeyedQuery({
    contract: piExtrasRpcContract,
    method: "threadTrustChecks",
    keys,
    enabled: keys.length > 0,
  });
  // A saved decision changes every row in this workspace, badge included.
  useRealtime("pi-trust", () => {
    void query.refetch();
  });
  return { byThread: query.data ?? {}, refetch: query.refetch, error: query.error };
}

/**
 * Row data for the sidebar badge: Pi threads only. Threads running on another
 * provider never ask the host anything, and a thread without a workspace path
 * has nothing to check.
 */
export function usePiTrustRowData({ threads }: ExperimentalThreadRowMetadataDataInput) {
  const piThreadIds = threads.filter(isPiThread).map((thread) => thread.id);
  return useThreadTrust(piThreadIds).byThread;
}

export type PiTrustRowData = ReturnType<typeof usePiTrustRowData>;

/**
 * A metadata-line item, not a control: it marks a Pi thread whose workspace
 * ships project resources Pi skipped. A click opens the thread, where the
 * trust panel offers the decision.
 */
export function PiTrustBadge({ thread, data }: ExperimentalThreadRowMetadataProps<PiTrustRowData>) {
  if (!isPiThread(thread)) return null;
  const check = data?.[thread.id];
  if (check === undefined || check.status !== "untrusted") return null;
  const count = check.resources.length;
  return (
    <span
      className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
      title={`Pi skipped ${count} project resource${count === 1 ? "" : "s"} in ${check.canonicalPath}`}
    >
      <span aria-hidden="true">⚠</span>
      <span>untrusted</span>
    </span>
  );
}

/**
 * The composer's context row is the surface a phone user actually sees above
 * the message box. It shows only for a Pi thread in a workspace Pi skipped, and
 * expanding it opens the same panel the action tab shows.
 */
export function usePiTrustSegmentVisible(input: ExperimentalThreadContextSegmentInput): boolean {
  const { threads } = experimental_useSidebarThreads({ experimental_lifecycles: ["active", "archived"] });
  const thread = threads.find((candidate) => candidate.id === input.threadId);
  const isPi = thread !== undefined && thread.providerId === "pi" && thread.environment?.path != null;
  // Non-Pi threads must not reach the host. The read also warms the badge and
  // panel caches for a Pi thread.
  const { byThread } = useThreadTrust(isPi ? [input.threadId] : []);
  return isPi && byThread[input.threadId]?.status === "untrusted";
}

export function PiTrustSegmentSummary({
  threadId,
  isExpanded,
  onToggle,
}: ExperimentalThreadContextSegmentProps) {
  const { byThread } = useThreadTrust([threadId]);
  const check = byThread[threadId];
  if (check === undefined || check.status !== "untrusted") return null;
  const count = check.resources.length;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isExpanded}
      title={`Pi skipped ${count} project resource${count === 1 ? "" : "s"} in ${check.canonicalPath}`}
      className="inline-flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 transition-colors hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:text-amber-300"
    >
      <span aria-hidden="true">⚠</span>
      <span>
        Pi: {count} resource{count === 1 ? "" : "s"} skipped
      </span>
      <span aria-hidden="true">{isExpanded ? "▴" : "▾"}</span>
    </button>
  );
}

export function PiTrustSegmentDetails({ threadId, isExpanded }: ExperimentalThreadContextSegmentProps) {
  if (!isExpanded) return null;
  return (
    <div className="mt-2 rounded-md border border-border bg-card">
      <PiTrustPanel threadId={threadId} />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all font-mono text-xs">{value}</span>
    </div>
  );
}

/**
 * The trust panel. It reads the same per-thread check as the badge and writes
 * only from the button below, which saves the decision `pi /trust` saves. A
 * saved decision applies to the next Pi session, so the panel says that
 * instead of implying the running thread changes.
 */
export function PiTrustPanel({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof piExtrasRpcContract>();
  const { byThread, refetch, error: queryError } = useThreadTrust([threadId]);
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const check = byThread[threadId];

  const save = useCallback(async () => {
    if (check === undefined || check.hostId === null) return;
    // Bind the write to the workspace shown on the button. The server and host
    // reject it if the thread or a symlink moved in the meantime.
    setPending(true);
    setSaveError(null);
    try {
      await rpc.call("trustThreadWorkspace", {
        threadId,
        confirm: true,
        workspace: { hostId: check.hostId, canonicalPath: check.canonicalPath },
      });
      await refetch();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Unable to save the trust decision.");
    } finally {
      setPending(false);
    }
  }, [check, rpc, refetch, threadId]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      // Bypass the server and host caches; an external /trust change would
      // otherwise stay invisible until both TTLs expired. The server drops
      // invalidated observations, so the refetch cannot return the old answer.
      await rpc.call("refreshThreadTrust", { threadId });
      await refetch();
    } catch (cause) {
      setRefreshError(cause instanceof Error ? cause.message : "Unable to refresh Pi trust state.");
    } finally {
      setRefreshing(false);
    }
  }, [rpc, refetch, threadId]);

  if (check === undefined) {
    return (
      <div className="space-y-2 p-4 text-sm">
        <p className="text-muted-foreground">Checking Pi project trust…</p>
        {queryError === null ? null : <p className="text-destructive">{queryError.message}</p>}
        <button type="button" onClick={() => void refresh()} disabled={refreshing} className="text-xs underline underline-offset-2 disabled:opacity-50">
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    );
  }

  if (check.status === "no-resources") {
    return (
      <div className="space-y-2 p-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p>Pi project trust gates nothing in this workspace.</p>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <p className="text-muted-foreground">
          A bare <code>.pi</code> directory needs no decision. Pi skips project settings, MCP servers, extensions,
          skills, prompts, themes, system prompts, and <code>.agents/skills</code> here anyway, because none exist.
        </p>
      </div>
    );
  }

  if (check.status === "unknown") {
    return (
      <div className="space-y-2 p-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p>Pi project trust could not be read for this thread.</p>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {check.error === null ? null : <p className="text-muted-foreground">{check.error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 text-sm">
      <div className="space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="font-medium">
            {check.trusted ? "This workspace is trusted for Pi" : "Pi would skip project resources"}
          </h2>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <p className="text-muted-foreground">
          {check.trusted
            ? "A new Pi session in this workspace loads the project resources listed below. Trust comes from a saved decision or from defaultProjectTrust; the running session keeps whatever it started with."
            : "BB starts Pi in RPC mode, which cannot show Pi's trust prompt. With no trusting decision, Pi starts each session in this workspace without the resources below."}
        </p>
      </div>

      <div className="space-y-1 rounded-md border border-border bg-muted/40 p-3">
        <DetailRow label="Workspace" value={check.canonicalPath} />
        <DetailRow
          label="Decision"
          value={
            check.savedDecision === null
              ? `none saved; defaultProjectTrust is "${check.defaultProjectTrust}"`
              : `${check.savedDecision ? "trusted" : "not trusted"} (${check.savedDecisionPath})`
          }
        />
      </div>

      <div>
        <p className="font-medium">Resources project trust gates here</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 font-mono text-xs">
          {check.resources.map((resource) => (
            <li key={resource} className="break-all">
              {resource}
            </li>
          ))}
        </ul>
      </div>

      {check.error === null ? null : (
        <p role="alert" className="text-destructive">
          {check.error}
        </p>
      )}

      {check.canTrust ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={pending}
            className="max-w-full whitespace-normal break-words rounded-md bg-primary px-3 py-1.5 text-left text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Saving…" : `Trust ${check.canonicalPath} for Pi`}
          </button>
          <p className="text-xs text-muted-foreground">
            Saves one entry in Pi's trust store at <code>{check.storePath}</code>, exactly as <code>pi /trust</code>{" "}
            does, and changes nothing else there. It applies to the next Pi session, including a new BB thread in this
            workspace; this running thread keeps running without the skipped resources. Trust lets Pi load and run the
            resources listed above, so save it only for a workspace you trust.
          </p>
        </div>
      ) : null}

      {saveError === null ? null : (
        <p role="alert" className="text-destructive">
          {saveError}
        </p>
      )}

      {refreshError === null ? null : (
        <p role="alert" className="text-destructive">
          {refreshError}
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        A Pi extension that answers the <code>project_trust</code> event takes precedence over saved decisions, and this
        panel cannot see that answer. If you installed one, it may already decide trust for every thread.
      </p>
    </div>
  );
}
