import { eq } from "drizzle-orm";
import type {
  z,
  OnboardingSchema,
  StationSelectionSchema,
  Station,
} from "@pump-hawk/contracts";
import { DbService } from "../lib/db/db.service";
import {
  driver,
  station,
  stationPrice,
  trackedStation,
} from "../lib/db/schema";
import { AppError } from "../app/errors";
import { serializeDriver, driverValues } from "../drivers/driver.service";
import { DAY } from "../pricing/forecast";
export function distanceMiles(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const rad = (n: number) => (n * Math.PI) / 180,
    dlat = rad(b.latitude - a.latitude),
    dlon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dlon / 2) ** 2;
  return 3958.7613 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function serializeStation(s: typeof station.$inferSelect): Station {
  return {
    ...s,
    priceUpdatedAt: s.priceUpdatedAt?.toISOString() ?? null,
    checkedAt: s.checkedAt?.toISOString() ?? null,
  };
}
export class StationService {
  static inject = ["dbService", "clock"] as const;
  constructor(
    private store: DbService,
    private clock: () => Date,
  ) {}
  async nearby(location: { latitude: number; longitude: number }) {
    const state = await this.store.db.query.syncState.findFirst({
      where: { key: "fuel-finder" },
    });
    if (!state)
      throw new AppError(
        "STATIONS_UNAVAILABLE",
        "Live stations are not available yet. The first Fuel Finder sync must finish before you can choose stations.",
        503,
      );
    const rows = await this.store.db.query.station.findMany({
      where: {
        latitude: {
          gte: location.latitude - 0.08,
          lte: location.latitude + 0.08,
        },
        longitude: {
          gte: location.longitude - 0.17,
          lte: location.longitude + 0.17,
        },
        closed: false,
      },
    });
    return {
      stations: rows
        .map((s) => ({
          ...serializeStation(s),
          distanceMiles: distanceMiles(location, s),
        }))
        .filter((s) => s.distanceMiles <= 5 && s.pricePence !== null)
        .sort((a, b) => a.distanceMiles - b.distanceMiles),
      radiusMiles: 5 as const,
      checkedAt: state.syncedAt.toISOString(),
    };
  }
  async tracked(userId: string) {
    const since = new Date(+this.clock() - 30 * DAY);
    const rows = await this.store.db.query.trackedStation.findMany({
      where: { userId },
      with: { station: true },
      orderBy: { stationId: "asc" },
    });
    const prices = rows.length
      ? await this.store.db.query.stationPrice.findMany({
          where: {
            stationId: { in: rows.map((r) => r.stationId) },
            observedAt: { gte: since },
          },
          orderBy: { observedAt: "asc" },
        })
      : [];
    return {
      since: since.toISOString(),
      stations: rows.map((r) => ({
        ...serializeStation(r.station),
        history: prices
          .filter((p) => p.stationId === r.stationId)
          .map((p) => ({
            observedAt: p.observedAt.toISOString(),
            pricePence: p.pricePence,
          })),
      })),
    };
  }
  async updateTracked(
    userId: string,
    input: z.infer<typeof StationSelectionSchema>,
  ) {
    return this.saveSelection(userId, input);
  }
  async onboard(userId: string, input: z.infer<typeof OnboardingSchema>) {
    return this.saveSelection(userId, input);
  }
  private async saveSelection(
    userId: string,
    input: z.infer<typeof StationSelectionSchema> & {
      driver?: z.infer<typeof OnboardingSchema>["driver"];
    },
  ) {
    const nearby = await this.nearby(input.location);
    if (
      input.stationIds.length < 1 ||
      input.stationIds.length > 3 ||
      new Set(input.stationIds).size !== input.stationIds.length ||
      input.stationIds.some((id) => !nearby.stations.some((s) => s.id === id))
    )
      throw new AppError(
        "INVALID_STATIONS",
        "Choose one to three available E10 stations within five miles.",
        422,
      );
    if (
      !nearby.checkedAt ||
      +this.clock() - Date.parse(nearby.checkedAt) > 2 * 60 * 60 * 1000
    )
      throw new AppError(
        "STATIONS_STALE",
        "Station prices are awaiting a fresh Fuel Finder sync. Please try again shortly.",
        503,
      );
    return this.store.db.transaction(async (tx) => {
      const values = input.driver
        ? {
            ...driverValues(input.driver, this.clock()),
            onboardingComplete: true,
          }
        : undefined;
      // Both paths lock the driver row to serialize simultaneous selections.
      // SELECT FOR UPDATE is needed here; relational .query has no lock option.
      const [saved] = values
        ? await tx
            .insert(driver)
            .values({ ...values, userId })
            .onConflictDoUpdate({ target: driver.userId, set: values })
            .returning()
        : await tx
            .select()
            .from(driver)
            .where(eq(driver.userId, userId))
            .for("update");
      if (!saved?.onboardingComplete)
        throw new AppError(
          "DRIVER_NOT_FOUND",
          "Complete car onboarding before editing stations.",
          404,
        );
      await tx.delete(trackedStation).where(eq(trackedStation.userId, userId));
      await tx
        .insert(trackedStation)
        .values(input.stationIds.map((stationId) => ({ userId, stationId })));
      // Capture a first *observed* point; never backdate the provider's latest price into invented history.

      for (const s of nearby.stations.filter((s) =>
        input.stationIds.includes(s.id),
      ))
        if (s.pricePence !== null)
          await tx
            .insert(stationPrice)
            .values({
              stationId: s.id,
              observedAt: new Date(s.checkedAt!),
              pricePence: s.pricePence,
            })
            .onConflictDoNothing();
      return serializeDriver(saved!);
    });
  }
}
