import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { DbService } from "../db/db.service";
import * as schema from "../db/schema";
import type { Config } from "../../app/config";
export function createAuth(config: Config, store: DbService) {
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
      customRules: { "/sign-in/social": { window: 60, max: 10 } },
    },
  });
}
export class AuthService {
  static inject = ["config", "dbService"] as const;
  readonly auth: ReturnType<typeof createAuth>;
  constructor(config: Config, store: DbService) {
    this.auth = createAuth(config, store);
  }
}
