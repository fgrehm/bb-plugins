import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { replayTodoArgs } from "./replay";
import { TODO_TEXT_MAX_LENGTH, type Task, type TodoItem } from "./types";

// BB 0.47 rejects any thread event page above 100 (`Thread event limit cannot
// exceed 100`), so page at the cap and keep the original 20,000-event bound.
const EVENT_PAGE = 100;
const EVENT_PAGE_CAP = 200;

function trimAndTruncate(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= TODO_TEXT_MAX_LENGTH
    ? trimmed
    : trimmed.slice(0, TODO_TEXT_MAX_LENGTH);
}

export function itemsFromTasks(tasks: readonly Task[]): TodoItem[] {
  const items: TodoItem[] = [];
  for (const task of tasks) {
    if (task.status === "deleted") continue;
    const text = trimAndTruncate(task.subject);
    if (!text) continue;
    const activeForm = task.activeForm ? trimAndTruncate(task.activeForm) : "";
    items.push({
      id: String(task.id),
      text,
      status: task.status,
      ...(activeForm ? { activeForm } : {}),
    });
  }
  return items;
}

function todoArgsFromEvent(row: {
  type: string;
  data: unknown;
}): Record<string, unknown> | null {
  if (row.type !== "item/completed") return null;
  const data = row.data;
  if (!data || typeof data !== "object" || !("item" in data)) return null;
  const item = (data as { item?: unknown }).item;
  if (!item || typeof item !== "object") return null;
  const toolCall = item as {
    type?: unknown;
    tool?: unknown;
    status?: unknown;
    arguments?: unknown;
    result?: unknown;
  };
  if (toolCall.type !== "toolCall" || toolCall.tool !== "todo") return null;
  if (toolCall.status !== "completed") return null;
  if (
    typeof toolCall.result === "string" &&
    toolCall.result.startsWith("Error:")
  )
    return null;
  if (
    !toolCall.arguments ||
    typeof toolCall.arguments !== "object" ||
    Array.isArray(toolCall.arguments)
  ) {
    return null;
  }
  return toolCall.arguments as Record<string, unknown>;
}

export async function snapshotForThread(
  bb: BbPluginApi,
  threadId: string,
): Promise<{ items: TodoItem[] }> {
  const calls: Record<string, unknown>[] = [];
  let afterSeq: string | undefined;
  for (let pageIndex = 0; pageIndex < EVENT_PAGE_CAP; pageIndex += 1) {
    const page = await bb.sdk.threads.events.list({
      threadId,
      types: ["item/completed"],
      limit: String(EVENT_PAGE),
      ...(afterSeq ? { afterSeq } : {}),
    });
    if (page.length === 0) break;
    for (const row of page) {
      const args = todoArgsFromEvent(row);
      if (args) calls.push(args);
    }
    const last = page.at(-1);
    if (!last) break;
    afterSeq = String(last.seq);
    if (page.length < EVENT_PAGE) break;
  }
  return { items: itemsFromTasks(replayTodoArgs(calls).tasks) };
}
