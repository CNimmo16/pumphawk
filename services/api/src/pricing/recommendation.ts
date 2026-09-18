import type {
  Driver,
  Forecast,
  Recommendation,
  WeeklyOutlook,
} from "@pump-hawk/contracts";
import { DAY, addDays, isoDay, round } from "./forecast";
const displayDay = (day: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  }).format(new Date(day + "T12:00:00Z"));
// /PRICES.md: reserve and reachable fuel take precedence over price timing.
export function litresOnDay(driver: Driver, day: string) {
  const weekday = (new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7;
  const miles =
    driver.mileageMode === "weekly"
      ? (driver.weekdayMiles?.[weekday] ?? driver.dailyMiles)
      : driver.dailyMiles;
  return (miles / driver.mpg) * 4.54609;
}
export function plannedLitres(driver: Driver, today: string, days: number) {
  let litres = 0;
  for (let i = 0; i < days; i++)
    litres += litresOnDay(driver, addDays(today, i));
  return litres;
}
export function daysOfDriving(driver: Driver, today: string, current: number) {
  if (current <= 0) return 0;
  const weekly = plannedLitres(driver, today, 7);
  if (!weekly) return null;
  const weeks = Math.max(0, Math.floor(current / weekly) - 1);
  let remaining = current - weeks * weekly,
    days = weeks * 7;
  for (let i = 0; i < 15; i++, days++) {
    const needed = litresOnDay(driver, addDays(today, days));
    if (needed && remaining <= needed)
      return round(days + remaining / needed, 1);
    remaining -= needed;
  }
  return null;
}
export function fuelState(driver: Driver, now: Date) {
  const dailyLitres = (driver.dailyMiles / driver.mpg) * 4.54609;
  const ageDays = Math.max(0, (+now - Date.parse(driver.fuelUpdatedAt)) / DAY);
  let consumed = 0;
  // Spread each day's estimate across that UK calendar day; hourly integration handles DST and weekday boundaries.
  for (
    let t = Math.max(Date.parse(driver.fuelUpdatedAt), +now - 90 * DAY);
    t < +now;
    t += 3600000
  ) {
    const duration = Math.min(3600000, +now - t);
    consumed +=
      (litresOnDay(driver, isoDay(new Date(t + duration / 2))) * duration) /
      DAY;
  }
  const current = Math.max(0, driver.currentLitres - consumed);
  const reserve = Math.min(
    driver.tankCapacityLitres,
    Math.max(5, driver.tankCapacityLitres * 0.1),
  );
  return { dailyLitres, ageDays, current, reserve };
}
export function recommend(
  driver: Driver,
  forecast: Forecast,
  now: Date,
  weekly?: WeeklyOutlook,
): Recommendation {
  const { dailyLitres, ageDays, current, reserve } = fuelState(driver, now);
  const space = Math.max(0, driver.tankCapacityLitres - current),
    today = isoDay(now);
  const base = {
    fillDate: today,
    nextFillDate: today,
    estimatedCurrentLitres: round(current, 1),
    reserveLitres: round(reserve, 1),
    daysOfFuel: dailyLitres ? daysOfDriving(driver, today, current) : null,
    targetPricePence: forecast.currentPricePence,
    tips: [
      "Compare nearby supermarket forecourts when prices are falling.",
      "Avoid motorway services where safely practical; the supplied research estimates a 20–30p/litre premium.",
      "Tuesday or Wednesday morning can break a close tie. Never run below your reserve to wait.",
    ],
  };
  const make = (
    action: Recommendation["action"],
    title: string,
    reason: string,
    litres: number,
    extra: Partial<Recommendation> = {},
  ): Recommendation => ({
    ...base,
    action,
    title,
    reason,
    litresToBuy: Math.min(
      Math.floor((space + 1e-9) * 10) / 10,
      Math.ceil(Math.max(0, litres) * 10) / 10,
    ),
    estimatedCostGbp: 0,
    estimatedSavingsGbp: 0,
    ...extra,
  });
  // The trained curve is evaluated over reachable dates, not its day-14 headline.
  // £1 and 0.5p/L are explicit product thresholds, not statistical guarantees.
  const modelCandidates =
    forecast.model === "daily-ridge"
      ? forecast.points
          .filter((p) => {
            const days = (Date.parse(p.date) - Date.parse(today)) / DAY;
            return (
              days >= 1 &&
              p.date <= addDays(forecast.asOf, 7) &&
              plannedLitres(driver, today, days) <=
                driver.tankCapacityLitres - reserve
            );
          })
          .map((p) => {
            const days = (Date.parse(p.date) - Date.parse(today)) / DAY;
            const needed = Math.max(
              0,
              plannedLitres(driver, today, days) + reserve - current,
            );
            const saving =
              ((forecast.currentPricePence - p.pricePence) *
                Math.max(0, space - needed)) /
              100;
            return { ...p, days, needed, saving };
          })
      : [];
  const worthwhile = modelCandidates.filter(
    (p) => p.saving >= 1 && forecast.currentPricePence - p.pricePence >= 0.5,
  );
  const best = worthwhile.sort(
    (a, b) => b.saving - a.saving || a.days - b.days,
  )[0];
  const nextNeeded = modelCandidates.find(
    (p) => current - plannedLitres(driver, today, p.days) < reserve,
  );
  const risingBeforeNeeded =
    nextNeeded &&
    nextNeeded.pricePence - forecast.currentPricePence >= 0.5 &&
    ((nextNeeded.pricePence - forecast.currentPricePence) * space) / 100 >= 1;
  // PRICES.md: the weekly benchmark can justify buying ahead of a later rise,
  // even with ample fuel. Compare its own observations, never daily/weekly levels.
  const weeklyAnchor = weekly?.history.find(
    (p) => p.date === weekly.referenceDate,
  );
  const weeklyPoints = [...(weekly?.points ?? [])].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const weeklyRise =
    forecast.mode === "live" &&
    weekly &&
    weeklyAnchor &&
    +now >= Date.parse(weekly.issuedAt) &&
    +now - Date.parse(weekly.issuedAt) <= 8 * DAY
      ? weeklyPoints.flatMap((point, index) => {
          const previous = weeklyPoints[index - 1] ?? weeklyAnchor;
          // Don't count a rebound from a predicted dip as a rise above the latest
          // observed benchmark, or count the earlier predicted rise twice.
          const baseline =
            previous.pricePence > weeklyAnchor.pricePence
              ? previous
              : weeklyAnchor;
          const change = point.pricePence - baseline.pricePence;
          const saving =
            (change * (Math.floor((space + 1e-9) * 10) / 10)) / 100;
          return point.date > today &&
            point.date > addDays(forecast.asOf, 7) &&
            change >= 0.5 &&
            saving >= 1
            ? [{ date: point.date, from: baseline.date, change, saving }]
            : [];
        })[0]
      : undefined;
  let result: Recommendation;
  if (ageDays > 7)
    result = make(
      "update-tank",
      "Update your tank level",
      "Your fuel reading is over 7 days old. Confirm it before relying on a fill-up plan.",
      0,
    );
  else if (space < 0.1)
    result = make(
      "hold",
      "You’re already topped up",
      "Your tank is full. There is no fuel to buy right now.",
      0,
    );
  else if (litresOnDay(driver, today) > driver.tankCapacityLitres - reserve)
    result = make(
      "fill-now",
      "Plan more than one fuel stop",
      "Your stated daily driving uses more than one tank’s usable fuel. Fill available space and plan another stop before reaching reserve.",
      space,
    );
  else if (forecast.model === "daily-ridge" && best)
    result = make(
      best.needed > 0 ? "top-up" : "wait",
      best.needed > 0
        ? "A little now. Reassess before filling."
        : "A cheaper stop may be ahead.",
      `The next seven days suggest waiting until ${displayDay(best.date)} may save about £${best.saving.toFixed(2)}. Keep your reserve and reassess tomorrow.`,
      best.needed,
      {
        fillDate: best.needed > 0 ? today : best.date,
        nextFillDate: best.date,
        targetPricePence: best.pricePence,
        estimatedSavingsGbp: round(best.saving),
        priceSignal: "daily",
      },
    );
  else if (forecast.model === "daily-ridge" && risingBeforeNeeded)
    result = make(
      "fill-now",
      "Get ahead of your next needed fill",
      "The model expects a meaningful rise before you need fuel within the next seven days. Filling now may help; reassess daily.",
      space,
      {
        priceSignal: "daily",
        estimatedSavingsGbp: round(
          ((nextNeeded!.pricePence - forecast.currentPricePence) *
            (Math.floor((space + 1e-9) * 10) / 10)) /
            100,
        ),
      },
    );
  else if (weeklyRise)
    result = make(
      "fill-now",
      "Fill before the weekly rise",
      `The weekly UK outlook predicts a ${weeklyRise.change.toFixed(2)}p/L rise from ${displayDay(weeklyRise.from)} to ${displayDay(weeklyRise.date)}. Fill the available space now, even with fuel in reserve. This is a national signal; your station's price may differ.`,
      space,
      { priceSignal: "weekly", estimatedSavingsGbp: round(weeklyRise.saving) },
    );
  else if (
    forecast.model !== "daily-ridge" &&
    ["rising", "disruption", "fx-shock"].includes(forecast.signal)
  )
    result = make(
      "fill-now",
      "Get ahead of the rise",
      forecast.explanation,
      space,
    );
  else if (
    forecast.model !== "daily-ridge" &&
    forecast.signal === "falling" &&
    forecast.direction === "falling"
  ) {
    const candidates = forecast.points
      .slice(1, (forecast.adviceHorizonDays ?? 14) + 1)
      .filter(
        (_, i) =>
          plannedLitres(driver, today, i + 1) <=
          driver.tankCapacityLitres - reserve,
      );
    if (!candidates.length)
      candidates.push(forecast.points[1] ?? forecast.points[0]!);
    const cheapest = candidates.reduce((a, b) =>
      b.pricePence < a.pricePence ? b : a,
    );
    const close = candidates.filter(
      (p) => p.pricePence <= cheapest.pricePence + 0.3,
    );
    const midweek = close.find((p) =>
      [2, 3].includes(new Date(p.date + "T12:00:00Z").getUTCDay()),
    );
    const target = midweek ?? cheapest;
    const days = (Date.parse(target.date) - Date.parse(today)) / DAY;
    const needed = Math.min(
      space,
      Math.max(0, plannedLitres(driver, today, days) + reserve - current),
    );
    const saving = round(
      Math.max(
        0,
        ((forecast.currentPricePence - target.pricePence) * (space - needed)) /
          100,
      ),
    );
    result = make(
      needed > 0 ? "top-up" : "wait",
      needed > 0
        ? "A little now. More for less later."
        : "Good things come to those who wait.",
      needed > 0
        ? `Buy enough to reach ${displayDay(target.date)} with your reserve intact, then reassess the price.`
        : `Your estimated fuel can cover the wait to ${displayDay(target.date)}, including your reserve.`,
      needed,
      {
        fillDate: needed > 0 ? today : target.date,
        nextFillDate: target.date,
        targetPricePence: target.pricePence,
        estimatedSavingsGbp: saving,
      },
    );
  } else if (current < reserve + plannedLitres(driver, today, 2))
    result = make(
      "top-up",
      "Time for a practical top-up",
      "Keep your reserve and top up for your next journeys. Reassess prices before a larger fill.",
      Math.max(0, reserve + plannedLitres(driver, today, 3) - current),
    );
  else
    result = make(
      "hold",
      "You’re in a good place",
      "You have fuel in reserve. The available forecasts do not currently justify an earlier fill-up. Reassess tomorrow.",
      0,
    );
  result.estimatedCostGbp = round(
    (result.litresToBuy * forecast.currentPricePence) / 100,
  );
  return result;
}
