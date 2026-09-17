import { isAlertHour } from "./alerts/alert.service";
import { createApp } from "./app/app";
import { readConfig } from "./app/config";
import { buildInjector, type AppInjector } from "./app/injector";
import { reportError } from "./lib/telemetry/report";
const app = createApp();
export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    let injector: AppInjector | undefined;
    ctx.waitUntil(
      (async () => {
        try {
          injector = buildInjector(readConfig(env));
          const activeInjector = injector;
          const service = injector.resolve("syncService");
          if (event.cron === "10 * * * *") {
            const result = await service.hourly();
            console.info(JSON.stringify({ event: "data_sync", ...result }));
          } else {
            if (event.cron === "0 8 * * *") {
              const result = await service.daily();
              console.info(JSON.stringify({ event: "data_sync", ...result }));
            }
            if (event.cron === "5 8 * * *") {
              const data = injector.resolve("modelDataService");
              const results = await Promise.allSettled([
                data
                  .snapshot()
                  .then(() => activeInjector.resolve("modelService").daily()),
                data
                  .weekly()
                  .then(() => activeInjector.resolve("modelService").weekly()),
              ]);
              const failures = results.filter((r) => r.status === "rejected");
              if (failures.length) {
                console.error(
                  JSON.stringify({
                    event: "model_refresh_failed",
                    failures: failures.length,
                  }),
                );
                throw new Error("Model refresh incomplete", {
                  cause: failures[0]?.reason,
                });
              }
            }
            // Preserve existing opt-in SMS stub behaviour; only its dashboard card was removed.
            if (isAlertHour(new Date(event.scheduledTime))) {
              const result = await injector.resolve("alertService").evaluate();
              console.info(
                JSON.stringify({ event: "alerts_evaluated", ...result }),
              );
            }
          }
        } catch (error) {
          await reportError(
            error,
            env,
            `scheduled:${event.cron}`,
            Object.values(env).filter(
              (v): v is string => typeof v === "string" && v.length > 12,
            ),
          );
          throw error;
        } finally {
          await injector?.dispose();
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
