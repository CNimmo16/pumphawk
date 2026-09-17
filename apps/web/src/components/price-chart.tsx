import { useRef, useState } from "react";
import type { Forecast, TrackedStations } from "@pump-hawk/openapi/types";
import { dateLabel } from "../lib/api";
import { ForecastTooltip } from "./forecast-tooltip";
const W = 850,
  H = 285,
  left = 48,
  right = 22,
  top = 24,
  bottom = 40;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}p`;
export function PriceChart({ forecast }: { forecast: Forecast }) {
  const [active, setActive] = useState<string | null>(null);
  const selectedPoint = useRef<SVGCircleElement>(null);
  const today = forecast.points[0]!.date,
    from = new Date(Date.parse(today) - 13 * 86400000)
      .toISOString()
      .slice(0, 10),
    to = forecast.points.at(-1)!.date;
  const history = forecast.history.filter((p) => p.date >= from),
    future = forecast.points;
  const low =
      Math.floor(
        (Math.min(
          ...history.map((p) => p.pricePence),
          ...future.map((p) => p.lowPence),
        ) -
          1) /
          2,
      ) * 2,
    high =
      Math.ceil(
        (Math.max(
          ...history.map((p) => p.pricePence),
          ...future.map((p) => p.highPence),
        ) +
          1) /
          2,
      ) * 2;
  const x = (date: string) =>
      left +
      ((Date.parse(date) - Date.parse(from)) /
        (Date.parse(to) - Date.parse(from))) *
        (W - left - right),
    y = (price: number) =>
      top + ((high - price) / (high - low)) * (H - top - bottom);
  const path = (points: { date: string; pricePence: number }[]) =>
    points
      .map((p, i) => `${i ? "L" : "M"}${x(p.date)},${y(p.pricePence)}`)
      .join(" ");
  const selected = future.find((p) => p.date === active),
    delta = selected ? selected.pricePence - forecast.currentPricePence : 0;
  return (
    <>
      <div className="chart-readout">
        <span>GBP pence per litre</span>
        <span>Hover, tap or tab to a forecast day</span>
      </div>
      <div className="chart-interactive">
        <svg
          className="price-chart"
          viewBox={`0 0 ${W} ${H}`}
          role="group"
          aria-label="UK petrol prices: past 14 days and next 14 days"
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
          {future.slice(1).map((p, i) => {
            const a = future[i]!;
            return (
              <path
                key={p.date}
                d={`M${x(a.date)},${y(a.highPence)} L${x(p.date)},${y(p.highPence)} L${x(p.date)},${y(p.lowPence)} L${x(a.date)},${y(a.lowPence)} Z`}
                fill={p.confidence === "medium" ? "#c9dfad" : "#eddeb6"}
                opacity={
                  forecast.model === "daily-ridge" && i >= 7 ? 0.25 : 0.6
                }
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
                {dateLabel(p.date)}:{" "}
                {p.source === "sample" || forecast.mode === "demo"
                  ? "sample"
                  : "actual"}{" "}
                {p.pricePence.toFixed(2)}p/L
              </title>
            </circle>
          ))}
          <path
            d={path(future)}
            fill="none"
            stroke="#6b873f"
            strokeWidth={2.7}
            strokeDasharray="5 5"
          />
          {[
            from,
            new Date(Date.parse(today) - 7 * 86400000)
              .toISOString()
              .slice(0, 10),
            today,
            future[7]!.date,
            to,
          ].map((date) => (
            <text
              key={date}
              x={x(date)}
              y={H - 13}
              textAnchor="middle"
              className="chart-label"
            >
              {date === today
                ? forecast.model === "daily-ridge"
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
                fill="#244d3a"
                stroke="white"
                strokeWidth={2}
              />
            </g>
          )}
          {future.slice(1).map((p) => (
            <rect
              key={p.date}
              x={x(p.date) - (W - left - right) / 27 / 2}
              y={top}
              width={(W - left - right) / 27}
              height={H - top - bottom}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`Forecast ${dateLabel(p.date)}: ${p.pricePence.toFixed(2)}p per litre, range ${p.lowPence.toFixed(2)} to ${p.highPence.toFixed(2)}`}
              aria-describedby={
                active === p.date ? "forecast-tooltip" : undefined
              }
              onPointerMove={(event) => {
                if (event.pointerType !== "mouse") return;
                setActive(p.date);
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
            {history.length} day collected
            <br />
            <span>Actual history builds each day</span>
          </div>
        )}
        {selected && (
          <ForecastTooltip anchor={selectedPoint}>
            <div className="tooltip-heading">
              <strong>{dateLabel(selected.date)}</strong>
              <span>
                {forecast.model === "daily-ridge" &&
                selected.date > future[7]!.date
                  ? "Longer-term outlook"
                  : `${selected.confidence ?? "low"} certainty`}
              </span>
            </div>
            <div className="tooltip-price">
              {selected.pricePence.toFixed(2)}
              <small>p/L</small>
              <span>
                {signed(delta)} vs{" "}
                {forecast.model === "daily-ridge" ? "snapshot" : "today"}
              </span>
            </div>
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
              )) ?? (
                <p>
                  Synthetic example based on falling wholesale costs and slower
                  retail price cuts.
                </p>
              )}
            </div>
            <small>
              Contributions sum to the change from the observed anchor. They are
              fitted terms, not causal effects. The range is not a guaranteed
              probability interval.
            </small>
          </ForecastTooltip>
        )}
      </div>
      <div className="chart-legend">
        <span>
          <i className="solid-line" />
          {forecast.mode === "sample"
            ? "Sample pump history"
            : forecast.mode === "demo"
              ? "Demo E10 prices"
              : "Actual E10 prices"}
        </span>
        <span>
          <i className="dash-line" />
          14-day forecast
        </span>
        <span>
          <i className="range-square" />
          Medium certainty
        </span>
        <span>
          <i className="range-square low" />
          Low certainty
        </span>
      </div>
      <details className="chart-table">
        <summary>View daily prices and signal breakdowns</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Price</th>
                <th>Range (p/L)</th>
                <th>Signals: contribution from today</th>
              </tr>
            </thead>
            <tbody>
              {future.slice(1).map((p) => (
                <tr key={p.date}>
                  <td>{dateLabel(p.date)}</td>
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
                      .join(" · ") ?? "Synthetic wholesale scenario"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
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
