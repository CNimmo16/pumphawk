import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { KeyboardController } from "react-native-keyboard-controller";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateTankMutation } from "@pump-hawk/openapi/react-query";
import { useDashboard } from "../src/lib/queries";
import { errorMessage } from "../src/lib/api";
import { numberInput } from "../src/lib/driver-form";
import { colors } from "../src/lib/theme";
import { Screen } from "../src/components/screen";
import {
  Body,
  Button,
  Card,
  ErrorNote,
  Field,
  Heading,
  Skeleton,
} from "../src/components/ui";
export default function Tank() {
  const data = useDashboard();
  if (data.loadingAdvice)
    return (
      <Screen>
        <Skeleton label="Loading tank level" />
      </Screen>
    );
  if (data.session.error)
    return (
      <Screen>
        <ErrorNote
          message={errorMessage(data.session.error)}
          retry={() => void data.session.refetch()}
        />
      </Screen>
    );
  if (!data.signedIn) return <Redirect href="/sign-in" />;
  if (data.onboarding) return <Redirect href="/onboarding" />;
  if (!data.car)
    return (
      <Screen>
        <ErrorNote
          message={errorMessage(data.failure)}
          retry={() => void data.driver.refetch()}
        />
      </Screen>
    );
  return (
    <TankForm
      capacity={data.car.tankCapacityLitres}
      current={data.advice?.estimatedCurrentLitres ?? data.car.currentLitres}
    />
  );
}
function TankForm({
  capacity,
  current,
}: {
  capacity: number;
  current: number;
}) {
  const [value, setValue] = useState(current.toFixed(1)),
    [error, setError] = useState("");
  const cache = useQueryClient();
  const save = useMutation({
    ...updateTankMutation(),
    onSuccess: async () => {
      await cache.invalidateQueries();
      if (router.canGoBack()) router.back();
      else router.replace("/");
    },
  });
  function submit() {
    setError("");
    void KeyboardController.dismiss();
    try {
      save.mutate({
        body: {
          currentLitres: numberInput(value, "Fuel in tank", 0, capacity),
        },
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <Screen form>
      <Heading>How full is your tank?</Heading>
      <Body>
        Check your gauge and give us your best estimate. We’ll update your plan
        from this reading.
      </Body>
      <Card>
        <FuelSlider
          capacity={capacity}
          value={Number(value.replace(",", ".")) || 0}
          onChange={(n) => setValue(n.toFixed(1))}
        />
        <View className="flex-row flex-wrap gap-2">
          {[0.25, 0.5, 0.75, 1].map((fraction) => (
            <Button
              key={fraction}
              variant="outline"
              onPress={() => setValue((capacity * fraction).toFixed(1))}
            >
              {fraction === 1 ? "Full" : `${fraction * 100}%`}
            </Button>
          ))}
        </View>
        <Field
          label="Fuel in tank now"
          keyboardType="decimal-pad"
          unit="litres"
          value={value}
          onChangeText={setValue}
        />
        <Body className="text-sm">Tank capacity: {capacity} litres</Body>
        {(error || save.error) && (
          <ErrorNote message={error || errorMessage(save.error)} />
        )}
        <Button loading={save.isPending} onPress={submit}>
          Save tank level
        </Button>
      </Card>
    </Screen>
  );
}
function FuelSlider({
  capacity,
  value,
  onChange,
}: {
  capacity: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const [width, setWidth] = useState(280);
  const fraction = useSharedValue(Math.min(1, Math.max(0, value / capacity)));
  useEffect(() => {
    fraction.value = withTiming(Math.min(1, Math.max(0, value / capacity)), {
      duration: 80,
    });
  }, [value, capacity, fraction]);
  const fill = useAnimatedStyle(() => ({ width: `${fraction.value * 100}%` }));
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: fraction.value * (width - 28) }],
  }));
  const choose = (x: number) =>
    onChange(
      Math.round(
        Math.max(0, Math.min(1, (x - 14) / (width - 28))) * capacity * 10,
      ) / 10,
    );
  const pan = Gesture.Pan()
    .activeOffsetX([-5, 5])
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
    <View className="gap-2">
      <Text className="text-4xl font-semibold text-ink">
        {Math.round((Math.min(capacity, Math.max(0, value)) / capacity) * 100)}%
      </Text>
      <GestureDetector gesture={Gesture.Race(pan, tap)}>
        <View
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Tank level"
          accessibilityValue={{
            min: 0,
            max: capacity,
            now: Math.min(capacity, Math.max(0, value)),
            text: `${value.toFixed(1)} litres`,
          }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(e) =>
            onChange(
              Math.min(
                capacity,
                Math.max(
                  0,
                  value + (e.nativeEvent.actionName === "increment" ? 1 : -1),
                ),
              ),
            )
          }
          className="h-14 justify-center"
        >
          <View className="h-3 rounded-full overflow-hidden bg-line">
            <Animated.View
              style={[{ height: "100%", backgroundColor: colors.forest }, fill]}
            />
          </View>
          <Animated.View
            style={[
              {
                position: "absolute",
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: colors.forest,
                borderWidth: 3,
                borderColor: "white",
              },
              thumb,
            ]}
          />
        </View>
      </GestureDetector>
      <View className="flex-row justify-between">
        <Body className="text-xs">Empty</Body>
        <Body className="text-xs">Full</Body>
      </View>
    </View>
  );
}
