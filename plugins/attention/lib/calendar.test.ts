import { describe, expect, it } from "vitest";
import {
  addDays,
  dayKey,
  dayLabel,
  monthGrid,
  monthOf,
  monthRange,
  monthTitle,
  shiftMonth,
  shiftPeriod,
  weekRange,
} from "./calendar.js";

describe("calendar helpers", () => {
  it("shifts months across year boundaries", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
  });

  it("builds a Monday-first grid", () => {
    const grid = monthGrid("2026-10");
    expect(grid).toHaveLength(35);
    expect(grid.slice(0, 3)).toEqual([null, null, null]);
    expect(grid[3]).toBe("2026-10-01");
    expect(grid[33]).toBe("2026-10-31");
    expect(grid[34]).toBe(null);
    const february = monthGrid("2026-02");
    expect(february).toHaveLength(35);
    expect(february[6]).toBe("2026-02-01");
    expect(february[33]).toBe("2026-02-28");
  });

  it("computes week and month ranges", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(weekRange("2026-10-15")).toEqual({
      startDay: "2026-10-12",
      endDay: "2026-10-18",
    });
    expect(monthRange("2026-10-15")).toEqual({
      startDay: "2026-10-01",
      endDay: "2026-10-31",
    });
  });

  it("shifts a period and clamps short months", () => {
    expect(shiftPeriod("2026-10-20", "day", 1)).toBe("2026-10-21");
    expect(shiftPeriod("2026-10-20", "week", -1)).toBe("2026-10-13");
    expect(shiftPeriod("2026-01-31", "month", 1)).toBe("2026-02-28");
    expect(shiftPeriod("2026-03-31", "month", -1)).toBe("2026-02-28");
  });

  it("formats month, day, and titles", () => {
    expect(monthOf("2026-10-20")).toBe("2026-10");
    expect(monthTitle("2026-10")).toBe("October 2026");
    expect(dayKey("2026-10", 5)).toBe("2026-10-05");
    expect(dayLabel("2026-10-20")).toBe("Tue, 20 Oct 2026");
  });
});
