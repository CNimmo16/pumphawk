import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { relations } from "./relations";
import type { Config } from "../../app/config";
export function createDb(url: string) {
  const client = postgres(url, {
    max: 5,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
  });
  return drizzle({ client, relations });
}
export class DbService {
  static inject = ["config"] as const;
  readonly db: ReturnType<typeof createDb>;
  constructor(config: Config) {
    this.db = createDb(config.databaseUrl);
  }
  async dispose() {
    await this.db.$client.end({ timeout: 5 });
  }
}
