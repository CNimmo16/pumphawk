import type { Driver, DriverInputType } from "@pump-hawk/contracts";
import { DbService } from "../lib/db/db.service";
import { eq } from "drizzle-orm";
import { driver } from "../lib/db/schema";
import { AppError } from "../app/errors";
export function serializeDriver(row: typeof driver.$inferSelect): Driver {
  return {
    ...row,
    fuelUpdatedAt: row.fuelUpdatedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
export function driverValues(input: DriverInputType, now: Date) {
  const mileageMode = input.mileageMode ?? "average",
    weekdayMiles = input.weekdayMiles ?? Array(7).fill(input.dailyMiles);
  if (
    mileageMode === "weekly" &&
    (!input.weekdayMiles || weekdayMiles.length !== 7)
  )
    throw new AppError(
      "MILEAGE_REQUIRED",
      "Enter mileage for all seven days.",
      422,
    );
  return {
    ...input,
    mileageMode,
    weekdayMiles,
    dailyMiles:
      mileageMode === "weekly"
        ? weekdayMiles.reduce((a, b) => a + b, 0) / 7
        : input.dailyMiles,
    fuelUpdatedAt: now,
    updatedAt: now,
  };
}
export class DriverService {
  static inject = ["dbService", "clock"] as const;
  constructor(
    private store: DbService,
    private clock: () => Date,
  ) {}
  async get(userId: string) {
    const row = await this.store.db.query.driver.findFirst({
      where: { userId },
    });
    if (!row)
      throw new AppError(
        "DRIVER_NOT_FOUND",
        "Add your car and current tank level to get a personal fill-up plan.",
        404,
      );
    return serializeDriver(row);
  }
  async updateTank(userId: string, currentLitres: number) {
    const row = await this.get(userId);
    if (currentLitres > row.tankCapacityLitres)
      throw new AppError(
        "TANK_CAPACITY",
        "Fuel cannot exceed your tank capacity.",
        422,
      );
    const [saved] = await this.store.db
      .update(driver)
      .set({
        currentLitres,
        fuelUpdatedAt: this.clock(),
        updatedAt: this.clock(),
      })
      .where(eq(driver.userId, userId))
      .returning();
    return serializeDriver(saved!);
  }
  async save(userId: string, input: DriverInputType) {
    const now = this.clock();
    const values = driverValues(input, now);
    const [row] = await this.store.db
      .insert(driver)
      .values({ ...values, userId })
      .onConflictDoUpdate({
        target: driver.userId,
        set: values,
      })
      .returning();
    return serializeDriver(row!);
  }
}
