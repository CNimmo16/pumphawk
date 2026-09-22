import { describe, expect, it, vi } from "vitest";
import { buildInjector } from "./injector";
import { ConfigSchema } from "./config";

describe("request service lifecycle", () => {
  it("disposes the database provider in the parent chain exactly once", async () => {
    const injector = buildInjector(
      ConfigSchema.parse({
        environment: "test",
        appOrigin: "http://localhost:3100",
        authUrl: "http://localhost:3100",
        authSecret: "test-secret-longer-than-32-characters",
        ingestApiKey: "test-ingestion-key-longer-than-24",
        databaseUrl:
          "postgres://pumphawk:pumphawk@127.0.0.1:55435/pumphawk_test",
        marketDataMode: "demo",
        marketSource: "provider",
      }),
    );
    const database = injector.resolve("dbService");
    // postgres-js connects lazily; this verifies cleanup without opening a DB socket.
    const close = vi.spyOn(database, "dispose");
    await injector.dispose();
    await injector.dispose();
    expect(close).toHaveBeenCalledTimes(1);
    expect(() => injector.resolve("dbService")).toThrow();
  });
});
