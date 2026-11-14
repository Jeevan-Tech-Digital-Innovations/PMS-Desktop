import { describe, expect, it } from "vitest";
import { formatClock, formatDuration, formatMinutes, initials, secondsSince, taskBreadcrumb, taskParents } from "./format";

describe("formatClock", () => {
  it("formats h:mm:ss", () => {
    expect(formatClock(0)).toBe("0:00:00");
    expect(formatClock(59)).toBe("0:00:59");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(8 * 3600)).toBe("8:00:00");
    expect(formatClock(100 * 3600 + 1)).toBe("100:00:01");
  });
  it("clamps bad input", () => {
    expect(formatClock(-5)).toBe("0:00:00");
    expect(formatClock(Number.NaN)).toBe("0:00:00");
    expect(formatClock(61.9)).toBe("0:01:01");
  });
});

describe("formatDuration", () => {
  it("formats 6h 05m style", () => {
    expect(formatDuration(6 * 3600 + 5 * 60)).toBe("6h 05m");
    expect(formatDuration(18 * 60)).toBe("18m");
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(3600)).toBe("1h 00m");
    expect(formatDuration(59)).toBe("0m");
  });
});

describe("formatMinutes", () => {
  it("formats mm:ss and falls back to h:mm:ss", () => {
    expect(formatMinutes(252)).toBe("04:12");
    expect(formatMinutes(15 * 60)).toBe("15:00");
    expect(formatMinutes(3725)).toBe("1:02:05");
  });
});

describe("initials", () => {
  it("uses first and last name", () => {
    expect(initials("Anita Rao")).toBe("AR");
    expect(initials("Anita Kumari Rao")).toBe("AR");
    expect(initials("anita.rao@acme.com")).toBe("AR");
    expect(initials("madonna")).toBe("MA");
    expect(initials("")).toBe("?");
  });
});

describe("task breadcrumbs", () => {
  const base = { title: "Hero", projectName: "Website" };
  it("handles path with parents only", () => {
    expect(taskParents({ ...base, path: ["Homepage"] })).toEqual(["Homepage"]);
    expect(taskBreadcrumb({ ...base, path: ["Homepage"] })).toBe("Website › Homepage");
  });
  it("handles path that includes project and the task itself", () => {
    expect(taskParents({ ...base, path: ["Website", "Homepage", "Hero"] })).toEqual(["Homepage"]);
    expect(taskBreadcrumb({ ...base, path: ["Homepage", "Hero"] })).toBe("Website › Homepage");
  });
  it("shows only the project for a top-level task", () => {
    expect(taskBreadcrumb({ ...base, path: [] })).toBe("Website");
    expect(taskBreadcrumb({ ...base, path: ["Hero"] })).toBe("Website");
  });
});

describe("secondsSince", () => {
  it("never goes negative", () => {
    const now = Date.parse("2026-11-14T10:00:00Z");
    expect(secondsSince("2026-11-14T09:59:00Z", now)).toBe(60);
    expect(secondsSince("2026-11-14T10:05:00Z", now)).toBe(0);
    expect(secondsSince("nonsense", now)).toBe(0);
  });
});
