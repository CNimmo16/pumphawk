import type { Forecast } from "@pump-hawk/contracts";
import type { Settlement } from "../data/databento.service";
import { AppError } from "../app/errors";
import { DAY, addDays, isoDay, round } from "./forecast";
export type PumpObservation = {
  date: string;
  pricePence: number;
  source?: "fuel-finder" | "sample";
};
export type FxObservation = { date: string; usdPerGbp: number };
const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));
// PRICES.md: GBP refined petrol leads, crude is corroborating, pump momentum dominates near term.
// These are deliberately explicit, uncalibrated policy coefficients, not a fitted statistical model.
export function marketSignal(
  product: "B7H" | "BZ",
  settlements: Settlement[],
  rates: FxObservation[],
  now: Date,
) {
  const rows = settlements
    .filter(
      (s) =>
        s.product === product && s.date <= isoDay(now) && +s.expiresAt > +now,
    )
    .sort(
      (a, b) => +a.expiresAt - +b.expiresAt || a.date.localeCompare(b.date),
    );
  const symbol = rows[0]?.symbol;
  const contract = rows
    .filter((r) => r.symbol === symbol)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = contract.at(-1);
  if (!latest || +now - Date.parse(latest.date) > 5 * DAY) return null;
  const baseline = contract
    .filter((s) => s.date <= addDays(latest.date, -7))
    .at(-1);
  const fx = (date: string) =>
    rates
      .filter(
        (r) =>
          r.date <= date && Date.parse(date) - Date.parse(r.date) <= 5 * DAY,
      )
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1)?.usdPerGbp;
  const latestFx = fx(latest.date),
    oldFx = baseline && fx(baseline.date);
  if (!baseline || !latestFx || !oldFx) return null;
  const unit = product === "B7H" ? (0.745 / 1000) * 100 : 100 / 158.987294928;
  const current = (latest.priceUsd / latestFx) * unit,
    old = (baseline.priceUsd / oldFx) * unit;
  return {
    delta: current - old,
    percent: (current / old - 1) * 100,
    current,
    usdPerGbp: latestFx,
    date: latest.date,
    symbol: symbol!,
  };
}
export function liveForecast(
  pumps: PumpObservation[],
  settlements: Settlement[],
  rates: FxObservation[],
  now: Date,
  mode: Forecast["mode"] = "live",
): Forecast {
  const today = isoDay(now),
    history = [...pumps]
      .filter((p) => p.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14),
    latest = history.at(-1);
  if (!latest)
    throw new AppError(
      "MARKET_NOT_READY",
      "The first Fuel Finder price collection has not completed yet.",
      503,
    );
  if (Date.parse(today) - Date.parse(latest.date) > 2 * DAY)
    throw new AppError(
      "MARKET_STALE",
      "National petrol prices are over two days old. Fresh data is needed for a forecast.",
      503,
    );
  const b7h = marketSignal("B7H", settlements, rates, now),
    crude = marketSignal("BZ", settlements, rates, now);
  const recent = history.filter((p) => p.date >= addDays(latest.date, -5));
  const slopes = recent
    .slice(1)
    .map(
      (p, i) =>
        (p.pricePence - recent[i]!.pricePence) /
        ((Date.parse(p.date) - Date.parse(recent[i]!.date)) / DAY),
    );
  const momentum = slopes.length
    ? clamp(slopes.reduce((a, b) => a + b, 0) / slopes.length, -3, 3)
    : 0;
  const oldPump = history
    .filter((p) => p.date <= addDays(latest.date, -7))
    .at(-1);
  const realised = oldPump ? latest.pricePence - oldPump.pricePence : 0;
  const warnings = [
    ...(mode === "sample"
      ? [
          "Local development sample pump history is included. Forecasts and fill-up advice use synthetic historical prices; they are not real-world buying guidance.",
        ]
      : []),
    "The shaded range is a heuristic uncertainty band, not a calibrated probability interval.",
  ];
  if (history.length < 6)
    warnings.push(
      `Only ${history.length} day${history.length === 1 ? "" : "s"} of actual pump history collected. Momentum has reduced weight until five daily changes are available.`,
    );
  if (history.length < 14)
    warnings.push(
      "Fuel Finder supplies current prices; the chart will build up genuine history as daily observations are collected.",
    );
  if (!b7h)
    warnings.push(
      "B7H signal unavailable or stale; its contribution is disabled.",
    );
  if (!crude)
    warnings.push(
      "Brent signal unavailable or stale; its contribution is disabled.",
    );
  if (latest.date !== today)
    warnings.push(`The latest actual pump observation is ${latest.date}.`);
  const dispersion = slopes.length
    ? Math.sqrt(
        slopes.reduce((s, n) => s + (n - momentum) ** 2, 0) / slopes.length,
      )
    : 1;
  const base = latest.pricePence;
  const points = Array.from({ length: 15 }, (_, day) => {
    const pumpWeight =
      day === 0
        ? 1
        : 0.9 * Math.exp(-(day - 1) / 6) * Math.min(1, slopes.length / 5);
    const marketWeight = 1 - pumpWeight;
    const bw = b7h ? marketWeight * (crude ? 0.8 : 1) : 0,
      cw = crude ? marketWeight * (b7h ? 0.2 : 1) : 0;
    // Remaining weight holds today's price if a feed is missing. Never invent market inputs.
    const projectedPump = momentum * day;
    const target = (s: NonNullable<typeof b7h>) =>
      clamp(s.delta * 1.2 - realised, -20, 20);
    const passThrough = (delta: number) =>
      delta >= 0 ? 1 - Math.exp(-day / 2) : clamp((day - 2) / 12, 0, 1);
    const bDelta = b7h ? target(b7h) : 0,
      cDelta = crude ? target(crude) : 0;
    const signals = [
      {
        name: "pump" as const,
        label: "Recent pump prices",
        weight: round(pumpWeight, 4),
        contributionPence: round(projectedPump * pumpWeight, 4),
        available: slopes.length > 0,
        detail: `${mode === "sample" ? "Includes seeded local pump history. " : ""}${round(momentum, 2)}p/L per day across ${slopes.length} recent daily changes. Its weight fades further out.`,
      },
      {
        name: "b7h" as const,
        label: "B7H petrol futures",
        weight: round(bw, 4),
        contributionPence: round(bDelta * passThrough(bDelta) * bw, 4),
        available: !!b7h,
        detail: b7h
          ? `${round(b7h.percent, 2)}% in GBP over the comparison week; same contract (${b7h.symbol}), settlement ${b7h.date}. Adjusted for pump changes already observed.`
          : "Awaiting fresh comparable settlements and GBP/USD rates.",
      },
      {
        name: "crude" as const,
        label: "Brent crude",
        weight: round(cw, 4),
        contributionPence: round(cDelta * passThrough(cDelta) * cw, 4),
        available: !!crude,
        detail: crude
          ? `${round(crude.percent, 2)}% in GBP over the comparison week; same contract (${crude.symbol}), settlement ${crude.date}. Corroborating signal at a lower weight.`
          : "Awaiting fresh comparable settlements and GBP/USD rates.",
      },
    ];
    const price = clamp(
      base + signals.reduce((sum, s) => sum + s.contributionPence, 0),
      30,
      600,
    );
    const confidence =
      history.length >= 6 && b7h && crude && day <= 5
        ? ("medium" as const)
        : ("low" as const);
    const width =
      day === 0
        ? 0
        : 0.6 +
          Math.sqrt(day) * (0.8 + dispersion * 0.5) +
          (!b7h ? 1 : 0) +
          (!crude ? 0.5 : 0) +
          (history.length < 6 ? 1.5 : 0);
    return {
      date: addDays(today, day),
      pricePence: round(price),
      lowPence: round(Math.max(30, price - width)),
      highPence: round(Math.min(600, price + width)),
      confidence,
      signals,
    };
  });
  const delta = points.at(-1)!.pricePence - base;
  const direction =
    delta < -0.4 ? "falling" : delta > 0.4 ? "rising" : "steady";
  let consecutive = 0;
  for (
    let i = history.length - 1;
    i > 0 && history[i]!.pricePence < history[i - 1]!.pricePence;
    i--
  )
    consecutive++;
  return {
    asOf: latest.date,
    generatedAt: now.toISOString(),
    source:
      mode === "live"
        ? "Fuel Finder · Databento CME · ECB via Frankfurter"
        : mode === "sample"
          ? "Local sample pump history · Fuel Finder · Databento CME · ECB via Frankfurter"
          : "Pump Hawk demo",
    mode,
    fuelType: "petrol",
    currency: "GBP",
    unit: "pence/litre",
    currentPricePence: round(base),
    wholesalePence: b7h ? round(b7h.current) : null,
    wholesaleChangePercent: b7h ? round(b7h.percent) : null,
    usdPerGbp: b7h?.usdPerGbp ?? null,
    direction,
    signal: direction,
    consecutiveFallingDays: consecutive,
    history: history.map((h) => ({
      date: h.date,
      pricePence: h.pricePence,
      ...(h.source ? { source: h.source } : {}),
      wholesalePence: null,
    })),
    points,
    explanation:
      direction === "falling"
        ? "Market signals suggest lower prices ahead. Buy only enough to cover your journeys and reserve until then."
        : direction === "rising"
          ? "The combined pump-price and market signals suggest an increase. Filling before the rise may help."
          : "The combined signals show no clear price advantage to waiting.",
    methodology:
      "14-day scenario: recent pump momentum fades with horizon; B7H has 80% of available market weight and Brent 20%. Compare the same futures contract in GBP, allow faster rises and slower cuts, and subtract observed pump changes. UK average is an unweighted mean of reporting open E10 forecourts, not a sales-weighted official average. Coefficients and ranges are not yet backtested.",
    warnings,
  };
}
