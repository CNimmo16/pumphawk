import type { Station } from "@pump-hawk/openapi/types";

export function stationPriceMedian(
  stations: readonly Station[],
): number | null {
  const prices = stations
    .map((station) => station.pricePence)
    .filter((price): price is number => price != null && Number.isFinite(price))
    .sort((a, b) => a - b);
  if (!prices.length) return null;
  const middle = Math.floor(prices.length / 2);
  return prices.length % 2
    ? prices[middle]!
    : (prices[middle - 1]! + prices[middle]!) / 2;
}

export function stationPriceComparison(
  price: number | null | undefined,
  median: number | null,
) {
  if (price == null || !Number.isFinite(price) || median == null)
    return { band: "unknown", description: "Price comparison unavailable" };
  const difference = Math.round((price - median) * 100) / 100;
  return {
    band: difference < -1 ? "low" : difference > 1 ? "high" : "typical",
    description:
      difference === 0
        ? "At the nearby median"
        : `${Math.abs(difference).toFixed(1)}p ${difference < 0 ? "below" : "above"} the nearby median`,
  };
}
