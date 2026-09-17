import { config } from "dotenv";
import { createDb } from "../src/lib/db/db.service";
import { seedSampleHistory } from "../src/pricing/sample-history";
config({ path: ".dev.vars", quiet: true });
if (!process.env.DATABASE_URL)
  throw new Error("Run pnpm run setup or set DATABASE_URL.");
const target = new URL(process.env.DATABASE_URL);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
  String(process.env.ENVIRONMENT) === "production"
)
  throw new Error(
    "Sample seeding requires a local development PostgreSQL database.",
  );
const db = createDb(process.env.DATABASE_URL);
try {
  console.log(await seedSampleHistory(db, new Date()));
  console.log(
    "Set MARKET_DATA_MODE=sample in services/api/.dev.vars to use this history with stored futures and FX. Existing Fuel Finder observations are preserved.",
  );
} finally {
  await db.$client.end();
}
