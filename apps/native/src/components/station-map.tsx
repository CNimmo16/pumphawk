import { useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import Constants from "expo-constants";
import MapView, { Circle, Marker, type Region } from "react-native-maps";
import type { Station } from "@pump-hawk/openapi/types";
import {
  stationPriceComparison,
  stationPriceMedian,
} from "@pump-hawk/presentation/station-prices";
import { Body, Button } from "./ui";
import { colors } from "../lib/theme";
export type Location = { latitude: number; longitude: number };
export function StationMap({
  location,
  stations,
  selected,
  onSelect,
  initialRegion,
  onRegionChange,
}: {
  location: Location;
  stations: Station[];
  selected: string[];
  onSelect: (id: string) => void;
  initialRegion?: Region;
  onRegionChange?: (region: Region) => void;
}) {
  const map = useRef<MapView>(null);
  const [focused, setFocused] = useState<string>();
  const median = stationPriceMedian(stations);
  const region = { ...location, latitudeDelta: 0.18, longitudeDelta: 0.25 };
  if (
    Platform.OS === "android" &&
    !Constants.expoConfig?.extra?.androidMapsConfigured
  )
    return (
      <View className="rounded-2xl bg-paper p-4">
        <Body>
          The Android map needs its Maps API key in this development build.
          Nearby prices and station selection are available in the list below.
        </Body>
      </View>
    );
  return (
    <View className="gap-2">
      <View className="h-80 overflow-hidden rounded-2xl border border-line">
        <MapView
          key={`${location.latitude},${location.longitude}`}
          ref={map}
          initialRegion={initialRegion ?? region}
          onRegionChangeComplete={onRegionChange}
          style={{ flex: 1 }}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
        >
          <Circle
            center={location}
            radius={8046.72}
            strokeColor="white"
            strokeWidth={5}
            fillColor="rgba(36,74,54,0.08)"
          />
          <Marker
            coordinate={location}
            title="Search centre"
            pinColor={colors.forest}
          />
          {stations.map((station) => {
            const band = stationPriceComparison(
              station.pricePence,
              median,
            ).band;
            const active = selected.includes(station.id);
            return (
              <Marker
                key={station.id}
                coordinate={station}
                zIndex={focused === station.id ? 2000 : active ? 1000 : 1}
                onPress={() => {
                  setFocused(station.id);
                  onSelect(station.id);
                }}
                accessibilityLabel={`${station.name}, ${station.pricePence?.toFixed(1) ?? "unknown"} pence per litre${active ? ", selected" : ""}`}
              >
                <View
                  className={`rounded-xl border-2 px-3 py-2 ${active ? "border-forest" : "border-white"} ${band === "low" ? "bg-low" : band === "high" ? "bg-high" : band === "typical" ? "bg-typical" : "bg-white"}`}
                >
                  <Text className="font-bold text-ink">
                    {active ? "✓ " : ""}
                    {station.pricePence?.toFixed(1) ?? "—"}p
                  </Text>
                </View>
              </Marker>
            );
          })}
        </MapView>
      </View>
      <Button
        variant="quiet"
        onPress={() => map.current?.animateToRegion(region, 0)}
      >
        Re-centre five-mile area
      </Button>
    </View>
  );
}
