import { describe, expect, it } from "vitest";
import { formatExactTime, formatRelativeTime } from "./format";

// Local time so the formatted hour does not depend on the test machine's zone.
const NOW = new Date(2026, 9, 28, 12, 0, 0).getTime();

describe("formatRelativeTime", () => {
  it("rounds down to the largest whole unit", () => {
    const at = (secondsAgo: number) => NOW - secondsAgo * 1_000;
    expect(formatRelativeTime(at(0), NOW)).toBe("just now");
    expect(formatRelativeTime(at(59), NOW)).toBe("just now");
    expect(formatRelativeTime(at(60), NOW)).toBe("1m ago");
    expect(formatRelativeTime(at(59 * 60), NOW)).toBe("59m ago");
    expect(formatRelativeTime(at(60 * 60), NOW)).toBe("1h ago");
    expect(formatRelativeTime(at(23 * 60 * 60), NOW)).toBe("23h ago");
    expect(formatRelativeTime(at(24 * 60 * 60), NOW)).toBe("1d ago");
    expect(formatRelativeTime(at(3 * 24 * 60 * 60), NOW)).toBe("3d ago");
  });

  it("treats a future message as just now", () => {
    expect(formatRelativeTime(NOW + 5_000, NOW)).toBe("just now");
  });
});

describe("formatExactTime", () => {
  it("includes the local date, time, and zone offset", () => {
    const formatted = formatExactTime(NOW);
    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/12:00/);
    expect(formatted).toMatch(/(GMT|UTC)/);
  });
});
