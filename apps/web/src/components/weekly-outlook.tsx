import type { WeeklyOutlook } from "@pump-hawk/openapi/types";
import { dateLabel } from "../lib/api";

export function WeeklyOutlookChart({ outlook }: { outlook: WeeklyOutlook }) {
  const history = outlook.history.slice(-12),
    anchor = history.at(-1)!;
  const all = [...history, ...outlook.points];
  const first = Date.parse(history[0]!.date),
    last = Date.parse(all.at(-1)!.date);
  const low = Math.floor(
    Math.min(
      ...history.map((p) => p.pricePence),
      ...outlook.points.map((p) => p.lowPence),
    ) - 1,
  );
  const high = Math.ceil(
    Math.max(
      ...history.map((p) => p.pricePence),
      ...outlook.points.map((p) => p.highPence),
    ) + 1,
  );
  const x = (date: string) =>
    48 + ((Date.parse(date) - first) / Math.max(1, last - first)) * 780;
  const y = (price: number) =>
    24 + ((high - price) / Math.max(1, high - low)) * 190;
  const path = (points: { date: string; pricePence: number }[]) =>
    points
      .map((p, i) => `${i ? "L" : "M"}${x(p.date)},${y(p.pricePence)}`)
      .join(" ");
  return (
    <>
      <div className="chart-readout">
        <span>Sales-weighted petrol · pence per litre</span>
        <span>Issued {dateLabel(outlook.issuedAt.slice(0, 10))}</span>
      </div>
      <svg
        className="price-chart"
        viewBox="0 0 850 260"
        role="img"
        aria-label="Official weekly UK petrol history and next two weekly predictions"
      >
        {[0, 1, 2, 3, 4].map((i) => {
          const value = low + ((high - low) * i) / 4;
          return (
            <g key={i}>
              <line
                x1={48}
                x2={828}
                y1={y(value)}
                y2={y(value)}
                stroke="#e5e9e2"
                strokeDasharray="3 5"
              />
              <text
                x={38}
                y={y(value) + 4}
                textAnchor="end"
                className="chart-label"
              >
                {value.toFixed(0)}p
              </text>
            </g>
          );
        })}
        <path
          d={path(history)}
          fill="none"
          stroke="#244d3a"
          strokeWidth={2.7}
        />
        <path
          d={path([anchor, ...outlook.points])}
          fill="none"
          stroke="#6b873f"
          strokeWidth={2.7}
          strokeDasharray="5 5"
        />
        {history.map((p) => (
          <circle
            key={p.date}
            cx={x(p.date)}
            cy={y(p.pricePence)}
            r={3}
            fill="#244d3a"
          >
            <title>
              {dateLabel(p.date)}: observed {p.pricePence.toFixed(2)}p/L
            </title>
          </circle>
        ))}
        {outlook.points.map((p) => (
          <g key={p.date}>
            <line
              x1={x(p.date)}
              x2={x(p.date)}
              y1={y(p.lowPence)}
              y2={y(p.highPence)}
              stroke="#6b873f"
              strokeWidth={8}
              opacity={0.2}
            />
            <circle cx={x(p.date)} cy={y(p.pricePence)} r={5} fill="#6b873f">
              <title>
                {dateLabel(p.date)}: forecast {p.pricePence.toFixed(2)}p/L;
                empirical range {p.lowPence.toFixed(2)}–{p.highPence.toFixed(2)}
                p/L
              </title>
            </circle>
          </g>
        ))}
        {[history[0]!, anchor, outlook.points.at(-1)!].map((p) => (
          <text
            key={p.date}
            x={x(p.date)}
            y={244}
            textAnchor="middle"
            className="chart-label"
          >
            {dateLabel(p.date)}
          </text>
        ))}
      </svg>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Official observation</th>
              <th>Predicted price</th>
              <th>Empirical range</th>
            </tr>
          </thead>
          <tbody>
            {outlook.points.map((p) => (
              <tr key={p.date}>
                <td>{dateLabel(p.date)}</td>
                <td>{p.pricePence.toFixed(2)}p/L</td>
                <td>
                  {p.lowPence.toFixed(2)}–{p.highPence.toFixed(2)}p/L
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="chart-note">
        A separate official benchmark, weighted by fuel sales. Forecasts refer
        only to the two dates shown. Ranges use historical forecast errors and
        are not guaranteed probabilities.
      </p>
    </>
  );
}
