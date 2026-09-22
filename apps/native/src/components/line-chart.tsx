import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { Circle, G, Line, Path, Text as SvgText } from "react-native-svg";
import {
  chartGeometry,
  nearestPoint,
  type ChartPoint,
  type ChartSeries,
} from "../lib/chart";
import { colors } from "../lib/theme";
import { dateLabel } from "../lib/api";
import { Button, MotionView } from "./ui";
import { FadeIn, ReduceMotion } from "react-native-reanimated";
export function LineChart({
  series,
  label,
  onSelect,
  selected,
  selectable,
  handover,
}: {
  series: ChartSeries[];
  label: string;
  onSelect?: (point: ChartPoint | undefined) => void;
  selected?: ChartPoint;
  selectable?: ChartPoint[];
  handover?: { date: string; label: string };
}) {
  const [width, setWidth] = useState(300);
  const geometry = useMemo(() => chartGeometry(series, width), [series, width]);
  if (!geometry)
    return (
      <Text className="text-sm text-muted py-5">
        No observations yet. Prices will appear as they are collected.
      </Text>
    );
  const points = selectable ?? geometry.points;
  const choose = (x: number) => onSelect?.(nearestPoint(points, x, geometry.x));
  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .runOnJS(true)
    .onStart((e) => choose(e.x))
    .onUpdate((e) => choose(e.x));
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((e, success) => {
      if (success) choose(e.x);
    });
  return (
    <View
      className="gap-3"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <GestureDetector gesture={Gesture.Race(pan, tap)}>
        <View
          accessible
          accessibilityLabel={label}
          accessibilityRole={onSelect ? "adjustable" : "image"}
          accessibilityHint={
            onSelect
              ? "Swipe horizontally to explore prices. Forecast dates are also available below."
              : undefined
          }
          accessibilityActions={
            onSelect
              ? [
                  { name: "increment", label: "Next observation" },
                  { name: "decrement", label: "Previous observation" },
                ]
              : undefined
          }
          onAccessibilityAction={(e) => {
            const index = points.findIndex((p) => p.date === selected?.date);
            onSelect?.(
              points[
                Math.max(
                  0,
                  Math.min(
                    points.length - 1,
                    index + (e.nativeEvent.actionName === "increment" ? 1 : -1),
                  ),
                )
              ],
            );
          }}
        >
          <Svg width={width} height={220}>
            {[0, 1, 2, 3].map((i) => {
              const price =
                geometry.min + ((geometry.max - geometry.min) * i) / 3;
              return (
                <ViewTick
                  key={i}
                  price={price}
                  y={geometry.y(price)}
                  width={width}
                />
              );
            })}
            {series
              .filter((s) => s.dashed && !s.pointsOnly)
              .flatMap((s) =>
                s.points.slice(1).map((p, i) => {
                  const previous = s.points[i]!;
                  if (
                    p.lowPence == null ||
                    previous.lowPence == null ||
                    p.highPence == null ||
                    previous.highPence == null
                  )
                    return null;
                  const d = `M${geometry.x(previous.date)},${geometry.y(previous.lowPence)} L${geometry.x(p.date)},${geometry.y(p.lowPence)} L${geometry.x(p.date)},${geometry.y(p.highPence)} L${geometry.x(previous.date)},${geometry.y(previous.highPence)} Z`;
                  return (
                    <Path
                      key={`${s.id}-${p.date}`}
                      d={d}
                      fill={
                        p.confidence === "medium" ? colors.leaf : colors.wheat
                      }
                      opacity={0.5}
                    />
                  );
                }),
              )}
            {handover && (
              <>
                <Line
                  x1={geometry.x(handover.date)}
                  x2={geometry.x(handover.date)}
                  y1={geometry.top}
                  y2={geometry.bottom}
                  stroke={colors.muted}
                  strokeDasharray="3 4"
                />
                <SvgText
                  x={geometry.x(handover.date) - 5}
                  y={11}
                  textAnchor="end"
                  fontSize={10}
                  fill={colors.muted}
                >
                  {handover.label}
                </SvgText>
              </>
            )}
            {series
              .filter((s) => !s.pointsOnly)
              .map((s) => (
                <Path
                  key={s.id}
                  d={geometry.path(s.points)}
                  stroke={s.color}
                  strokeWidth={2.3}
                  strokeDasharray={s.dashed ? "5 5" : undefined}
                  fill="none"
                />
              ))}
            {series
              .filter((s) => s.pointsOnly || s.points.length === 1)
              .flatMap((s) =>
                s.points.map((p) => (
                  <G key={`${s.id}-${p.date}`}>
                    {s.pointsOnly &&
                      p.lowPence != null &&
                      p.highPence != null && (
                        <>
                          <Line
                            x1={geometry.x(p.date)}
                            x2={geometry.x(p.date)}
                            y1={geometry.y(p.lowPence)}
                            y2={geometry.y(p.highPence)}
                            stroke={s.color}
                            strokeWidth={2}
                          />
                          {[p.lowPence, p.highPence].map((price, i) => (
                            <Line
                              key={i}
                              x1={geometry.x(p.date) - 4}
                              x2={geometry.x(p.date) + 4}
                              y1={geometry.y(price)}
                              y2={geometry.y(price)}
                              stroke={s.color}
                              strokeWidth={2}
                            />
                          ))}
                        </>
                      )}
                    <Circle
                      cx={geometry.x(p.date)}
                      cy={geometry.y(p.pricePence)}
                      r={4}
                      fill={s.color}
                    />
                  </G>
                )),
              )}
            {selected && (
              <>
                <Line
                  x1={geometry.x(selected.date)}
                  x2={geometry.x(selected.date)}
                  y1={geometry.top}
                  y2={geometry.bottom}
                  stroke={colors.muted}
                  strokeDasharray="3 4"
                />
                <Circle
                  cx={geometry.x(selected.date)}
                  cy={geometry.y(selected.pricePence)}
                  r={5}
                  fill={
                    series.find((s) => s.points.includes(selected))?.color ??
                    colors.forest
                  }
                  stroke="white"
                  strokeWidth={2}
                />
              </>
            )}
            <SvgText
              x={geometry.left}
              y={215}
              fontSize={10}
              fill={colors.muted}
            >
              {dateLabel(new Date(geometry.minTime).toISOString())}
            </SvgText>
            <SvgText
              x={geometry.right}
              y={215}
              textAnchor="end"
              fontSize={10}
              fill={colors.muted}
            >
              {dateLabel(new Date(geometry.maxTime).toISOString())}
            </SvgText>
          </Svg>
        </View>
      </GestureDetector>
      <View className="flex-row flex-wrap gap-4">
        {series.map((s) => (
          <View key={s.id} className="flex-row gap-2 items-center">
            <View
              style={{
                width: s.pointsOnly ? 7 : 12,
                height: s.pointsOnly ? 7 : 3,
                borderRadius: s.pointsOnly ? 4 : 0,
                backgroundColor: s.color,
              }}
            />
            <Text className="text-xs text-muted">{s.label}</Text>
          </View>
        ))}
      </View>
      {selected && (
        <MotionView
          entering={FadeIn.duration(150).reduceMotion(ReduceMotion.System)}
          className="rounded-xl bg-paper px-4 py-3 gap-2"
        >
          {selected.detailLabel && (
            <Text className="text-xs text-muted">{selected.detailLabel}</Text>
          )}
          {selected.seriesLabel && (
            <Text className="text-xs text-muted">
              {selected.seriesLabel} ·{" "}
              {new Date(selected.date).toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          )}
          <Text className="font-semibold text-ink">
            {dateLabel(selected.date)} · {selected.pricePence.toFixed(2)}p/L
          </Text>
          {selected.lowPence != null && (
            <Text className="text-sm text-muted">
              Range {selected.lowPence.toFixed(2)}–
              {selected.highPence?.toFixed(2)}p/L
            </Text>
          )}
          <Button variant="quiet" onPress={() => onSelect?.(undefined)}>
            Close detail
          </Button>
        </MotionView>
      )}
    </View>
  );
}
function ViewTick({
  price,
  y,
  width,
}: {
  price: number;
  y: number;
  width: number;
}) {
  return (
    <>
      <Line
        x1={40}
        x2={width - 12}
        y1={y}
        y2={y}
        stroke={colors.line}
        strokeDasharray="2 4"
      />
      <SvgText
        x={32}
        y={y + 3}
        textAnchor="end"
        fontSize={10}
        fill={colors.muted}
      >
        {price.toFixed(0)}p
      </SvgText>
    </>
  );
}
