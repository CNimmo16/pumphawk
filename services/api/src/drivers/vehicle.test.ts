import { describe, expect, it } from "vitest";
import { VehicleLookupInput } from "@pump-hawk/contracts";
import { parseVehicle } from "./vehicle.service";

export function vehicleFixture() {
  return {
    success: true,
    result: {
      vehicle_details: {
        vehicle_identification: {
          vehicle_registration_mark: "AB12CDE",
          dvla_manufacturer_desc: "FORD",
          dvla_model_desc: "FIESTA",
          dvla_fuel_desc: "PETROL",
          manufactured_year: 2012,
          vehicle_identification_number: "not-needed-by-pumphawk",
        },
      },
      model_details: {
        model_data: { ukvd_fuel_type_desc: "Petrol" },
        body_details: { fuel_capacity_litres: 42 },
        power_source: { power_source_vehicle_type: "ICE" },
        fuel_economy: { combined_litres_100km: 5.4, combined_mpg: 52.3 },
      },
    },
  };
}

describe("registration lookup", () => {
  it("accepts current, dateless and Northern Irish plates without imposing an age format", () => {
    for (const registrationNumber of ["ab12 cde", "A1", "123 ABC", "ABZ 1234"])
      expect(VehicleLookupInput.safeParse({ registrationNumber }).success).toBe(
        true,
      );
    for (const registrationNumber of [
      "",
      "12345",
      "ABCDEFG",
      "AB12<script>",
      "AB123456",
      "AB-12-CDE",
    ])
      expect(VehicleLookupInput.safeParse({ registrationNumber }).success).toBe(
        false,
      );
  });
  it("returns minimal specifications with explicitly imperial fuel economy", () => {
    const car = parseVehicle(vehicleFixture(), "AB12CDE");
    expect(car).toMatchObject({
      vehicleName: "FORD FIESTA",
      tankCapacityLitres: 42,
      mpg: 52.3,
      year: 2012,
    });
    expect(JSON.stringify(car)).not.toContain("not-needed-by-pumphawk");
  });
  it("does not invent missing or invalid capacity and MPG", () => {
    const data = vehicleFixture();
    data.result.model_details.body_details.fuel_capacity_litres = 0;
    data.result.model_details.fuel_economy = {
      combined_litres_100km: 0,
      combined_mpg: 0,
    };
    expect(parseVehicle(data, "AB12CDE")).toMatchObject({
      tankCapacityLitres: null,
      mpg: null,
    });
    expect(parseVehicle(data, "AB12CDE").warnings).toHaveLength(2);
  });
  it("rejects diesel/electric lookups rather than making petrol plans for them", () => {
    for (const fuel of ["DIESEL", "ELECTRICITY", "DIESEL HYBRID"]) {
      const data = vehicleFixture();
      data.result.vehicle_details.vehicle_identification.dvla_fuel_desc = fuel;
      data.result.model_details.model_data.ukvd_fuel_type_desc = fuel;
      expect(() => parseVehicle(data, "AB12CDE")).toThrow(/another fuel/);
    }
  });
  it("leaves hybrid MPG for the driver, even when published values fit the numeric limits", () => {
    const data = vehicleFixture();
    data.result.model_details.power_source.power_source_vehicle_type = "PHEV";
    expect(parseVehicle(data, "AB12CDE")).toMatchObject({
      mpg: null,
      tankCapacityLitres: 42,
    });
  });
  it("refuses a different plate and sanitises malformed upstream data", () => {
    expect(() => parseVehicle(vehicleFixture(), "XY12ABC")).toThrow(
      /unavailable/,
    );
    expect(() =>
      parseVehicle(
        { success: false, error: "private-provider-body" },
        "AB12CDE",
      ),
    ).toThrow(/unavailable/);
    expect(() =>
      parseVehicle({ success: true, result: null }, "AB12CDE"),
    ).toThrow(/unavailable/);
  });
});
