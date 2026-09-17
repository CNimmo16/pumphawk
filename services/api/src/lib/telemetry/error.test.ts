import { describe, it, expect, vi } from "vitest";
import { errorDiagnostic } from "./error";
import { reportError } from "./report";

describe("safe error reporting", () => {
  it("removes credentials, SQL parameters, phone numbers and URL query strings", () => {
    const error = new Error(
      "Failed query: select secret\nparams: secret-password",
    );
    error.cause = new Error(
      "connect postgres://user:pass@host/db https://api.test?key=secret Bearer abc +447700900123 user@example.com private-value",
    );
    const result = JSON.stringify(errorDiagnostic(error, ["private-value"]));
    for (const value of [
      "secret-password",
      "user:pass",
      "?key",
      "Bearer abc",
      "447700",
      "user@example.com",
      "private-value",
    ])
      expect(result).not.toContain(value);
    expect(result).toContain("Database query failed");
  });
  it("logs locally without contacting PostHog when no project is configured", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const http = vi.spyOn(globalThis, "fetch");
    try {
      await reportError(new TypeError("Invalid redirect value"), {}, "test");
      expect(log).toHaveBeenCalledOnce();
      expect(http).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      http.mockRestore();
    }
  });
});
