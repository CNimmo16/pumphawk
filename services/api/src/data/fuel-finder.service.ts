import { z } from "zod";
import type { Config } from "../app/config";
import { AppError } from "../app/errors";
import { providerText, type HttpClient } from "./http";
const origin = "https://www.fuel-finder.service.gov.uk";
const Pfs = z.object({
  node_id: z.string().min(1),
  trading_name: z.string(),
  brand_name: z.string().nullish(),
  temporary_closure: z.boolean().nullish(),
  permanent_closure: z.boolean().nullish(),
  is_motorway_service_station: z.boolean().nullish(),
  location: z.object({
    latitude: z.coerce.number().min(49).max(61),
    longitude: z.coerce.number().min(-9).max(3),
    address_line_1: z.string().nullish(),
    postcode: z.string().nullish(),
  }),
});
const Prices = z.object({
  node_id: z.string(),
  fuel_prices: z.array(
    z.object({
      fuel_type: z.string(),
      price: z.union([z.number(), z.string(), z.null()]),
      price_last_updated: z.string().nullish(),
      price_change_effective_timestamp: z.string().nullish(),
    }),
  ),
});
export function parseStation(input: unknown) {
  const r = Pfs.safeParse(input);
  if (!r.success) return null;
  const p = r.data;
  return {
    id: p.node_id,
    name: p.trading_name,
    brand: p.brand_name ?? p.trading_name,
    address: p.location.address_line_1 ?? "",
    postcode: p.location.postcode ?? "",
    latitude: p.location.latitude,
    longitude: p.location.longitude,
    motorway: !!p.is_motorway_service_station,
    closed: !!(p.temporary_closure || p.permanent_closure),
  };
}
export function parsePrice(input: unknown, now: Date) {
  const r = Prices.safeParse(input);
  if (!r.success) return null;
  const p = r.data.fuel_prices.find((p) => p.fuel_type === "E10");
  if (!p) return { id: r.data.node_id, pricePence: null, priceUpdatedAt: null };
  const price = Number(p.price),
    stamp = p.price_change_effective_timestamp ?? p.price_last_updated;
  // Current official API timestamps are ISO 8601 UTC; reject ambiguous/unparseable dates.
  const date =
    stamp && /(?:Z|[+-]\d\d:\d\d)$/.test(stamp) ? new Date(stamp) : null;
  if (date && +date > +now) return null;
  return {
    id: r.data.node_id,
    pricePence:
      price >= 30 && price <= 600 && date && Number.isFinite(+date)
        ? price
        : null,
    priceUpdatedAt: date && Number.isFinite(+date) ? date : null,
  };
}
// Training uses max(receipt, effective timestamp), including invalidations and future-effective prices.
export function parseModelPrice(input: unknown, receivedAt: Date) {
  const result = Prices.safeParse(input);
  if (!result.success) return null;
  const price = result.data.fuel_prices.find((p) => p.fuel_type === "E10");
  if (!price) return null;
  const stamp =
    price.price_change_effective_timestamp ?? price.price_last_updated;
  if (!stamp || !/(?:Z|[+-]\d\d:\d\d)$/.test(stamp)) return null;
  const sourceAt = new Date(stamp);
  if (!Number.isFinite(+sourceAt)) return null;
  const value = Number(price.price);
  return {
    stationId: result.data.node_id,
    sourceAt,
    receivedAt,
    availableAt: new Date(Math.max(+receivedAt, +sourceAt)),
    pricePence:
      Number.isFinite(value) && value >= 30 && value <= 600 ? value : null,
    source: "fuel-finder",
  };
}
export class FuelFinderService {
  static inject = ["config", "httpClient"] as const;
  constructor(
    private config: Config,
    private http: HttpClient,
  ) {}
  async token() {
    if (!this.config.fuelFinderClientId || !this.config.fuelFinderClientSecret)
      throw new AppError(
        "FUEL_FINDER_NOT_CONFIGURED",
        "Fuel Finder credentials are needed before live station prices can be collected.",
        503,
      );
    const data = JSON.parse(
      await providerText(
        this.http,
        origin + "/api/v1/oauth/generate_access_token",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: this.config.fuelFinderClientId,
            client_secret: this.config.fuelFinderClientSecret,
          }),
        },
        20000,
      ),
    );
    if (!data.success || typeof data.data?.access_token !== "string")
      throw new AppError(
        "FUEL_FINDER_AUTH",
        "Fuel Finder did not return an access token.",
        503,
      );
    return data.data.access_token as string;
  }
  async *pages(token: string, kind: "stations" | "prices", since?: Date) {
    const deadline = Date.now() + 4 * 60 * 1000;
    for (let page = 1; page <= 50; page++) {
      if (Date.now() > deadline)
        throw new AppError(
          "SYNC_TIMEOUT",
          "Fuel Finder sync timed out; previous data was retained.",
          503,
        );
      const url = new URL(
        origin + "/api/v1/pfs" + (kind === "prices" ? "/fuel-prices" : ""),
      );
      url.searchParams.set("batch-number", String(page));
      if (since)
        url.searchParams.set(
          "effective-start-timestamp",
          since.toISOString().slice(0, 19).replace("T", " "),
        );
      const response = JSON.parse(
        await providerText(
          this.http,
          url.toString(),
          { headers: { Authorization: `Bearer ${token}` } },
          5_000_000,
        ),
      );
      if (!Array.isArray(response))
        throw new AppError(
          "FUEL_FINDER_FORMAT",
          "Fuel Finder returned an unexpected response format.",
          503,
        );
      yield response as unknown[];
      if (response.length < 500) return;
      // One concurrent request per client, comfortably below the 100 requests/minute limit.
      await new Promise((resolve) => setTimeout(resolve, 650));
    }
    throw new AppError(
      "FUEL_FINDER_PAGINATION",
      "Fuel Finder pagination exceeded its safety limit; sync was not completed.",
      503,
    );
  }
}
