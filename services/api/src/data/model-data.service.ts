import { sql } from "drizzle-orm";
import { DbService } from "../lib/db/db.service";
import { modelPrice } from "../lib/db/schema";
import { parseCsv, providerText, type HttpClient } from "./http";
import { AppError } from "../app/errors";
const DAY = 86400000;
export function dailyCutoff(now: Date) {
  const cutoff = new Date(now.toISOString().slice(0, 10) + "T08:00:00Z");
  return +cutoff > +now ? new Date(+cutoff - DAY) : cutoff;
}
export function parseWeeklyPrices(csv: string, now: Date) {
  return parseCsv(csv.replace(/^\uFEFF/, "")).flatMap((row) => {
    const [rawDate, rawPrice] = Object.values(row);
    const match = rawDate?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) return [];
    const date = `${match[3]}-${match[2]}-${match[1]}`;
    const pricePence = Number(rawPrice);
    const availableAt = new Date(Date.parse(date + "T08:00:00Z") + 3 * DAY);
    if (
      !Number.isFinite(+availableAt) ||
      pricePence < 30 ||
      pricePence > 600 ||
      !Number.isFinite(pricePence)
    )
      return [];
    // Store early publications but do not expose them before the trained origin.
    if (Date.parse(date) > +now) return [];
    return [
      {
        frequency: "weekly" as const,
        date,
        availableAt,
        pricePence,
        source: "desnz",
      },
    ];
  });
}
export class ModelDataService {
  static inject = ["dbService", "httpClient", "clock"] as const;
  constructor(
    private store: DbService,
    private http: HttpClient,
    private clock: () => Date,
  ) {}
  async snapshot() {
    const now = this.clock(),
      cutoff = dailyCutoff(now),
      date = cutoff.toISOString().slice(0, 10);
    const existing = await this.store.db.query.modelPrice.findFirst({
      where: { frequency: "daily", date },
    });
    if (existing) return { snapshot: date, created: false };
    // Require a completed collection before this cutoff; never backdate today's feed.
    const job = await this.store.db.query.dataJob.findFirst({
      where: {
        key: { like: "fuel-finder:%" },
        status: "complete",
        finishedAt: { lt: cutoff, gte: new Date(+cutoff - 2 * 3600000) },
      },
    });
    if (!job)
      throw new AppError(
        "SNAPSHOT_FEED_STALE",
        "No completed Fuel Finder collection immediately before the 08:00 UTC cutoff.",
        503,
      );
    // DISTINCT ON and AVG belong in SQL: scanning every station event into a Worker is unbounded.
    const rows = await this.store.db.execute<{
      price: number;
      count: number;
    }>(sql`
      WITH latest AS (SELECT DISTINCT ON (station_id) station_id, price_pence FROM model_pump_event
        WHERE available_at < ${cutoff.toISOString()}::timestamptz
        ORDER BY station_id, source_at DESC, received_at DESC)
      SELECT avg(price_pence)::float8 AS price, count(price_pence)::integer AS count FROM latest`);
    const value = rows[0];
    if (!value?.count || value.price == null)
      throw new AppError(
        "SNAPSHOT_EMPTY",
        "No eligible observed E10 station prices at the cutoff.",
        503,
      );
    const open = await this.store.db.query.nationalPrice.findFirst({
      where: { source: "fuel-finder", observedAt: { lt: cutoff } },
      orderBy: { observedAt: "desc" },
    });
    await this.store.db
      .insert(modelPrice)
      .values({
        frequency: "daily",
        date,
        availableAt: cutoff,
        pricePence: Math.round(value.price * 1000) / 1000,
        stationCount: value.count,
        source: "fuel-finder-observed",
        openStationPricePence:
          open && +cutoff - +open.observedAt < 2 * 3600000
            ? open.pricePence
            : null,
      })
      .onConflictDoNothing();
    return { snapshot: date, created: true };
  }
  async weekly() {
    const page = await providerText(
      this.http,
      "https://www.gov.uk/government/statistics/weekly-road-fuel-prices",
      {},
      2_000_000,
    );
    const urls = [
      ...page.matchAll(
        /href="(https:\/\/assets\.publishing\.service\.gov\.uk\/[^"<>]+\.csv)"/gi,
      ),
    ].map((m) => m[1]!);
    const url = urls.find((s) => /2018|CSV__/i.test(s));
    if (!url)
      throw new AppError(
        "WEEKLY_SOURCE_CHANGED",
        "Official weekly CSV link was not found.",
        503,
      );
    const prices = parseWeeklyPrices(
      await providerText(this.http, url, {}, 1_000_000),
      this.clock(),
    );
    if (!prices.length)
      throw new AppError(
        "WEEKLY_SOURCE_EMPTY",
        "No official petrol observations were returned.",
        503,
      );
    for (let i = 0; i < prices.length; i += 200)
      await this.store.db
        .insert(modelPrice)
        .values(prices.slice(i, i + 200))
        .onConflictDoNothing();
    return { observations: prices.length };
  }
}
