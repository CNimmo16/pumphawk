import { config } from "dotenv";
import { ConfigSchema } from "../src/app/config";
export function localConfig() {
  config({ path: ".dev.vars", quiet: true });
  return ConfigSchema.parse({
    environment: "development",
    appOrigin: "http://localhost:3100",
    authUrl: "http://localhost:3100",
    authSecret: process.env.BETTER_AUTH_SECRET,
    ingestApiKey: process.env.INGEST_API_KEY,
    databaseUrl: process.env.DATABASE_URL,
    marketDataMode: process.env.MARKET_DATA_MODE ?? "live",
    databentoApiKey: process.env.DATABENTO_API_KEY,
    fuelFinderClientId: process.env.FUEL_FINDER_CLIENT_ID,
    fuelFinderClientSecret: process.env.FUEL_FINDER_CLIENT_SECRET,
  });
}
