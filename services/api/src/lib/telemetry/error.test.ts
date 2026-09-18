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
  it.each([
    ["Chrome", "    at load (", ")"],
    ["Firefox", "load@", ""],
    ["Safari", "global code@", ""],
    ["anonymous browser frame", "@", ""],
  ])(
    "preserves %s source locations without URL credentials or parameters",
    (_, prefix, suffix) => {
      const error = new Error(
        "Failed at https://app.test/private?token=secret",
      );
      error.stack = `Error: ${error.message}\n${prefix}https://user:password@app.test/assets/index-abc.js?token=secret#private:12:345${suffix}`;

      const diagnostic = errorDiagnostic(error);

      expect(diagnostic.message).toBe("Failed at [url]");
      expect(diagnostic.stack).toBe(
        `${prefix}https://app.test/assets/index-abc.js:12:345${suffix}`,
      );
    },
  );
  it("keeps Worker bundle coordinates and limits stack depth", () => {
    const error = new Error("Failed query: select secret\nparams: password");
    error.stack = `Error: ${error.message}\n${Array.from(
      { length: 15 },
      (_, index) => `    at run (index.js:${index + 1}:42)`,
    ).join("\n")}`;

    const diagnostic = errorDiagnostic(error);

    expect(diagnostic.stack.split("\n")).toHaveLength(12);
    expect(diagnostic.stack).toContain("    at run (index.js:1:42)");
    expect(diagnostic.stack).not.toContain("password");
  });
  it("still redacts sensitive values in stack frames and causes", () => {
    const error = new Error("failure");
    error.stack =
      "Error: failure\n    at private-value (index.js:1:42)\n    at https://api.test/private?token=secret";
    const cause = new Error("inner failure");
    cause.stack =
      "Error: inner failure\n    at load (https://app.test/assets/index.js?token=secret:5:6)";
    error.cause = cause;

    const diagnostic = errorDiagnostic(error, ["private-value"]);

    expect(diagnostic.stack).toBe(
      "    at [redacted] (index.js:1:42)\n    at [url]",
    );
    expect(diagnostic.cause?.stack).toBe(
      "    at load (https://app.test/assets/index.js:5:6)",
    );
    expect(JSON.stringify(diagnostic)).not.toContain("secret");
  });
});
