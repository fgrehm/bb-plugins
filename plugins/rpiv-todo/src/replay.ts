import {
  EMPTY_STATE,
  type Task,
  type TaskAction,
  type TaskState,
  type TaskStatus,
} from "./types";

const ACTIONS = new Set<TaskAction>([
  "create",
  "update",
  "list",
  "get",
  "delete",
  "clear",
]);

const STATUSES = new Set<TaskStatus>([
  "pending",
  "in_progress",
  "completed",
  "deleted",
]);

/**
 * Mirrors `@juicesharp/rpiv-todo` 2.15.0: a completed task can only be deleted,
 * never reopened. Replaying a transition the extension rejected would desync
 * every following call.
 */
const LEGAL: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ["pending", "in_progress", "completed", "deleted"],
  in_progress: ["in_progress", "pending", "completed", "deleted"],
  completed: ["completed", "deleted"],
  deleted: ["deleted"],
};

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asNumberList(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: number[] = [];
  for (const item of value) {
    const n = asNumber(item);
    if (n === undefined) return undefined;
    out.push(n);
  }
  return out;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Replay completed `todo` tool arguments through the same state machine as
 * `@juicesharp/rpiv-todo`. Rejected calls are skipped so ids stay aligned with
 * the extension's `nextId`.
 */
export function replayTodoArgs(
  calls: readonly Record<string, unknown>[],
): TaskState {
  let state: TaskState = { tasks: [], nextId: EMPTY_STATE.nextId };
  for (const args of calls) {
    const next = applyArgs(state, args);
    if (next) state = next;
  }
  return state;
}

function applyArgs(
  state: TaskState,
  args: Record<string, unknown>,
): TaskState | null {
  const action = args.action;
  if (typeof action !== "string" || !ACTIONS.has(action as TaskAction))
    return null;
  switch (action as TaskAction) {
    case "create":
      return applyCreate(state, args);
    case "update":
      return applyUpdate(state, args);
    case "delete":
      return applyDelete(state, args);
    case "clear":
      return { tasks: [], nextId: 1 };
    case "list":
    case "get":
      return state;
    default:
      return null;
  }
}

interface TaskSpec {
  subject: string;
  description?: string;
  activeForm?: string;
  owner?: string;
  blockedBy?: number[];
}

/** Validate one task's fields against the state before the call commits. */
function taskSpec(
  state: TaskState,
  source: Record<string, unknown>,
): TaskSpec | null {
  const subject = asOptionalString(source.subject)?.trim();
  if (!subject) return null;

  const blockedBy = asNumberList(source.blockedBy);
  if (source.blockedBy !== undefined && blockedBy === undefined) return null;
  if (blockedBy) {
    for (const dep of blockedBy) {
      const depTask = state.tasks.find((task) => task.id === dep);
      if (!depTask || depTask.status === "deleted") return null;
    }
  }

  const spec: TaskSpec = { subject };
  const description = asOptionalString(source.description);
  const activeForm = asOptionalString(source.activeForm);
  const owner = asOptionalString(source.owner);
  if (description) spec.description = description;
  if (activeForm) spec.activeForm = activeForm;
  if (owner) spec.owner = owner;
  if (blockedBy?.length) spec.blockedBy = blockedBy;
  return spec;
}

function applyCreate(
  state: TaskState,
  args: Record<string, unknown>,
): TaskState | null {
  const batch = args.tasks;
  const hasBatch = batch !== undefined;
  // `subject` and `tasks[]` are one-of; sending both is rejected.
  if (hasBatch && args.subject !== undefined) return null;

  const sources: Record<string, unknown>[] = [];
  if (hasBatch) {
    if (!Array.isArray(batch) || batch.length === 0) return null;
    for (const item of batch) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      sources.push(item as Record<string, unknown>);
    }
  } else {
    sources.push(args);
  }

  // Validate every item first: one bad item fails the whole call.
  const specs: TaskSpec[] = [];
  for (const source of sources) {
    const spec = taskSpec(state, source);
    if (!spec) return null;
    specs.push(spec);
  }

  const tasks = [...state.tasks];
  let nextId = state.nextId;
  for (const spec of specs) {
    tasks.push({ id: nextId, status: "pending", ...spec });
    nextId += 1;
  }
  return { tasks, nextId };
}

