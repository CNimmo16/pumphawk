import { eq, sql } from "drizzle-orm";
import { DbService } from "../lib/db/db.service";
import {
  dataJob,
  exchangeRate,
  futuresSettlement,
  nationalPrice,
  station,
  stationPrice,
  syncState,
  modelPumpEvent,
  modelSettlementEvent,
  modelFxRate,
} from "../lib/db/schema";
import { DatabentoService } from "./databento.service";
import {
  FuelFinderService,
  parsePrice,
  parseModelPrice,
  parseStation,
} from "./fuel-finder.service";
import { AppError } from "../app/errors";
import { isoDay, round } from "../pricing/forecast";
export class SyncService {
  static inject = [
    "dbService",
    "databentoService",
    "fuelFinderService",
    "clock",
  ] as const;
  constructor(
    private store: DbService,
    private databento: DatabentoService,
    private fuelFinder: FuelFinderService,
    private clock: () => Date,
  ) {}
  private async once(key: string, run: () => Promise<Record<string, number>>) {
    const [claim] = await this.store.db
      .insert(dataJob)
      .values({ key, status: "running", startedAt: this.clock() })
      .onConflictDoUpdate({
        target: dataJob.key,
        set: {
          status: "running",
          startedAt: this.clock(),
          finishedAt: null,
          error: null,
          attempts: sql`${dataJob.attempts} + 1`,
        },
        setWhere: sql`${dataJob.status} = 'failed' and ${dataJob.attempts} < 3`,
      })
      .returning();
    if (!claim) {
      const job = await this.store.db.query.dataJob.findFirst({
        where: { key },
      });
      if (job?.status === "complete") return { skipped: true, key };
      throw new AppError(
        "SYNC_UNAVAILABLE",
        job?.status === "running"
          ? "This sync is already running."
          : "Sync failed three times; inspect the logs before retrying on the next scheduled period.",
        503,
      );
    }
    try {
      const result = await run();
      await this.store.db
        .update(dataJob)
        .set({ status: "complete", finishedAt: this.clock() })
        .where(eq(dataJob.key, key));
      return { skipped: false, key, ...result };
    } catch (error) {
      await this.store.db
        .update(dataJob)
        .set({
          status: "failed",
          finishedAt: this.clock(),
          error: error instanceof AppError ? error.code : "SYNC_FAILED",
        })
        .where(eq(dataJob.key, key));
      throw error;
    }
  }
  async daily() {
    const now = this.clock();
    return this.once(
      `databento:${now.toISOString().slice(0, 10)}`,
      async () => {
        const existing =
          await this.store.db.query.modelSettlementEvent.findFirst();
        const result = await this.databento.daily(now, !existing);
        const rates = await this.databento.exchangeRates(
          result.start,
          result.end,
        );
        await this.store.db.transaction(async (tx) => {
          if (result.events.length)
            await tx
              .insert(modelSettlementEvent)
              .values(result.events)
              .onConflictDoNothing();
          const previousRates = await tx.query.modelFxRate.findMany({
            where: { date: { gte: result.start } },
            orderBy: { availableAt: "asc" },
          });
          const knownRates = new Map(
            previousRates.map((r) => [r.date, r.usdPerGbp]),
          );
          const newRates = rates
            .filter((r) => knownRates.get(r.date) !== r.usdPerGbp)
            .map((r) => ({
              ...r,
              availableAt: new Date(
                Math.max(
                  Date.parse(r.date + "T18:00:00Z"),
                  knownRates.has(r.date) ? +this.clock() : 0,
                ),
              ),
            }));
          if (newRates.length)
            await tx.insert(modelFxRate).values(newRates).onConflictDoNothing();
          for (const row of result.settlements)
            await tx
              .insert(futuresSettlement)
              .values({ ...row, downloadedAt: now })
              .onConflictDoUpdate({
                target: [
                  futuresSettlement.product,
                  futuresSettlement.symbol,
                  futuresSettlement.date,
                ],
                set: { ...row, downloadedAt: now },
                setWhere: sql`${futuresSettlement.publishedAt} <= ${row.publishedAt.toISOString()}::timestamptz`,
              });
          for (const row of rates)
            await tx
              .insert(exchangeRate)
              .values(row)
              .onConflictDoUpdate({ target: exchangeRate.date, set: row });
        });
        return {
          settlements: result.settlements.length,
          exchangeRates: rates.length,
        };
      },
    );
  }
  async hourly() {
    const now = this.clock(),
      hour = now.toISOString().slice(0, 13);
    return this.once(`fuel-finder:${hour}`, async () => {
      const prior = await this.store.db.query.syncState.findFirst({
        where: { key: "fuel-finder" },
      });
      const full = !prior || isoDay(prior.syncedAt) !== isoDay(now);
      const since = full ? undefined : new Date(+prior.syncedAt - 3600000);
      const token = await this.fuelFinder.token();
      const stations: NonNullable<ReturnType<typeof parseStation>>[] = [],
        prices: NonNullable<ReturnType<typeof parsePrice>>[] = [];
      const modelEvents: NonNullable<ReturnType<typeof parseModelPrice>>[] = [];
      for await (const page of this.fuelFinder.pages(token, "stations", since))
        for (const raw of page) {
          const row = parseStation(raw);
          if (row) stations.push(row);
        }
      for await (const page of this.fuelFinder.pages(token, "prices", since))
        for (const raw of page) {
          const receivedAt = this.clock();
          const row = parsePrice(raw, receivedAt);
          if (row) prices.push(row);
          const event = parseModelPrice(raw, receivedAt);
          if (event) modelEvents.push(event);
        }
      if (full && (!stations.length || !prices.length))
        throw new AppError(
          "EMPTY_FUEL_FEED",
          "Fuel Finder returned no usable stations or prices; previous data was retained.",
          503,
        );
      return this.store.db.transaction(async (tx) => {
        const uniqueStations = [
          ...new Map(stations.map((s) => [s.id, s])).values(),
        ];
        for (let i = 0; i < uniqueStations.length; i += 250)
          await tx
            .insert(station)
            .values(uniqueStations.slice(i, i + 250))
            .onConflictDoUpdate({
              target: station.id,
              set: {
                name: sql`excluded.name`,
                brand: sql`excluded.brand`,
                address: sql`excluded.address`,
                postcode: sql`excluded.postcode`,
                latitude: sql`excluded.latitude`,
                longitude: sql`excluded.longitude`,
                motorway: sql`excluded.motorway`,
                closed: sql`excluded.closed`,
              },
            });
        // Bulk updates avoid one database round trip per forecourt.
        for (let i = 0; i < prices.length; i += 250) {
          const chunk = prices.slice(i, i + 250);
          if (!chunk.length) continue;
          const values = sql.join(
            chunk.map(
              (p) =>
                sql`(${p.id}::text,${p.pricePence}::double precision,${p.priceUpdatedAt?.toISOString() ?? null}::timestamptz)`,
            ),
            sql`, `,
          );
          await tx.execute(
            sql`update station as s set price_pence=v.price,price_updated_at=v.stamp from (values ${values}) as v(id,price,stamp) where s.id=v.id and v.stamp is not null and (s.price_updated_at is null or v.stamp >= s.price_updated_at)`,
          );
        }
        await tx.update(station).set({ checkedAt: now });
        const eligible = new Set(
          (await tx.query.station.findMany({ columns: { id: true } })).map(
            (s) => s.id,
          ),
        );
        const observedEvents = modelEvents.filter((e) =>
          eligible.has(e.stationId),
        );
        for (let i = 0; i < observedEvents.length; i += 500)
          await tx
            .insert(modelPumpEvent)
            .values(observedEvents.slice(i, i + 500))
            .onConflictDoNothing();
        const all = await tx.query.station.findMany({
          where: { closed: false, pricePence: { isNotNull: true } },
        });
        const valid = all.filter((s) => s.pricePence !== null);
        if (!valid.length)
          throw new AppError(
            "NO_PETROL_PRICES",
            "Fuel Finder has no usable open-station E10 prices.",
            503,
          );
        const national = {
          date: isoDay(now),
          source: "fuel-finder" as const,
          pricePence: round(
            valid.reduce((sum, s) => sum + s.pricePence!, 0) / valid.length,
            3,
          ),
          stationCount: valid.length,
          observedAt: now,
        };
        await tx
          .insert(nationalPrice)
          .values(national)
          .onConflictDoUpdate({ target: nationalPrice.date, set: national });
        const tracked = await tx.query.trackedStation.findMany();
        const ids = new Set(tracked.map((t) => t.stationId));
        const observations = valid
          .filter((s) => ids.has(s.id))
          .map((s) => ({
            stationId: s.id,
            observedAt: now,
            pricePence: s.pricePence!,
          }));
        for (let i = 0; i < observations.length; i += 500)
          await tx
            .insert(stationPrice)
            .values(observations.slice(i, i + 500))
            .onConflictDoNothing();
        await tx
          .insert(syncState)
          .values({ key: "fuel-finder", syncedAt: now })
          .onConflictDoUpdate({
            target: syncState.key,
            set: { syncedAt: now },
          });
        return {
          stations: stations.length,
          priceUpdates: prices.length,
          tracked: observations.length,
          nationalSample: valid.length,
        };
      });
    });
  }
}
