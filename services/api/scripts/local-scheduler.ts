// Wrangler dev doesn't execute cron triggers automatically. Use the same services locally.
import { buildInjector } from "../src/app/injector";
import { AppError } from "../src/app/errors";
import { localConfig } from "./local-config";
const config = localConfig(),
  seen = new Map<string, string>();
let stopped = false,
  wake: () => void = () => {};
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    stopped = true;
    wake();
  });
console.log(
  "Local data scheduler: daily markets at 08:00 UTC, station prices hourly at :10. Checking stored jobs on startup.",
);
while (!stopped) {
  const now = new Date(),
    utc = now.toISOString();
  for (const kind of ["daily", "hourly"] as const) {
    const slot = kind === "daily" ? utc.slice(0, 10) : utc.slice(0, 13);
    if (
      seen.get(kind) === slot ||
      (seen.has(kind) &&
        (kind === "daily" ? now.getUTCHours() < 8 : now.getUTCMinutes() < 10))
    )
      continue;
    const injector = buildInjector(config);
    seen.set(kind, slot);
    try {
      const result = await injector.resolve("syncService")[kind]();
      console.log(JSON.stringify({ event: "local_data_sync", ...result }));
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "local_data_sync_failed",
          kind,
          code: error instanceof AppError ? error.code : "SYNC_FAILED",
        }),
      );
    } finally {
      await injector.dispose();
    }
    if (stopped) break;
  }
  if (!stopped)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 60000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
}
