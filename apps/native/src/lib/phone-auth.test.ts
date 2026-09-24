import { describe, expect, it } from "vitest";
import { normalizeUkMobile } from "@pump-hawk/presentation/phone-auth";

describe("shared phone sign-in input", () => {
  it("normalizes local and international UK mobile formats to one identity", () => {
    for (const value of [
      "07400 123456",
      "(07400) 123-456",
      "+44 7400 123456",
      "0044 7400 123456",
    ])
      expect(normalizeUkMobile(value)).toBe("+447400123456");
  });
  it("rejects other countries, landlines, incomplete numbers and extensions", () => {
    for (const value of [
      "",
      "+14155552671",
      "020 7946 0000",
      "07400123",
      "07400123456 ext 1",
      "mobile07400123456",
    ])
      expect(normalizeUkMobile(value)).toBeUndefined();
  });
});
