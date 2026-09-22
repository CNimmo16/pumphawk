import type { Forecast, WeeklyOutlook } from "@pump-hawk/openapi/types";

const DAY = 86_400_000;
export const addDays = (date: string, days: number) =>
  new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
export const outlookDateLabel = (date: string) =>
  new Date(date).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

type PricePoint = Forecast["points"][number];
export type OutlookPoint = PricePoint & {
  kind: "daily" | "weekly";
  detailLabel: string;
  referencePrice?: number;
  referenceLabel: string;
};
export type OutlookDisagreement = {
  date: string;
  referenceDate: string;
  dailyChange: number;
  weeklyChange: number;
  message: string;
};

const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}p/L`;

/** Compare changes from the same observed date, never the two benchmark levels.
 * Only use the daily model's validated seven-day window. Non-overlapping
 * empirical change ranges are a caution heuristic, not a significance test.
 */
function compareOutlooks(
  daily: Forecast,
  weekly: WeeklyOutlook,
  dailyPoints: OutlookPoint[],
): OutlookDisagreement | undefined {
  const dailyAnchor = daily.history.find(
    (p) => p.date === weekly.referenceDate,
  );
  const weeklyAnchor = weekly.history.find(
    (p) => p.date === weekly.referenceDate,
  );
  if (!dailyAnchor || !weeklyAnchor || dailyAnchor.source === "sample") return;
  const comparisons = dailyPoints.flatMap((d) => {
    const w = weekly.points.find((p) => p.date === d.date);
    if (!w) return [];
    const gap = Math.max(
      d.lowPence -
        dailyAnchor.pricePence -
        (w.highPence - weeklyAnchor.pricePence),
      w.lowPence -
        weeklyAnchor.pricePence -
        (d.highPence - dailyAnchor.pricePence),
    );
    return gap > 0
      ? [
          {
            gap,
            date: d.date,
            dailyChange: d.pricePence - dailyAnchor.pricePence,
            weeklyChange: w.pricePence - weeklyAnchor.pricePence,
          },
        ]
      : [];
  });
  const difference = comparisons.sort((a, b) => b.gap - a.gap)[0];
  if (!difference) return;
  return {
    ...difference,
    referenceDate: weekly.referenceDate,
    message: `Outlooks differ for ${outlookDateLabel(difference.date)}: daily ${signed(difference.dailyChange)}, weekly ${signed(difference.weeklyChange)} since ${outlookDateLabel(weekly.referenceDate)}. Their change ranges do not overlap. Different station weighting and update dates can contribute; treat the outlook with extra caution.`,
  };
}

/** A presentation of two existing forecasts, not a blended or rebased model. */
export function buildNationalOutlook({
  forecast,
  weekly,
  weeklyStatus = "unavailable",
  now = new Date().toISOString(),
}: {
  forecast?: Forecast;
  weekly?: WeeklyOutlook;
  weeklyStatus?: "loading" | "unavailable";
  now?: string;
}) {
  const today = now.slice(0, 10);
  const asOf = forecast?.asOf ?? today;
  const cutoff = addDays(asOf, 7);
  const from = addDays(asOf, -13);
  const sample = !!forecast && forecast.mode !== "live";
  const weeklyAge = weekly
    ? Date.parse(now) - Date.parse(weekly.issuedAt)
    : NaN;
  const usableWeekly =
    weekly && !sample && weeklyAge >= 0 && weeklyAge <= 8 * DAY
      ? weekly
      : undefined;
  const weeklyAnchor = usableWeekly?.history.find(
    (p) => p.date === usableWeekly.referenceDate,
  );
  const dailyPoints: OutlookPoint[] = (forecast?.points ?? [])
    .filter((p) => p.date > asOf && p.date <= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({
      ...p,
      kind: "daily",
      detailLabel: `${sample ? "Sample" : forecast?.model === "daily-ridge" ? "Daily model" : "Daily fallback"} · station average · snapshot ${outlookDateLabel(asOf)}`,
      referencePrice: forecast?.currentPricePence,
      referenceLabel: "daily snapshot",
    }));
  const weeklyPoints: OutlookPoint[] = (usableWeekly?.points ?? [])
    .filter((p) => p.date > (forecast ? cutoff : today))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({
      ...p,
      kind: "weekly",
      detailLabel: `Weekly model · sales-weighted average · issued ${outlookDateLabel(usableWeekly!.issuedAt)}`,
      referencePrice: weeklyAnchor?.pricePence,
      referenceLabel: `official observation on ${outlookDateLabel(usableWeekly!.referenceDate)}`,
    }));
  const history = forecast
    ? forecast.history.filter((p) => p.date >= from && p.date <= asOf)
    : (usableWeekly?.history ?? []).filter(
        (p) => p.date >= from && p.date <= today,
      );
  const observedAnchor = forecast
    ? [
        {
          date: asOf,
          pricePence: forecast.currentPricePence,
          lowPence: forecast.currentPricePence,
          highPence: forecast.currentPricePence,
        },
      ]
    : [];
  const points = [...dailyPoints, ...weeklyPoints];
  const dailySnapshot = forecast?.snapshotAt ?? forecast?.generatedAt;
  const dailyAge = dailySnapshot
    ? Date.parse(now) - Date.parse(dailySnapshot)
    : NaN;
  const disagreement =
    forecast?.model === "daily-ridge" &&
    !sample &&
    usableWeekly &&
    dailyAge >= 0 &&
    dailyAge <= 2 * DAY
      ? compareOutlooks(forecast, usableWeekly, dailyPoints)
      : undefined;
  let weeklyNote: string;
  if (sample)
    weeklyNote =
      "Sample daily prices are shown on their own. The live weekly benchmark is not mixed with sample data.";
  else if (weekly && !usableWeekly)
    weeklyNote =
      "The weekly release is out of date. Later predictions will return when a fresh release is available.";
  else if (!usableWeekly)
    weeklyNote =
      weeklyStatus === "loading"
        ? "Loading the weekly outlook…"
        : "The weekly outlook is temporarily unavailable. Later predictions will return when it is available.";
  else if (!weeklyPoints.length)
    weeklyNote = forecast
      ? `The latest weekly release has no prediction beyond ${outlookDateLabel(cutoff)}. Later dates will appear with a new release.`
      : "The latest weekly release has no upcoming prediction dates.";
  else
    weeklyNote = `Weekly model issued ${outlookDateLabel(usableWeekly.issuedAt)}. Dots show predictions only for those dates; bars show their ranges.`;
  const benchmarkNote = sample
    ? "Daily prices and ranges use synthetic sample history."
    : forecast
      ? "Daily prices use a station average; weekly prices use the official sales-weighted average. A difference at the handover can reflect the benchmark change."
      : "Daily prices are unavailable. Showing the official sales-weighted weekly benchmark.";
  return {
    asOf,
    cutoff,
    from,
    history,
    dailyLine: [...observedAnchor, ...dailyPoints],
    dailyPoints,
    weeklyPoints,
    points,
    disagreement,
    weeklyNote,
    benchmarkNote,
    hasHandover: !!dailyPoints.length && !!weeklyPoints.length,
    historyLabel: sample
      ? "Sample history"
      : forecast
        ? "Actual station average"
        : "Official observations",
  };
}
