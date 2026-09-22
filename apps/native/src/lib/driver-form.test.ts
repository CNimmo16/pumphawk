import { describe, expect, it } from "vitest";
import type { Station } from "@pump-hawk/openapi/types";
import {
  initialDraft,
  numberInput,
  parseDriver,
  sortedStations,
} from "./driver-form";
import {
  stationPriceComparison,
  stationPriceMedian,
} from "@pump-hawk/presentation/station-prices";
import { chartGeometry, nearestPoint } from "./chart";
const station = (
  id: string,
  pricePence: number | null,
  distanceMiles: number,
): Station => ({
  id,
  name: id,
  pricePence,
  distanceMiles,
  brand: "",
  address: "",
  postcode: "",
  latitude: 51.5,
  longitude: 0,
  motorway: false,
  closed: false,
  priceUpdatedAt: null,
  checkedAt: null,
});
describe("native form and chart boundaries", () => {
  it("rejects blank, malformed and overflowing tank readings", () => {
    for (const value of ["", " ", "oops", "-2", "51", "Infinity"])
      expect(() => numberInput(value, "Tank", 0, 50)).toThrow();
    expect(numberInput("0", "Tank", 0, 50)).toBe(0);
    expect(numberInput("25,5", "Tank", 0, 50)).toBe(25.5);
    expect(() =>
      parseDriver({ ...initialDraft(), currentLitres: "51" }),
    ).toThrow();
  });
  it("uses the seven-day mean while preserving each weekday and SMS preference", () => {
    const result = parseDriver({
      ...initialDraft(),
      smsEnabled: true,
      mileageMode: "weekly",
      weekdayMiles: ["0", "10", "20", "30", "40", "50", "60"],
    });
    expect(result.dailyMiles).toBe(30);
    expect(result.weekdayMiles).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(result.smsEnabled).toBe(true);
    expect(() =>
      parseDriver({
        ...initialDraft(),
        mileageMode: "weekly",
        weekdayMiles: ["1"],
      }),
    ).toThrow();
  });
  it("pins selected stations ahead of both sort orders and puts unknown prices last", () => {
    const input = [
      station("far-selected", 180, 4),
      station("near", 170, 0.2),
      station("cheap", 160, 2),
      station("unknown", null, 3),
    ];
    expect(
      sortedStations(input, ["far-selected"], "price").map((s) => s.id),
    ).toEqual(["far-selected", "cheap", "near", "unknown"]);
    expect(
      sortedStations(input, ["far-selected"], "distance").map((s) => s.id),
    ).toEqual(["far-selected", "near", "cheap", "unknown"]);
    expect(input[0]!.id).toBe("far-selected");
  });
  it("shares the web median and colour boundaries, ignoring unavailable prices", () => {
    expect(
      stationPriceMedian([
        station("a", 150, 1),
        station("b", 160, 2),
        station("c", null, 3),
      ]),
    ).toBe(155);
    expect(stationPriceComparison(153.9, 155).band).toBe("low");
    expect(stationPriceComparison(156, 155).band).toBe("typical");
    expect(stationPriceComparison(156.1, 155).band).toBe("high");
    expect(stationPriceComparison(null, 155).band).toBe("unknown");
  });
  it("positions irregular observations by real time and includes the whole uncertainty range", () => {
    const points = [
      { date: "2026-09-01", pricePence: 160 },
      { date: "2026-09-02", pricePence: 162 },
      { date: "2026-09-11", pricePence: 170, lowPence: 150, highPence: 180 },
    ];
    const geometry = chartGeometry(
      [{ id: "a", label: "a", color: "", points }],
      320,
    )!;
    expect(
      (geometry.x(points[1]!.date) - geometry.left) /
        (geometry.right - geometry.left),
    ).toBeCloseTo(0.1);
    expect(geometry.min).toBeLessThan(150);
    expect(geometry.max).toBeGreaterThan(180);
    expect(nearestPoint(points, geometry.right, geometry.x)).toEqual(points[2]);
    expect(chartGeometry([], 320)).toBeNull();
    const single = chartGeometry(
      [{ id: "a", label: "a", color: "", points: points.slice(0, 1) }],
      320,
    )!;
    expect(Number.isFinite(single.x(points[0]!.date))).toBe(true);
  });
});
