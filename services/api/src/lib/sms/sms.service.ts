import { eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { smsMessage } from "../db/schema";
import type { Config } from "../../app/config";
import { isoDay } from "../../pricing/forecast";
export type SmsEnvelope = {
  to: string;
  body: string;
  idempotencyKey: string;
  kind: "otp" | "fill-alert";
};
export interface SmsTransport {
  deliver(message: SmsEnvelope): Promise<"stubbed">;
}
/** Intentional no-network stub. The outbox is the delivery receipt. */
export class StubSmsTransport implements SmsTransport {
  async deliver(_message: SmsEnvelope): Promise<"stubbed"> {
    return "stubbed";
  }
}
export class SmsService {
  static inject = ["dbService", "smsTransport", "config", "clock"] as const;
  constructor(
    private store: DbService,
    private transport: SmsTransport,
    private config: Config,
    private clock: () => Date,
  ) {}
  async send(input: SmsEnvelope & { userId?: string }) {
    const [record] = await this.store.db
      .insert(smsMessage)
      .values({
        id: crypto.randomUUID(),
        userId: input.userId,
        phoneNumber: input.to,
        kind: input.kind,
        body: input.body,
        dedupeKey: input.idempotencyKey,
      })
      .onConflictDoNothing({ target: smsMessage.dedupeKey })
      .returning();
    if (!record) return { created: false };
    try {
      const status = await this.transport.deliver(input);
      await this.store.db
        .update(smsMessage)
        .set({ status })
        .where(eq(smsMessage.id, record.id));
      // OTP bodies and phone numbers never enter server logs.
      if (this.config.environment !== "test")
        console.info(
          JSON.stringify({
            event: "sms_stubbed",
            id: record.id,
            kind: input.kind,
          }),
        );
    } catch (error) {
      await this.store.db
        .update(smsMessage)
        .set({ status: "failed" })
        .where(eq(smsMessage.id, record.id));
      throw error;
    }
    return { created: true };
  }
  async retryPending() {
    const rows = await this.store.db.query.smsMessage.findMany({
      where: { kind: "fill-alert", status: { in: ["pending", "failed"] } },
      limit: 100,
      orderBy: { createdAt: "asc" },
      with: { user: { with: { driver: true } } },
    });
    for (const row of rows) {
      // Never deliver a delayed alert after a user opts out or on a later day.
      if (
        !row.user?.driver?.smsEnabled ||
        !row.user.phoneNumberVerified ||
        row.user.phoneNumber !== row.phoneNumber ||
        isoDay(row.createdAt) !== isoDay(this.clock())
      )
        continue;
      const status = await this.transport.deliver({
        to: row.phoneNumber,
        body: row.body,
        idempotencyKey: row.dedupeKey,
        kind: row.kind,
      });
      await this.store.db
        .update(smsMessage)
        .set({ status })
        .where(eq(smsMessage.id, row.id));
    }
  }
}
