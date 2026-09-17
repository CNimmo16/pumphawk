import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  dataJob,
  nationalPrice,
  station,
  syncState,
  modelPumpEvent,
  modelPrice,
  modelSettlementEvent,
  modelFxRate,
  forecastRun,
} from "../lib/db/schema";
import { sql } from "drizzle-orm";
import { createDb } from "../lib/db/db.service";
import { createApp } from "./app";
import { buildInjector } from "./injector";
import { ConfigSchema, type Config } from "./config";
import { demoObservations, isoDay } from "../pricing/forecast";
import { seedSampleHistory } from "../pricing/sample-history";
import {
  DashboardSchema,
  ForecastSchema,
  SmsSchema,
  z,
} from "@pump-hawk/contracts";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://pumphawk:pumphawk@127.0.0.1:55435/pumphawk_test";
if (!new URL(databaseUrl).pathname.endsWith("_test"))
  throw new Error(
    "Integration tests require a dedicated database ending in _test.",
  );
const db = createDb(databaseUrl),
  now = new Date();
const config: Config = {
  environment: "test",
  appOrigin: "http://localhost:3100",
  authUrl: "http://localhost:3100",
  authSecret: "test-secret-longer-than-32-characters",
  ingestApiKey: "test-ingestion-key-longer-than-24",
  databaseUrl,
  marketDataMode: "demo",
  marketSource: "provider",
};
const app = createApp({ config, clock: () => now });
const headers = {
  "content-type": "application/json",
  origin: config.appOrigin,
  "cf-connecting-ip": "127.0.0.1",
};
let cookie = "",
  secondCookie = "";
