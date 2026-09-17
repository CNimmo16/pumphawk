import type { Forecast, Observation } from "@pump-hawk/contracts";
import { AppError } from "../app/errors";
// Business rules and modelling assumptions are recorded in /PRICES.md.
export const POLICY = {
  upwardDays: 2,
  downwardStartDays: 3,
  downwardEndDays: 14,
  passThrough: 1.2,
  dailyRise: 0.01,
  threeDayRise: 0.02,
  fxDrop: 0.02,
  maxMarketAgeDays: 2,
  minHistory: 15,
} as const;
export const DAY = 86_400_000;
export const round = (n: number, dp = 2) => Number(n.toFixed(dp));
export const isoDay = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
export const addDays = (d: string, n: number) =>
  isoDay(new Date(Date.parse(d + "T00:00:00Z") + n * DAY));
export function forecastPrices(
  observations: Observation[],
  now: Date,
  mode: "demo" | "live",
  source: string,
): Forecast {
  const sorted = [...observations].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < POLICY.minHistory)
    throw new AppError(
      "MARKET_UNAVAILABLE",
      "At least 15 daily observations are needed. Import market data first.",
      503,
    );
  const rows = sorted.slice(-30),
    latest = rows.at(-1)!,
    previous = rows.at(-2)!,
    today = isoDay(now);
  const age = (Date.parse(today) - Date.parse(latest.date)) / DAY;
  if (age > POLICY.maxMarketAgeDays || age < 0)
    throw new AppError(
      "MARKET_STALE",
      "Market data is stale or dated in the future. Refresh observations before planning a fill-up.",
      503,
    );
  if (rows.some((r, i) => i > 0 && r.date !== addDays(rows[i - 1]!.date, 1)))
    throw new AppError(
      "MARKET_GAPS",
      "Market observations must be one contiguous daily series.",
      503,
    );
  let falling = 0;
  for (
    let i = rows.length - 1;
    i > 0 && rows[i]!.wholesalePence < rows[i - 1]!.wholesalePence;
    i--
  )
    falling++;
  let rising = 0;
  for (
    let i = rows.length - 1;
    i > 0 && rows[i]!.wholesalePence > rows[i - 1]!.wholesalePence;
    i--
  )
    rising++;
  const dailyRise = latest.wholesalePence / previous.wholesalePence - 1;
  const threeDayRise = latest.wholesalePence / rows.at(-4)!.wholesalePence - 1;
  const fxDrop = 1 - latest.usdPerGbp / previous.usdPerGbp;
  const signal = latest.disruption
    ? "disruption"
    : rising >= 3 ||
        dailyRise >= POLICY.dailyRise ||
        threeDayRise >= POLICY.threeDayRise
      ? "rising"
      : fxDrop >= POLICY.fxDrop
        ? "fx-shock"
        : falling >= 3
          ? "falling"
          : "steady";
  const delta =
    (latest.wholesalePence - rows.at(-15)!.wholesalePence) * POLICY.passThrough;
  // A recent reversal overrides an older decline: rises hit the pumps first.
  const pending =
    signal === "rising"
      ? Math.max(
          delta,
          (latest.wholesalePence - rows.at(-4)!.wholesalePence) *
            POLICY.passThrough,
          0,
        )
      : delta;
  const points = Array.from({ length: 31 }, (_, day) => {
    const elapsed = day + age;
    const progress =
      pending >= 0
        ? Math.min(elapsed / POLICY.upwardDays, 1)
        : Math.max(
            0,
            Math.min(
              (elapsed - POLICY.downwardStartDays) /
                (POLICY.downwardEndDays - POLICY.downwardStartDays),
              1,
            ),
          );
    const price = round(Math.max(30, latest.retailPence + pending * progress));
    const band = round(0.5 + Math.sqrt(elapsed) * 0.65);
    return {
      date: addDays(today, day),
      pricePence: price,
      lowPence: round(Math.max(0, price - band)),
      highPence: round(price + band),
    };
  });
  return {
    asOf: latest.date,
    generatedAt: now.toISOString(),
    source,
    mode,
    fuelType: "petrol",
    currency: "GBP",
    unit: "pence/litre",
    currentPricePence: latest.retailPence,
    wholesalePence: latest.wholesalePence,
    wholesaleChangePercent: round(
      (latest.wholesalePence / rows.at(-8)!.wholesalePence - 1) * 100,
    ),
    usdPerGbp: latest.usdPerGbp,
    direction: pending < -0.5 ? "falling" : pending > 0.5 ? "rising" : "steady",
    signal,
    consecutiveFallingDays: falling,
    history: rows.map((r) => ({
      date: r.date,
      pricePence: r.retailPence,
      wholesalePence: r.wholesalePence,
    })),
    points,
    explanation:
      signal === "falling"
        ? `Wholesale petrol in GBP has fallen for ${falling} consecutive days. Pump prices may follow over 7–14 days.`
        : signal === "rising"
          ? "Wholesale petrol is rising. Retail prices can respond within 24–48 hours."
          : signal === "fx-shock"
            ? "Sterling has weakened sharply. Import costs may rise; GBP wholesale already includes currency effects."
            : signal === "disruption"
              ? "A supply disruption is flagged. The size of any future price shock is unknown."
              : "There is no strong short-term buying signal.",
    methodology:
      "PRICES.md · heuristic v1 · latest wholesale held constant · illustrative range, not statistical confidence",
    warnings: [
      ...(mode === "demo"
        ? ["Synthetic demonstration data. These are not live UK petrol prices."]
        : []),
      ...(age ? ["Latest observation is " + age + " day(s) old."] : []),
      "Forecasts are scenarios, not guarantees. Individual forecourt prices vary.",
      "Weekday discounts and motorway premiums are guidance only, not forecast inputs.",
    ],
  };
}
export function demoObservations(now: Date): Observation[] {
  return Array.from({ length: 30 }, (_, i) => ({
    date: addDays(isoDay(now), i - 29),
    wholesalePence: round(56.2 - i * 0.24 - (i > 20 ? (i - 20) * 0.12 : 0)),
    retailPence: round(151.8 - i * 0.135),
    usdPerGbp: round(1.31 + Math.sin(i / 5) * 0.003, 4),
    disruption: false,
  }));
}
