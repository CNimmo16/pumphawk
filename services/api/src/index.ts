import { isAlertHour } from "./alerts/alert.service";
import { createApp } from "./app/app";
import { readConfig } from "./app/config";
import { buildInjector } from "./app/injector";
const app = createApp();
export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    const injector = buildInjector(
      readConfig(env),
      () => new Date(event.scheduledTime),
    );
    ctx.waitUntil(
      (async () => {
        try {
          const service = injector.resolve("syncService");
          if (event.cron === "10 * * * *") {
            const result = await service.hourly();
            console.info(JSON.stringify({ event: "data_sync", ...result }));
          } else {
            if (event.cron === "0 8 * * *") {
              const result = await service.daily();
              console.info(JSON.stringify({ event: "data_sync", ...result }));
            }
            // Preserve existing opt-in SMS stub behaviour; only its dashboard card was removed.
            if (isAlertHour(new Date(event.scheduledTime))) {
              const result = await injector.resolve("alertService").evaluate();
              console.info(
                JSON.stringify({ event: "alerts_evaluated", ...result }),
              );
            }
          }
        } finally {
          await injector.dispose();
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
