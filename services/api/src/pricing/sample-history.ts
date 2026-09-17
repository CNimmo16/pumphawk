import { eq, sql } from "drizzle-orm";
import type { createDb } from "../lib/db/db.service";
import { nationalPrice } from "../lib/db/schema";
import { addDays, isoDay, round } from "./forecast";

// PRICES.md: synthetic local development inputs for the normal v2 forecasting model.
export async function seedSampleHistory(
  db: ReturnType<typeof createDb>,
  now: Date,
) {
  return db.transaction(async (tx) => {
    const today = isoDay(now);
    const latest = await tx.query.nationalPrice.findFirst({
      where: {
        source: "fuel-finder",
        date: { lte: today, gte: addDays(today, -2) },
      },
      orderBy: { date: "desc" },
    });
    const anchor = latest?.pricePence ?? 171.5;
    const rows = Array.from({ length: 30 }, (_, i) => {
      const daysAgo = 29 - i;
      return {
        date: addDays(today, -daysAgo),
        source: "sample" as const,
        pricePence: round(
          Math.max(
            30,
            anchor -
              daysAgo * 0.45 -
              Math.min(daysAgo, 5) * 0.65 +
              0.18 * (Math.sin(i / 2.4) - Math.sin(29 / 2.4)),
          ),
        ),
        stationCount: 0,
        observedAt: now,
      };
    });
    const written = await tx
      .insert(nationalPrice)
      .values(rows)
      .onConflictDoUpdate({
        target: nationalPrice.date,
        set: { pricePence: sql`excluded.price_pence`, observedAt: now },
        setWhere: eq(nationalPrice.source, "sample"),
      })
      .returning({ date: nationalPrice.date });
    return {
      sampleDays: written.length,
      retainedObservedDays: rows.length - written.length,
      from: rows[0]!.date,
      through: today,
      anchorPricePence: anchor,
    };
  });
}
