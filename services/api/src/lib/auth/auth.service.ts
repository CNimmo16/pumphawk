import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { phoneNumber } from "better-auth/plugins";
import { expo } from "@better-auth/expo";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { DbService } from "../db/db.service";
import * as schema from "../db/schema";
import type { Config } from "../../app/config";
import { AppError } from "../../app/errors";
import { phoneAuthEnabled, validUkMobile } from "./phone";
import { TwilioVerifyService } from "./twilio-verify.service";
// This is a server-side environment check, never a client-supplied flag.
export const localEmailAuthEnabled = (config: Config) =>
  config.environment === "development";

async function phoneOperation<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    throw new APIError(
      error.status === 429
        ? "TOO_MANY_REQUESTS"
        : error.status === 400
          ? "BAD_REQUEST"
          : "SERVICE_UNAVAILABLE",
      {
        code: error.code,
        message: error.message,
      },
    );
  }
}
export function createAuth(
  config: Config,
  store: DbService,
  verify: TwilioVerifyService,
) {
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
    trustedOrigins: [config.appOrigin, "pumphawk://"],
    plugins: [
      expo(),
      ...(phoneAuthEnabled(config)
        ? [
            phoneNumber({
              otpLength: 6,
              expiresIn: 600,
              requireVerification: true,
              phoneNumberValidator: validUkMobile,
              // Twilio generates and consumes the real OTP; Better Auth's generated code is unused.
              sendOTP: ({ phoneNumber }) =>
                phoneOperation(() => verify.send(phoneNumber)),
              verifyOTP: ({ phoneNumber, code }) =>
                phoneOperation(() => verify.verify(phoneNumber, code)),
              signUpOnVerification: {
                getTempEmail: () =>
                  `${crypto.randomUUID()}@phone.pumphawk.invalid`,
                getTempName: () => "Driver",
              },
            }),
          ]
        : []),
    ],
    emailAndPassword: {
      enabled: localEmailAuthEnabled(config),
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    socialProviders:
      config.googleClientId && config.googleClientSecret
        ? {
            google: {
              clientId: config.googleClientId,
              clientSecret: config.googleClientSecret,
              prompt: "select_account",
              accessType: "online",
            },
          }
        : {},
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      useSecureCookies: config.environment === "production",
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/social": { window: 60, max: 10 },
        "/phone-number/send-otp": { window: 60, max: 3 },
        "/phone-number/verify": { window: 60, max: 10 },
      },
    },
  });
}
export class AuthService {
  static inject = ["config", "dbService", "twilioVerifyService"] as const;
  readonly auth: ReturnType<typeof createAuth>;
  constructor(config: Config, store: DbService, verify: TwilioVerifyService) {
    this.auth = createAuth(config, store, verify);
  }
}
