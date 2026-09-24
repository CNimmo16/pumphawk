import { sql } from "drizzle-orm";
import { AppError } from "../../app/errors";
import type { Config } from "../../app/config";
import { providerText, type HttpClient } from "../../data/http";
import { DbService } from "../db/db.service";
import { rateLimit } from "../db/schema";
import { phoneAuthEnabled, validUkMobile } from "./phone";

export class TwilioVerifyService {
  static inject = ["config", "dbService", "httpClient", "clock"] as const;
  constructor(
    private config: Config,
    private store: DbService,
    private http: HttpClient,
    private clock: () => Date,
  ) {}

  private async limit(phone: string, operation: "send" | "check") {
    // Atomic across Workers. Keep phone numbers out of rate-limit identifiers.
    const hash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(phone)),
    );
    const key = `twilio:${operation}:${Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    const now = this.clock().getTime(),
      start = now - 10 * 60_000;
    const [result] = await this.store.db
      .insert(rateLimit)
      .values({
        id: crypto.randomUUID(),
        key,
        count: 1,
        lastRequest: now,
      })
      .onConflictDoUpdate({
        target: rateLimit.key,
        set: {
          count: sql`case when ${rateLimit.lastRequest} <= ${start} then 1 else ${rateLimit.count} + 1 end`,
          lastRequest: sql`case when ${rateLimit.lastRequest} <= ${start} then ${now} else ${rateLimit.lastRequest} end`,
        },
      })
      .returning({ count: rateLimit.count });
    if (!result || result.count > (operation === "send" ? 3 : 10))
      throw new AppError(
        "PHONE_RATE_LIMIT",
        "Too many attempts. Please wait 10 minutes before trying again.",
        429,
      );
  }

  private async request(
    action: "Verifications" | "VerificationCheck",
    phone: string,
    code?: string,
  ) {
    if (!phoneAuthEnabled(this.config))
      throw new AppError(
        "PHONE_AUTH_DISABLED",
        "Phone sign-in is not configured.",
        404,
      );
    if (!validUkMobile(phone))
      throw new AppError(
        "INVALID_PHONE_NUMBER",
        "Enter a valid UK mobile number.",
        400,
      );
    if (action === "VerificationCheck" && !/^\d{6}$/.test(code ?? ""))
      throw new AppError(
        "INVALID_OTP",
        "Enter the six-digit code from your text message.",
        400,
      );
    await this.limit(phone, action === "Verifications" ? "send" : "check");
    const unavailable = () =>
      new AppError(
        "PHONE_PROVIDER_UNAVAILABLE",
        "Phone sign-in is temporarily unavailable. Please try again later.",
        503,
      );
    let data: {
      status?: string;
      to?: string;
      service_sid?: string;
      channel?: string;
      httpStatus?: number;
      code?: number;
    };
    try {
      const body = new URLSearchParams({
        To: phone,
        ...(code ? { Code: code } : { Channel: "sms" }),
      });
      const response = await providerText(
        this.http,
        `https://verify.twilio.com/v2/Services/${encodeURIComponent(this.config.twilioVerifyServiceSid!)}/${action}`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${this.config.twilioAccountSid}:${this.config.twilioAuthToken}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        },
        16_384,
        10_000,
        (httpStatus, text) => {
          let code: unknown;
          try {
            code = JSON.parse(text).code;
          } catch {
            /* Discard provider bodies. */
          }
          return JSON.stringify({
            httpStatus,
            code: typeof code === "number" ? code : undefined,
          });
        },
      );
      data = JSON.parse(response);
      if (!data || typeof data !== "object") throw unavailable();
    } catch {
      // Never propagate Twilio bodies, request headers, phone numbers or codes.
      throw unavailable();
    }
    if (data.httpStatus) {
      if (data.httpStatus === 429 || data.code === 60202 || data.code === 60203)
        throw new AppError(
          "PHONE_RATE_LIMIT",
          "Too many attempts. Please wait 10 minutes before trying again.",
          429,
        );
      if (action === "VerificationCheck" && data.httpStatus === 404)
        return false;
      if (data.httpStatus === 400 && data.code === 60200)
        throw new AppError(
          "INVALID_PHONE_REQUEST",
          "Check your mobile number and verification code, then try again.",
          400,
        );
      throw unavailable();
    }
    if (
      data.to !== phone ||
      data.service_sid !== this.config.twilioVerifyServiceSid ||
      data.channel !== "sms"
    )
      throw unavailable();
    if (action === "Verifications") {
      if (data.status !== "pending") throw unavailable();
      return true;
    }
    return data.status === "approved";
  }

  async send(phone: string) {
    await this.request("Verifications", phone);
  }
  async verify(phone: string, code: string) {
    return this.request("VerificationCheck", phone, code);
  }
}
