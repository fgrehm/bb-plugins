import { definePluginApp } from "@get-bb/plugin-sdk/app";
import "./app.css";
import type { Cursor, MessageTime } from "./src/contract";
import {
  clearDecorations,
  decorate,
  hasUndecoratedMessageRows,
  threadIdFromPath,
  visibleThreadIds,
} from "./src/dom";
import { createTimestampLoader } from "./src/loader";

const REFRESH_MS = 30_000;
const BACKFILL_DELAY_MS = 200;

type RpcEnvelope<T> =
  { ok: true; result: T } | { ok: false; error?: { message?: string } };

type NewestPages = {
  messages: MessageTime[];
  cursors: Array<{ threadId: string; cursor: Cursor | null }>;
};

type OlderPage = {
  messages: MessageTime[];
  cursor: Cursor | null;
};

function rpcClient(pluginId: string, signal: AbortSignal) {
  const endpoint = (method: string) =>
    `/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/${method}`;

  return async function call<T>(method: string, input: unknown): Promise<T> {
    const response = await fetch(endpoint(method), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Chat Timestamps ${method} failed (${response.status})`);
    }
    const envelope = (await response.json()) as RpcEnvelope<T>;
    if (!envelope.ok) {
      throw new Error(
        envelope.error?.message ?? `Chat Timestamps ${method} failed`,
      );
    }
    return envelope.result;
  };
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "chat-timestamps",
    mount({ pluginId, signal }) {
      const call = rpcClient(pluginId, signal);
      let stopped = false;
      let backfillTimer: number | undefined;
      let lastPath = window.location.pathname;

      const loader = createTimestampLoader({
        fetchNewest: (threadIds) =>
          call<NewestPages>("messageTimes", { threadIds }),
        fetchOlder: (threadId, cursor) =>
          call<OlderPage>("olderMessageTimes", { threadId, cursor }),
        onUpdate: () => {
          decorate(loader.getTimes());
          if (hasUndecoratedMessageRows(loader.getTimes())) scheduleBackfill();
        },
      });

      const walkOlderPages = async () => {
        if (stopped || signal.aborted) return;
        const threadId = threadIdFromPath();
        if (!threadId) return;
        if (
          !hasUndecoratedMessageRows(loader.getTimes()) ||
          !loader.hasOlder(threadId)
        ) {
          return;
        }
        const outcome = await loader.backfill(threadId);
        if (stopped || signal.aborted) return;
        if (
          outcome === "advanced" &&
          hasUndecoratedMessageRows(loader.getTimes())
        ) {
          scheduleBackfill();
        }
      };

      const scheduleBackfill = () => {
        if (stopped || backfillTimer !== undefined) return;
        backfillTimer = window.setTimeout(() => {
          backfillTimer = undefined;
          void walkOlderPages();
        }, BACKFILL_DELAY_MS);
      };

      const refresh = () => {
        const threadIds = visibleThreadIds();
        if (threadIds.length === 0) {
          clearDecorations();
          return;
        }
        void loader.refresh(threadIds).finally(() => {
          if (!stopped) decorate(loader.getTimes());
        });
      };

      const refreshOnRouteChange = () => {
        const path = window.location.pathname;
        if (path === lastPath) return;
        lastPath = path;
        refresh();
      };

      refresh();
      const timer = window.setInterval(refresh, REFRESH_MS);
      const observer = new MutationObserver(() => {
        refreshOnRouteChange();
        decorate(loader.getTimes());
        if (hasUndecoratedMessageRows(loader.getTimes())) scheduleBackfill();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      window.addEventListener("popstate", refreshOnRouteChange);

      return () => {
        stopped = true;
        window.clearInterval(timer);
        if (backfillTimer !== undefined) window.clearTimeout(backfillTimer);
        window.removeEventListener("popstate", refreshOnRouteChange);
        observer.disconnect();
        clearDecorations();
      };
    },
  });
});
