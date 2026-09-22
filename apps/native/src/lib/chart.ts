export type ChartPoint = {
  date: string;
  pricePence: number;
  seriesLabel?: string;
  detailLabel?: string;
  lowPence?: number;
  highPence?: number;
  confidence?: "low" | "medium";
};
export type ChartSeries = {
  id: string;
  label: string;
  color: string;
  points: ChartPoint[];
  dashed?: boolean;
  pointsOnly?: boolean;
};
export function chartGeometry(
  series: ChartSeries[],
  width: number,
  height = 220,
) {
  const points = series
    .flatMap((s) => s.points)
    .filter(
      (p) =>
        Number.isFinite(p.pricePence) && Number.isFinite(Date.parse(p.date)),
    );
  if (!points.length) return null;
  const times = points.map((p) => Date.parse(p.date));
  const minTime = Math.min(...times),
    maxTime = Math.max(...times);
  const values = points.flatMap((p) => [
    p.lowPence ?? p.pricePence,
    p.highPence ?? p.pricePence,
  ]);
  const min = Math.floor(Math.min(...values) - 1),
    max = Math.ceil(Math.max(...values) + 1);
  const left = 40,
    right = Math.max(left + 1, width - 12),
    top = 14,
    bottom = height - 30;
  const x = (date: string) =>
    left +
    ((Date.parse(date) - minTime) / Math.max(1, maxTime - minTime)) *
      (right - left);
  const y = (price: number) =>
    bottom - ((price - min) / Math.max(1, max - min)) * (bottom - top);
  return {
    x,
    y,
    min,
    max,
    minTime,
    maxTime,
    left,
    right,
    top,
    bottom,
    points,
    path: (points: ChartPoint[]) =>
      points
        .map((p, i) => `${i ? "L" : "M"}${x(p.date)},${y(p.pricePence)}`)
        .join(" "),
  };
}
export function nearestPoint(
  points: ChartPoint[],
  x: number,
  project: (date: string) => number,
) {
  return points.reduce<ChartPoint | undefined>(
    (best, p) =>
      !best || Math.abs(project(p.date) - x) < Math.abs(project(best.date) - x)
        ? p
        : best,
    undefined,
  );
}
