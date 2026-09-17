import { config } from "dotenv";
import { createDb } from "../src/lib/db/db.service";
import { migrate } from "drizzle-orm/postgres-js/migrator";
config({ path: ".dev.vars", quiet: true });
if (!process.env.DATABASE_URL)
  throw new Error("Run pnpm run setup or set DATABASE_URL.");
const db = createDb(process.env.DATABASE_URL);
try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
} finally {
  await db.$client.end();
}
