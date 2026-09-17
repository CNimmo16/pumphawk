import { liveForecast } from "./live-forecast";
import { DbService } from "../lib/db/db.service";
import { marketObservation } from "../lib/db/schema";
import type { Config } from "../app/config";
import type { Observation } from "@pump-hawk/contracts";
import { AppError } from "../app/errors";
import { demoObservations, forecastPrices, isoDay } from "./forecast";
export class MarketService {
  static inject = ["dbService", "config", "clock"] as const;
  constructor(
    private store: DbService,
    private config: Config,
    private clock: () => Date,
  ) {}
  async forecast() {
    const now = this.clock();
    if (this.config.marketDataMode === "demo") {
      const demo = forecastPrices(
        demoObservations(now),
        now,
        "demo",
        "Pump Hawk demo",
      );
      demo.points = demo.points.slice(0, 15);
      return demo;
    }
    const includeSamples =
      this.config.environment === "development" &&
      this.config.marketDataMode === "sample";
    const [pumps, settlements, rates] = await Promise.all([
      this.store.db.query.nationalPrice.findMany({
        where: {
          date: { lte: isoDay(now) },
          ...(includeSamples ? {} : { source: "fuel-finder" as const }),
        },
        orderBy: { date: "desc" },
        limit: 14,
      }),
      this.store.db.query.futuresSettlement.findMany({
        where: {
          date: {
            gte: new Date(+now - 45 * 86400000).toISOString().slice(0, 10),
          },
        },
        orderBy: { date: "asc" },
      }),
      this.store.db.query.exchangeRate.findMany({
        orderBy: { date: "desc" },
        limit: 45,
      }),
    ]);
    return liveForecast(
      pumps,
      settlements,
      rates,
      now,
      pumps.some((p) => p.source === "sample") ? "sample" : "live",
    );
  }

  async ingest(source: string, observations: Observation[]) {
    if (new Set(observations.map((o) => o.date)).size !== observations.length)
      throw new AppError(
        "DUPLICATE_DATE",
        "Each date may appear only once in a batch.",
        422,
      );
    if (observations.some((o) => o.date > isoDay(this.clock())))
      throw new AppError(
        "FUTURE_OBSERVATION",
        "Observations cannot be dated in the future.",
        422,
      );
    await this.store.db.transaction(async (tx) => {
      for (const row of observations)
        await tx
          .insert(marketObservation)
          .values({ ...row, id: crypto.randomUUID(), source })
          .onConflictDoUpdate({
            target: [marketObservation.source, marketObservation.date],
            set: row,
          });
    });
    return { accepted: observations.length, source };
  }
}
