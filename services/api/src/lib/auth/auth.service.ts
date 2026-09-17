import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { phoneNumber } from "better-auth/plugins";
import { DbService } from "../db/db.service";
import * as schema from "../db/schema";
import type { Config } from "../../app/config";
import { SmsService } from "../sms/sms.service";
export function createAuth(config: Config, store: DbService, sms: SmsService) {
  return betterAuth({
    appName: "Pump Hawk",
    baseURL: config.authUrl,
    basePath: "/api/auth",
    secret: config.authSecret,
    database: drizzleAdapter(store.db, {
      provider: "pg",
      schema,
      transaction: true,
    }),
    trustedOrigins: [config.appOrigin],
    emailAndPassword: { enabled: false },
    advanced: {
      useSecureCookies: config.environment === "production",
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/phone-number/send-otp": { window: 60, max: 3 },
        "/phone-number/verify": { window: 60, max: 10 },
      },
    },
    plugins: [
      phoneNumber({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 5,
        phoneNumberValidator: (phone) => /^\+447\d{9}$/.test(phone),
        sendOTP: async ({ phoneNumber: phone, code }) => {
          await sms.send({
            to: phone,
            kind: "otp",
            body: `Your Pump Hawk code is ${code}. It expires in 5 minutes.`,
            idempotencyKey: crypto.randomUUID(),
          });
        },
        signUpOnVerification: {
          getTempEmail: (phone) => `${phone.slice(1)}@phone.pumphawk.invalid`,
          getTempName: () => "Driver",
        },
      }),
    ],
  });
}
export class AuthService {
  static inject = ["config", "dbService", "smsService"] as const;
  readonly auth: ReturnType<typeof createAuth>;
  constructor(config: Config, store: DbService, sms: SmsService) {
    this.auth = createAuth(config, store, sms);
  }
}
