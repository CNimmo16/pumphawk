import { describe, expect, it, vi } from "vitest";
import { parseCsv, providerText, type HttpClient } from "./http";
import {
  parsePrice,
  parseStation,
  FuelFinderService,
} from "./fuel-finder.service";
import {
  parseSettlements,
  selectContracts,
  DatabentoService,
} from "./databento.service";
import { distanceMiles } from "./station.service";
import type { Config } from "../app/config";
const now = new Date("2026-09-16T12:00:00Z");
const definition = {
  instrument_class: "F",
  asset: "B7H",
  raw_symbol: "B7HU6",
  expiration: "2026-09-30T19:30:00Z",
};
const stat = {
  symbol: "B7HU6",
  stat_type: "3",
  stat_flags: "3",
  price: "1284.740",
  ts_ref: "2026-09-15T00:00:00Z",
  ts_recv: "2026-09-15T23:05:00Z",
  update_action: "1",
};
describe("provider normalization", () => {
  it("reads quoted CSV and preserves exact settlement display prices", () => {
    expect(parseCsv('a,b\r\n"a,b","quote ""yes"""\r\n')).toEqual([
      { a: "a,b", b: 'quote "yes"' },
    ]);
    const rows = parseSettlements(
      [stat, { ...stat, price: "1285.123", ts_recv: "2026-09-15T23:06:00Z" }],
      [definition],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.priceUsd).toBe(1285.123);
    expect(rows[0]!.date).toBe("2026-09-15");
  });
  it("excludes preliminary/intraday prices, price limits and spread definitions", () => {
    expect(
      parseSettlements(
        [
          { ...stat, stat_flags: "2" },
          { ...stat, stat_flags: "11" },
          { ...stat, stat_type: "17" },
        ],
        [definition],
      ),
    ).toEqual([]);
    expect(
      selectContracts(
        [
          definition,
          { ...definition, raw_symbol: "spread", instrument_class: "S" },
          { ...definition, raw_symbol: "expired", expiration: "2026-09-01" },
        ],
        now,
      ),
    ).toEqual([definition]);
    expect(
      parseSettlements(
        [
          stat,
          { ...stat, update_action: "2", ts_recv: "2026-09-15T23:07:00Z" },
        ],
        [definition],
      ),
    ).toEqual([]);
  });
  it("uses E10 prices in pence and ignores future effective changes", () => {
    const fuel = {
      node_id: "station",
      fuel_prices: [
        {
          fuel_type: "E5",
          price: 155.9,
          price_last_updated: "2026-09-15T12:00:00Z",
        },
        {
          fuel_type: "E10",
          price: "139.9000",
          price_change_effective_timestamp: "2026-09-15T12:00:00Z",
        },
      ],
    };
    expect(parsePrice(fuel, now)?.pricePence).toBe(139.9);
    expect(
      parsePrice(
        { ...fuel, fuel_prices: [{ ...fuel.fuel_prices[1], price: 0 }] },
        now,
      )?.pricePence,
    ).toBeNull();
    expect(
      parsePrice(
        {
          ...fuel,
          fuel_prices: [
            {
              ...fuel.fuel_prices[1],
              price_change_effective_timestamp: "2099-01-01T00:00:00Z",
            },
          ],
        },
        now,
      ),
    ).toBeNull();
  });
  it("recognises closed stations and applies a true five-mile distance", () => {
    const a = { latitude: 51.5, longitude: -0.1 };
    expect(distanceMiles(a, a)).toBe(0);
    expect(
      distanceMiles(a, { latitude: 51.6, longitude: -0.1 }),
    ).toBeGreaterThan(5);
    expect(
      parseStation({
        node_id: "one",
        trading_name: "Test",
        temporary_closure: true,
        location: a,
      })?.closed,
    ).toBe(true);
  });
  it("fails closed on cost limits without downloading paid data", async () => {
    const http = vi.fn(
      async () => new Response("0.26"),
    ) as unknown as HttpClient;
    const service = new DatabentoService(
      { databentoApiKey: "test" } as Config,
      http,
    );
    await expect(service.daily(now, false)).rejects.toThrow("$0.25");
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("bounds upstream bodies and does not expose token-bearing error bodies", async () => {
    await expect(
      providerText(
        (async () =>
          new Response("secret-token", { status: 401 })) as HttpClient,
        "https://example.com",
      ),
    ).rejects.toThrow("HTTP 401");
    await expect(
      providerText(
        (async () => new Response("abcdef")) as HttpClient,
        "https://example.com",
        {},
        3,
      ),
    ).rejects.toThrow("download limit");
  });
  it("reuses one token across paginated station/price calls with the incremental watermark", async () => {
    const calls: string[] = [];
    const http = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(
        JSON.stringify(
          calls.length === 1
            ? { success: true, data: { access_token: "test-token" } }
            : [],
        ),
      );
    }) as unknown as HttpClient;
    const service = new FuelFinderService(
        {
          fuelFinderClientId: "test",
          fuelFinderClientSecret: "test",
        } as Config,
        http,
      ),
      token = await service.token();
    for await (const _ of service.pages(token, "stations", now)) {
    }
    for await (const _ of service.pages(token, "prices", now)) {
    }
    expect(calls).toHaveLength(3);
    expect(calls[2]).toContain(
      "effective-start-timestamp=2026-09-16+12%3A00%3A00",
    );
  });
});
