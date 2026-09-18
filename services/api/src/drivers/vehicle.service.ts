import { sql } from "drizzle-orm";
import {
  VehicleLookupInput,
  VehicleLookupSchema,
  z,
} from "@pump-hawk/contracts";
import type { Config } from "../app/config";
import { AppError } from "../app/errors";
import { providerText, type HttpClient } from "../data/http";
import { DbService } from "../lib/db/db.service";
import { rateLimit } from "../lib/db/schema";

// Only the fields used for onboarding are retained. VINs, keeper/plate history,
// raw provider payloads and the submitted registration are never persisted.
const text = z.string().nullish();
const numeric = z.union([z.number(), z.string()]).nullish();
const ProviderSchema = z.object({
  success: z.boolean(),
  result: z
    .object({
      vehicle_details: z
        .object({
          vehicle_identification: z
            .object({
              vehicle_registration_mark: text,
              dvla_manufacturer_desc: text,
              dvla_model_desc: text,
              dvla_fuel_desc: text,
              manufactured_year: numeric,
            })
            .nullish(),
        })
        .nullish(),
      model_details: z
        .object({
          model_data: z
            .object({
              manufacturer_desc: text,
              model_range_desc: text,
              model_desc: text,
              ukvd_fuel_type_desc: text,
            })
            .nullish(),
          body_details: z.object({ fuel_capacity_litres: numeric }).nullish(),
          power_source: z.object({ power_source_vehicle_type: text }).nullish(),
          fuel_economy: z
            .object({ combined_litres_100km: numeric, combined_mpg: numeric })
            .nullish(),
        })
        .nullish(),
    })
    .nullish(),
});
const clean = (value: string | null | undefined) => value?.trim() || null;
const number = (value: unknown, min: number, max: number) => {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim()))
    return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const unavailable = () =>
  new AppError(
    "VEHICLE_LOOKUP_UNAVAILABLE",
    "Car lookup is unavailable right now. You can enter your details manually.",
    503,
  );
const notFound = () =>
  new AppError(
    "VEHICLE_NOT_FOUND",
    "We couldn’t find that registration. Check it or enter your car details manually.",
    404,
  );

