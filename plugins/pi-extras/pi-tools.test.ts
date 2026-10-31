import { applyToolToggle, PI_DEFAULT_TOOLS, toolsState } from "./pi-tools.ts";
import { describe, expect, it } from "vitest";

describe("toolsState", () => {
  it("resolves pi's defaults when the key is absent (null)", () => {
    const state = toolsState(null);
    expect(state.inherited).toBe(true);
    expect(state.active).toEqual(PI_DEFAULT_TOOLS);
  });

  it("treats an explicit empty list as an empty selection, not pi's defaults", () => {
    const state = toolsState([]);
    expect(state.inherited).toBe(false);
    expect(state.active).toEqual([]);
  });

  it("resolves modifiers against pi's defaults", () => {
    const state = toolsState(["-bash", "+grep", "+codemode"]);
    expect(state.inherited).toBe(true);
    expect(state.activeSet.has("bash")).toBe(false);
    expect(state.activeSet.has("grep")).toBe(true);
    expect(state.activeSet.has("codemode")).toBe(true);
    expect(state.unmodeledModifiers).toEqual([]);
  });

  it("treats any plain name as a replacing list", () => {
    const state = toolsState(["read", "write", "-edit"]);
    expect(state.inherited).toBe(false);
    expect(state.activeSet.has("bash")).toBe(false);
    expect(state.activeSet.has("read")).toBe(true);
    expect(state.activeSet.has("edit")).toBe(false);
  });

  it("resolves an empty plain entry and duplicate plain names like pi", () => {
    const blank = toolsState([""]);
    expect(blank.inherited).toBe(false);
    expect(blank.active).toEqual([""]);
    // -read removes the first matching occurrence, so read stays selected.
    expect(toolsState(["read", "read", "-read"]).active).toEqual(["read"]);
    expect(applyToolToggle(["read", "read", "-read"], "grep", true)).toEqual(["read", "grep"]);
    expect(applyToolToggle([""], "read", false)).toEqual([""]);
  });

  it("reports unmodeled modifier targets verbatim", () => {
    const state = toolsState(["+my-extension-tool", "+codemode"]);
    expect(state.unmodeledModifiers).toEqual(["+my-extension-tool"]);
    expect(state.activeSet.has("codemode")).toBe(true);
  });
});

describe("applyToolToggle", () => {
  it("writes relative entries in inherited mode and returns to an absent key", () => {
    const disabled = applyToolToggle(null, "bash", false);
    expect(disabled).toEqual(["-bash"]);
    expect(applyToolToggle(disabled, "bash", true)).toBeNull();
  });

  it("writes nothing for a no-op toggle of a pi default", () => {
    expect(applyToolToggle(null, "read", true)).toBeNull();
  });

  it("keeps unrelated edits when another tool toggles", () => {
    const first = applyToolToggle(null, "bash", false);
    const second = applyToolToggle(first, "codemode", true);
    expect(second).toEqual(["-bash", "+codemode"]);
  });

  it("never writes redundant removals for tools pi has off by default", () => {
    expect(applyToolToggle(null, "grep", false)).toBeNull();
    const on = applyToolToggle(null, "grep", true);
    expect(on).toEqual(["+grep"]);
    expect(applyToolToggle(on, "grep", false)).toBeNull();
  });

  it("keeps an explicit empty selection as [] instead of deleting the key", () => {
    // Unchecking the last tool of an explicit selection is a real state: pi
    // reads [] as no built-in tools.
    expect(applyToolToggle(["read"], "read", false)).toEqual([]);
    expect(applyToolToggle(["read", "-edit"], "read", false)).toEqual([]);
  });

  it("does not resurrect removed tools on an unrelated toggle", () => {
    // The reviewer's reproduction, from pi's semantics:
    // ["+acme", "-acme"] leaves acme removed; ["-acme", "+acme"] leaves it active.
    const removed = applyToolToggle(["+acme", "-acme"], "grep", true);
    expect(removed).toEqual(["+grep", "+acme", "-acme"]);
    const active = applyToolToggle(["-acme", "+acme"], "grep", true);
    expect(active).toEqual(["+grep", "-acme", "+acme"]);
    expect(toolsState(active).activeSet.has("acme")).toBe(true);
    expect(toolsState(removed).activeSet.has("acme")).toBe(false);
  });

  it("preserves every unknown tool through a replacing-list edit", () => {
    const list = applyToolToggle(["read", "+acme"], "grep", true);
    expect(list).toEqual(expect.arrayContaining(["read", "grep", "acme"]));
  });

  it("rewrites a replacing list as plain names when the key is explicit", () => {
    const list = applyToolToggle(["read", "write"], "grep", true);
    expect(list).toContain("grep");
    expect(list).toContain("read");
    expect(list).not.toContain("-edit");
    expect(toolsState(list).inherited).toBe(false);
  });

  it("folds modifiers into a replacing list", () => {
    const list = applyToolToggle(["-bash", "+codemode", "read"], "edit", true);
    // Replacing lists only carry what the resolved selection holds.
    expect(list).toEqual(["read", "edit", "codemode"]);
  });
});
describe("applyToolToggle no-ops", () => {
  it("keeps the original inherited list instead of returning to absence", () => {
    // Toggling an already-active tool must not re-enable a removed default,
    // must keep a tool pi has off by default, and must keep unknown entry order.
    expect(applyToolToggle(["-bash"], "read", true)).toEqual(["-bash"]);
    expect(applyToolToggle(["+grep"], "read", true)).toEqual(["+grep"]);
    expect(applyToolToggle(["-bash", "+acme"], "read", true)).toEqual(["-bash", "+acme"]);
    // Resolved membership is unchanged in all three.
    expect(toolsState(["-bash", "+acme"]).activeSet.has("bash")).toBe(false);
  });

  it("keeps the original explicit list on a no-op", () => {
    expect(applyToolToggle(["read"], "bash", false)).toEqual(["read"]);
    expect(applyToolToggle([], "read", false)).toEqual([]);
  });
});

describe("applyToolToggle with modifier-prefixed extension names", () => {
  it("never flattens a tool literally named with the modifier prefix", () => {
    // Extension tools may literally be named "-read"; the panel must keep them
    // as explicit selections, not emit a plain entry pi reads as a removal.
    const list = applyToolToggle(["read", "+-read"], "grep", true);
    expect(list).toEqual(["read", "grep", "+-read"]);
    expect(toolsState(list).activeSet.has("-read")).toBe(true);
    expect(toolsState(list).activeSet.has("grep")).toBe(true);
  });

  it("keeps another such tool when the baseline tool is disabled", () => {
    const list = applyToolToggle(["read", "+-acme"], "read", false);
    // Baseline "read" disabled; the empty plain entry anchors the explicit
    // baseline so pi resolves exactly the appended "-acme" extension tool.
    expect(list).toEqual(["", "+-acme"]);
    // Pi keeps the "" placeholder in the resolved list; no tool matches it.
    expect(toolsState(list).activeSet).toEqual(new Set(["", "-acme"]));
  });

  it("keeps the replacement explicit when nothing else is active", () => {
    const list = applyToolToggle(["read", "+-acme"], "read", false);
    expect(list).toEqual(["", "+-acme"]);
    expect(toolsState(list).inherited).toBe(false);
  });
});
