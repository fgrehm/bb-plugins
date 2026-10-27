import { describe, expect, it } from "vitest";
import { replayTodoArgs } from "./replay";

describe("replayTodoArgs", () => {
  it("creates a single task", () => {
    const state = replayTodoArgs([
      { action: "create", subject: "Read the README" },
    ]);
    expect(state.nextId).toBe(2);
    expect(state.tasks).toEqual([
      { id: 1, subject: "Read the README", status: "pending" },
    ]);
  });

  it("creates a batch in order with sequential ids", () => {
    const state = replayTodoArgs([
      {
        action: "create",
        tasks: [
          { subject: "Boil water" },
          { subject: "Warm the teapot" },
          { subject: "Steep the tea" },
          { subject: "Pour and enjoy" },
        ],
      },
      { action: "update", id: 1, status: "completed" },
    ]);
    expect(
      state.tasks.map((task) => [task.id, task.subject, task.status]),
    ).toEqual([
      [1, "Boil water", "completed"],
      [2, "Warm the teapot", "pending"],
      [3, "Steep the tea", "pending"],
      [4, "Pour and enjoy", "pending"],
    ]);
    expect(state.nextId).toBe(5);
  });

  it("rejects a call that sends both subject and tasks", () => {
    const state = replayTodoArgs([
      { action: "create", subject: "A", tasks: [{ subject: "B" }] },
    ]);
    expect(state.tasks).toEqual([]);
    expect(state.nextId).toBe(1);
  });

  it("rejects the whole batch when one item is invalid", () => {
    const state = replayTodoArgs([
      {
        action: "create",
        tasks: [{ subject: "A" }, { subject: "  " }],
      },
    ]);
    expect(state.tasks).toEqual([]);
  });

  it("never reopens a completed task", () => {
    const state = replayTodoArgs([
      { action: "create", subject: "A" },
      { action: "update", id: 1, status: "completed" },
      { action: "update", id: 1, status: "in_progress" },
    ]);
    expect(state.tasks[0].status).toBe("completed");
  });

  it("tombstones deleted tasks and refuses later updates", () => {
    const state = replayTodoArgs([
      { action: "create", subject: "A" },
      { action: "delete", id: 1 },
      { action: "update", id: 1, status: "pending" },
    ]);
    expect(state.tasks[0].status).toBe("deleted");
  });

  it("resets the id counter on clear", () => {
    const state = replayTodoArgs([
      { action: "create", subject: "A" },
      { action: "create", subject: "B" },
      { action: "clear" },
      { action: "create", subject: "C" },
    ]);
    expect(state.tasks).toEqual([{ id: 1, subject: "C", status: "pending" }]);
    expect(state.nextId).toBe(2);
  });

  it("skips failed calls so ids stay aligned", () => {
    const state = replayTodoArgs([
      { action: "create" },
      { action: "create", subject: "Real" },
      { action: "update", id: 99, status: "completed" },
    ]);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({ id: 1, subject: "Real" });
    expect(state.nextId).toBe(2);
  });

  it("validates blockedBy against existing tasks", () => {
    const accepted = replayTodoArgs([
      { action: "create", subject: "A" },
      { action: "create", subject: "B", blockedBy: [1] },
    ]);
    expect(accepted.tasks[1].blockedBy).toEqual([1]);

    const rejected = replayTodoArgs([
      { action: "create", subject: "A" },
      { action: "create", subject: "B", blockedBy: [7] },
    ]);
    expect(rejected.tasks).toHaveLength(1);
  });

  it("cannot block a batch item on a sibling created in the same call", () => {
    const state = replayTodoArgs([
      {
        action: "create",
        tasks: [{ subject: "A" }, { subject: "B", blockedBy: [1] }],
      },
    ]);
    expect(state.tasks).toEqual([]);
  });

  it("rejects a dependency cycle", () => {
    const state = replayTodoArgs([
      { action: "create", subject: "A" },
      { action: "create", subject: "B", blockedBy: [1] },
      { action: "update", id: 1, addBlockedBy: [2] },
    ]);
    expect(state.tasks[0].blockedBy).toBeUndefined();
  });
});
