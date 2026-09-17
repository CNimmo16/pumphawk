import type { Features, Frequency } from "./model";
const DAY = 86400000;
const stamp = (date: string) => Date.parse(date + "T00:00:00Z");
export type ModelPrice = {
  date: string;
  availableAt: Date;
  pricePence: number;
};
export type ModelSettlement = {
  product: "B7H" | "BZ";
  symbol: string;
  date: string;
  publishedAt: Date;
  expiresAt: Date;
  priceUsd: number;
  deleted?: boolean;
};
export type ModelFx = { date: string; availableAt: Date; usdPerGbp: number };

export function buildFeatures(
  frequency: Frequency,
  prices: ModelPrice[],
  events: ModelSettlement[],
  rates: ModelFx[],
  origin: Date,
) {
  const past = prices
    .filter((p) => +p.availableAt <= +origin)
    .sort((a, b) => a.date.localeCompare(b.date));
  const anchor = past.at(-1);
  if (!anchor) throw new Error("No model anchor");
  const features: Features = { anchor_price: anchor.pricePence };
  const previous = (lag: number) =>
    past.filter((p) => stamp(p.date) <= stamp(anchor.date) - lag * DAY).at(-1);
  for (const lag of frequency === "daily"
    ? [1, 3, 7, 14, 28]
    : [7, 14, 28, 56]) {
    const old = previous(lag);
    features[`x_pump_change_${lag}`] = old
      ? anchor.pricePence - old.pricePence
      : null;
  }
  for (const [name, lag] of [
    ["short", frequency === "daily" ? 5 : 7],
    ["long", frequency === "daily" ? 14 : 28],
  ] as const) {
    const old = previous(lag);
    features[`x_pump_slope_${name}`] = old
      ? (anchor.pricePence - old.pricePence) /
        ((stamp(anchor.date) - stamp(old.date)) / DAY)
      : 0;
  }
  const state = new Map<string, ModelSettlement>();
  for (const event of events
    .filter((e) => +e.publishedAt <= +origin)
    .sort((a, b) => +a.publishedAt - +b.publishedAt)) {
    const key = `${event.product}:${event.symbol}:${event.expiresAt.toISOString()}:${event.date}`;
    if (event.deleted) state.delete(key);
    else state.set(key, event);
  }
  const availableRates = rates
    .filter((r) => +r.availableAt <= +origin)
    .sort(
      (a, b) => a.date.localeCompare(b.date) || +a.availableAt - +b.availableAt,
    );
  const rate = (date: string) =>
    availableRates
      .filter((r) => r.date <= date && stamp(date) - stamp(r.date) < 6 * DAY)
      .at(-1)?.usdPerGbp;
  for (const product of ["B7H", "BZ"] as const) {
    const prefix = product.toLowerCase();
    features[`x_${prefix}_level`] = null;
    for (const lag of [1, 3, 7, 14, 28])
      features[`x_${prefix}_change_${lag}`] = null;
    const candidates = [...state.values()]
      .filter(
        (e) =>
          e.product === product &&
          +e.expiresAt > +origin &&
          stamp(e.date) <= +origin &&
          +origin - stamp(e.date) < 6 * DAY,
      )
      .sort(
        (a, b) => +a.expiresAt - +b.expiresAt || b.date.localeCompare(a.date),
      );
    const latest = candidates[0];
    if (!latest) continue;
    const multiplier = product === "B7H" ? 0.0745 : 100 / 158.987294928;
    const latestFx = rate(latest.date);
    if (!latestFx) continue;
    const level = (latest.priceUsd / latestFx) * multiplier;
    features[`x_${prefix}_level`] = level;
    for (const lag of [1, 3, 7, 14, 28]) {
      const boundary = stamp(latest.date) - lag * DAY;
      const old = [...state.values()]
        .filter(
          (e) =>
            e.product === product &&
            e.symbol === latest.symbol &&
            +e.expiresAt === +latest.expiresAt &&
            stamp(e.date) <= boundary &&
            boundary - stamp(e.date) < 6 * DAY,
        )
        .sort((a, b) => a.date.localeCompare(b.date))
        .at(-1);
      const oldFx = old && rate(old.date);
      if (old && oldFx)
        features[`x_${prefix}_change_${lag}`] =
          level - (old.priceUsd / oldFx) * multiplier;
    }
  }
  return { features, anchor };
}
