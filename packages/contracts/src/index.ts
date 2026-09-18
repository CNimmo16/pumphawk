import { z } from "@hono/zod-openapi";
export { z };
export const ErrorSchema = z
  .object({ error: z.object({ code: z.string(), message: z.string() }) })
  .openapi("ApiError");
export const DriverInput = z
  .object({
    vehicleName: z.string().trim().min(1).max(60).default("My car"),
    tankCapacityLitres: z.number().min(15).max(150),
    currentLitres: z.number().min(0).max(150),
    mpg: z.number().min(10).max(150).describe("UK imperial miles per gallon"),
    dailyMiles: z.number().min(0).max(600),
    smsEnabled: z.boolean(),
    mileageMode: z.enum(["average", "weekly"]).optional(),
    weekdayMiles: z
      .array(z.number().min(0).max(600))
      .length(7)
      .optional()
      .describe("Monday through Sunday"),
  })
  .refine((d) => d.mileageMode !== "weekly" || !!d.weekdayMiles, {
    message: "Enter mileage for all seven days",
    path: ["weekdayMiles"],
  })
  .refine((d) => d.currentLitres <= d.tankCapacityLitres, {
    message: "Fuel cannot exceed tank capacity",
    path: ["currentLitres"],
  })
  .openapi("DriverInput");
export const DriverSchema = DriverInput.safeExtend({
  onboardingComplete: z.boolean().optional(),
  fuelUpdatedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).openapi("Driver");
export const ObservationSchema = z
  .object({
    date: z.iso.date(),
    wholesalePence: z
      .number()
      .min(1)
      .max(500)
      .describe("Refined petrol wholesale price in GBP pence/litre"),
    retailPence: z.number().min(30).max(600),
    usdPerGbp: z.number().min(0.3).max(3),
    disruption: z.boolean().default(false),
  })
  .openapi("MarketObservation");
export const IngestSchema = z
  .object({
    source: z.string().regex(/^[a-z0-9-]{2,50}$/),
    observations: z.array(ObservationSchema).min(1).max(90),
  })
  .openapi("MarketIngestion");
export const SignalBreakdownSchema = z.object({
  name: z.enum(["pump", "b7h", "crude", "baseline"]),
  label: z.string(),
  weight: z.number().optional(),
  contributionPence: z.number(),
  detail: z.string(),
  available: z.boolean(),
});
export const ForecastPointSchema = z.object({
  date: z.iso.date(),
  pricePence: z.number(),
  lowPence: z.number(),
  highPence: z.number(),
  confidence: z.enum(["low", "medium"]).optional(),
  signals: z.array(SignalBreakdownSchema).optional(),
});
export const ForecastSchema = z
  .object({
    asOf: z.iso.date(),
    generatedAt: z.iso.datetime(),
    source: z.string(),
    mode: z.enum(["demo", "live", "sample"]),
    model: z.enum(["daily-ridge", "heuristic"]).optional(),
    modelVersion: z.string().optional(),
    adviceHorizonDays: z.number().int().optional(),
    snapshotAt: z.iso.datetime().optional(),
    series: z.string().optional(),
    openStationPricePence: z.number().nullable().optional(),
    fuelType: z.literal("petrol"),
    currency: z.literal("GBP"),
    unit: z.literal("pence/litre"),
    currentPricePence: z.number(),
    wholesalePence: z.number().nullable(),
    wholesaleChangePercent: z.number().nullable(),
    usdPerGbp: z.number().nullable(),
    direction: z.enum(["falling", "rising", "steady"]),
    signal: z.enum(["falling", "rising", "disruption", "fx-shock", "steady"]),
    consecutiveFallingDays: z.number(),
    history: z.array(
      z.object({
        date: z.iso.date(),
        pricePence: z.number(),
        wholesalePence: z.number().nullable(),
        source: z.enum(["fuel-finder", "sample"]).optional(),
      }),
    ),
    points: z.array(ForecastPointSchema),
    explanation: z.string(),
    methodology: z.string(),
    warnings: z.array(z.string()),
  })
  .openapi("Forecast");
export const WeeklyOutlookSchema = z
  .object({
    model: z.literal("weekly-huber"),
    modelVersion: z.string(),
    generatedAt: z.iso.datetime(),
    issuedAt: z.iso.datetime(),
    referenceDate: z.iso.date(),
    series: z.literal("Official DESNZ sales-weighted petrol"),
    unit: z.literal("pence/litre"),
    history: z.array(z.object({ date: z.iso.date(), pricePence: z.number() })),
    points: z.array(ForecastPointSchema),
    warnings: z.array(z.string()),
  })
  .openapi("WeeklyOutlook");
export type WeeklyOutlook = z.infer<typeof WeeklyOutlookSchema>;
export const RecommendationSchema = z
  .object({
    action: z.enum(["wait", "top-up", "fill-now", "hold", "update-tank"]),
    title: z.string(),
    reason: z.string(),
    litresToBuy: z.number(),
    estimatedCostGbp: z.number(),
    estimatedSavingsGbp: z.number(),
    priceSignal: z
      .enum(["daily", "weekly"])
      .optional()
      .describe(
        "Forecast supplying the price-timing decision. Weekly savings use the change within the official benchmark, not a local station quote.",
      ),
    fillDate: z.iso.date(),
    nextFillDate: z.iso.date(),
    estimatedCurrentLitres: z.number(),
    reserveLitres: z.number(),
    daysOfFuel: z.number().nullable(),
    targetPricePence: z.number(),
    tips: z.array(z.string()),
  })
  .openapi("Recommendation");
export const DashboardSchema = z
  .object({
    driver: DriverSchema,
    forecast: ForecastSchema.nullable(),
    recommendation: RecommendationSchema.nullable(),
    forecastError: z.string().optional(),
  })
  .openapi("Dashboard");
export const SmsSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["otp", "fill-alert"]),
    body: z.string(),
    status: z.enum(["pending", "stubbed", "failed"]),
    createdAt: z.iso.datetime(),
  })
  .openapi("SmsMessage");
