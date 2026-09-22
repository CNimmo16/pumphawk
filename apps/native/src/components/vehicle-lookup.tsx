import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  getVehicleLookupAvailabilityOptions,
  lookupVehicleMutation,
} from "@pump-hawk/openapi/react-query";
import type { VehicleLookup } from "@pump-hawk/openapi/types";
import { KeyboardController } from "react-native-keyboard-controller";
import { Body, Button, Card, ErrorNote, Field, Label } from "./ui";
import { errorMessage } from "../lib/api";
export function VehicleLookupForm({
  onApply,
}: {
  onApply: (car: VehicleLookup) => void;
}) {
  const [registration, setRegistration] = useState(""),
    [applied, setApplied] = useState(false);
  const availability = useQuery({
    ...getVehicleLookupAvailabilityOptions(),
    retry: false,
  });
  const lookup = useMutation(lookupVehicleMutation());
  if (!availability.data?.enabled)
    return (
      <Body className="text-sm">
        Enter your car details below. Registration lookup is currently
        unavailable.
      </Body>
    );
  const normalized = registration.replace(/ /g, "").toUpperCase();
  const valid = /^(?=.*[A-Z])(?=.*\d)[A-Z\d]{2,7}$/.test(normalized);
  const find = () => {
    if (valid) {
      void KeyboardController.dismiss();
      setApplied(false);
      lookup.mutate({ body: { registrationNumber: normalized } });
    }
  };
  return (
    <Card className="bg-paper">
      <Label>Find your car</Label>
      <Field
        label="UK registration"
        placeholder="AB12 CDE"
        maxLength={10}
        autoCapitalize="characters"
        autoCorrect={false}
        value={registration}
        onChangeText={(text) => {
          setRegistration(text.toUpperCase());
          lookup.reset();
          setApplied(false);
        }}
        returnKeyType="search"
        onSubmitEditing={find}
      />
      <Button
        variant="outline"
        disabled={!valid}
        loading={lookup.isPending}
        onPress={find}
      >
        Find my car
      </Button>
      <Body className="text-xs">
        Your registration goes to One Auto API to find specifications. We don’t
        save your plate. Manual entry is always available.
      </Body>
      {lookup.error && <ErrorNote message={errorMessage(lookup.error)} />}
      {lookup.data && (
        <>
          <Body className="font-semibold text-ink">
            {lookup.data.vehicleName}
          </Body>
          <Body className="text-sm">
            {[lookup.data.year, lookup.data.fuelType]
              .filter(Boolean)
              .join(" · ")}
            {"\n"}Tank:{" "}
            {lookup.data.tankCapacityLitres == null
              ? "enter manually"
              : `${lookup.data.tankCapacityLitres}L`}{" "}
            · Economy:{" "}
            {lookup.data.mpg == null
              ? "enter manually"
              : `${lookup.data.mpg} UK MPG`}
          </Body>
          {lookup.data.warnings.map((w) => (
            <Body key={w} className="text-xs">
              {w}
            </Body>
          ))}
          <Button
            disabled={applied}
            onPress={() => {
              onApply(lookup.data!);
              setApplied(true);
            }}
          >
            {applied ? "Details added — check below" : "Use these details"}
          </Button>
        </>
      )}
    </Card>
  );
}
