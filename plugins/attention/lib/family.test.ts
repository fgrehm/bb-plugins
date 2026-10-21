import { describe, it, expect } from "vitest";
import { collectFamily, recordedVisits } from "./family.js";
import type { DayInput } from "./contract.js";
const input = (
  at: string,
  initiator: DayInput["initiator"] = "user",
): DayInput => ({
  at: Date.parse(at),
  initiator,
  threadId: "a",
  kind: "new-turn",
  model: null,
  queueDelayMs: null,
});
describe("recorded visits", () => {
  it("sorts human inputs, merges at the gap, and excludes automation", () => {
    const visits = recordedVisits(
      [
        input("2026-10-11T09:15Z"),
        input("2026-10-11T09:00Z"),
        input("2026-10-11T09:40Z"),
        input("2026-10-11T09:30Z", "agent"),
      ],
      "UTC",
    );
    expect(visits.map((v) => v.inputs.length)).toEqual([2, 1]);
  });
  it("breaks at local midnight even within the gap", () => {
    const inputs = [input("2026-10-12T03:59Z"), input("2026-10-12T04:01Z")];
    expect(recordedVisits(inputs, "America/New_York")).toHaveLength(2);
    expect(recordedVisits(inputs, "UTC")).toHaveLength(1);
  });
  it("allows adjustable gaps without mutating inputs", () => {
    const inputs = [input("2026-10-11T09:20Z"), input("2026-10-11T09:00Z")];
    expect(recordedVisits(inputs, "UTC", 5)).toHaveLength(2);
    expect(recordedVisits(inputs, "UTC", 60)).toHaveLength(1);
    expect(inputs[0]!.at).toBe(Date.parse("2026-10-11T09:20Z"));
  });
});
describe("family traversal", () => {
  const nodes = [
    { id: "root", parentThreadId: null },
    { id: "child", parentThreadId: "root" },
    { id: "grandchild", parentThreadId: "child" },
    { id: "sibling", parentThreadId: "root" },
  ];
  const get = async (id: string) => nodes.find((n) => n.id === id)!;
  const children = async (id: string) =>
    nodes.filter((n) => n.parentThreadId === id);
  it("opens the complete family from a grandchild", async () => {
    const result = await collectFamily(nodes[2]!, get, children);
    expect(result.root.id).toBe("root");
    expect(result.threads.map((t) => t.id)).toEqual([
      "root",
      "child",
      "sibling",
      "grandchild",
    ]);
    expect(result.warnings).toEqual([]);
  });
  it("reports truncated families and missing ancestors", async () => {
    expect(
      (await collectFamily(nodes[0]!, get, children, 2)).warnings,
    ).not.toEqual([]);
    const partial = await collectFamily(
      nodes[1]!,
      async () => {
        throw new Error("missing");
      },
      children,
    );
    expect(partial.root.id).toBe("child");
    expect(partial.warnings).toHaveLength(1);
  });
  it("terminates cyclic metadata", async () => {
    const node = { id: "cycle", parentThreadId: "cycle" };
    const result = await collectFamily(
      node,
      async () => node,
      async () => [node],
    );
    expect(result.threads).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });
});
