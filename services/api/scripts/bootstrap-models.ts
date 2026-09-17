import { config } from "dotenv";
import { createDb } from "../src/lib/db/db.service";
import { modelPrice, modelPumpEvent } from "../src/lib/db/schema";
import history from "../data/model-history.json";
import baseline from "../data/model-station-baseline.json";
config({ path: ".dev.vars", quiet: true });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const db = createDb(process.env.DATABASE_URL);
try {
  await db.transaction(async (tx) => {
    for (let i = 0; i < history.prices.length; i += 200)
      await tx
        .insert(modelPrice)
        .values(
          history.prices
            .slice(i, i + 200)
            .map((p) => ({
              ...p,
              frequency: p.frequency as "daily" | "weekly",
              availableAt: new Date(p.availableAt),
            })),
        )
        .onConflictDoNothing();
    for (let i = 0; i < baseline.events.length; i += 500)
      await tx
        .insert(modelPumpEvent)
        .values(
          baseline.events
            .slice(i, i + 500)
            .map((p) => ({
              ...p,
              availableAt: new Date(p.availableAt),
              receivedAt: new Date(p.receivedAt),
              sourceAt: new Date(p.sourceAt),
            })),
        )
        .onConflictDoNothing();
  });
  console.log(
    "Genuine model history and station baseline imported; existing observations preserved.",
  );
} finally {
  await db.$client.end();
}