export const GoogleSignInSchema = z
  .object({
    provider: z.literal("google"),
    callbackURL: z
      .string()
      .optional()
      .describe("App URL after success, normally /"),
    errorCallbackURL: z
      .string()
      .optional()
      .describe("App URL after cancellation or failure"),
    disableRedirect: z.boolean().optional(),
  })
  .openapi("GoogleSignIn");
export type DriverInputType = z.infer<typeof DriverInput>;
export type Driver = z.infer<typeof DriverSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type Forecast = z.infer<typeof ForecastSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;

export const LocationSchema = z.object({
  latitude: z.number().min(49).max(61),
  longitude: z.number().min(-9).max(2),
});
export const StationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    brand: z.string(),
    address: z.string(),
    postcode: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    motorway: z.boolean(),
    closed: z.boolean(),
    pricePence: z.number().nullable(),
    priceUpdatedAt: z.iso.datetime().nullable(),
    checkedAt: z.iso.datetime().nullable(),
    distanceMiles: z.number().optional(),
  })
  .openapi("Station");
export const NearbySchema = z
  .object({
    stations: z.array(StationSchema),
    radiusMiles: z.literal(5),
    checkedAt: z.iso.datetime().nullable(),
  })
  .openapi("NearbyStations");
export const TrackedSchema = z
  .object({
    stations: z.array(
      StationSchema.extend({
        history: z.array(
          z.object({ observedAt: z.iso.datetime(), pricePence: z.number() }),
        ),
      }),
    ),
    since: z.iso.datetime(),
  })
  .openapi("TrackedStations");
export const OnboardingSchema = z
  .object({
    driver: DriverInput,
    location: LocationSchema,
    stationIds: z.array(z.string().min(1).max(100)).min(1).max(3),
  })
  .refine((v) => new Set(v.stationIds).size === v.stationIds.length, {
    message: "Choose different stations",
    path: ["stationIds"],
  })
  .openapi("OnboardingInput");
export const TankInput = z
  .object({ currentLitres: z.number().min(0).max(150) })
  .openapi("TankInput");
export type Station = z.infer<typeof StationSchema>;

export const VehicleLookupInput = z
  .object({
    registrationNumber: z
      .string()
      .trim()
      .min(2)
      .max(10)
      .regex(
        /^(?=.*[a-z])(?=.*\d)[a-z\d ]+$/i,
        "Enter a UK registration number.",
      )
      .refine(
        (v) => v.replace(/ /g, "").length <= 7,
        "Enter a UK registration number.",
      ),
  })
  .openapi("VehicleLookupInput");
export const VehicleLookupSchema = z
  .object({
    registrationNumber: z.string(),
    vehicleName: z.string().min(1).max(60),
    fuelType: z.string().nullable(),
    year: z.number().int().nullable(),
    tankCapacityLitres: z.number().min(15).max(150).nullable(),
    mpg: z.number().min(10).max(150).nullable(),
    warnings: z.array(z.string()),
    source: z.literal("UK Vehicle Data via One Auto API"),
  })
  .openapi("VehicleLookup");
export const VehicleLookupAvailabilitySchema = z
  .object({
    enabled: z.boolean(),
  })
  .openapi("VehicleLookupAvailability");
