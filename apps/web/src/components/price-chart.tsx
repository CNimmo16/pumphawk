import { useRef, useState } from "react";
import type {
  Forecast,
  WeeklyOutlook,
  TrackedStations,
} from "@pump-hawk/openapi/types";
import {
  addDays,
  buildNationalOutlook,
} from "@pump-hawk/presentation/national-outlook";
import { dateLabel } from "../lib/api";
import { ForecastTooltip } from "./forecast-tooltip";
const W = 850,
  H = 285,
  left = 48,
  right = 22,
  top = 24,
  bottom = 40;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}p`;
export function PriceChart({
  forecast,
  weekly,
  weeklyLoading,
}: {
  forecast?: Forecast;
  weekly?: WeeklyOutlook;
  weeklyLoading?: boolean;
}) {
  const [active, setActive] = useState<string | null>(null);
  const selectedPoint = useRef<SVGCircleElement>(null);
  const outlook = buildNationalOutlook({
    forecast,
    weekly,
    weeklyStatus: weeklyLoading ? "loading" : "unavailable",
  });
  const {
    history,
    dailyLine,
    points,
    weeklyPoints,
    asOf: today,
    from,
  } = outlook;
  const all = [...history, ...dailyLine, ...weeklyPoints];
  if (!all.length) return <p className="chart-empty">{outlook.weeklyNote}</p>;
  const to = all.reduce((last, p) => (p.date > last ? p.date : last), today);
  const values = [
    ...history.map((p) => p.pricePence),
    ...dailyLine.flatMap((p) => [p.lowPence, p.highPence]),
    ...weeklyPoints.flatMap((p) => [p.lowPence, p.highPence]),
  ];
  const low = Math.floor((Math.min(...values) - 1) / 2) * 2;
  const high = Math.ceil((Math.max(...values) + 1) / 2) * 2;
  const x = (date: string) =>
    left +
    ((Date.parse(date) - Date.parse(from)) /
      Math.max(1, Date.parse(to) - Date.parse(from))) *
      (W - left - right);
  const y = (price: number) =>
    top + ((high - price) / (high - low)) * (H - top - bottom);
  const path = (ps: { date: string; pricePence: number }[]) =>
    ps
      .map((p, i) => `${i ? "L" : "M"}${x(p.date)},${y(p.pricePence)}`)
      .join(" ");
  const selected = points.find((p) => p.date === active);
  const tickDates = [
    ...new Set([from, addDays(today, -7), today, outlook.cutoff, to]),
  ].filter((d) => d <= to);
  const hitWidth = Math.min(32, x(addDays(today, 1)) - x(today));
  return (
    <>
      <div className="chart-readout">
        <span>GBP pence per litre</span>
        <span>Hover, tap or tab to a prediction</span>
      </div>
      <div className="chart-interactive">
        <svg
          className="price-chart"
          viewBox={`0 0 ${W} ${H}`}
          role="group"
          aria-label="UK petrol history, seven daily predictions, then available weekly predictions on their observation dates"
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") setActive(null);
          }}
        >
          {[0, 1, 2, 3, 4].map((i) => {
            const value = low + ((high - low) * i) / 4;
            return (
              <g key={i}>
                <line
                  x1={left}
                  x2={W - right}
                  y1={y(value)}
                  y2={y(value)}
                  stroke="#e5e9e2"
                  strokeDasharray="3 5"
                />
                <text
                  x={left - 10}
                  y={y(value) + 4}
                  textAnchor="end"
                  className="chart-label"
                >
                  {value.toFixed(0)}p
                </text>
              </g>
            );
          })}
          {dailyLine.slice(1).map((p, i) => {
            const a = dailyLine[i]!;
            return (
              <path
                key={p.date}
                d={`M${x(a.date)},${y(a.highPence)} L${x(p.date)},${y(p.highPence)} L${x(p.date)},${y(p.lowPence)} L${x(a.date)},${y(a.lowPence)} Z`}
                fill={
                  "confidence" in p && p.confidence === "medium"
                    ? "#c9dfad"
                    : "#eddeb6"
                }
                opacity={0.6}
              />
            );
          })}
          <line
            x1={x(today)}
            x2={x(today)}
            y1={top}
            y2={H - bottom}
            stroke="#a3af97"
            strokeDasharray="4 4"
          />
          {outlook.hasHandover && (
            <g>
              <line
                x1={x(outlook.cutoff)}
                x2={x(outlook.cutoff)}
                y1={top}
                y2={H - bottom}
                stroke="#6c78ab"
                strokeDasharray="3 4"
              />
              <text
                x={x(outlook.cutoff) - 6}
                y={14}
                textAnchor="end"
                className="chart-label"
              >
                DAY 7 · WEEKLY →
              </text>
            </g>
          )}
          {history.length > 1 && (
            <path
              d={path(history)}
              fill="none"
              stroke="#244d3a"
              strokeWidth={2.7}
            />
          )}
          {history.map((p) => (
            <circle
              key={p.date}
              cx={x(p.date)}
              cy={y(p.pricePence)}
              r={history.length === 1 ? 4 : 2.5}
              fill="#244d3a"
            >
              <title>
                {dateLabel(p.date)}: {outlook.historyLabel}{" "}
                {p.pricePence.toFixed(2)}p/L
              </title>
            </circle>
          ))}
          {!!dailyLine.length && (
            <path
              d={path(dailyLine)}
              fill="none"
              stroke="#6b873f"
              strokeWidth={2.7}
              strokeDasharray="5 5"
            />
          )}
          {weeklyPoints.map((p) => (
            <g key={p.date}>
              <line
                x1={x(p.date)}
                x2={x(p.date)}
                y1={y(p.lowPence)}
                y2={y(p.highPence)}
                stroke="#6c78ab"
                strokeWidth={2}
              />
              {[p.lowPence, p.highPence].map((price, i) => (
                <line
                  key={i}
                  x1={x(p.date) - 5}
                  x2={x(p.date) + 5}
                  y1={y(price)}
                  y2={y(price)}
                  stroke="#6c78ab"
                  strokeWidth={2}
                />
              ))}
              <circle
                cx={x(p.date)}
                cy={y(p.pricePence)}
                r={4.5}
                fill="#6c78ab"
              />
            </g>
          ))}
          {tickDates.map((date) => (
            <text
              key={date}
              x={x(date)}
              y={H - 13}
              textAnchor="middle"
              className="chart-label"
            >
              {date === today
                ? forecast
                  ? "SNAPSHOT"
                  : "TODAY"
                : dateLabel(date)}
            </text>
          ))}
          {selected && (
            <g>
              <line
                x1={x(selected.date)}
                x2={x(selected.date)}
                y1={top}
                y2={H - bottom}
                stroke="#a2ad8c"
              />
              <circle
                ref={selectedPoint}
                cx={x(selected.date)}
                cy={y(selected.pricePence)}
                r={5}
                fill={selected.kind === "weekly" ? "#6c78ab" : "#244d3a"}
                stroke="white"
                strokeWidth={2}
              />
            </g>
          )}
          {points.map((p) => (
            <rect
              key={p.date}
              x={x(p.date) - hitWidth / 2}
              y={top}
              width={hitWidth}
              height={H - top - bottom}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${p.detailLabel}, forecast ${dateLabel(p.date)}: ${p.pricePence.toFixed(2)}p per litre, range ${p.lowPence.toFixed(2)} to ${p.highPence.toFixed(2)}`}
              aria-describedby={
                active === p.date ? "forecast-tooltip" : undefined
              }
              onPointerMove={(event) => {
                if (event.pointerType === "mouse") setActive(p.date);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === "mouse") setActive(null);
              }}
              onFocus={() => setActive(p.date)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(p.date)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setActive(null);
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setActive(p.date);
                }
              }}
            />
          ))}
        </svg>
        {history.length < 2 && (
          <div className="history-placeholder">
            {history.length} observation collected
            <br />
            <span>Actual history builds over time</span>
          </div>
        )}
        {selected && (
          <ForecastTooltip anchor={selectedPoint}>
            <div className="tooltip-heading">
              <strong>{dateLabel(selected.date)}</strong>
              <span>
                {selected.kind === "weekly"
                  ? "Weekly prediction"
                  : `${selected.confidence ?? "low"} certainty`}
              </span>
            </div>
            <p>{selected.detailLabel}</p>
            <div className="tooltip-price">
              {selected.pricePence.toFixed(2)}
              <small>p/L</small>
            </div>
            {selected.referencePrice != null && (
              <p>
                {signed(selected.pricePence - selected.referencePrice)} vs{" "}
                {selected.referenceLabel}
              </p>
            )}
            <p>
              Possible range:{" "}
              <b>
                {selected.lowPence.toFixed(2)}–{selected.highPence.toFixed(2)}
                p/L
              </b>
            </p>
            <div className="tooltip-signals">
              {selected.signals?.map((s) => (
                <div key={s.name}>
                  <strong>
                    {s.label}
                    <span>
                      {s.available
                        ? `${s.weight == null ? "" : `${Math.round(s.weight * 100)}% weight · `}${signed(s.contributionPence)}`
                        : "Unavailable"}
                    </span>
                  </strong>
                  <p>{s.detail}</p>
                </div>
              )) ?? <p>Signal breakdown unavailable.</p>}
            </div>
            <small>
              Contributions are relative to the {selected.referenceLabel}. They
              are fitted terms, not causal effects. Ranges are not guaranteed
              probabilities.
            </small>
          </ForecastTooltip>
        )}
      </div>
      <div className="chart-legend">
        <span>
          <i className="solid-line" />
          {outlook.historyLabel}
        </span>
        {!!outlook.dailyPoints.length && (
          <span>
            <i className="dash-line" />
            Daily · next 7 days
          </span>
        )}
        {!!weeklyPoints.length && (
          <span>
            <i className="weekly-dot" />
            Weekly · official benchmark
          </span>
        )}
        {!!outlook.dailyPoints.length && (
          <>
            <span>
              <i className="range-square" />
              Medium certainty
            </span>
            <span>
              <i className="range-square low" />
              Low certainty
            </span>
          </>
        )}
      </div>
      {outlook.disagreement && (
        <div className="outlook-warning" role="status">
          <strong>The outlooks disagree</strong>
          <p>{outlook.disagreement.message}</p>
        </div>
      )}
      <p className="outlook-note" role="status">
        {outlook.weeklyNote}
      </p>
      <details className="chart-table">
        <summary>View forecast prices and signal breakdowns</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Benchmark</th>
                <th>Price</th>
                <th>Range (p/L)</th>
                <th>Contributions from each model’s reference</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date}>
                  <td>{dateLabel(p.date)}</td>
                  <td>
                    {p.kind === "weekly"
                      ? "Weekly · sales-weighted"
                      : "Daily · station average"}
                  </td>
                  <td>{p.pricePence.toFixed(2)}p</td>
                  <td>
                    {p.lowPence.toFixed(2)}–{p.highPence.toFixed(2)}
                  </td>
                  <td>
                    {p.signals
                      ?.map(
                        (s) =>
                          `${s.label}: ${s.available ? signed(s.contributionPence) : "unavailable"}`,
                      )
                      .join(" · ") ?? "Unavailable"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="chart-note">
        {outlook.benchmarkNote} Shading and bars show empirical or illustrative
        ranges, not guaranteed probabilities.
      </p>
    </>
  );
}
const colours = ["#406e51", "#b97d45", "#6c78ab"];
export function StationChart({ data }: { data: TrackedStations }) {
  const points = data.stations.flatMap((s) => s.history);
  if (!data.stations.length)
    return (
      <p className="chart-empty">
        Choose your stations to start collecting their price history.
      </p>
    );
  const first = points.length
    ? Math.min(...points.map((p) => Date.parse(p.observedAt)))
    : Date.now();
  const last = points.length
    ? Math.max(...points.map((p) => Date.parse(p.observedAt)))
    : first;
  const span = Math.max(3600000, last - first),
    low =
      Math.floor(
        (Math.min(
          ...points.map((p) => p.pricePence),
          ...data.stations.map((s) => s.pricePence ?? 150),
        ) -
          1) /
          2,
      ) * 2,
    high =
      Math.ceil(
        (Math.max(
          ...points.map((p) => p.pricePence),
          ...data.stations.map((s) => s.pricePence ?? 150),
        ) +
          1) /
          2,
      ) * 2;
  const x = (stamp: string) =>
      left + ((Date.parse(stamp) - first) / span) * (W - left - right),
    y = (p: number) => top + ((high - p) / (high - low)) * (H - top - bottom);
  return (
    <>
      <div className="chart-readout">
        <span>GBP pence per litre · actual hourly observations</span>
        <span>Up to 30 days</span>
      </div>
      <svg
        className="price-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Actual price history at your tracked petrol stations"
      >
        {[0, 1, 2, 3, 4].map((i) => {
          const value = low + ((high - low) * i) / 4;
          return (
            <g key={i}>
              <line
                x1={left}
                x2={W - right}
                y1={y(value)}
                y2={y(value)}
                stroke="#e5e9e2"
                strokeDasharray="3 5"
              />
              <text
                x={left - 10}
                y={y(value) + 4}
                textAnchor="end"
                className="chart-label"
              >
                {value.toFixed(0)}p
              </text>
            </g>
          );
        })}
        {data.stations.map((s, i) => (
          <g key={s.id}>
            <path
              d={s.history
                .map((p, j) =>
                  j
                    ? `L${x(p.observedAt)},${y(s.history[j - 1]!.pricePence)} L${x(p.observedAt)},${y(p.pricePence)}`
                    : `M${x(p.observedAt)},${y(p.pricePence)}`,
                )
                .join(" ")}
              stroke={colours[i]}
              strokeWidth={2.5}
              fill="none"
            />
            {s.history
              .filter((_, j) => j === 0 || j === s.history.length - 1)
              .map((p, j) => (
                <circle
                  key={j}
                  cx={x(p.observedAt)}
                  cy={y(p.pricePence)}
                  r={4}
                  fill={colours[i]}
                >
                  <title>
                    {s.name}: {p.pricePence.toFixed(1)}p/L at{" "}
                    {new Date(p.observedAt).toLocaleString("en-GB")}
                  </title>
                </circle>
              ))}
          </g>
        ))}
        <text x={left} y={H - 13} className="chart-label">
          {new Date(first).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
          })}
        </text>
        {last > first && (
          <text
            x={W - right}
            y={H - 13}
            textAnchor="end"
            className="chart-label"
          >
            {new Date(last).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            })}
          </text>
        )}
      </svg>
      <div className="station-legend">
        {data.stations.map((s, i) => (
          <div key={s.id}>
            <i style={{ background: colours[i] }} />
            <span>
              {s.name}
              <small>{s.postcode}</small>
            </span>
            <strong>
              {s.pricePence?.toFixed(1) ?? "—"}
              <small>p/L</small>
            </strong>
          </div>
        ))}
      </div>
      {last - first < 86400000 && (
        <p className="chart-note">
          Tracking has just started. Each hourly collection adds a real
          observation; older prices aren’t invented.
        </p>
      )}
      <details className="chart-table">
        <summary>View station observations</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Station</th>
                <th>Observed</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {data.stations.flatMap((s) =>
                s.history.map((p) => (
                  <tr key={`${s.id}:${p.observedAt}`}>
                    <td>{s.name}</td>
                    <td>{new Date(p.observedAt).toLocaleString("en-GB")}</td>
                    <td>{p.pricePence.toFixed(2)}p/L</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
