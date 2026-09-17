import { localConfig } from "./local-config";
import { buildInjector } from "../src/app/injector";
import { AppError } from "../src/app/errors";
const injector = buildInjector(localConfig());
try {
  const kind = process.argv[2];
  if (kind === "models") {
    const data = injector.resolve("modelDataService");
    await data.weekly();
    try {
      await data.snapshot();
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== "SNAPSHOT_FEED_STALE")
        throw error;
      console.log(
        "No pre-cutoff collection; retaining the last genuine snapshot.",
      );
    }
    await injector.resolve("modelService").daily();
    await injector.resolve("modelService").weekly();
    console.log("Model observations and forecasts refreshed.");
  } else {
    if (kind !== "daily" && kind !== "hourly")
      throw new Error("Usage: sync-data.ts daily|hourly|models");
    console.log(
      JSON.stringify(await injector.resolve("syncService")[kind](), null, 2),
    );
  }
} catch (error) {
  console.error(
    error instanceof AppError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.name
        : "Sync failed",
  );
  process.exitCode = 1;
} finally {
  await injector.dispose();
}
