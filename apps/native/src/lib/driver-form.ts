import type { Driver, DriverInput, Station } from "@pump-hawk/openapi/types";
export const weekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
export type DriverDraft = {
  vehicleName: string;
  tankCapacityLitres: string;
  currentLitres: string;
  mpg: string;
  dailyMiles: string;
  mileageMode: "average" | "weekly";
  weekdayMiles: string[];
  smsEnabled: boolean;
};
export function initialDraft(driver?: Driver, litres?: number): DriverDraft {
  return {
    vehicleName: driver?.vehicleName ?? "My car",
    tankCapacityLitres: String(driver?.tankCapacityLitres ?? 50),
    currentLitres: (litres ?? driver?.currentLitres ?? 20).toFixed(1),
    mpg: String(driver?.mpg ?? 45),
    dailyMiles: String(driver?.dailyMiles ?? 20),
    mileageMode: driver?.mileageMode ?? "average",
    weekdayMiles:
      driver?.weekdayMiles?.map(String) ??
      Array(7).fill(String(driver?.dailyMiles ?? 20)),
    smsEnabled: driver?.smsEnabled ?? false,
  };
}
export function numberInput(
  value: string,
  label: string,
  min: number,
  max: number,
) {
  const clean = value.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(clean))
    throw new Error(`Enter ${label.toLowerCase()} as a number.`);
  const number = Number(clean);
  if (!Number.isFinite(number) || number < min || number > max)
    throw new Error(`${label} must be between ${min} and ${max}.`);
  return number;
}
export function parseDriver(draft: DriverDraft, carOnly = false): DriverInput {
  const vehicleName = draft.vehicleName.trim();
  if (!vehicleName || vehicleName.length > 60)
    throw new Error("Enter a car name of up to 60 characters.");
  const tankCapacityLitres = numberInput(
    draft.tankCapacityLitres,
    "Tank capacity",
    15,
    150,
  );
  const mpg = numberInput(draft.mpg, "UK MPG", 10, 150);
  const currentLitres = numberInput(
    draft.currentLitres,
    "Fuel in tank",
    0,
    tankCapacityLitres,
  );
  const weekly = draft.mileageMode === "weekly";
  const weekdayMiles =
    weekly && !carOnly
      ? weekdays.map((day, i) =>
          numberInput(draft.weekdayMiles[i] ?? "", `${day} mileage`, 0, 600),
        )
      : undefined;
  const dailyMiles = carOnly
    ? 0
    : weekly
      ? weekdayMiles!.reduce((sum, value) => sum + value, 0) / 7
      : numberInput(draft.dailyMiles, "Daily mileage", 0, 600);
  return {
    vehicleName,
    tankCapacityLitres,
    currentLitres,
    mpg,
    dailyMiles,
    mileageMode: draft.mileageMode,
    weekdayMiles,
    smsEnabled: draft.smsEnabled,
  };
}
export function sortedStations(
  stations: Station[],
  selected: string[],
  order: "distance" | "price",
) {
  return [...stations].sort((a, b) => {
    const selection =
      Number(selected.includes(b.id)) - Number(selected.includes(a.id));
    const distance =
      (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity);
    const price = (a.pricePence ?? Infinity) - (b.pricePence ?? Infinity);
    return (
      selection ||
      (order === "price" ? price || distance : distance || price) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id)
    );
  });
}
