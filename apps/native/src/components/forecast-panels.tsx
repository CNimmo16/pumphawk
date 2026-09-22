import { buildNationalOutlook } from "@pump-hawk/presentation/national-outlook";
import { useState } from "react";
import { Text, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import type {
  Forecast,
  WeeklyOutlook,
  TrackedStations,
} from "@pump-hawk/openapi/types";
import { Body, Button, Card, Heading, Label } from "./ui";
import { LineChart } from "./line-chart";
import type { ChartPoint, ChartSeries } from "../lib/chart";
import { dateLabel } from "../lib/api";
import { colors, stationColors } from "../lib/theme";
export function OutlookPanel({
  forecast,
  weekly,
  weeklyLoading,
}: {
  forecast?: Forecast;
  weekly?: WeeklyOutlook;
  weeklyLoading?: boolean;
}) {
  const [selectedDate, setSelectedDate] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const outlook = buildNationalOutlook({
    forecast,
    weekly,
    weeklyStatus: weeklyLoading ? "loading" : "unavailable",
  });
  const selected = outlook.points.find((p) => p.date === selectedDate);
  const series: ChartSeries[] = [
    {
      id: "actual",
      label: outlook.historyLabel,
      color: colors.forest,
      points: outlook.history,
    },
    ...(outlook.dailyLine.length
      ? [
          {
            id: "daily",
            label: "Daily · next 7 days",
            color: colors.forest,
            points: outlook.dailyLine,
            dashed: true,
          },
        ]
      : []),
    ...(outlook.weeklyPoints.length
      ? [
          {
            id: "weekly",
            label: "Weekly · official benchmark",
            color: stationColors[2]!,
            points: outlook.weeklyPoints,
            pointsOnly: true,
          },
        ]
      : []),
  ];
  return (
    <Card>
      <Heading>The road ahead</Heading>
      <Body className="text-sm">UK petrol · daily for 7 days, then weekly</Body>
      <Label>Pence per litre · two national benchmarks</Label>
      <LineChart
        label="UK petrol history, seven daily predictions, then available weekly predictions on their observation dates"
        series={series}
        selected={selected}
        onSelect={(p) => setSelectedDate(p?.date)}
        selectable={outlook.points}
        handover={
          outlook.hasHandover
            ? { date: outlook.cutoff, label: "Day 7 · weekly →" }
            : undefined
        }
      />
      <Body className="text-xs">
        Tap or drag to explore a prediction. Green daily shading: medium
        certainty; yellow: low certainty.
      </Body>
      {selected?.signals && (
        <View className="gap-3">
          {selected.signals.map((signal) => (
            <View key={signal.name} className="gap-1">
              <Text className="text-sm font-semibold text-ink">
                {signal.label}:{" "}
                {signal.available
                  ? `${signal.contributionPence >= 0 ? "+" : ""}${signal.contributionPence.toFixed(2)}p/L`
                  : "unavailable"}
              </Text>
              <Body className="text-xs">{signal.detail}</Body>
            </View>
          ))}
          <Body className="text-xs">
            Contributions are relative to the {selected.referenceLabel}; they
            are fitted terms, not causal effects.
          </Body>
        </View>
      )}
      {outlook.disagreement && (
        <View
          className="rounded-xl bg-wheat p-4 gap-1"
          accessibilityRole="alert"
        >
          <Text className="font-semibold text-ink">The outlooks disagree</Text>
          <Body className="text-sm">{outlook.disagreement.message}</Body>
        </View>
      )}
      <Body className="text-xs">{outlook.weeklyNote}</Body>
      <Button variant="quiet" onPress={() => setExpanded(!expanded)}>
        {expanded ? "Hide forecast prices" : "View forecast prices and signals"}
      </Button>
      {expanded && (
        <View className="gap-2">
          {outlook.points.map((p) => (
            <Button
              key={p.date}
              variant="outline"
              onPress={() => setSelectedDate(p.date)}
            >
              {dateLabel(p.date)} · {p.kind === "daily" ? "Daily" : "Weekly"} ·{" "}
              {p.pricePence.toFixed(2)}p/L
            </Button>
          ))}
        </View>
      )}
      <Body className="text-xs">
        {outlook.benchmarkNote} Ranges reflect past errors or illustrative
        scenarios, not guaranteed probabilities.
      </Body>
    </Card>
  );
}
export function StationHistory({ data }: { data: TrackedStations }) {
  const [selected, setSelected] = useState<ChartPoint>(),
    [expanded, setExpanded] = useState(false);
  return (
    <Card>
      <Heading>Your regular stops</Heading>
      <Body className="text-sm">
        Actual E10 prices · collected hourly · up to 30 days
      </Body>
      <LineChart
        label="Actual petrol price history at your tracked stations"
        selected={selected}
        onSelect={setSelected}
        series={data.stations.map((s, i) => ({
          id: s.id,
          label: s.name,
          color: stationColors[i % stationColors.length]!,
          points: s.history.map((p) => ({
            date: p.observedAt,
            pricePence: p.pricePence,
            seriesLabel: s.name,
          })),
        }))}
      />
      {data.stations.every((s) => s.history.length < 2) && (
        <Body className="text-sm">
          Tracking has just started. Each collection adds a real observation;
          older prices aren’t invented.
        </Body>
      )}
      <Button variant="quiet" onPress={() => setExpanded(!expanded)}>
        {expanded ? "Hide observations" : "View station observations"}
      </Button>
      {expanded && (
        <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled>
          <View className="gap-4">
            {data.stations.map((station) => (
              <View key={station.id} className="gap-2">
                <Text className="font-semibold text-ink">{station.name}</Text>
                {station.history.map((p) => (
                  <Text key={p.observedAt} className="text-xs text-muted">
                    {new Date(p.observedAt).toLocaleString("en-GB")} ·{" "}
                    {p.pricePence.toFixed(1)}p/L
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </Card>
  );
}
