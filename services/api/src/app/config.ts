import { z } from "zod";
export const ConfigSchema = z
  .object({
    environment: z.enum(["development", "test", "production"]),
    appOrigin: z.url(),
    authUrl: z.url(),
    authSecret: z.string().min(32),
    googleClientId: z.string().min(1).optional(),
    googleClientSecret: z.string().min(1).optional(),
    ingestApiKey: z.string().min(24),
    databaseUrl: z.string().min(1),
    marketDataMode: z.enum(["demo", "live", "sample"]),
    databentoApiKey: z.string().optional(),
    fuelFinderClientId: z.string().optional(),
    fuelFinderClientSecret: z.string().optional(),
    marketSource: z.string().default("provider"),
  })
  .refine(
    (config) =>
      Boolean(config.googleClientId) === Boolean(config.googleClientSecret),
    {
      message: "Configure both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      path: ["googleClientId"],
    },
  )
  .refine(
    (config) =>
      config.marketDataMode !== "sample" ||
      config.environment === "development",
    {
      message: "Sample pump history is only available in development.",
      path: ["marketDataMode"],
    },
  );
export type Config = z.infer<typeof ConfigSchema>;
export function readConfig(env: Env): Config {
  return ConfigSchema.parse({
    environment: env.ENVIRONMENT,
    appOrigin: env.APP_ORIGIN,
    authUrl: env.BETTER_AUTH_URL,
    authSecret: env.BETTER_AUTH_SECRET,
    googleClientId: env.GOOGLE_CLIENT_ID || undefined,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || undefined,
    ingestApiKey: env.INGEST_API_KEY,
    databaseUrl: env.DATABASE_URL,
    marketDataMode: env.MARKET_DATA_MODE,
    marketSource: env.MARKET_SOURCE,
    databentoApiKey: env.DATABENTO_API_KEY,
    fuelFinderClientId: env.FUEL_FINDER_CLIENT_ID,
    fuelFinderClientSecret: env.FUEL_FINDER_CLIENT_SECRET,
  });
}
