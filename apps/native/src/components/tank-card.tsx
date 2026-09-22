import { useEffect } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { Driver, Recommendation } from "@pump-hawk/openapi/types";
import { Body, Button, Card, Heading, Label } from "./ui";
import { colors } from "../lib/theme";
export function TankCard({
  car,
  advice,
}: {
  car: Driver;
  advice?: Recommendation | null;
}) {
  const litres = advice?.estimatedCurrentLitres ?? car.currentLitres;
  const fraction = Math.min(1, Math.max(0, litres / car.tankCapacityLitres));
  const progress = useSharedValue(fraction);
  useEffect(() => {
    progress.value = withTiming(fraction, { duration: 350 });
  }, [fraction, progress]);
  const style = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  return (
    <Card>
      <Heading>Your tank</Heading>
      <Body className="font-semibold text-ink">{car.vehicleName}</Body>
      <Label>
        {car.tankCapacityLitres}L tank · {car.mpg} UK MPG
      </Label>
      <View className="flex-row items-end justify-between">
        <Text className="text-4xl font-semibold text-ink">
          {Math.round(fraction * 100)}%
        </Text>
        <Body className="text-sm">
          {litres.toFixed(1)} / {car.tankCapacityLitres} litres
        </Body>
      </View>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Fuel in tank"
        accessibilityValue={{
          min: 0,
          max: car.tankCapacityLitres,
          now: litres,
        }}
        className="h-3 rounded-full overflow-hidden bg-line"
      >
        <Animated.View
          style={[{ height: "100%", backgroundColor: colors.forest }, style]}
        />
      </View>
      <Body className="text-sm">
        {advice?.daysOfFuel == null
          ? "Update your gauge to keep the plan useful."
          : `About ${advice.daysOfFuel.toFixed(1)} days of driving.`}{" "}
        {car.mileageMode === "weekly"
          ? "Using your weekly schedule."
          : `Based on ${car.dailyMiles.toFixed(1)} miles a day.`}
        {advice ? ` Keep ${advice.reserveLitres.toFixed(1)}L in reserve.` : ""}
      </Body>
      <Button variant="outline" onPress={() => router.push("/tank")}>
        Update tank level →
      </Button>
      <Button variant="quiet" onPress={() => router.push("/onboarding")}>
        Edit car and driving
      </Button>
    </Card>
  );
}
