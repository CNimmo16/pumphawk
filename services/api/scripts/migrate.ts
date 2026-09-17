import { config } from "dotenv";
import { createDb } from "../src/lib/db/db.service";
import { migrate } from "drizzle-orm/postgres-js/migrator";
config({ path: ".dev.vars", quiet: true });
const connection = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!connection) throw new Error("Run pnpm run setup or set DATABASE_URL.");
const db = createDb(connection);
try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
} finally {
  await db.$client.end();
}
