import { localConfig } from "./local-config";
import { buildInjector } from "../src/app/injector";
import { AppError } from "../src/app/errors";
const injector = buildInjector(localConfig());
try {
  const kind = process.argv[2];
  if (kind !== "daily" && kind !== "hourly")
    throw new Error("Usage: sync-data.ts daily|hourly");
  console.log(
    JSON.stringify(await injector.resolve("syncService")[kind](), null, 2),
  );
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
