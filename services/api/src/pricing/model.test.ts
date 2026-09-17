import { describe, it, expect } from "vitest";
import fixtures from "./model-fixtures.json";
import { predictModel, type Frequency } from "./model";
import { buildFeatures } from "./model-features";
import { dailyCutoff, parseWeeklyPrices } from "../data/model-data.service";
import { parseModelPrice } from "../data/fuel-finder.service";
import { parseSettlementEvents } from "../data/databento.service";

describe("portable models and point-in-time inputs", () => {
  for (const [i, fixture] of fixtures.entries())
    it(`matches Python fitted predictions for ${fixture.frequency} fixture ${i}`, () => {
      const predictions = predictModel(
        fixture.frequency as Frequency,
        Object.fromEntries(
          Object.entries(fixture.features).map(([key, value]) => [
            key,
            value ?? null,
          ]),
        ),
      );
      for (const prediction of predictions) {
        const expected = (
          fixture.expected as Record<
            string,
            { price_ppl: number; change_ppl: number }
          >
        )[String(prediction.horizon)]!;
        expect(prediction.price).toBeCloseTo(expected.price_ppl, 10);
        expect(prediction.change).toBeCloseTo(expected.change_ppl, 10);
        expect(
          Object.values(prediction.contributions).reduce((a, b) => a + b, 0),
        ).toBeCloseTo(prediction.change, 12);
      }
      if (fixture.frequency === "weekly")
        expect(predictions.map((p) => p.horizon)).toEqual([7, 14]);
    });
  it("rejects cross-frequency inference", () =>
    expect(() =>
      predictModel("weekly", { anchor_price: 150 }, "daily"),
    ).toThrow("frequency mismatch"));
  it("uses fixed UTC snapshot cutoffs across DST", () => {
    expect(dailyCutoff(new Date("2026-07-04T07:59:59Z")).toISOString()).toBe(
      "2026-07-03T08:00:00.000Z",
    );
    expect(dailyCutoff(new Date("2026-07-04T08:00:00Z")).toISOString()).toBe(
      "2026-07-04T08:00:00.000Z",
    );
  });
  it("preserves future-effective prices and invalidation events", () => {
    const body = {
      node_id: "one",
      fuel_prices: [
        {
          fuel_type: "E10",
          price: 151,
          price_change_effective_timestamp: "2026-07-05T09:00:00Z",
        },
      ],
    };
    expect(
      parseModelPrice(
        body,
        new Date("2026-07-04T08:00:00Z"),
      )!.availableAt.toISOString(),
    ).toBe("2026-07-05T09:00:00.000Z");
    body.fuel_prices[0]!.price = 0;
    expect(parseModelPrice(body, new Date())!.pricePence).toBeNull();
  });
  it("does not compare different contracts or see later revisions/FX", () => {
    const origin = new Date("2026-07-20T08:00:00Z"),
      expiresAt = new Date("2026-08-01T00:00:00Z");
    const event = {
      product: "B7H" as const,
      symbol: "A",
      expiresAt,
      date: "2026-07-19",
      priceUsd: 1000,
      publishedAt: new Date("2026-07-19T18:00:00Z"),
    };
    const events = [
      event,
      {
        ...event,
        priceUsd: 9000,
        publishedAt: new Date("2026-07-20T09:00:00Z"),
      },
      { ...event, date: "2026-07-12", priceUsd: 800 },
      { ...event, symbol: "B", date: "2026-07-12", priceUsd: 1 },
    ];
    const rates = ["2026-07-12", "2026-07-19"].map((date) => ({
      date,
      usdPerGbp: 1.25,
      availableAt: new Date(date + "T18:00:00Z"),
    }));
    const prices = [
      { date: "2026-07-20", availableAt: origin, pricePence: 150 },
      {
        date: "2026-07-19",
        availableAt: new Date("2026-07-19T08:00:00Z"),
        pricePence: 149,
      },
    ];
    const result = buildFeatures(
      "daily",
      prices,
      events,
      [
        ...rates,
        {
          ...rates[1]!,
          usdPerGbp: 9,
          availableAt: new Date("2026-07-20T09:00:00Z"),
        },
      ],
      origin,
    );
    expect(result.features.x_b7h_change_7).toBeCloseTo(
      ((1000 - 800) / 1.25) * 0.0745,
    );
    expect(result.features.x_pump_change_1).toBe(1);
    expect(
      buildFeatures(
        "daily",
        prices,
        [
          ...events,
          {
            ...event,
            deleted: true,
            publishedAt: new Date("2026-07-20T07:00:00Z"),
          },
        ],
        rates,
        origin,
      ).features.x_b7h_level,
    ).toBeNull();
  });
  it("keeps deletion events even when they have no price", () => {
    const d = {
      raw_symbol: "A",
      asset: "B7H",
      instrument_class: "F",
      ts_recv: "2026-07-01T00:00:00Z",
      expiration: "2026-08-01T00:00:00Z",
    };
    const event = {
      symbol: "A",
      ts_recv: "2026-07-20T07:00:00Z",
      ts_ref: "2026-07-19T00:00:00Z",
      stat_flags: "1",
      stat_type: "3",
      update_action: "2",
      price: "",
    };
    expect(parseSettlementEvents([event], [d])[0]!.deleted).toBe(true);
    expect(
      parseSettlementEvents(
        [event],
        [{ ...d, ts_recv: "2026-07-21T00:00:00Z" }],
      ),
    ).toEqual([]);
  });
  it("only emits real weekly dates with conservative Thursday availability", () => {
    const result = parseWeeklyPrices(
      "Date,Petrol\n14/09/2026,150.23\n",
      new Date("2026-09-16T00:00:00Z"),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.availableAt.toISOString()).toBe(
      "2026-09-17T08:00:00.000Z",
    );
  });
});
