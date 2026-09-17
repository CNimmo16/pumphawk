import { reportError } from "../lib/telemetry/report";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import {
  NearbySchema,
  TrackedSchema,
  OnboardingSchema,
  TankInput,
  z,
  ErrorSchema,
  DriverInput,
  DriverSchema,
  ForecastSchema,
  WeeklyOutlookSchema,
  DashboardSchema,
  RecommendationSchema,
  IngestSchema,
  SmsSchema,
  PhoneSchema,
  VerifySchema,
} from "@pump-hawk/contracts";
import { readConfig, type Config } from "./config";
import { buildInjector, type AppInjector } from "./injector";
import { AppError } from "./errors";
import { recommend } from "../pricing/recommendation";
import { demoObservations, forecastPrices } from "../pricing/forecast";
import type { MiddlewareHandler } from "hono";
export type AppEnv = {
  Bindings: Env;
  Variables: { injector: AppInjector; userId: string };
};
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const errors = {
  400: json(ErrorSchema, "Malformed or invalid request"),
  401: json(
    ErrorSchema,
    "Phone verification and a session cookie are required",
  ),
  403: json(ErrorSchema, "Origin or credentials rejected"),
  404: json(ErrorSchema, "Resource not found"),
  422: json(ErrorSchema, "Invalid input"),
  429: json(ErrorSchema, "Rate limit exceeded"),
  503: json(ErrorSchema, "Data unavailable or stale"),
};
const protectedSecurity = [{ sessionCookie: [] }];
const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const result = await c
    .get("injector")
    .resolve("authService")
    .auth.api.getSession({ headers: c.req.raw.headers });
  if (!result?.user.phoneNumberVerified)
    throw new AppError(
      "UNAUTHENTICATED",
      "Verify your phone number to continue.",
      401,
    );
  c.set("userId", result.user.id);
  await next();
};
const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const expected = c.get("injector").resolve("config").ingestApiKey;
  const received = c.req.header("authorization")?.replace(/^Bearer /, "") ?? "";
  const hash = async (s: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    );
  const [a, b] = await Promise.all([hash(received), hash(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  if (diff !== 0)
    throw new AppError(
      "FORBIDDEN",
      "A valid ingestion bearer token is required.",
      403,
    );
  await next();
};
export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Pump Hawk API",
    version: "0.1.0",
    description:
      "UK petrol forecasts and personal fill-up plans. Prices are GBP pence/litre, fuel is litres, and MPG is UK imperial. Separate daily and weekly fitted models with an explicitly labelled heuristic fallback; methodology: PRICES.md. Demo prices are synthetic. SMS is a persisted stub.\n\nAuthentication: POST /api/auth/phone-number/send-otp, then /verify. Retain the HttpOnly session cookie. For unsafe authenticated requests set Origin to APP_ORIGIN. Better Auth owns authentication errors (code/message); application errors use the error envelope. All /api/v1/me routes require a verified phone. POST /api/v1/market/observations uses the separate ingestion bearer secret.",
  },
  servers: [{ url: "/" }],
  tags: [
    {
      name: "Market",
      description: "National petrol forecasts and source observations",
    },
    {
      name: "Driver",
      description: "Your car, estimated tank state, and fill-up advice",
    },
    { name: "Auth", description: "Phone-only signup/login via Better Auth" },
    { name: "Alerts", description: "Opt-in alerts and persisted SMS stub" },
    { name: "System", description: "Operational status and development tools" },
  ],
};
export function createApp(
  options: { config?: Config; clock?: () => Date } = {},
) {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success)
        return c.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: result.error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("; "),
            },
          },
          422,
        );
    },
  });
  app.use("*", secureHeaders());
  app.use(
    "*",
    bodyLimit({
      maxSize: 128 * 1024,
      onError: (c) =>
        c.json(
          {
            error: {
              code: "BODY_TOO_LARGE",
              message: "Request body exceeds 128KB.",
            },
          },
          413,
        ),
    }),
  );
  app.use("/api/*", async (c, next) => {
    if (
      c.req.path === "/api/openapi.json" ||
      c.req.path === "/api/docs" ||
      c.req.path === "/api/health"
    ) {
      await next();
      return;
    }
    const config = options.config ?? readConfig(c.env);
    const injector = buildInjector(config, options.clock);
    c.set("injector", injector);
    try {
      if (c.req.path.startsWith("/api/v1/me")) {
        c.header("Cache-Control", "no-store");
        if (
          !["GET", "HEAD"].includes(c.req.method) &&
          c.req.header("origin") !== config.appOrigin
        )
          throw new AppError(
            "ORIGIN_REJECTED",
            "Use the configured app origin for authenticated changes.",
            403,
          );
      }
      await next();
    } finally {
      await injector.dispose();
    }
  });
  app.onError(async (error, c) => {
    if (!(error instanceof AppError) || error.status >= 500) {
      const pending = reportError(
        error,
        c.env ?? {},
        c.req.routePath ?? "api",
        Object.values(options.config ?? c.env ?? {}).filter(
          (v): v is string => typeof v === "string" && v.length > 12,
        ),
      );
      // Hono's Node test harness has no execution context.
      try {
        c.executionCtx.waitUntil(pending);
      } catch {
        await pending;
      }
    }
    if (error instanceof AppError)
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    if (error instanceof SyntaxError)
      return c.json(
        {
          error: {
            code: "INVALID_JSON",
            message: "Request body must be valid JSON.",
          },
        },
        400,
      );
    return c.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Something went wrong. Please try again.",
        },
      },
      500,
    );
  });
  app.notFound((c) =>
    c.json(
      { error: { code: "NOT_FOUND", message: "Endpoint not found." } },
      404,
    ),
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/health",
      operationId: "getHealth",
      tags: ["System"],
      responses: {
        200: json(z.object({ status: z.literal("ok") }), "Worker is running"),
      },
    }),
    (c) => c.json({ status: "ok" as const }, 200),
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/forecast",
      operationId: "getForecast",
      tags: ["Market"],
      summary: "Get a 14-day petrol-price scenario",
      responses: {
        200: json(ForecastSchema, "Daily forecast and uncertainty range"),
        ...errors,
      },
    }),
    async (c) =>
      c.json(await c.get("injector").resolve("marketService").forecast(), 200),
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/demo",
      operationId: "getDemoDashboard",
      tags: ["Market"],
      summary: "Explore a synthetic example driver and forecast",
      responses: {
        200: json(DashboardSchema, "Explicitly synthetic preview"),
        ...errors,
      },
    }),
    (c) => {
      const now = options.clock?.() ?? new Date();
      const forecast = forecastPrices(
        demoObservations(now),
        now,
        "demo",
        "Pump Hawk demo",
      );
      forecast.points = forecast.points.slice(0, 15);
      const driver = {
        vehicleName: "My hatchback",
        tankCapacityLitres: 50,
        currentLitres: 18,
        mpg: 45,
        dailyMiles: 20,
        smsEnabled: false,
        fuelUpdatedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      return c.json(
        { driver, forecast, recommendation: recommend(driver, forecast, now) },
        200,
      );
    },
  );
  app.use("/api/v1/me/*", requireUser);
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/me/driver",
      operationId: "getDriver",
      tags: ["Driver"],
      security: protectedSecurity,
      responses: {
        200: json(DriverSchema, "Your latest reported tank state"),
        ...errors,
      },
    }),
    async (c) =>
      c.json(
        await c.get("injector").resolve("driverService").get(c.get("userId")),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "put",
      path: "/api/v1/me/driver",
      operationId: "saveDriver",
      summary: "Set car, current tank reading, and SMS consent",
      description:
        "PUT replaces the car and confirms a fresh tank reading at the server time. Send the current gauge reading, not an old stored value. smsEnabled is explicit consent; set false to opt out.",
      tags: ["Driver"],
      security: protectedSecurity,
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: DriverInput } },
        },
      },
      responses: {
        200: json(DriverSchema, "Saved car with a fresh tank reading"),
        ...errors,
      },
    }),
    async (c) =>
      c.json(
        await c
          .get("injector")
          .resolve("driverService")
          .save(c.get("userId"), c.req.valid("json")),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/me/dashboard",
      operationId: "getDashboard",
      tags: ["Driver"],
      security: protectedSecurity,
      responses: {
        200: json(DashboardSchema, "Personal forecast and recommendation"),
        ...errors,
      },
    }),
    async (c) => {
      const i = c.get("injector");
      const driver = await i.resolve("driverService").get(c.get("userId"));
      let forecast;
      try {
        forecast = await i.resolve("marketService").forecast();
      } catch (error) {
        if (error instanceof AppError && error.status === 503)
          return c.json(
            {
              driver,
              forecast: null,
              recommendation: null,
              forecastError: error.message,
            },
            200,
          );
        throw error;
      }
      return c.json(
        {
          driver,
          forecast,
          recommendation: recommend(driver, forecast, i.resolve("clock")()),
        },
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/me/recommendation",
      operationId: "getRecommendation",
      tags: ["Driver"],
      security: protectedSecurity,
      responses: {
        200: json(RecommendationSchema, "When to buy and how many litres"),
        ...errors,
      },
    }),
    async (c) => {
      const i = c.get("injector");
      return c.json(
        recommend(
          await i.resolve("driverService").get(c.get("userId")),
          await i.resolve("marketService").forecast(),
          i.resolve("clock")(),
        ),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/me/messages",
      operationId: "getMessages",
      tags: ["Alerts"],
      security: protectedSecurity,
      responses: {
        200: json(
          z.array(SmsSchema),
          "Your latest 20 fill-up messages; OTPs are never returned",
        ),
        ...errors,
      },
    }),
    async (c) => {
      const rows = await c
        .get("injector")
        .resolve("dbService")
        .db.query.smsMessage.findMany({
          where: { userId: c.get("userId"), kind: "fill-alert" },
          orderBy: { createdAt: "desc" },
          limit: 20,
        });
      return c.json(
        rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/market/observations",
      operationId: "ingestObservations",
      tags: ["Market"],
      summary: "Import GBP refined petrol observations",
      security: [{ ingestionBearer: [] }],
      middleware: [requireAdmin] as const,
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: IngestSchema } },
        },
      },
      responses: {
        200: json(
          z.object({ accepted: z.number(), source: z.string() }),
          "Atomic, idempotent upsert by source and date",
        ),
        ...errors,
      },
    }),
    async (c) => {
      const { source, observations } = c.req.valid("json");
      return c.json(
        await c
          .get("injector")
          .resolve("marketService")
          .ingest(source, observations),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/alerts/evaluate",
      operationId: "evaluateAlerts",
      tags: ["Alerts"],
      summary: "Evaluate opted-in users (scheduler/manual operations)",
      security: [{ ingestionBearer: [] }],
      middleware: [requireAdmin] as const,
      responses: {
        200: json(
          z.object({ checked: z.number(), stubbed: z.number() }),
          "Daily deduplicated SMS evaluation",
        ),
        ...errors,
      },
    }),
    async (c) =>
      c.json(await c.get("injector").resolve("alertService").evaluate(), 200),
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/me/stations/nearby",
      operationId: "getNearbyStations",
      tags: ["Driver"],
      security: protectedSecurity,
      summary: "Find E10 petrol stations within five miles",
      description:
        "Current stored Fuel Finder prices, refreshed hourly. Coordinates are used for this search and are not stored in your profile.",
      request: {
        query: z.object({
          latitude: z.coerce.number().min(49).max(61),
          longitude: z.coerce.number().min(-9).max(2),
        }),
      },
      responses: {
        200: json(NearbySchema, "Nearby stations ordered by distance"),
        ...errors,
      },
    }),
    async (c) =>
      c.json(
        await c
          .get("injector")
          .resolve("stationService")
          .nearby(c.req.valid("query")),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/me/stations",
      operationId: "getTrackedStations",
      tags: ["Driver"],
      security: protectedSecurity,
      summary:
        "Tracked stations and up to 30 days of actual hourly observations",
      responses: {
        200: json(
          TrackedSchema,
          "History begins when a station is first tracked; missing history is never invented",
        ),
        ...errors,
      },
    }),
    async (c) =>
      c.json(
        await c
          .get("injector")
          .resolve("stationService")
          .tracked(c.get("userId")),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "put",
      path: "/api/v1/me/onboarding",
      operationId: "saveOnboarding",
      tags: ["Driver"],
      security: protectedSecurity,
      summary:
        "Save car, weekly mileage and one to three nearby stations atomically",
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: OnboardingSchema } },
        },
      },
      responses: { 200: json(DriverSchema, "Onboarding complete"), ...errors },
    }),
    async (c) =>
      c.json(
        await c
          .get("injector")
          .resolve("stationService")
          .onboard(c.get("userId"), c.req.valid("json")),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "patch",
      path: "/api/v1/me/tank",
      operationId: "updateTank",
      tags: ["Driver"],
      security: protectedSecurity,
      summary:
        "Record your current gauge without changing your car or driving schedule",
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: TankInput } },
        },
      },
      responses: { 200: json(DriverSchema, "Updated tank reading"), ...errors },
    }),
    async (c) =>
      c.json(
        await c
          .get("injector")
          .resolve("driverService")
          .updateTank(c.get("userId"), c.req.valid("json").currentLitres),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/data/sync/{kind}",
      operationId: "syncData",
      tags: ["System"],
      security: [{ ingestionBearer: [] }],
      middleware: [requireAdmin] as const,
      summary: "Run daily market or hourly station ingestion",
      description:
        "Idempotent across Workers using Postgres job claims. Daily downloads run at most once per UTC day; hourly station collection runs at most once per UTC hour. Failed attempts remain recorded and retry next scheduled period.",
      request: {
        params: z.object({ kind: z.enum(["daily", "hourly", "models"]) }),
      },
      responses: {
        200: json(
          z
            .object({ key: z.string(), skipped: z.boolean() })
            .catchall(z.unknown()),
          "Job result",
        ),
        ...errors,
      },
    }),
    async (c) => {
      if (c.req.valid("param").kind === "models") {
        const i = c.get("injector"),
          data = i.resolve("modelDataService");
        await data.weekly();
        // On first deployment, archived genuine snapshots can precede the first
        // local collection. Keep them until a complete pre-cutoff collection exists.
        try {
          await data.snapshot();
        } catch (error) {
          if (
            !(error instanceof AppError) ||
            error.code !== "SNAPSHOT_FEED_STALE"
          )
            throw error;
        }
        const daily = await i.resolve("modelService").daily();
        const weekly = await i.resolve("modelService").weekly();
        return c.json(
          {
            key: "models:" + daily.asOf,
            skipped: false,
            dailyModel: daily.model,
            weeklyModel: weekly.model,
          },
          200,
        );
      }
      return c.json(
        await c
          .get("injector")
          .resolve("syncService")
          [c.req.valid("param").kind as "daily" | "hourly"](),
        200,
      );
    },
  );
  const authError = z.object({ code: z.string(), message: z.string() });
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/forecast/weekly",
      operationId: "getWeeklyOutlook",
      tags: ["Market"],
      summary: "Official sales-weighted UK weekly petrol outlook",
      responses: {
        200: json(
          WeeklyOutlookSchema,
          "Next two official weekly observations; never a daily forecast",
        ),
        503: errors[503],
      },
    }),
    async (c) =>
      c.json(await c.get("injector").resolve("modelService").weekly(), 200),
  );
  for (const [path, id, schema, summary] of [
    [
      "/api/auth/phone-number/send-otp",
      "sendPhoneOtp",
      PhoneSchema,
      "Send a six-digit phone verification code",
    ],
    [
      "/api/auth/phone-number/verify",
      "verifyPhoneOtp",
      VerifySchema,
      "Verify code; create account or sign in and set the session cookie",
    ],
  ] as const) {
    app.openAPIRegistry.registerPath({
      method: "post",
      path,
      operationId: id,
      tags: ["Auth"],
      summary,
      request: {
        body: { required: true, content: { "application/json": { schema } } },
      },
      responses: {
        200: json(
          z.object({
            status: z.boolean().optional(),
            token: z.string().optional(),
            user: z.unknown().optional(),
          }),
          "Better Auth result; verification sets an HttpOnly cookie",
        ),
        400: json(authError, "Invalid code or phone number"),
        429: json(authError, "Too many attempts"),
      },
    });
    app.post(path, (c) =>
      c.get("injector").resolve("authService").auth.handler(c.req.raw),
    );
  }
  app.openAPIRegistry.registerPath({
    method: "get",
    path: "/api/auth/get-session",
    operationId: "getSession",
    tags: ["Auth"],
    responses: { 200: json(z.unknown(), "Better Auth session or null") },
  });
  app.get("/api/auth/get-session", (c) =>
    c.get("injector").resolve("authService").auth.handler(c.req.raw),
  );
  app.openAPIRegistry.registerPath({
    method: "post",
    path: "/api/auth/sign-out",
    operationId: "signOut",
    tags: ["Auth"],
    responses: {
      200: json(z.object({ success: z.boolean() }), "Session revoked"),
    },
  });
  app.post("/api/auth/sign-out", (c) =>
    c.get("injector").resolve("authService").auth.handler(c.req.raw),
  );
  // Local development convenience only; deliberately omitted from the public contract.
  app.get("/api/dev/otp", async (c) => {
    const i = c.get("injector"),
      config = i.resolve("config"),
      hostname = new URL(c.req.url).hostname;
    if (
      config.environment !== "development" ||
      !["localhost", "127.0.0.1"].includes(hostname)
    )
      throw new AppError("NOT_FOUND", "Endpoint not found.", 404);
    c.header("Cache-Control", "no-store");
    const row = await i.resolve("dbService").db.query.smsMessage.findFirst({
      where: {
        phoneNumber: c.req.query("phone") ?? "",
        kind: "otp",
        createdAt: { gt: new Date(Date.now() - 5 * 60_000) },
      },
      orderBy: { createdAt: "desc" },
    });
    return c.json(
      {
        code: row?.body.match(/\b\d{6}\b/)?.[0] ?? null,
        delivery: "local stub",
      },
      200,
    );
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "sessionCookie", {
    type: "apiKey",
    in: "cookie",
    name: "better-auth.session_token",
    description: "Better Auth cookie; production uses __Secure- prefix.",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "ingestionBearer", {
    type: "http",
    scheme: "bearer",
    description: "INGEST_API_KEY server secret; never expose to the browser.",
  });
  app.doc31("/api/openapi.json", openApiDocument);
  app.get("/api/docs", swaggerUI({ url: "/api/openapi.json" }));
  return app;
}