// Schema/units: https://www.oneautoapi.com/service/uk-vehicle-data-vehicle-and-model-details-from-vrm-vin/
export function parseVehicle(payload: unknown, registration: string) {
  const parsed = ProviderSchema.safeParse(payload);
  if (!parsed.success || !parsed.data.success) throw unavailable();
  const data = parsed.data.result;
  const identity = data?.vehicle_details?.vehicle_identification;
  const model = data?.model_details;
  const returnedPlate = clean(identity?.vehicle_registration_mark)
    ?.replace(/ /g, "")
    .toUpperCase();
  // Never fill another vehicle's specifications after an upstream mismatch.
  if (!returnedPlate || returnedPlate !== registration) throw unavailable();
  const make =
    clean(identity?.dvla_manufacturer_desc) ??
    clean(model?.model_data?.manufacturer_desc);
  const name =
    clean(identity?.dvla_model_desc) ??
    [model?.model_data?.model_range_desc, model?.model_data?.model_desc]
      .filter(Boolean)
      .join(" ")
      .trim();
  if (!make || !name) throw notFound();
  const fuelType =
    clean(model?.model_data?.ukvd_fuel_type_desc) ??
    clean(identity?.dvla_fuel_desc);
  const fuel = [
    identity?.dvla_fuel_desc,
    model?.model_data?.ukvd_fuel_type_desc,
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  const petrol = /PETROL|GASOLINE/.test(fuel);
  if (
    /DIESEL|HYDROGEN|LPG|CNG/.test(fuel) ||
    (!petrol && /ELECTRIC/.test(fuel))
  )
    throw new AppError(
      "VEHICLE_FUEL_UNSUPPORTED",
      "Pump Hawk currently forecasts petrol prices. This vehicle uses another fuel.",
      422,
    );
  const hybrid =
    /HYBRID|PHEV|HEV/.test(
      `${fuel} ${model?.power_source?.power_source_vehicle_type ?? ""}`.toUpperCase(),
    ) ||
    (petrol && /ELECTRIC/.test(fuel));
  const tank = number(model?.body_details?.fuel_capacity_litres, 15, 150);
  const economy = model?.fuel_economy;
  // Convert litres/100 km explicitly to imperial MPG; never assume US gallons.
  const litres100km = number(economy?.combined_litres_100km, 1, 100);
  const combined = litres100km
    ? 282.4809363 / litres100km
    : number(economy?.combined_mpg, 10, 150);
  const mpg = petrol && !hybrid ? number(combined, 10, 150) : null;
  const warnings: string[] = [];
  if (!petrol)
    warnings.push(
      "Check that your car runs on petrol and is suitable for E10.",
    );
  if (tank === null)
    warnings.push(
      "Tank capacity wasn’t available. Please enter it from your car’s handbook.",
    );
  if (mpg === null)
    warnings.push(
      hybrid
        ? "For a hybrid, enter your observed petrol MPG; published combined figures include electric driving."
        : "Fuel economy wasn’t available. Please enter your average UK MPG.",
    );
  else
    warnings.push(
      "Fuel economy is a published combined figure. Adjust it to your real-world UK MPG.",
    );
  const year = number(identity?.manufactured_year, 1900, 2100);
  return VehicleLookupSchema.parse({
    registrationNumber: registration,
    vehicleName: `${make} ${name}`.slice(0, 60),
    fuelType,
    year: year !== null && Number.isInteger(year) ? year : null,
    tankCapacityLitres: tank,
    mpg: mpg === null ? null : Math.round(mpg * 10) / 10,
    warnings,
    source: "UK Vehicle Data via One Auto API",
  });
}

export class VehicleService {
  static inject = ["config", "dbService", "httpClient", "clock"] as const;
  constructor(
    private config: Config,
    private store: DbService,
    private http: HttpClient,
    private clock: () => Date,
  ) {}
  get enabled() {
    return Boolean(this.config.oneAutoApiKey);
  }

  async lookup(userId: string, input: z.infer<typeof VehicleLookupInput>) {
    const { registrationNumber } = VehicleLookupInput.parse(input);
    const registration = registrationNumber.replace(/ /g, "").toUpperCase();
    if (!this.enabled) throw unavailable();
    const now = this.clock().getTime();
    const dayStart = Math.floor(now / 86_400_000) * 86_400_000;
    // Atomic across Worker instances. Reuses the auth rate-limit table with a
    // distinct namespace and one row per user; no registration numbers stored.
    const permitted = await this.store.db
      .insert(rateLimit)
      .values({
        id: crypto.randomUUID(),
        key: `vehicle-lookup:${userId}`,
        count: 1,
        lastRequest: now,
      })
      .onConflictDoUpdate({
        target: rateLimit.key,
        set: {
          count: sql`CASE WHEN ${rateLimit.lastRequest} < ${dayStart} THEN 1 ELSE ${rateLimit.count} + 1 END`,
          lastRequest: now,
        },
        setWhere: sql`${rateLimit.lastRequest} < ${dayStart} OR ${rateLimit.count} < 10`,
      })
      .returning({ id: rateLimit.id });
    if (!permitted.length)
      throw new AppError(
        "VEHICLE_LOOKUP_LIMIT",
        "You’ve reached today’s limit of 10 car lookups. Enter your details manually or try again tomorrow.",
        429,
      );
    const url = new URL(
      "https://api.oneautoapi.com/ukvehicledata/vehicleandmodeldetailsfromvrm",
    );
    url.searchParams.set("vehicle_registration_mark", registration);
    try {
      const body = await providerText(
        async (request, init) => {
          const response = await this.http(request, init);
          if ([204, 404].includes(response.status)) {
            await response.body?.cancel();
            throw notFound();
          }
          // 202/206 are incomplete; no guessed or partial specifications.
          if (response.status !== 200) {
            await response.body?.cancel();
            throw unavailable();
          }
          return response;
        },
        url.toString(),
        {
          headers: {
            "x-api-key": this.config.oneAutoApiKey!,
            Accept: "application/json",
          },
        },
        256_000,
        10_000,
      );
      return parseVehicle(JSON.parse(body), registration);
    } catch (error) {
      // Do not propagate upstream URLs, keys, plates, bodies or thrown causes
      // into PostHog or browser messages. No automatic retries of paid calls.
      if (error instanceof AppError && [404, 422].includes(error.status))
        throw error;
      throw unavailable();
    }
  }
}
