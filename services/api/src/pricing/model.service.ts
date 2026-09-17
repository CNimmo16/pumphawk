import {
  ForecastSchema,
  WeeklyOutlookSchema,
  type Forecast,
  type WeeklyOutlook,
} from "@pump-hawk/contracts";
import { DbService } from "../lib/db/db.service";
import { forecastRun } from "../lib/db/schema";
import { AppError } from "../app/errors";
import { addDays, round } from "./forecast";
import { buildFeatures } from "./model-features";
import { models, predictModel, type Frequency } from "./model";

const DAY = 86400000;
export class ModelService {
  static inject = ["dbService", "clock"] as const;
  constructor(
    private store: DbService,
    private clock: () => Date,
  ) {}

  private async generate(frequency: Frequency) {
    const now = this.clock();
    const prices = await this.store.db.query.modelPrice.findMany({
      where: { frequency, availableAt: { lte: now } },
      orderBy: { date: "desc" },
      limit: frequency === "daily" ? 45 : 60,
    });
    const anchor = prices[0];
    if (
      !anchor ||
      +now - +anchor.availableAt > (frequency === "daily" ? 2 : 8) * DAY
    )
      throw new AppError(
        "MODEL_NOT_READY",
        `A fresh ${frequency} model observation is not yet available.`,
        503,
      );
    const origin = anchor.availableAt;
    const version = models[frequency].fingerprint;
    const saved = await this.store.db.query.forecastRun.findFirst({
      where: { frequency, origin: { eq: origin }, modelVersion: version },
    });
    if (saved) return saved.result;
    // Never silently use a median for missing retail history at initial startup.
    if (
      !prices.some(
        (p) =>
          p.date <= addDays(anchor.date, frequency === "daily" ? -14 : -28),
      )
    )
      throw new AppError(
        "MODEL_HISTORY_MISSING",
        "Import the genuine model history before enabling forecasts.",
        503,
      );
    const from = addDays(anchor.date, -70);
    const [events, rates] = await Promise.all([
      this.store.db.query.modelSettlementEvent.findMany({
        where: { date: { gte: from }, publishedAt: { lte: origin } },
      }),
      this.store.db.query.modelFxRate.findMany({
        where: { date: { gte: from }, availableAt: { lte: origin } },
      }),
    ]);
    const { features } = buildFeatures(
      frequency,
      prices,
      events,
      rates,
      origin,
    );
    if (
      features.x_b7h_level == null ||
      (frequency === "daily" && features.x_bz_level == null)
    )
      throw new AppError(
        "MODEL_MARKET_STALE",
        "Fresh futures and FX data are required for the trained model.",
        503,
      );
    const predictions = predictModel(frequency, features);
    const warnings = [
      "National averages are not predictions for an individual forecourt.",
      "Ranges are empirical historical errors, not guaranteed probability intervals.",
    ];
    if (predictions.some((p) => p.imputed.length))
      warnings.push(
        "Some contract history is unavailable; the fitted training medians are used for those features.",
      );
    const labels = {
      pump: "Recent pump prices",
      b7h: "B7H petrol futures",
      crude: "Brent crude",
      baseline: "Model baseline",
    };
    const points = predictions.map((p) => ({
      date: addDays(anchor.date, p.horizon),
      pricePence: round(p.price),
      lowPence: round(p.price - p.radius),
      highPence: round(p.price + p.radius),
      confidence: (p.horizon <= 7 && !p.imputed.length ? "medium" : "low") as
        "medium" | "low",
      signals: Object.entries(p.contributions).map(([key, value]) => ({
        name: key as keyof typeof labels,
        label: labels[key as keyof typeof labels],
        contributionPence: value,
        available: true,
        detail:
          key === "baseline"
            ? "Fitted intercept and preprocessing baseline. Contributions sum to the predicted change; they are not causal effects."
            : `Sum of fitted ${labels[key as keyof typeof labels].toLowerCase()} feature contributions, including any training-median substitution.`,
      })),
    }));
    const history = [...prices]
      .reverse()
      .map((p) => ({ date: p.date, pricePence: p.pricePence }));
    let result: Forecast | WeeklyOutlook;
    if (frequency === "weekly") {
      result = WeeklyOutlookSchema.parse({
        model: "weekly-huber",
        modelVersion: version,
        generatedAt: now.toISOString(),
        issuedAt: origin.toISOString(),
        referenceDate: anchor.date,
        series: "Official DESNZ sales-weighted petrol",
        unit: "pence/litre",
        history,
        points,
        warnings: [
          ...warnings,
          "The next two reference observations are weekly; no daily values are interpolated. Thursday issuance matches the conservative training cutoff.",
        ],
      });
    } else {
      const delta = points[6]!.pricePence - anchor.pricePence;
      const direction =
        delta > 0.5 ? "rising" : delta < -0.5 ? "falling" : "steady";
      result = ForecastSchema.parse({
        model: "daily-ridge",
        modelVersion: version,
        adviceHorizonDays: 7,
        snapshotAt: origin.toISOString(),
        series: "Equal-station observed E10 average · 08:00 UTC",
        openStationPricePence: anchor.openStationPricePence,
        asOf: anchor.date,
        generatedAt: now.toISOString(),
        source: "Fuel Finder / FuelCosts history · Databento · ECB",
        mode: "live",
        fuelType: "petrol",
        currency: "GBP",
        unit: "pence/litre",
        currentPricePence: anchor.pricePence,
        wholesalePence: round(features.x_b7h_level!),
        wholesaleChangePercent: null,
        usdPerGbp: null,
        direction,
        signal: direction,
        consecutiveFallingDays: 0,
        history: history
          .slice(-14)
          .map((p) => ({ ...p, wholesalePence: null })),
        points: [
          {
            date: anchor.date,
            pricePence: anchor.pricePence,
            lowPence: anchor.pricePence,
            highPence: anchor.pricePence,
            signals: [],
          },
          ...points,
        ],
        explanation:
          "The fitted daily model combines recent pump movements with GBP petrol and crude futures. Reassess buying decisions each day.",
        methodology:
          "Fourteen independent daily regressions, trained on genuine daily snapshots. This observed-station average includes last known prices regardless of current closure status, matching the training proxy. Buying advice uses only the first seven forecast days. Signal contributions are fitted model terms, not fixed percentage weights or causal effects.",
        warnings: [
          ...warnings,
          "Days 8–14 are a longer-term outlook only. The 14-day interval covered 56% of held-out outcomes; it must not be read as a 90% confidence range.",
        ],
      });
    }
    await this.store.db
      .insert(forecastRun)
      .values({
        frequency,
        origin,
        modelVersion: version,
        inputs: features,
        result,
      })
      .onConflictDoNothing();
    const stored = await this.store.db.query.forecastRun.findFirst({
      where: { frequency, origin: { eq: origin }, modelVersion: version },
    });
    return stored!.result;
  }
  async daily() {
    return ForecastSchema.parse(await this.generate("daily"));
  }
  async weekly() {
    return WeeklyOutlookSchema.parse(await this.generate("weekly"));
  }
}
