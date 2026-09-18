import { describe, it, expect } from "vitest";
import { DriverInput, ForecastSchema } from "@pump-hawk/contracts";
import type { Driver, WeeklyOutlook } from "@pump-hawk/contracts";
import { demoObservations, forecastPrices, addDays, DAY } from "./forecast";
import { fuelState, recommend } from "./recommendation";
import { isAlertHour, londonDate } from "../alerts/alert.service";
const now = new Date("2026-09-15T08:00:00Z");
const base: Driver = {
  vehicleName: "Test car",
  tankCapacityLitres: 50,
  currentLitres: 20,
  mpg: 45,
  dailyMiles: 20,
  smsEnabled: false,
  fuelUpdatedAt: now.toISOString(),
  updatedAt: now.toISOString(),
};
const falling = () =>
  forecastPrices(demoObservations(now), now, "demo", "test");
describe("daily model buying decisions", () => {
  it("ignores day-14 rises and trivial short-term savings", () => {
    const forecast = falling();
    forecast.model = "daily-ridge";
    forecast.adviceHorizonDays = 7;
    forecast.signal = "rising";
    forecast.points = forecast.points.slice(0, 15).map((p, i) => ({
      ...p,
      pricePence: forecast.currentPricePence + (i > 7 ? 30 : -0.1),
    }));
    expect(recommend(base, forecast, now).action).toBe("hold");
  });
  it("can wait for a meaningful dip even if the headline says rising", () => {
    const forecast = falling();
    forecast.model = "daily-ridge";
    forecast.signal = "rising";
    forecast.points = forecast.points.slice(0, 15).map((p, i) => ({
      ...p,
      pricePence: forecast.currentPricePence + (i === 3 ? -5 : 4),
    }));
    const advice = recommend(base, forecast, now);
    expect(advice.action).toBe("wait");
    expect(advice.nextFillDate).toBe("2026-09-18");
    expect(advice.estimatedSavingsGbp).toBeGreaterThanOrEqual(1);
  });
});
describe("weekly outlook buying decisions", () => {
  const driver = { ...base, dailyMiles: 5, mpg: 40 };
  const daily = () => {
    const forecast = falling();
    forecast.mode = "live";
    forecast.model = "daily-ridge";
    forecast.currentPricePence = 171.46;
    forecast.direction = forecast.signal = "rising";
    forecast.points = forecast.points.slice(0, 15).map((p, index) => ({
      ...p,
      pricePence: 171.46 + index * 0.5,
    }));
    return forecast;
  };
  const weekly = (): WeeklyOutlook => ({
    model: "weekly-huber",
    modelVersion: "test",
    generatedAt: now.toISOString(),
    issuedAt: now.toISOString(),
    referenceDate: "2026-09-14",
    series: "Official DESNZ sales-weighted petrol",
    unit: "pence/litre",
    history: [{ date: "2026-09-14", pricePence: 169 }],
    points: [
      {
        date: "2026-09-21",
        pricePence: 171.9,
        lowPence: 169.41,
        highPence: 174.38,
      },
      {
        date: "2026-09-28",
        pricePence: 175.29,
        lowPence: 169.95,
        highPence: 180.63,
      },
    ],
    warnings: [],
  });
  it("fills ahead of a weekly rise even with more than seven days of fuel", () => {
    expect(recommend(driver, daily(), now).action).toBe("hold");
    const advice = recommend(driver, daily(), now, weekly());
    expect(advice.action).toBe("fill-now");
    expect(advice.priceSignal).toBe("weekly");
    expect(advice.litresToBuy).toBe(30);
    expect(advice.estimatedSavingsGbp).toBe(1.02);
    expect(advice.reason).toContain("3.39p/L");
    expect(advice.reason).toContain("28 Sept");
  });
  it("keeps a worthwhile short-term dip ahead of a later weekly rise", () => {
    const forecast = daily();
    forecast.points[3]!.pricePence = forecast.currentPricePence - 5;
    const advice = recommend(driver, forecast, now, weekly());
    expect(advice.action).toBe("wait");
    expect(advice.nextFillDate).toBe("2026-09-18");
    expect(advice.priceSignal).toBe("daily");
  });
  it("never compares weekly absolute prices against the different daily benchmark", () => {
    const outlook = weekly();
    outlook.history[0]!.pricePence = 200;
    outlook.points[0]!.pricePence = 201;
    outlook.points[1]!.pricePence = 201.1;
    expect(recommend(driver, daily(), now, outlook).action).toBe("hold");
    outlook.points[0]!.pricePence = 190;
    outlook.points[1]!.pricePence = 195;
    expect(recommend(driver, daily(), now, outlook).action).toBe("hold");
  });
  it("ignores unavailable, stale, future-issued and expired weekly outlooks", () => {
    for (const outlook of [
      undefined,
      { ...weekly(), issuedAt: new Date(+now - 9 * DAY).toISOString() },
      { ...weekly(), issuedAt: new Date(+now + DAY).toISOString() },
      { ...weekly(), history: [] },
      {
        ...weekly(),
        points: weekly().points.map((p) => ({ ...p, date: "2026-09-14" })),
      },
    ])
      expect(recommend(driver, daily(), now, outlook).action).toBe("hold");
  });
  it("keeps tank freshness, capacity and materiality safeguards", () => {
    expect(
      recommend(
        { ...driver, fuelUpdatedAt: new Date(+now - 8 * DAY).toISOString() },
        daily(),
        now,
        weekly(),
      ).action,
    ).toBe("update-tank");
    expect(
      recommend({ ...driver, currentLitres: 50 }, daily(), now, weekly())
        .litresToBuy,
    ).toBe(0);
    expect(
      recommend({ ...driver, currentLitres: 49 }, daily(), now, weekly())
        .action,
    ).toBe("hold");
    const demo = daily();
    demo.mode = "demo";
    expect(recommend(driver, demo, now, weekly()).action).toBe("hold");
  });
});
describe("GBP wholesale forecast (PRICES.md)", () => {
  it("returns today plus 30 daily forecasts with bounded, widening ranges", () => {
    const f = falling();
    expect(ForecastSchema.safeParse(f).success).toBe(true);
    expect(f.points).toHaveLength(31);
    expect(f.points.at(-1)!.date).toBe("2026-10-15");
    for (const p of f.points) {
      expect(p.lowPence).toBeLessThanOrEqual(p.pricePence);
      expect(p.highPence).toBeGreaterThanOrEqual(p.pricePence);
    }
    expect(f.points[30]!.highPence - f.points[30]!.lowPence).toBeGreaterThan(
      f.points[1]!.highPence - f.points[1]!.lowPence,
    );
  });
  it("lags price cuts and plateaus after day 14", () => {
    const f = falling();
    expect(f.signal).toBe("falling");
    expect(f.points[2]!.pricePence).toBe(f.currentPricePence);
    expect(f.points[14]!.pricePence).toBeLessThan(f.currentPricePence);
    expect(f.points[30]!.pricePence).toBe(f.points[14]!.pricePence);
  });
  it("responds to a wholesale spike within two days, overriding an older decline", () => {
    const rows = demoObservations(now);
    rows[29]!.wholesalePence += 5;
    const f = forecastPrices(rows, now, "live", "test");
    expect(f.signal).toBe("rising");
    expect(f.points[2]!.pricePence).toBeGreaterThan(f.currentPricePence);
    expect(f.points[2]!.pricePence).toBe(f.points[30]!.pricePence);
  });
  it("flags FX shock without double-counting exchange rates in GBP wholesale", () => {
    const rows = demoObservations(now);
    const original = falling();
    rows[29]!.usdPerGbp = rows[28]!.usdPerGbp * 0.95;
    const f = forecastPrices(rows, now, "live", "test");
    expect(f.signal).toBe("fx-shock");
    expect(f.points).toEqual(original.points);
  });
  it("prioritizes explicit disruption", () => {
    const rows = demoObservations(now);
    rows[29]!.disruption = true;
    expect(forecastPrices(rows, now, "live", "test").signal).toBe("disruption");
  });
  it("requires three consecutive daily drops", () => {
    const rows = demoObservations(now);
    rows[28]!.wholesalePence = rows[27]!.wholesalePence + 0.01;
    expect(forecastPrices(rows, now, "live", "test").signal).toBe("steady");
  });
  it("recognises sustained modest increases before a large spike", () => {
    const rows = demoObservations(now).map((r, i) => ({
      ...r,
      wholesalePence: 50 + i * 0.1,
    }));
    const f = forecastPrices(rows, now, "live", "test");
    expect(f.signal).toBe("rising");
    expect(recommend(base, f, now).action).toBe("fill-now");
  });
  it("uses the UK calendar date across BST midnight", () => {
    const late = new Date("2026-09-15T23:30:00Z");
    expect(
      forecastPrices(demoObservations(late), late, "demo", "test").points[0]!
        .date,
    ).toBe("2026-09-16");
  });
  it("refuses short, gapped, duplicate, future and stale series", () => {
    const rows = demoObservations(now);
    expect(() => forecastPrices(rows.slice(0, 5), now, "live", "test")).toThrow(
      "15",
    );
    expect(() =>
      forecastPrices(
        rows.filter((_, i) => i !== 20),
        now,
        "live",
        "test",
      ),
    ).toThrow("contiguous");
    expect(() =>
      forecastPrices([...rows, rows[29]!], now, "live", "test"),
    ).toThrow("contiguous");
    expect(() =>
      forecastPrices(rows, new Date(now.getTime() + DAY * 3), "live", "test"),
    ).toThrow("stale");
    expect(() =>
      forecastPrices(rows, new Date(now.getTime() - DAY), "live", "test"),
    ).toThrow("future");
  });
  it("does not mutate observations", () => {
    const rows = demoObservations(now).reverse(),
      copy = structuredClone(rows);
    forecastPrices(rows, now, "demo", "test");
    expect(rows).toEqual(copy);
  });
});
describe("safe quantities and timing", () => {
  it("uses UK imperial gallons", () => {
    expect(
      fuelState({ ...base, mpg: 45, dailyMiles: 45 }, now).dailyLitres,
    ).toBeCloseTo(4.54609);
  });
  it("deducts estimated driving since the last tank reading", () => {
    const d = {
      ...base,
      fuelUpdatedAt: new Date(now.getTime() - 2 * DAY).toISOString(),
    };
    expect(fuelState(d, now).current).toBeCloseTo(
      20 - ((2 * 20) / 45) * 4.54609,
    );
  });
  it("buys only enough to reach the cheaper day with a reserve", () => {
    const d = { ...base, currentLitres: 10 },
      r = recommend(d, falling(), now);
    expect(r.action).toBe("top-up");
    const days = (Date.parse(r.nextFillDate) - Date.parse("2026-09-15")) / DAY;
    expect(
      d.currentLitres + r.litresToBuy - days * fuelState(d, now).dailyLitres,
    ).toBeGreaterThanOrEqual(r.reserveLitres - 0.001);
    expect(r.litresToBuy).toBeLessThan(40);
  });
  it("waits without buying when fuel safely covers the interval", () => {
    const r = recommend({ ...base, currentLitres: 45 }, falling(), now);
    expect(r.action).toBe("wait");
    expect(r.litresToBuy).toBe(0);
    expect(r.fillDate).not.toBe("2026-09-15");
  });
  it("fills on a rising signal", () => {
    const f = falling();
    f.signal = "rising";
    const r = recommend(base, f, now);
    expect(r.action).toBe("fill-now");
    expect(r.litresToBuy).toBe(30);
  });
  it("caps top-ups at actual free capacity without rounding past it", () => {
    const f = falling();
    f.signal = "rising";
    expect(
      recommend({ ...base, currentLitres: 49.84 }, f, now).litresToBuy,
    ).toBeLessThanOrEqual(0.16);
  });
  it("never asks a full tank to buy more", () => {
    const f = falling();
    f.signal = "disruption";
    const r = recommend({ ...base, currentLitres: 50 }, f, now);
    expect(r.action).toBe("hold");
    expect(r.litresToBuy).toBe(0);
  });
  it("requires a fresh tank reading after seven days", () => {
    expect(
      recommend(
        {
          ...base,
          fuelUpdatedAt: new Date(now.getTime() - 8 * DAY).toISOString(),
        },
        falling(),
        now,
      ).action,
    ).toBe("update-tank");
  });
  it("does not divide by zero for parked cars", () => {
    const r = recommend(
      { ...base, dailyMiles: 0, currentLitres: 0 },
      falling(),
      now,
    );
    expect(r.daysOfFuel).toBeNull();
    expect(r.litresToBuy).toBe(5);
  });
  it("prioritizes an empty tank and very high daily consumption", () => {
    const r = recommend(
      { ...base, currentLitres: 0, dailyMiles: 600, mpg: 10 },
      falling(),
      now,
    );
    expect(r.action).toBe("fill-now");
    expect(r.litresToBuy).toBe(50);
    expect(r.reason).toContain("another stop");
  });
  it("selects a reachable date for small tanks", () => {
    const d = {
        ...base,
        tankCapacityLitres: 20,
        currentLitres: 2,
        dailyMiles: 40,
      },
      r = recommend(d, falling(), now);
    const days = (Date.parse(r.nextFillDate) - Date.parse("2026-09-15")) / DAY;
    expect(
      days * fuelState(d, now).dailyLitres + r.reserveLitres,
    ).toBeLessThanOrEqual(20);
  });
  it("never produces negative savings, costs or quantities", () => {
    for (const dailyMiles of [0, 10, 100, 600])
      for (const currentLitres of [0, 1, 20, 49.96, 50]) {
        const r = recommend(
          { ...base, dailyMiles, currentLitres },
          falling(),
          now,
        );
        expect(r.litresToBuy).toBeGreaterThanOrEqual(0);
        expect(r.litresToBuy).toBeLessThanOrEqual(50 - currentLitres + 0.001);
        expect(r.estimatedSavingsGbp).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(r.estimatedCostGbp)).toBe(true);
      }
  });
  it("validates user fuel and consumption bounds", () => {
    expect(DriverInput.safeParse({ ...base, currentLitres: 60 }).success).toBe(
      false,
    );
    expect(DriverInput.safeParse({ ...base, mpg: 0 }).success).toBe(false);
    expect(DriverInput.safeParse({ ...base, dailyMiles: -1 }).success).toBe(
      false,
    );
  });
});
describe("British alert times", () => {
  it("runs at 08:00 UK time in BST and GMT", () => {
    expect(isAlertHour(new Date("2026-09-15T07:00:00Z"))).toBe(true);
    expect(isAlertHour(new Date("2026-09-15T08:00:00Z"))).toBe(false);
    expect(isAlertHour(new Date("2026-12-15T08:00:00Z"))).toBe(true);
    expect(isAlertHour(new Date("2026-12-15T07:00:00Z"))).toBe(false);
  });
  it("uses UK calendar days for idempotency", () => {
    expect(londonDate(new Date("2026-09-15T23:30:00Z"))).toBe("2026-09-16");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
