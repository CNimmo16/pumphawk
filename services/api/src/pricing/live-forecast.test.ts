import { describe, expect, it } from "vitest";
import { liveForecast, marketSignal } from "./live-forecast";
import { addDays, DAY } from "./forecast";
import { fuelState, plannedLitres, recommend } from "./recommendation";
import { ForecastSchema, type Driver } from "@pump-hawk/contracts";
import type { Settlement } from "../data/databento.service";
const now = new Date("2026-09-16T12:00:00Z");
const rates = Array.from({ length: 20 }, (_, i) => ({
  date: addDays("2026-09-16", i - 19),
  usdPerGbp: 1.3,
}));
const settlements = (b7hSlope = 0, crudeSlope = 0): Settlement[] =>
  ["B7H", "BZ"].flatMap((product) =>
    rates.map((r, i) => ({
      product: product as "B7H" | "BZ",
      symbol: product + "V6",
      date: r.date,
      priceUsd:
        (product === "B7H" ? 700 : 70) +
        i * (product === "B7H" ? b7hSlope : crudeSlope),
      expiresAt: new Date("2026-10-30"),
      publishedAt: new Date(r.date + "T00:00:00Z"),
    })),
  );
const pumps = (slope = 0) =>
  Array.from({ length: 14 }, (_, i) => ({
    date: addDays("2026-09-16", i - 13),
    pricePence: 130 + i * slope,
  }));
describe("14-day stored-data forecast", () => {
  it("gives a sustained 2p daily pump rise most of tomorrow's weight, fading by day 14", () => {
    const f = liveForecast(pumps(2), settlements(), rates, now);
    expect(ForecastSchema.safeParse(f).success).toBe(true);
    expect(f.points).toHaveLength(15);
    expect(f.points[1]!.date).toBe("2026-09-17");
    expect(f.points.at(-1)!.date).toBe("2026-09-30");
    expect(f.points[1]!.signals![0]!.weight).toBe(0.9);
    expect(f.points[1]!.pricePence - f.currentPricePence).toBeGreaterThan(1.2);
    expect(f.points[14]!.signals![0]!.weight).toBeLessThan(0.15);
    for (const point of f.points) {
      expect(point.lowPence).toBeLessThanOrEqual(point.pricePence);
      expect(point.highPence).toBeGreaterThanOrEqual(point.pricePence);
      expect(
        f.currentPricePence +
          point.signals!.reduce((s, p) => s + p.contributionPence, 0),
      ).toBeCloseTo(point.pricePence, 2);
    }
  });
  it("uses independent petrol and crude signals, with B7H weighted four times as strongly", () => {
    const flat = liveForecast(pumps(), settlements(), rates, now),
      b7h = liveForecast(pumps(), settlements(3, 0), rates, now),
      crude = liveForecast(pumps(), settlements(0, 0.3), rates, now);
    expect(b7h.points[14]!.pricePence).toBeGreaterThan(
      flat.points[14]!.pricePence,
    );
    expect(crude.points[14]!.pricePence).toBeGreaterThan(
      flat.points[14]!.pricePence,
    );
    const s = b7h.points[14]!.signals!;
    expect(s[1]!.weight / s[2]!.weight).toBeCloseTo(4, 2);
  });
  it("converts each observation into GBP so a weaker pound lifts import costs", () => {
    const fx = rates.map((r, i) => ({ ...r, usdPerGbp: 1.4 - i * 0.01 }));
    expect(marketSignal("B7H", settlements(), fx, now)!.delta).toBeGreaterThan(
      0,
    );
    expect(marketSignal("B7H", settlements(), rates, now)!.delta).toBe(0);
  });
  it("never compares different contract levels across a roll", () => {
    const old = settlements().map((r) => ({
      ...r,
      symbol: r.product + "U6",
      priceUsd: r.priceUsd * 4,
      expiresAt: new Date("2026-09-15"),
    }));
    expect(
      marketSignal("B7H", [...old, ...settlements()], rates, now)!.delta,
    ).toBe(0);
  });
  it("uses actual dates across gaps, keeps one-day history honest and disables stale signals", () => {
    const f = liveForecast(pumps().slice(-1), [], [], now);
    expect(f.history).toHaveLength(1);
    expect(f.points[1]!.confidence).toBe("low");
    expect(f.points[1]!.signals!.every((s) => !s.available)).toBe(true);
    expect(f.warnings.join(" ")).toContain("Only 1 day");
    expect(() => liveForecast([], [], [], now)).toThrow("first Fuel Finder");
    expect(() => liveForecast(pumps().slice(0, -3), [], [], now)).toThrow(
      "two days old",
    );
    const stale = settlements().filter((s) => s.date < "2026-09-10");
    expect(marketSignal("B7H", stale, rates, now)).toBeNull();
  });
});
const driver: Driver = {
  vehicleName: "Test car",
  tankCapacityLitres: 50,
  currentLitres: 30,
  mpg: 45,
  dailyMiles: 40 / 7,
  smsEnabled: false,
  mileageMode: "weekly",
  weekdayMiles: [20, 20, 0, 0, 0, 0, 0],
  fuelUpdatedAt: "2026-09-13T23:00:00Z",
  updatedAt: now.toISOString(),
};
describe("weekday fuel planning", () => {
  it("consumes weekday journeys while a parked weekend consumes none", () => {
    expect(plannedLitres(driver, "2026-09-14", 2)).toBeCloseTo(
      (40 / 45) * 4.54609,
    );
    expect(plannedLitres(driver, "2026-09-19", 2)).toBe(0);
    expect(
      fuelState(driver, new Date("2026-09-15T23:00:00Z")).current,
    ).toBeCloseTo(30 - (40 / 45) * 4.54609);
  });
  it("buys enough for a large planned journey instead of using the weekly average", () => {
    const car = {
      ...driver,
      weekdayMiles: [0, 0, 300, 0, 0, 0, 0],
      currentLitres: 5,
      dailyMiles: 300 / 7,
      fuelUpdatedAt: now.toISOString(),
    };
    const f = liveForecast(pumps(), settlements(-3, -0.3), rates, now),
      r = recommend(car, f, now);
    expect(r.litresToBuy).toBeGreaterThanOrEqual((300 / 45) * 4.54609);
    expect(r.litresToBuy).toBeLessThanOrEqual(45);
    expect(r.daysOfFuel).toBeLessThan(1);
  });
});
