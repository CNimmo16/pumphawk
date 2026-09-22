import { describe, expect, it } from "vitest";
import type { Forecast, WeeklyOutlook } from "@pump-hawk/openapi/types";
import {
  addDays,
  buildNationalOutlook,
} from "@pump-hawk/presentation/national-outlook";

const now = "2026-09-17T12:00:00Z";
const point = (date: string, pricePence: number) => ({
  date,
  pricePence,
  lowPence: pricePence - 0.5,
  highPence: pricePence + 0.5,
  confidence: "medium" as const,
  signals: [
    {
      name: "b7h" as const,
      label: "Petrol futures",
      contributionPence: 0.3,
      detail: "Fitted contribution",
      available: true,
    },
  ],
});
const daily = (changes: Partial<Forecast> = {}): Forecast => ({
  asOf: "2026-09-17",
  generatedAt: now,
  snapshotAt: "2026-09-17T08:00:00Z",
  source: "test",
  mode: "live",
  model: "daily-ridge",
  fuelType: "petrol",
  currency: "GBP",
  unit: "pence/litre",
  currentPricePence: 150,
  wholesalePence: null,
  wholesaleChangePercent: null,
  usdPerGbp: null,
  direction: "steady",
  signal: "steady",
  consecutiveFallingDays: 0,
  history: [{ date: "2026-09-14", pricePence: 150, wholesalePence: null }],
  points: Array.from({ length: 15 }, (_, i) =>
    point(addDays("2026-09-17", i), 150 + i * 0.2),
  ),
  explanation: "test",
  methodology: "test",
  warnings: [],
  ...changes,
});
const weekly = (changes: Partial<WeeklyOutlook> = {}): WeeklyOutlook => ({
  model: "weekly-huber",
  modelVersion: "test",
  generatedAt: now,
  issuedAt: "2026-09-17T00:00:00Z",
  referenceDate: "2026-09-14",
  series: "Official DESNZ sales-weighted petrol",
  unit: "pence/litre",
  history: [{ date: "2026-09-14", pricePence: 145 }],
  points: [point("2026-09-21", 145.8), point("2026-09-28", 147.2)],
  warnings: [],
  ...changes,
});

describe("shared national outlook", () => {
  it("ends daily at day seven and preserves only actual later weekly observations", () => {
    const f = daily();
    const w = weekly();
    const result = buildNationalOutlook({ forecast: f, weekly: w, now });
    expect(result.cutoff).toBe("2026-09-24");
    expect(result.dailyPoints.map((p) => p.date)).toEqual(
      Array.from({ length: 7 }, (_, i) => addDays(f.asOf, i + 1)),
    );
    expect(result.weeklyPoints).toHaveLength(1);
    expect(result.weeklyPoints[0]).toMatchObject(w.points[1]!);
    expect(result.points.at(-1)?.date).toBe("2026-09-28");
    expect(result.points.some((p) => p.date === "2026-09-25")).toBe(false);
    expect(result.hasHandover).toBe(true);
    expect(f.points).toHaveLength(15);
    expect(w.points).toHaveLength(2);
  });
  it("keeps the cutoff date exclusively daily and starts weekly strictly afterwards", () => {
    const result = buildNationalOutlook({
      forecast: daily(),
      weekly: weekly({
        points: [point("2026-09-24", 140), point("2026-09-25", 141)],
      }),
      now,
    });
    expect(
      result.points.filter((p) => p.date === "2026-09-24").map((p) => p.kind),
    ).toEqual(["daily"]);
    expect(result.weeklyPoints.map((p) => p.date)).toEqual(["2026-09-25"]);
  });
  it("does not extend an older weekly release or fall back to hidden daily day 8–14", () => {
    const result = buildNationalOutlook({
      forecast: daily({ asOf: "2026-09-22" }),
      weekly: weekly(),
      now: "2026-09-22T12:00:00Z",
    });
    expect(result.weeklyPoints).toEqual([]);
    expect(result.hasHandover).toBe(false);
    expect(result.weeklyNote).toContain("no prediction beyond 29 Sept");
  });
  it.each(["sample", "demo"] as const)(
    "does not mix %s data with live weekly prices or disagreement checks",
    (mode) => {
      const result = buildNationalOutlook({
        forecast: daily({ mode }),
        weekly: weekly(),
        now,
      });
      expect(result.weeklyPoints).toEqual([]);
      expect(result.disagreement).toBeUndefined();
    },
  );
  it("retains daily points while weekly loads or fails, and allows weekly-only fallback", () => {
    const loading = buildNationalOutlook({
      forecast: daily(),
      weeklyStatus: "loading",
      now,
    });
    expect(loading.dailyPoints).toHaveLength(7);
    expect(loading.weeklyNote).toContain("Loading");
    expect(
      buildNationalOutlook({ forecast: daily(), now }).weeklyNote,
    ).toContain("unavailable");
    const weeklyOnly = buildNationalOutlook({ weekly: weekly(), now });
    expect(weeklyOnly.dailyLine).toEqual([]);
    expect(weeklyOnly.weeklyPoints).toHaveLength(2);
    expect(weeklyOnly.historyLabel).toBe("Official observations");
  });
  it("ignores stale or future weekly releases", () => {
    for (const issuedAt of ["2026-09-01T00:00:00Z", "2026-09-18T00:00:00Z"]) {
      const result = buildNationalOutlook({
        forecast: daily(),
        weekly: weekly({ issuedAt }),
        now,
      });
      expect(result.weeklyPoints).toEqual([]);
      expect(result.disagreement).toBeUndefined();
    }
  });
  it("does not mistake a constant benchmark offset for model disagreement", () => {
    const f = daily();
    const w = weekly();
    expect(f.points[4]!.pricePence - w.points[0]!.pricePence).toBeCloseTo(5);
    expect(
      buildNationalOutlook({ forecast: f, weekly: w, now }).disagreement,
    ).toBeUndefined();
  });
  it("warns on non-overlapping change ranges for the same reference and prediction dates", () => {
    const w = weekly({
      points: [point("2026-09-21", 140), point("2026-09-28", 139)],
    });
    const result = buildNationalOutlook({ forecast: daily(), weekly: w, now });
    expect(result.disagreement).toMatchObject({
      date: "2026-09-21",
      referenceDate: "2026-09-14",
      weeklyChange: -5,
    });
    expect(result.disagreement?.dailyChange).toBeCloseTo(0.8);
    expect(result.disagreement?.message).toContain("update dates");
  });
  it("does not flag overlapping uncertainty or compare daily predictions beyond day seven", () => {
    const w = weekly({
      points: [
        { ...point("2026-09-21", 140), highPence: 151 },
        point("2026-09-28", 120),
      ],
    });
    expect(
      buildNationalOutlook({ forecast: daily(), weekly: w, now }).disagreement,
    ).toBeUndefined();
  });
  it("requires matching observed history, fresh daily inputs and a fitted live daily model", () => {
    const w = weekly({ points: [point("2026-09-21", 120)] });
    for (const f of [
      daily({ history: [] }),
      daily({ snapshotAt: "2026-09-10T08:00:00Z" }),
      daily({ model: "heuristic" }),
      daily({
        history: [
          {
            date: "2026-09-14",
            pricePence: 150,
            wholesalePence: null,
            source: "sample",
          },
        ],
      }),
    ]) {
      expect(
        buildNationalOutlook({ forecast: f, weekly: w, now }).disagreement,
      ).toBeUndefined();
    }
  });
});
