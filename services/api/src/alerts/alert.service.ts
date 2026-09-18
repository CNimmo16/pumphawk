import { DbService } from "../lib/db/db.service";
import { SmsService } from "../lib/sms/sms.service";
import { MarketService } from "../pricing/market.service";
import { recommend } from "../pricing/recommendation";
import { serializeDriver } from "../drivers/driver.service";
export const londonDate = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
export const isAlertHour = (now: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now) === "08";
export class AlertService {
  static inject = [
    "dbService",
    "smsService",
    "marketService",
    "clock",
  ] as const;
  constructor(
    private store: DbService,
    private sms: SmsService,
    private market: MarketService,
    private clock: () => Date,
  ) {}
  async evaluate() {
    const now = this.clock(),
      { forecast, weekly } = await this.market.forecastsForAdvice();
    let sent = 0,
      checked = 0,
      cursor: string | undefined;
    // Keyset pagination keeps the scheduled invocation bounded in memory.
    while (true) {
      const drivers = await this.store.db.query.driver.findMany({
        where: {
          smsEnabled: true,
          ...(cursor ? { userId: { gt: cursor } } : {}),
        },
        with: { user: true },
        orderBy: { userId: "asc" },
        limit: 100,
      });
      if (!drivers.length) break;
      for (const row of drivers) {
        checked++;
        if (!row.user.phoneNumberVerified || !row.user.phoneNumber) continue;
        const advice = recommend(serializeDriver(row), forecast, now, weekly);
        if (
          !["fill-now", "top-up"].includes(advice.action) ||
          advice.litresToBuy < 0.1
        )
          continue;
        const result = await this.sms.send({
          userId: row.userId,
          to: row.user.phoneNumber,
          kind: "fill-alert",
          idempotencyKey: `fill:${row.userId}:${londonDate(now)}`,
          body: `${forecast.mode === "demo" ? "[DEMO] " : forecast.mode === "sample" ? "[SAMPLE] " : ""}Pump Hawk: ${advice.title} Buy ${advice.litresToBuy.toFixed(1)}L (about £${advice.estimatedCostGbp.toFixed(2)}). ${advice.reason} Manage alerts in Pump Hawk.`,
        });
        if (result.created) sent++;
      }
      cursor = drivers.at(-1)!.userId;
    }
    await this.sms.retryPending();
    return { checked, stubbed: sent };
  }
}
