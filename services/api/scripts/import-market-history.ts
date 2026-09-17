// Optional local bootstrap from the already acquired, audited research archive.
// Production uses the bounded daily provider job instead; no paid raw data is committed.
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { createDb } from "../src/lib/db/db.service";
import { modelSettlementEvent, modelFxRate } from "../src/lib/db/schema";
import { parseCsv } from "../src/data/http";
config({ path: ".dev.vars", quiet: true });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db = createDb(process.env.DATABASE_URL);
const root = new URL("../../../.local/model-data/processed/", import.meta.url);
const minimum = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
try {
  const events = parseCsv(
    readFileSync(new URL("settlement-events.csv", root), "utf8"),
  )
    .filter((r) => r.reference! >= minimum)
    .map((r) => ({
      product: r.product!.toUpperCase() as "B7H" | "BZ",
      symbol: r.raw_symbol!,
      date: r.reference!.slice(0, 10),
      publishedAt: new Date(r.available_at!),
      expiresAt: new Date(r.expires_at!),
      priceUsd: Number(r.update_action) === 2 ? 0 : Number(r.price),
      deleted: Number(r.update_action) === 2,
    }));
  const rates = parseCsv(readFileSync(new URL("fx.csv", root), "utf8"))
    .filter((r) => r.TIME_PERIOD! >= minimum)
    .map((r) => ({
      date: r.TIME_PERIOD!.slice(0, 10),
      availableAt: new Date(r.available_at!),
      usdPerGbp: Number(r.usd_per_gbp),
    }));
  await db.transaction(async (tx) => {
    for (let i = 0; i < events.length; i += 500)
      await tx
        .insert(modelSettlementEvent)
        .values(events.slice(i, i + 500))
        .onConflictDoNothing();
    if (rates.length)
      await tx.insert(modelFxRate).values(rates).onConflictDoNothing();
  });
  console.log(
    `Imported ${events.length} timestamped market events and ${rates.length} FX rates.`,
  );
} finally {
  await db.$client.end();
}
