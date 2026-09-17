import {
  pgTable,
  text,
  boolean,
  timestamp,
  doublePrecision,
  date,
  index,
  uniqueIndex,
  check,
  integer,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
const time = (name: string) => timestamp(name, { withTimezone: true });
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  phoneNumber: text("phone_number").unique(),
  phoneNumberVerified: boolean("phone_number_verified").default(false),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});
export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: time("expires_at").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);
export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: time("access_token_expires_at"),
    refreshTokenExpiresAt: time("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);
export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: time("expires_at").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: doublePrecision("last_request").notNull(),
});
export const driver = pgTable(
  "driver",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    vehicleName: text("vehicle_name").notNull(),
    tankCapacityLitres: doublePrecision("tank_capacity_litres").notNull(),
    currentLitres: doublePrecision("current_litres").notNull(),
    mpg: doublePrecision("mpg").notNull(),
    dailyMiles: doublePrecision("daily_miles").notNull(),
    mileageMode: text("mileage_mode", { enum: ["average", "weekly"] })
      .notNull()
      .default("average"),
    weekdayMiles: jsonb("weekday_miles")
      .$type<number[]>()
      .notNull()
      .default([20, 20, 20, 20, 20, 20, 20]),
    onboardingComplete: boolean("onboarding_complete").notNull().default(false),
    smsEnabled: boolean("sms_enabled").notNull().default(false),
    fuelUpdatedAt: time("fuel_updated_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "driver_fuel_bounds",
      sql`${t.currentLitres} >= 0 AND ${t.currentLitres} <= ${t.tankCapacityLitres}`,
    ),
    check(
      "driver_consumption_bounds",
      sql`${t.mpg} >= 10 AND ${t.dailyMiles} >= 0 AND ${t.tankCapacityLitres} >= 15`,
    ),
  ],
);
export const marketObservation = pgTable(
  "market_observation",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    date: date("date").notNull(),
    wholesalePence: doublePrecision("wholesale_pence").notNull(),
    retailPence: doublePrecision("retail_pence").notNull(),
    usdPerGbp: doublePrecision("usd_per_gbp").notNull(),
    disruption: boolean("disruption").notNull().default(false),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("market_source_date_idx").on(t.source, t.date)],
);
export const smsMessage = pgTable(
  "sms_message",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    phoneNumber: text("phone_number").notNull(),
    kind: text("kind", { enum: ["otp", "fill-alert"] }).notNull(),
    body: text("body").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    status: text("status", { enum: ["pending", "stubbed", "failed"] })
      .notNull()
      .default("pending"),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [index("sms_user_created_idx").on(t.userId, t.createdAt)],
);

// Provider observations are separate from legacy manually imported market observations.
export const futuresSettlement = pgTable(
  "futures_settlement",
  {
    product: text("product", { enum: ["B7H", "BZ"] }).notNull(),
    symbol: text("symbol").notNull(),
    date: date("date").notNull(),
    priceUsd: doublePrecision("price_usd").notNull(),
    expiresAt: time("expires_at").notNull(),
    publishedAt: time("published_at").notNull(),
    downloadedAt: time("downloaded_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.product, t.symbol, t.date] }),
    index("futures_date_idx").on(t.date),
  ],
);
export const exchangeRate = pgTable("exchange_rate", {
  date: date("date").primaryKey(),
  usdPerGbp: doublePrecision("usd_per_gbp").notNull(),
});
export const station = pgTable(
  "station",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    brand: text("brand").notNull(),
    address: text("address").notNull(),
    postcode: text("postcode").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    motorway: boolean("motorway").notNull(),
    closed: boolean("closed").notNull(),
    pricePence: doublePrecision("price_pence"),
    priceUpdatedAt: time("price_updated_at"),
    checkedAt: time("checked_at"),
  },
  (t) => [index("station_location_idx").on(t.latitude, t.longitude)],
);
export const trackedStation = pgTable(
  "tracked_station",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    stationId: text("station_id")
      .notNull()
      .references(() => station.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.stationId] })],
);
export const stationPrice = pgTable(
  "station_price",
  {
    stationId: text("station_id")
      .notNull()
      .references(() => station.id),
    observedAt: time("observed_at").notNull(),
    pricePence: doublePrecision("price_pence").notNull(),
  },
  (t) => [primaryKey({ columns: [t.stationId, t.observedAt] })],
);
export const nationalPrice = pgTable("national_price", {
  date: date("date").primaryKey(),
  source: text("source", { enum: ["fuel-finder", "sample"] })
    .notNull()
    .default("fuel-finder"),
  pricePence: doublePrecision("price_pence").notNull(),
  stationCount: integer("station_count").notNull(),
  observedAt: time("observed_at").notNull(),
});
export const dataJob = pgTable("data_job", {
  key: text("key").primaryKey(),
  status: text("status", { enum: ["running", "complete", "failed"] }).notNull(),
  startedAt: time("started_at").notNull(),
  finishedAt: time("finished_at"),
  error: text("error"),
});
export const syncState = pgTable("sync_state", {
  key: text("key").primaryKey(),
  syncedAt: time("synced_at").notNull(),
});

// Append-only observations preserve what was knowable at a forecast cutoff.
export const modelPumpEvent = pgTable(
  "model_pump_event",
  {
    stationId: text("station_id").notNull(),
    sourceAt: time("source_at").notNull(),
    receivedAt: time("received_at").notNull(),
    availableAt: time("available_at").notNull(),
    pricePence: doublePrecision("price_pence"),
    source: text("source").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.stationId, t.sourceAt, t.receivedAt] }),
    index("model_pump_available_idx").on(t.availableAt),
  ],
);

export const modelPrice = pgTable(
  "model_price",
  {
    frequency: text("frequency", { enum: ["daily", "weekly"] }).notNull(),
    date: date("date").notNull(),
    availableAt: time("available_at").notNull(),
    pricePence: doublePrecision("price_pence").notNull(),
    stationCount: integer("station_count"),
    source: text("source").notNull(),
    openStationPricePence: doublePrecision("open_station_price_pence"),
  },
  (t) => [primaryKey({ columns: [t.frequency, t.date] })],
);

export const modelSettlementEvent = pgTable(
  "model_settlement_event",
  {
    product: text("product", { enum: ["B7H", "BZ"] }).notNull(),
    symbol: text("symbol").notNull(),
    date: date("date").notNull(),
    publishedAt: time("published_at").notNull(),
    expiresAt: time("expires_at").notNull(),
    priceUsd: doublePrecision("price_usd").notNull(),
    deleted: boolean("deleted").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.product, t.symbol, t.date, t.publishedAt] }),
    index("model_settlement_date_idx").on(t.date),
  ],
);

export const modelFxRate = pgTable(
  "model_fx_rate",
  {
    date: date("date").notNull(),
    availableAt: time("available_at").notNull(),
    usdPerGbp: doublePrecision("usd_per_gbp").notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.availableAt] })],
);

export const forecastRun = pgTable(
  "forecast_run",
  {
    frequency: text("frequency", { enum: ["daily", "weekly"] }).notNull(),
    origin: time("origin").notNull(),
    modelVersion: text("model_version").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
    inputs: jsonb("inputs")
      .$type<Record<string, number | null | string>>()
      .notNull(),
    result: jsonb("result")
      .$type<
        | import("@pump-hawk/contracts").Forecast
        | import("@pump-hawk/contracts").WeeklyOutlook
      >()
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.frequency, t.origin, t.modelVersion] })],
);