/** Does adding `id -> deps` close a cycle in the blockedBy graph? */
function closesCycle(
  tasks: readonly Task[],
  id: number,
  deps: readonly number[],
): boolean {
  const edges = new Map<number, number[]>();
  for (const task of tasks) {
    if (task.blockedBy?.length) edges.set(task.id, [...task.blockedBy]);
  }
  edges.set(id, [...(edges.get(id) ?? []), ...deps]);

  const seen = new Set<number>();
  const stack = [...deps];
  while (stack.length > 0) {
    const current = stack.pop() as number;
    if (current === id) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(edges.get(current) ?? []));
  }
  return false;
}

function applyUpdate(
  state: TaskState,
  args: Record<string, unknown>,
): TaskState | null {
  const id = asNumber(args.id);
  if (id === undefined) return null;
  const idx = state.tasks.findIndex((task) => task.id === id);
  if (idx === -1) return null;
  const current = state.tasks[idx];

  const hasMutation =
    args.subject !== undefined ||
    args.description !== undefined ||
    args.activeForm !== undefined ||
    args.status !== undefined ||
    args.owner !== undefined ||
    (Array.isArray(args.addBlockedBy) && args.addBlockedBy.length > 0) ||
    (Array.isArray(args.removeBlockedBy) && args.removeBlockedBy.length > 0);
  if (!hasMutation) return null;

  let status = current.status;
  if (args.status !== undefined) {
    if (
      typeof args.status !== "string" ||
      !STATUSES.has(args.status as TaskStatus)
    )
      return null;
    const nextStatus = args.status as TaskStatus;
    if (!LEGAL[current.status].includes(nextStatus)) return null;
    status = nextStatus;
  }

  let blockedBy = current.blockedBy ? [...current.blockedBy] : [];
  const removeBlockedBy = asNumberList(args.removeBlockedBy);
  if (args.removeBlockedBy !== undefined && removeBlockedBy === undefined)
    return null;
  if (removeBlockedBy?.length) {
    const drop = new Set(removeBlockedBy);
    blockedBy = blockedBy.filter((dep) => !drop.has(dep));
  }
  const addBlockedBy = asNumberList(args.addBlockedBy);
  if (args.addBlockedBy !== undefined && addBlockedBy === undefined)
    return null;
  if (addBlockedBy?.length) {
    for (const dep of addBlockedBy) {
      if (dep === current.id) return null;
      const depTask = state.tasks.find((task) => task.id === dep);
      if (!depTask || depTask.status === "deleted") return null;
      if (!blockedBy.includes(dep)) blockedBy.push(dep);
    }
    if (closesCycle(state.tasks, current.id, blockedBy)) return null;
  }

  const updated: Task = { ...current, status };
  if (args.subject !== undefined) {
    const subject = asOptionalString(args.subject);
    if (subject === undefined) return null;
    updated.subject = subject;
  }
  if (args.description !== undefined) {
    const description = asOptionalString(args.description);
    if (description === undefined) return null;
    updated.description = description;
  }
  if (args.activeForm !== undefined) {
    const activeForm = asOptionalString(args.activeForm);
    if (activeForm === undefined) return null;
    updated.activeForm = activeForm;
  }
  if (args.owner !== undefined) {
    const owner = asOptionalString(args.owner);
    if (owner === undefined) return null;
    updated.owner = owner;
  }
  if (blockedBy.length) updated.blockedBy = blockedBy;
  else updated.blockedBy = undefined;

  const tasks = [...state.tasks];
  tasks[idx] = updated;
  return { tasks, nextId: state.nextId };
}

function applyDelete(
  state: TaskState,
  args: Record<string, unknown>,
): TaskState | null {
  const id = asNumber(args.id);
  if (id === undefined) return null;
  const idx = state.tasks.findIndex((task) => task.id === id);
  if (idx === -1) return null;
  const current = state.tasks[idx];
  if (!LEGAL[current.status].includes("deleted")) return null;
  const tasks = [...state.tasks];
  tasks[idx] = { ...current, status: "deleted" };
  return { tasks, nextId: state.nextId };
}