const car = {
  vehicleName: "Test hatchback",
  tankCapacityLitres: 50,
  currentLitres: 5,
  mpg: 45,
  dailyMiles: 20,
  smsEnabled: true,
};
const req = (path: string, method = "GET", body?: unknown, session = cookie) =>
  app.request("http://localhost:3100" + path, {
    method,
    headers: { ...headers, ...(session ? { cookie: session } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
async function login(phone: string) {
  const sent = await req(
    "/api/auth/phone-number/send-otp",
    "POST",
    { phoneNumber: phone },
    "",
  );
  expect(sent.status, await sent.clone().text()).toBe(200);
  const msg = await db.query.smsMessage.findFirst({
    where: { phoneNumber: phone, kind: "otp" },
    orderBy: { createdAt: "desc" },
  });
  expect(msg?.status).toBe("stubbed");
  const code = msg!.body.match(/\b\d{6}\b/)![0];
  const verified = await req(
    "/api/auth/phone-number/verify",
    "POST",
    { phoneNumber: phone, code },
    "",
  );
  expect(verified.status, await verified.clone().text()).toBe(200);
  const session = verified.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  expect(session).toContain("session_token");
  return { session, code };
}
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.execute(
    sql`TRUNCATE "user",session,account,verification,rate_limit,driver,sms_message,market_observation,data_job,exchange_rate,futures_settlement,national_price,station,station_price,sync_state,tracked_station,model_price,model_pump_event,model_settlement_event,model_fx_rate,forecast_run CASCADE`,
  );
}, 30_000);
afterAll(async () => {
  await db.$client.end();
});
describe.sequential(
  "Hono + PostgreSQL + Better Auth + generated contract",
  () => {
    it("serves health, OpenAPI and explicit demo without authentication", async () => {
      expect((await req("/api/health")).status).toBe(200);
      const spec = z
        .object({
          openapi: z.string(),
          paths: z.record(
            z.string(),
            z
              .object({
                get: z.object({ security: z.unknown().optional() }).optional(),
              })
              .passthrough(),
          ),
        })
        .parse(await (await req("/api/openapi.json")).json());
      expect(spec.openapi).toBe("3.1.0");
      expect(spec.paths["/api/v1/me/dashboard"]!.get!.security).toBeDefined();
      const demo = DashboardSchema.parse(
        await (await req("/api/v1/demo")).json(),
      );
      expect(DashboardSchema.safeParse(demo).success).toBe(true);
      expect(demo.forecast!.mode).toBe("demo");
    });
    it("blocks unauthenticated private data and disabled email signup", async () => {
      expect((await req("/api/v1/me/dashboard")).status).toBe(401);
      expect(
        (
          await req("/api/auth/sign-up/email", "POST", {
            email: "x@example.com",
            password: "password",
            name: "X",
          })
        ).status,
      ).toBe(404);
      expect((await req("/api/dev/otp?phone=%2B447700900123")).status).toBe(
        404,
      );
    });
    it("rejects non-UK phone numbers", async () => {
      expect(
        (
          await req(
            "/api/auth/phone-number/send-otp",
            "POST",
            { phoneNumber: "+15551234567" },
            "",
          )
        ).status,
      ).toBe(400);
    });
    it("signs up by OTP only and prevents code reuse", async () => {
      const result = await login("+447700900123");
      cookie = result.session;
      const session = z
        .object({ user: z.object({ phoneNumberVerified: z.boolean() }) })
        .parse(await (await req("/api/auth/get-session")).json());
      expect(session.user.phoneNumberVerified).toBe(true);
      const again = await req(
        "/api/auth/phone-number/verify",
        "POST",
        { phoneNumber: "+447700900123", code: result.code },
        "",
      );
      expect(again.status).not.toBe(200);
    });
    it("requires car setup then validates tank capacity and origin", async () => {
      expect((await req("/api/v1/me/driver")).status).toBe(404);
      expect(
        (await req("/api/v1/me/driver", "PUT", { ...car, currentLitres: 51 }))
          .status,
      ).toBe(422);
      const forbidden = await app.request(
        "http://localhost:3100/api/v1/me/driver",
        {
          method: "PUT",
          headers: { ...headers, origin: "https://evil.example", cookie },
          body: JSON.stringify(car),
        },
      );
      expect(forbidden.status).toBe(403);
      expect((await req("/api/v1/me/driver", "PUT", car)).status).toBe(200);
      const response = await req("/api/v1/me/dashboard");
      expect(response.headers.get("cache-control")).toBe("no-store");
      const dash = DashboardSchema.parse(await response.json());
      expect(DashboardSchema.safeParse(dash).success).toBe(true);
      expect(dash.recommendation!.action).toBe("top-up");
    });
    it("creates only one daily message under concurrent scheduler runs", async () => {
      const a = buildInjector(config, () => now),
        b = buildInjector(config, () => now);
      try {
        const results = await Promise.all([
          a.resolve("alertService").evaluate(),
          b.resolve("alertService").evaluate(),
        ]);
        expect(results.reduce((sum, r) => sum + r.stubbed, 0)).toBe(1);
      } finally {
        await Promise.all([a.dispose(), b.dispose()]);
      }
      const messages = z
        .array(SmsSchema)
        .parse(await (await req("/api/v1/me/messages")).json());
      expect(messages).toHaveLength(1);
      expect(messages[0].kind).toBe("fill-alert");
      expect(messages[0].body).toContain("[DEMO]");
    });
    it("does not expose another user’s car or SMS and respects opt-out", async () => {
      secondCookie = (await login("+447700900124")).session;
      expect(
        (await req("/api/v1/me/driver", "GET", undefined, secondCookie)).status,
      ).toBe(404);
      expect(
        await (
          await req("/api/v1/me/messages", "GET", undefined, secondCookie)
        ).json(),
      ).toEqual([]);
      await req(
        "/api/v1/me/driver",
        "PUT",
        { ...car, smsEnabled: false },
        secondCookie,
      );
      const injector = buildInjector(config, () => now);
      try {
        const result = await injector.resolve("alertService").evaluate();
        expect(result.checked).toBe(1);
        expect(result.stubbed).toBe(0);
      } finally {
        await injector.dispose();
      }
    });
    it("authenticates ingestion, rejects future dates, and uses live persisted observations", async () => {
      const observations = demoObservations(now);
      expect(
        (
          await req("/api/v1/market/observations", "POST", {
            source: "provider",
            observations,
          })
        ).status,
      ).toBe(403);
      const ingest = (body: unknown) =>
        app.request("http://localhost:3100/api/v1/market/observations", {
          method: "POST",
          headers: {
            ...headers,
            authorization: `Bearer ${config.ingestApiKey}`,
          },
          body: JSON.stringify(body),
        });
      expect(
        (
          await ingest({
            source: "provider",
            observations: [{ ...observations[0], date: "2099-01-01" }],
          })
        ).status,
      ).toBe(422);
      expect((await ingest({ source: "provider", observations })).status).toBe(
        200,
      );
      expect((await ingest({ source: "provider", observations })).status).toBe(
        200,
      );
      expect(
        await db.query.marketObservation.findMany({
          where: { source: "provider" },
        }),
      ).toHaveLength(30);
      // Manual legacy imports do not masquerade as Fuel Finder data.
      await db.insert(nationalPrice).values({
        date: isoDay(now),
        pricePence: 145.9,
        stationCount: 100,
        observedAt: now,
      });
      const live = createApp({
        config: { ...config, marketDataMode: "live" },
        clock: () => now,
      });
      const forecast = ForecastSchema.parse(
        await (
          await live.request("http://localhost:3100/api/v1/forecast")
        ).json(),
      );
      expect(forecast.mode).toBe("live");
      expect(forecast.source).toContain("Fuel Finder");
      expect(forecast.history).toHaveLength(1);
      expect(forecast.points).toHaveLength(15);
      const missing = createApp({
        config: { ...config, marketDataMode: "live" },
        clock: () => new Date(+now + 4 * 86400000),
      });
      expect(
        (await missing.request("http://localhost:3100/api/v1/forecast")).status,
      ).toBe(503);
    });
    it("seeds repeatable sample history for development forecasts while preserving and isolating live observations", async () => {
      const original = await db.query.nationalPrice.findFirst({
        where: { date: isoDay(now) },
      });
      for (let run = 0; run < 2; run++) {
        const result = await seedSampleHistory(db, now);
        expect(result.sampleDays).toBe(29);
        expect(result.retainedObservedDays).toBe(1);
      }
      expect(await db.query.nationalPrice.findMany()).toHaveLength(30);
      expect(
        await db.query.nationalPrice.findFirst({
          where: { date: isoDay(now) },
        }),
      ).toEqual(original);
      const local = createApp({
        config: {
          ...config,
          environment: "development",
          marketDataMode: "sample",
        },
        clock: () => now,
      });
      const forecast = ForecastSchema.parse(
        await (
          await local.request("http://localhost:3100/api/v1/forecast")
        ).json(),
      );
      expect(forecast.mode).toBe("sample");
      expect(forecast.history).toHaveLength(14);
      expect(
        forecast.history.filter((p) => p.source === "sample"),
      ).toHaveLength(13);
      expect(forecast.currentPricePence).toBe(original!.pricePence);
      expect(forecast.points[1]!.signals![0]!.weight).toBe(0.9);
      expect(forecast.points[1]!.pricePence).toBeGreaterThan(
        forecast.currentPricePence,
      );
      const live = createApp({
        config: { ...config, marketDataMode: "live" },
        clock: () => now,
      });
      const actual = ForecastSchema.parse(
        await (
          await live.request("http://localhost:3100/api/v1/forecast")
        ).json(),
      );
      expect(actual.mode).toBe("live");
      expect(actual.history).toHaveLength(1);
      expect(actual.points[1]!.signals![0]!.available).toBe(false);
      expect(
        ConfigSchema.safeParse({
          ...config,
          environment: "production",
          marketDataMode: "sample",
        }).success,
      ).toBe(false);
    });
    it("completes onboarding atomically, enforces three nearby stations and isolates users", async () => {
      const location = { latitude: 51.5, longitude: -0.1 };
      await db.insert(station).values(
        Array.from({ length: 5 }, (_, i) => ({
          id: `test-${i}`,
          name: `Station ${i}`,
          brand: "Test",
          address: "Test Road",
          postcode: "SW1A 1AA",
          latitude: 51.5 + (i === 4 ? 1 : i * 0.001),
          longitude: -0.1,
          motorway: false,
          closed: false,
          pricePence: 140 + i,
          priceUpdatedAt: now,
          checkedAt: now,
        })),
      );
      await db.insert(syncState).values({ key: "fuel-finder", syncedAt: now });
      const body = {
        driver: {
          ...car,
          mileageMode: "weekly",
          weekdayMiles: [10, 20, 30, 40, 50, 0, 0],
        },
        location,
        stationIds: ["test-0", "test-1", "test-2"],
      };
      expect(
        (
          await req("/api/v1/me/onboarding", "PUT", {
            ...body,
            stationIds: [...body.stationIds, "test-3"],
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await req("/api/v1/me/onboarding", "PUT", {
            ...body,
            stationIds: ["test-0", "test-0"],
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await req("/api/v1/me/onboarding", "PUT", {
            ...body,
            stationIds: ["test-4"],
          })
        ).status,
      ).toBe(422);
      const saved = await req("/api/v1/me/onboarding", "PUT", body);
      expect(saved.status, await saved.clone().text()).toBe(200);
      const result = (await saved.json()) as {
        dailyMiles: number;
        onboardingComplete: boolean;
      };
      expect(result.dailyMiles).toBeCloseTo(150 / 7);
      expect(result.onboardingComplete).toBe(true);
      const tracked = (await (await req("/api/v1/me/stations")).json()) as {
        stations: { id: string; history: unknown[] }[];
      };
      expect(tracked.stations).toHaveLength(3);
      expect(tracked.stations[0]!.history).toHaveLength(1);
      const other = (await (
        await req("/api/v1/me/stations", "GET", undefined, secondCookie)
      ).json()) as { stations: unknown[] };
      expect(other.stations).toEqual([]);
      const replacements = await Promise.all([
        req("/api/v1/me/onboarding", "PUT", {
          ...body,
          stationIds: ["test-0", "test-1"],
        }),
        req("/api/v1/me/onboarding", "PUT", {
          ...body,
          stationIds: ["test-2", "test-3"],
        }),
      ]);
      expect(replacements.every((r) => r.status === 200)).toBe(true);
      expect(
        (
          (await (await req("/api/v1/me/stations")).json()) as {
            stations: unknown[];
          }
        ).stations,
      ).toHaveLength(2);
      expect(
        (await req("/api/v1/me/tank", "PATCH", { currentLitres: 51 })).status,
      ).toBe(422);
      expect(
        (await req("/api/v1/me/tank", "PATCH", { currentLitres: 22 })).status,
      ).toBe(200);
      const updated = (await (await req("/api/v1/me/driver")).json()) as {
        currentLitres: number;
        weekdayMiles: number[];
      };
      expect(updated.currentLitres).toBe(22);
      expect(updated.weekdayMiles).toEqual(body.driver.weekdayMiles);
    });
    it("claims a daily market job once across concurrent requests and persists its observations", async () => {
      const a = buildInjector(config, () => now),
        b = buildInjector(config, () => now);
      const response = {
        start: now.toISOString().slice(0, 10),
        end: now.toISOString().slice(0, 10),
        events: [],
        settlements: [
          {
            product: "B7H" as const,
            symbol: "B7H-test",
            date: now.toISOString().slice(0, 10),
            priceUsd: 700,
            expiresAt: new Date(+now + 86400000 * 30),
            publishedAt: now,
          },
        ],
      };
      const daily = vi.fn(async () => response),
        fx = vi.fn(async () => [{ date: response.start, usdPerGbp: 1.3 }]);
      for (const i of [a, b]) {
        vi.spyOn(i.resolve("databentoService"), "daily").mockImplementation(
          daily,
        );
        vi.spyOn(
          i.resolve("databentoService"),
          "exchangeRates",
        ).mockImplementation(fx);
      }
      try {
        const results = await Promise.allSettled([
          a.resolve("syncService").daily(),
          b.resolve("syncService").daily(),
        ]);
        expect(daily).toHaveBeenCalledTimes(1);
        expect(
          results.filter((r) => r.status === "fulfilled" && !r.value.skipped),
        ).toHaveLength(1);
        expect((await a.resolve("syncService").daily()).skipped).toBe(true);
        expect(daily).toHaveBeenCalledTimes(1);
        expect(await db.query.futuresSettlement.findMany()).toHaveLength(1);
      } finally {
        await a.dispose();
        await b.dispose();
      }
    });
    it("retries failed daily jobs at most three times without reporting success", async () => {
      const i = buildInjector(config, () => new Date(+now + 86400000));
      const daily = vi
        .spyOn(i.resolve("databentoService"), "daily")
        .mockRejectedValue(new Error("provider unavailable"));
      try {
        for (let attempt = 0; attempt < 3; attempt++)
          await expect(i.resolve("syncService").daily()).rejects.toThrow(
            "provider unavailable",
          );
        await expect(i.resolve("syncService").daily()).rejects.toMatchObject({
          code: "SYNC_UNAVAILABLE",
        });
        expect(daily).toHaveBeenCalledTimes(3);
      } finally {
        await i.dispose();
      }
    });
    it("stores tracked-station hourly observations once and never duplicates them across users", async () => {
      const i = buildInjector(config, () => new Date(+now + 3600000));
      vi.spyOn(i.resolve("fuelFinderService"), "token").mockResolvedValue(
        "test-token",
      );
      vi.spyOn(i.resolve("fuelFinderService"), "pages").mockImplementation(
        async function* (_token, kind) {
          yield kind === "prices"
            ? [
                {
                  node_id: "test-2",
                  fuel_prices: [
                    {
                      fuel_type: "E10",
                      price: 149.9,
                      price_last_updated: now.toISOString(),
                    },
                  ],
                },
              ]
            : [];
        },
      );
      try {
        const first = await i.resolve("syncService").hourly();
        expect(first.skipped).toBe(false);
        const count = (await db.query.stationPrice.findMany()).length;
        expect(count).toBeGreaterThan(3);
        expect((await i.resolve("syncService").hourly()).skipped).toBe(true);
        expect(await db.query.stationPrice.findMany()).toHaveLength(count);
      } finally {
        await i.dispose();
      }
    });
    it("protects manual alert evaluation and logs out cleanly", async () => {
      expect((await req("/api/v1/alerts/evaluate", "POST")).status).toBe(403);
      expect((await req("/api/auth/sign-out", "POST", {})).status).toBe(200);
      expect((await req("/api/v1/me/dashboard")).status).toBe(401);
    });
    it("freezes the daily snapshot and excludes future, stale and invalid station updates", async () => {
      await db.execute(
        sql`TRUNCATE model_pump_event, model_price, model_settlement_event, model_fx_rate, forecast_run`,
      );
      const cutoff = new Date("2026-09-18T08:00:00Z"),
        received = new Date("2026-09-18T07:10:00Z");
      const event = (
        stationId: string,
        source: string,
        pricePence: number | null,
        availableAt = received,
      ) => ({
        stationId,
        sourceAt: new Date(source),
        receivedAt: availableAt,
        availableAt,
        pricePence,
        source: "fuel-finder",
      });
      await db
        .insert(modelPumpEvent)
        .values([
          event("a", "2026-09-18T06:00:00Z", 150),
          event("b", "2026-09-18T06:00:00Z", 160),
          event(
            "a",
            "2026-09-17T06:00:00Z",
            500,
            new Date("2026-09-18T07:20:00Z"),
          ),
          event(
            "a",
            "2026-09-18T09:00:00Z",
            300,
            new Date("2026-09-18T09:00:00Z"),
          ),
          event("c", "2026-09-18T06:00:00Z", null),
        ]);
      await db.insert(dataJob).values({
        key: "fuel-finder:model-test",
        status: "complete",
        startedAt: received,
        finishedAt: received,
      });
      const i = buildInjector(config, () => new Date("2026-09-18T08:05:00Z"));
      try {
        await i.resolve("modelDataService").snapshot();
        expect(
          (
            await db.query.modelPrice.findFirst({
              where: { frequency: "daily", date: "2026-09-18" },
            })
          )?.pricePence,
        ).toBe(155);
        await db
          .insert(modelPumpEvent)
          .values(
            event(
              "a",
              "2026-09-18T07:30:00Z",
              400,
              new Date("2026-09-18T08:01:00Z"),
            ),
          );
        expect((await i.resolve("modelDataService").snapshot()).created).toBe(
          false,
        );
        expect(
          (
            await db.query.modelPrice.findFirst({
              where: { frequency: "daily", date: "2026-09-18" },
            })
          )?.pricePence,
        ).toBe(155);
        await db.insert(modelPrice).values([
          {
            frequency: "daily",
            date: "2026-09-04",
            availableAt: new Date("2026-09-04T08:00:00Z"),
            pricePence: 151,
            source: "fuelcosts-archive",
          },
        ]);
        for (const product of ["B7H", "BZ"] as const)
          await db.insert(modelSettlementEvent).values(
            [0, 7, 14, 28].map((lag) => ({
              product,
              symbol: product + "-test",
              date: new Date(+cutoff - (lag + 1) * 86400000)
                .toISOString()
                .slice(0, 10),
              publishedAt: new Date(+cutoff - 3600000),
              expiresAt: new Date("2026-12-01T00:00:00Z"),
              priceUsd: product === "B7H" ? 1000 - lag : 80 - lag / 10,
            })),
          );
        await db.insert(modelFxRate).values(
          [0, 7, 14, 28].map((lag) => ({
            date: new Date(+cutoff - (lag + 1) * 86400000)
              .toISOString()
              .slice(0, 10),
            availableAt: new Date(+cutoff - 3600000),
            usdPerGbp: 1.3,
          })),
        );
        const first = await i.resolve("modelService").daily();
        expect(first.model).toBe("daily-ridge");
        expect(first.points).toHaveLength(15);
        await db.insert(modelSettlementEvent).values({
          product: "B7H",
          symbol: "B7H-test",
          date: "2026-09-17",
          publishedAt: new Date("2026-09-18T07:59:00Z"),
          expiresAt: new Date("2026-12-01T00:00:00Z"),
          priceUsd: 2000,
        });
        expect(await i.resolve("modelService").daily()).toEqual(first);
        expect(await db.query.forecastRun.findMany()).toHaveLength(1);
      } finally {
        await i.dispose();
      }
    });
    it("rate limits OTP requests across request-scoped auth instances", async () => {
      const send = () =>
        app.request("http://localhost:3100/api/auth/phone-number/send-otp", {
          method: "POST",
          headers: { ...headers, "cf-connecting-ip": "192.0.2.50" },
          body: JSON.stringify({ phoneNumber: "+447700900126" }),
        });
      for (let i = 0; i < 3; i++) expect((await send()).status).toBe(200);
      expect((await send()).status).toBe(429);
    });
  },
);
