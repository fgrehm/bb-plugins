import {
  useComposer,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useRef, useState } from "react";
import type { rpcContract } from "./contract";
import {
  CheckIcon,
  ChevronDownIcon,
  ListTodoIcon,
  LoaderIcon,
  SquareIcon,
} from "./icons";
import type { TodoItem } from "./types";

const STATUS_ORDER = { in_progress: 0, pending: 1, completed: 2 } as const;

function threadIdFromScope(
  scope: ReturnType<typeof useComposer>["scope"],
): string | null {
  if (scope.kind === "thread" || scope.kind === "queued-message")
    return scope.threadId;
  return null;
}

function isTodosSignal(payload: unknown): payload is { threadId: string } {
  return (
    !!payload &&
    typeof payload === "object" &&
    "threadId" in payload &&
    typeof (payload as { threadId: unknown }).threadId === "string"
  );
}

function StatusGlyph({ status }: { status: TodoItem["status"] }) {
  if (status === "completed") {
    return <CheckIcon className="rpiv-todo-icon text-muted-foreground" />;
  }
  if (status === "in_progress") {
    return (
      <LoaderIcon className="rpiv-todo-icon rpiv-todo-spin text-foreground" />
    );
  }
  return <SquareIcon className="rpiv-todo-icon text-muted-foreground" />;
}

function TodoRow({ item }: { item: TodoItem }) {
  const active = item.status === "in_progress";
  const current = active && item.activeForm ? item.activeForm : null;
  return (
    <li
      className={`flex min-w-0 items-start gap-2 text-xs ${active ? "text-foreground" : "text-muted-foreground"}`}
    >
      <StatusGlyph status={item.status} />
      <span
        className="min-w-0 flex-1 truncate"
        title={`#${item.id} ${item.text}${current ? ` — ${current}` : ""}`}
      >
        #{item.id}{" "}
        {current ? (
          <span className="rounded-sm bg-primary/15 px-1 font-medium text-primary">
            {current}
          </span>
        ) : (
          item.text
        )}
      </span>
    </li>
  );
}

export function TodoBanner() {
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const { values, isLoading: settingsLoading } = useSettings();
  const expandOnEnter = values?.expandOnEnter !== false;
  const threadId = threadIdFromScope(composer.scope);
  const [items, setItems] = useState<TodoItem[]>([]);
  const [expanded, setExpanded] = useState(true);
  const threadIdRef = useRef(threadId);
  const rpcRef = useRef(rpc);
  threadIdRef.current = threadId;
  rpcRef.current = rpc;

  const load = async (target = threadIdRef.current) => {
    if (!target) {
      setItems([]);
      return;
    }
    try {
      const result = await rpcRef.current.call("getTodos", {
        threadId: target,
      });
      if (threadIdRef.current === target) setItems(result.items);
    } catch {
      // Keep the last good snapshot if a refresh races a reload.
    }
  };

  useEffect(() => {
    void load(threadId);
  }, [threadId, connection]);

  useEffect(() => {
    if (settingsLoading) return;
    setExpanded(expandOnEnter);
  }, [threadId, expandOnEnter, settingsLoading]);

  useRealtime("todos", (payload) => {
    if (isTodosSignal(payload) && payload.threadId === threadIdRef.current) {
      void load(payload.threadId);
    }
  });

  const running = composer.isRunning;
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) void load();
    wasRunning.current = running;
  }, [running]);

  useEffect(() => {
    if (!running || !threadId) return;
    const timer = window.setInterval(() => {
      void load(threadId);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [running, threadId]);

  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
      ),
    [items],
  );

  if (!threadId || sorted.length === 0) return null;

  const completed = sorted.filter((item) => item.status === "completed").length;
  const current = sorted.find((item) => item.status === "in_progress");
  const currentLabel = current ? current.activeForm || current.text : null;
  const counts = `${completed}/${sorted.length} complete`;
  const visible = currentLabel ? `${counts} · ${currentLabel}` : counts;
  const aria = currentLabel
    ? `${completed} of ${sorted.length} items complete, now ${currentLabel}`
    : `${completed} of ${sorted.length} ${sorted.length === 1 ? "item" : "items"} complete`;

  return (
    <div className="min-h-8 overflow-hidden">
      <div className="flex items-center">
        <button
          type="button"
          id="rpiv-todo-card-toggle"
          aria-expanded={expanded}
          aria-controls="rpiv-todo-card-body"
          aria-label={`To-do list: ${aria}`}
          onClick={() => setExpanded((open) => !open)}
          className="flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-none px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-background/80"
        >
          <ListTodoIcon className="rpiv-todo-icon" />
          <span className="min-w-0 flex-1 truncate text-left">{visible}</span>
          <ChevronDownIcon
            className={`rpiv-todo-icon rpiv-todo-chevron${expanded ? " rpiv-todo-chevron-open" : ""}`}
          />
        </button>
      </div>
      <section
        id="rpiv-todo-card-body"
        role="region"
        aria-labelledby="rpiv-todo-card-toggle"
        aria-hidden={!expanded}
        className={`rpiv-todo-body ${expanded ? "rpiv-todo-body-open" : "rpiv-todo-body-closed"}`}
      >
        <div className="overflow-hidden bg-popover">
          <ul className="max-h-40 space-y-1 overflow-y-auto px-2.5 pb-2 pt-2">
            {sorted.map((item) => (
              <TodoRow key={item.id} item={item} />
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
