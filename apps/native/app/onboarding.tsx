import { useState } from "react";
import { Text, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  saveDriverMutation,
  saveOnboardingMutation,
  updateTrackedStationsMutation,
} from "@pump-hawk/openapi/react-query";
import type { Driver, Station } from "@pump-hawk/openapi/types";
import { KeyboardController } from "react-native-keyboard-controller";
import { FadeInDown, ReduceMotion } from "react-native-reanimated";
import { useDashboard } from "../src/lib/queries";
import { errorMessage } from "../src/lib/api";
import {
  initialDraft,
  parseDriver,
  weekdays,
  type DriverDraft,
} from "../src/lib/driver-form";
import { Screen } from "../src/components/screen";
import {
  Body,
  Button,
  Card,
  ErrorNote,
  Field,
  Heading,
  Label,
  MotionView,
  Skeleton,
} from "../src/components/ui";
import { VehicleLookupForm } from "../src/components/vehicle-lookup";
import { StationPicker } from "../src/components/station-picker";
import type { Location } from "../src/components/station-map";
export default function Onboarding() {
  const data = useDashboard(),
    params = useLocalSearchParams<{ step?: string }>();
  if (
    data.session.isPending ||
    (data.signedIn &&
      (data.driver.isPending ||
        data.tracked.isPending ||
        (!!data.driver.data && data.personal.isPending)))
  )
    return (
      <Screen>
        <Skeleton label="Loading your settings" />
      </Screen>
    );
  if (data.failure)
    return (
      <Screen>
        <ErrorNote
          message={errorMessage(data.failure)}
          retry={() => void data.retryAdvice()}
        />
      </Screen>
    );
  if (!data.signedIn) return <Redirect href="/sign-in" />;
  if (data.tracked.isError)
    return (
      <Screen>
        <ErrorNote
          message={errorMessage(data.tracked.error)}
          retry={() => void data.tracked.refetch()}
        />
      </Screen>
    );
  return (
    <OnboardingForm
      key={data.session.data?.user.id}
      driver={data.car}
      currentLitres={data.advice?.estimatedCurrentLitres}
      trackedStations={data.tracked.data?.stations ?? []}
      initialStep={
        params.step === "stations" && data.car?.onboardingComplete ? 2 : 0
      }
    />
  );
}
function OnboardingForm({
  driver,
  currentLitres,
  trackedStations,
  initialStep,
}: {
  driver?: Driver;
  currentLitres?: number;
  trackedStations: Station[];
  initialStep: number;
}) {
  const [draft, setDraft] = useState(() => initialDraft(driver, currentLitres));
  const [savedStations] = useState(trackedStations);
  const [editedCar, setEditedCar] = useState(false);
  const [step, setStep] = useState(initialStep),
    [error, setError] = useState(""),
    [location, setLocation] = useState<Location | null>(null),
    [selected, setSelected] = useState(() => savedStations.map((s) => s.id)),
    [ready, setReady] = useState(false);
  const keepingStations =
    !!driver?.onboardingComplete &&
    selected.length > 0 &&
    selected.length === savedStations.length &&
    savedStations.every((station) => selected.includes(station.id));
  const cache = useQueryClient();
  const complete = async () => {
    await cache.invalidateQueries();
    router.dismissAll();
    router.replace("/");
  };
  const save = useMutation({
    ...saveOnboardingMutation(),
    onSuccess: complete,
  });
  const stationsOnly = initialStep === 2 && step === 2 && !editedCar;
  const stationsSave = useMutation({
    ...updateTrackedStationsMutation(),
    onSuccess: complete,
  });
  const update = useMutation({ ...saveDriverMutation(), onSuccess: complete });
  const change = <K extends keyof DriverDraft>(key: K, value: DriverDraft[K]) =>
    setDraft((old) => ({ ...old, [key]: value }));
  const numeric = (
    key: "tankCapacityLitres" | "currentLitres" | "mpg" | "dailyMiles",
    label: string,
    unit: string,
  ) => (
    <Field
      label={label}
      unit={unit}
      keyboardType="decimal-pad"
      value={draft[key]}
      onChangeText={(value) => change(key, value)}
    />
  );
  async function next() {
    setError("");
    void KeyboardController.dismiss();
    try {
      if (stationsOnly) {
        if (keepingStations) {
          await complete();
          return;
        }
        if (!location || !ready)
          throw new Error("Find a location and choose your stations.");
        stationsSave.mutate({ body: { location, stationIds: selected } });
        return;
      }
      const driver = parseDriver(draft, step === 0);
      if (step < 2) {
        setStep(step + 1);
        return;
      }
      if (keepingStations) {
        update.mutate({ body: driver });
        return;
      }
      if (!location || !ready)
        throw new Error(
          "Find a location and choose one to three nearby stations.",
        );
      save.mutate({ body: { driver, location, stationIds: selected } });
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  function saveCar() {
    setError("");
    void KeyboardController.dismiss();
    try {
      update.mutate({ body: parseDriver(draft) });
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const submitting =
    save.isPending || update.isPending || stationsSave.isPending;
  const footer = (
    <>
      {(error || save.error || update.error || stationsSave.error) && (
        <ErrorNote
          message={
            error ||
            errorMessage(save.error ?? update.error ?? stationsSave.error)
          }
        />
      )}
      {step === 2 && (
        <Body className="text-xs">
          {selected.length
            ? `${selected.length} of 3 regular stops selected`
            : "Choose one to three stations to continue."}
        </Body>
      )}
      <View className="flex-row items-center gap-3">
        {step > 0 && (
          <Button
            variant="outline"
            disabled={submitting}
            onPress={() => {
              void KeyboardController.dismiss();
              setEditedCar(true);
              setStep(step - 1);
              setError("");
            }}
          >
            Back
          </Button>
        )}
        <View className="flex-1">
          <Button
            loading={submitting}
            disabled={step === 2 && !ready && !keepingStations}
            onPress={next}
          >
            {step === 2
              ? keepingStations
                ? "Keep my regular stops"
                : "Save my regular stops"
              : "Continue"}
          </Button>
        </View>
      </View>
      {step === 1 && driver?.onboardingComplete && (
        <Button
          variant="quiet"
          loading={update.isPending}
          disabled={submitting}
          onPress={saveCar}
        >
          Save car and keep my stations
        </Button>
      )}
    </>
  );
  return (
    <Screen form footer={footer}>
      <View className="flex-row gap-2">
        {["Car", "Driving", "Stations"].map((name, index) => (
          <View
            key={name}
            className={`flex-1 rounded-xl p-3 ${index === step ? "bg-forest" : "bg-line"}`}
          >
            <Text
              className={`text-xs font-semibold text-center ${index === step ? "text-white" : "text-muted"}`}
            >
              {index < step ? "✓" : index + 1} {name}
            </Text>
          </View>
        ))}
      </View>
      <MotionView
        key={step}
        entering={FadeInDown.duration(220).reduceMotion(ReduceMotion.System)}
        className="gap-5"
      >
        <Label>Step {step + 1} of 3</Label>
        <Heading>
          {
            [
              "A little about your car.",
              "What does your week look like?",
              "Find your regular stops.",
            ][step]
          }
        </Heading>
        <Body>
          {
            [
              "Check your tank size and real-world fuel economy. You can adjust these later.",
              "Estimate your usual miles. We’ll use this to plan how much petrol you need.",
              "Choose up to three stations within five miles. We’ll track their E10 prices every hour.",
            ][step]
          }
        </Body>
        {step === 0 && (
          <>
            <VehicleLookupForm
              onApply={(car) =>
                setDraft((old) => ({
                  ...old,
                  vehicleName: car.vehicleName,
                  tankCapacityLitres:
                    car.tankCapacityLitres == null
                      ? ""
                      : String(car.tankCapacityLitres),
                  mpg: car.mpg == null ? "" : String(car.mpg),
                }))
              }
            />
            <Card>
              <Field
                label="Car name"
                maxLength={60}
                value={draft.vehicleName}
                onChangeText={(value) => change("vehicleName", value)}
              />
              {numeric("tankCapacityLitres", "Tank capacity", "litres")}
              {numeric("mpg", "Average fuel economy", "UK MPG")}
              {numeric("currentLitres", "Fuel in tank now", "litres")}
              <Body className="text-xs">
                Use your current gauge reading. UK MPG uses imperial gallons.
              </Body>
            </Card>
          </>
        )}
        {step === 1 && (
          <Card>
            <Button
              variant={draft.mileageMode === "average" ? "primary" : "outline"}
              onPress={() => change("mileageMode", "average")}
            >
              Daily average
            </Button>
            <Button
              variant={draft.mileageMode === "weekly" ? "primary" : "outline"}
              onPress={() => change("mileageMode", "weekly")}
            >
              By day of the week
            </Button>
            {draft.mileageMode === "average"
              ? numeric("dailyMiles", "Average miles per day", "miles")
              : weekdays.map((day, i) => (
                  <Field
                    key={day}
                    label={day}
                    unit="miles"
                    keyboardType="decimal-pad"
                    value={draft.weekdayMiles[i]}
                    onChangeText={(value) =>
                      change(
                        "weekdayMiles",
                        draft.weekdayMiles.map((miles, index) =>
                          index === i ? value : miles,
                        ),
                      )
                    }
                  />
                ))}
          </Card>
        )}
        {step === 2 && (
          <Card>
            <StationPicker
              savedStations={savedStations}
              location={location}
              selected={selected}
              onLocation={setLocation}
              onSelected={setSelected}
              onReady={setReady}
            />
          </Card>
        )}
      </MotionView>
    </Screen>
  );
}
