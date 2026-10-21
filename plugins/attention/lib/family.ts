import type { DayInput } from "./contract.js";
import { dayStringAt } from "./day.js";

export interface Visit {
  start: number;
  end: number;
  day: string;
  inputs: DayInput[];
}

/** Visits describe adjacent recorded inputs, not focus or continuous handling. */
export function recordedVisits(
  inputs: DayInput[],
  timezone: string,
  gapMinutes = 15,
): Visit[] {
  const gap = Math.min(
    60,
    Math.max(5, Number.isFinite(gapMinutes) ? gapMinutes : 15),
  );
  const visits: Visit[] = [];
  for (const input of inputs
    .filter((i) => i.initiator === "user")
    .sort((a, b) => a.at - b.at)) {
    const day = dayStringAt(input.at, timezone);
    let visit = visits[visits.length - 1];
    if (
      visit === undefined ||
      visit.day !== day ||
      input.at - visit.end > gap * 60_000
    ) {
      visit = { start: input.at, end: input.at, day, inputs: [] };
      visits.push(visit);
    }
    visit.end = input.at;
    visit.inputs.push(input);
  }
  return visits;
}

export interface FamilyNode {
  id: string;
  parentThreadId: string | null;
}

/** Resolve ancestors and breadth-first descendants without a global thread-list cap. */
export async function collectFamily<T extends FamilyNode>(
  selected: T,
  get: (id: string) => Promise<T>,
  children: (id: string) => Promise<T[]>,
  limit = 80,
): Promise<{ root: T; threads: T[]; warnings: string[] }> {
  const warnings: string[] = [];
  let root = selected;
  const ancestors = new Set([root.id]);
  while (root.parentThreadId !== null) {
    if (ancestors.has(root.parentThreadId) || ancestors.size >= limit) {
      warnings.push("Ancestry is cyclic or exceeds the traversal limit.");
      break;
    }
    try {
      root = await get(root.parentThreadId);
    } catch {
      warnings.push("An ancestor is unavailable; this is a partial family.");
      break;
    }
    ancestors.add(root.id);
  }
  const threads: T[] = [root];
  const seen = new Set([root.id]);
  for (let index = 0; index < threads.length; index++) {
    for (const child of await children(threads[index]!.id)) {
      if (seen.has(child.id)) continue;
      if (threads.length >= limit) {
        warnings.push(
          `Family traversal is limited to ${limit} threads; totals may be incomplete.`,
        );
        return { root, threads, warnings };
      }
      seen.add(child.id);
      threads.push(child);
    }
  }
  return { root, threads, warnings };
}
