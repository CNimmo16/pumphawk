import { useEffect, useRef, useState } from "react";
import type { Region } from "react-native-maps";
import { Text, View } from "react-native";
import * as ExpoLocation from "expo-location";
import { KeyboardController } from "react-native-keyboard-controller";
import { useQuery } from "@tanstack/react-query";
import { getNearbyStationsOptions } from "@pump-hawk/openapi/react-query";
import type { Station } from "@pump-hawk/openapi/types";
import {
  stationPriceComparison,
  stationPriceMedian,
} from "@pump-hawk/presentation/station-prices";
import { sortedStations } from "../lib/driver-form";
import { errorMessage } from "../lib/api";
import { Body, Button, ErrorNote, Field, Label, Skeleton } from "./ui";
import { StationMap, type Location } from "./station-map";
export function StationPicker({
  savedStations,
  location,
  selected,
  onLocation,
  onSelected,
  onReady,
}: {
  savedStations: Station[];
  location: Location | null;
  selected: string[];
  onLocation: (location: Location) => void;
  onSelected: (ids: string[]) => void;
  onReady: (ready: boolean) => void;
}) {
  const [postcode, setPostcode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [order, setOrder] = useState<"distance" | "price">("distance");
  const [view, setView] = useState<"map" | "list">("map");
  const viewport = useRef<{ search: string; region: Region } | null>(null);
  const search = location ? `${location.latitude},${location.longitude}` : "";
  const nearby = useQuery({
    ...getNearbyStationsOptions({
      query: location ?? { latitude: 51.5, longitude: -0.1 },
    }),
    enabled: !!location,
    staleTime: 60_000,
  });
  const stations = nearby.data?.stations ?? [];
  const median = stationPriceMedian(stations);
  useEffect(() => {
    onReady(
      !!location &&
        !!nearby.data &&
        !nearby.isFetching &&
        !nearby.isError &&
        selected.length > 0 &&
        selected.every((id) => nearby.data.stations.some((s) => s.id === id)),
    );
  }, [
    location,
    nearby.data,
    nearby.isFetching,
    nearby.isError,
    selected,
    onReady,
  ]);
  useEffect(() => {
    if (nearby.data) {
      const valid = selected.filter((id) =>
        nearby.data.stations.some((s) => s.id === id),
      );
      if (valid.length !== selected.length) {
        onSelected(valid);
        setError(
          "Some selected stations are outside this search area. Choose your regular stops below.",
        );
      }
    }
  }, [nearby.data, selected, onSelected]);
  const choose = (value: Location) => {
    if (
      value.latitude < 49 ||
      value.latitude > 61 ||
      value.longitude < -9 ||
      value.longitude > 2
    )
      throw new Error(
        "Pump Hawk currently covers UK petrol stations. Enter a UK postcode.",
      );
    onLocation({ latitude: value.latitude, longitude: value.longitude });
    setError("");
  };
  async function locate() {
    setBusy(true);
    setError("");
    void KeyboardController.dismiss();
    try {
      const permission = await ExpoLocation.requestForegroundPermissionsAsync();
      if (!permission.granted)
        throw new Error(
          "Location access is off. Enter a nearby UK postcode instead.",
        );
      const cached = await ExpoLocation.getLastKnownPositionAsync({
        maxAge: 300_000,
        requiredAccuracy: 1500,
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result =
          cached ??
          (await Promise.race([
            ExpoLocation.getCurrentPositionAsync({
              accuracy: ExpoLocation.Accuracy.Balanced,
            }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () =>
                  reject(
                    new Error(
                      "Location took too long. Try a postcode instead.",
                    ),
                  ),
                15_000,
              );
            }),
          ]));
        choose(result.coords);
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function findPostcode() {
    if (!postcode.trim()) return;
    setBusy(true);
    setError("");
    void KeyboardController.dismiss();
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim())}`,
        { signal: controller.signal },
      );
      const data = await response.json();
      if (
        !response.ok ||
        !data.result ||
        !Number.isFinite(data.result.latitude) ||
        !Number.isFinite(data.result.longitude)
      )
        throw new Error("Enter a valid UK postcode.");
      choose(data.result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }
  function toggle(id: string) {
    if (selected.includes(id)) onSelected(selected.filter((s) => s !== id));
    else if (selected.length < 3) onSelected([...selected, id]);
    else
      setError(
        "You can track up to three stations. Deselect one to choose another.",
      );
  }
  return (
    <View className="gap-4">
      {!location && savedStations.length > 0 && (
        <>
          <Label>Your saved regular stops</Label>
          <Body>
            These stops are already selected. Keep them, or search below to
            choose different stations.
          </Body>
          {savedStations.map((station) => (
            <StationOption
              key={station.id}
              station={station}
              median={stationPriceMedian(savedStations)}
              selected
            />
          ))}
        </>
      )}
      <Button variant="outline" loading={busy} onPress={() => void locate()}>
        Use my location
      </Button>
      <Field
        label="Or enter a UK postcode"
        placeholder="E11 1PP"
        autoCapitalize="characters"
        autoCorrect={false}
        value={postcode}
        onChangeText={setPostcode}
        maxLength={10}
        returnKeyType="search"
        onSubmitEditing={() => void findPostcode()}
      />
      <Button
        variant="outline"
        disabled={busy || !postcode.trim()}
        onPress={() => void findPostcode()}
      >
        Find stations
      </Button>
      <Body className="text-xs">
        Location is used for this search and is not saved to your profile.
        Postcode lookup uses Postcodes.io.
      </Body>
      {location && (
        <>
          <View
            accessibilityRole="tablist"
            accessibilityLabel="Station view"
            className="flex-row gap-1 rounded-2xl bg-paper p-1"
          >
            {(["map", "list"] as const).map((tab) => (
              <View key={tab} className="flex-1">
                <Button
                  accessibilityRole="tab"
                  accessibilityState={{ selected: view === tab }}
                  variant={view === tab ? "primary" : "quiet"}
                  onPress={() => setView(tab)}
                >
                  {tab === "map" ? "Map" : "List"}
                </Button>
              </View>
            ))}
          </View>
          <Label>
            {selected.length} of 3 selected
            {view === "list" ? " · selected first" : ""}
          </Label>
          <Body className="text-xs">
            Green: below median · yellow: within 1p · red: above median
            {median != null ? ` (${median.toFixed(1)}p/L)` : ""}.
          </Body>
          {view === "map" && (
            <StationMap
              location={location}
              stations={stations}
              selected={selected}
              onSelect={toggle}
              initialRegion={
                viewport.current?.search === search
                  ? viewport.current.region
                  : undefined
              }
              onRegionChange={(region) => {
                viewport.current = { search, region };
              }}
            />
          )}
        </>
      )}
      {error && <ErrorNote message={error} />}
      {nearby.isFetching && location && (
        <Skeleton label="Loading nearby petrol stations" />
      )}
      {nearby.error && (
        <ErrorNote
          message={errorMessage(nearby.error)}
          retry={() => void nearby.refetch()}
        />
      )}
      {!!nearby.data && (
        <>
          {view === "list" && (
            <>
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Button
                    variant={order === "distance" ? "primary" : "outline"}
                    onPress={() => setOrder("distance")}
                  >
                    Distance
                  </Button>
                </View>
                <View className="flex-1">
                  <Button
                    variant={order === "price" ? "primary" : "outline"}
                    onPress={() => setOrder("price")}
                  >
                    Price ↑
                  </Button>
                </View>
              </View>
              {sortedStations(stations, selected, order).map((station) => (
                <StationOption
                  key={station.id}
                  station={station}
                  median={median}
                  selected={selected.includes(station.id)}
                  disabled={
                    !selected.includes(station.id) && selected.length >= 3
                  }
                  onToggle={() => toggle(station.id)}
                />
              ))}
            </>
          )}
          {!stations.length && (
            <Body>
              No reporting E10 stations within five miles. Try another postcode.
            </Body>
          )}
          <Body className="text-xs">
            Checked{" "}
            {nearby.data.checkedAt
              ? new Date(nearby.data.checkedAt).toLocaleString("en-GB")
              : "recently"}
            . Prices may change before you visit.
          </Body>
        </>
      )}
    </View>
  );
}

function StationOption({
  station,
  median,
  selected,
  disabled,
  onToggle,
}: {
  station: Station;
  median: number | null;
  selected: boolean;
  disabled?: boolean;
  onToggle?: () => void;
}) {
  const { band, description } = stationPriceComparison(
    station.pricePence,
    median,
  );
  return (
    <View
      className={`rounded-2xl border p-4 gap-3 ${selected ? "border-forest bg-paper" : "border-line bg-white"}`}
    >
      <View className="flex-row gap-3 justify-between">
        <View className="flex-1 gap-1">
          <Text className="text-base font-semibold text-ink">
            {station.name}
          </Text>
          <Text className="text-xs text-muted">
            {station.postcode}
            {station.distanceMiles != null
              ? ` · ${station.distanceMiles.toFixed(1)} miles`
              : ""}
            {station.motorway ? " · Motorway services" : ""}
          </Text>
        </View>
        <View
          accessibilityLabel={description}
          className={`rounded-xl p-2 self-start ${band === "low" ? "bg-low" : band === "high" ? "bg-high" : band === "typical" ? "bg-typical" : "bg-paper"}`}
        >
          <Text className="text-lg font-bold text-ink">
            {station.pricePence?.toFixed(1) ?? "—"}p
          </Text>
        </View>
      </View>
      {onToggle ? (
        <Button
          variant={selected ? "primary" : "outline"}
          accessibilityLabel={`${selected ? "Deselect" : "Track"} ${station.name}`}
          disabled={disabled}
          onPress={onToggle}
        >
          {selected ? "✓ Selected" : "Track this station"}
        </Button>
      ) : (
        <Text className="text-sm font-semibold text-forest">✓ Selected</Text>
      )}
    </View>
  );
}
