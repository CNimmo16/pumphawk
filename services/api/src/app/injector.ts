import { DatabentoService } from "../data/databento.service";
import { FuelFinderService } from "../data/fuel-finder.service";
import { SyncService } from "../data/sync.service";
import { StationService } from "../data/station.service";
import { ModelDataService } from "../data/model-data.service";
import { ModelService } from "../pricing/model.service";
import type { HttpClient } from "../data/http";
import { createInjector } from "typed-inject";
import type { Config } from "./config";
import { DbService } from "../lib/db/db.service";
import {
  SmsService,
  StubSmsTransport,
  type SmsTransport,
} from "../lib/sms/sms.service";
import { AuthService } from "../lib/auth/auth.service";
import { MarketService } from "../pricing/market.service";
import { DriverService } from "../drivers/driver.service";
import { VehicleService } from "../drivers/vehicle.service";
import { AlertService } from "../alerts/alert.service";
export function buildInjector(
  config: Config,
  clock = () => new Date(),
  transport: SmsTransport = new StubSmsTransport(),
  httpClient: HttpClient = fetch,
) {
  const root = createInjector();
  const services = root
    .provideValue("config", config)
    .provideValue("httpClient", httpClient)
    .provideValue("clock", clock)
    .provideValue("smsTransport", transport)
    .provideClass("dbService", DbService)
    .provideClass("smsService", SmsService)
    .provideClass("authService", AuthService)
    .provideClass("databentoService", DatabentoService)
    .provideClass("fuelFinderService", FuelFinderService)
    .provideClass("modelDataService", ModelDataService)
    .provideClass("modelService", ModelService)
    .provideClass("syncService", SyncService)
    .provideClass("stationService", StationService)
    .provideClass("marketService", MarketService)
    .provideClass("driverService", DriverService)
    .provideClass("vehicleService", VehicleService)
    .provideClass("alertService", AlertService);
  // Providers form a parent/child tree. Disposing only the last provider
  // leaves its parents (including the request's database pool) alive.
  return {
    resolve: services.resolve.bind(services),
    dispose: () => root.dispose(),
  };
}
export type AppInjector = ReturnType<typeof buildInjector>;
