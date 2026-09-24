import { client } from "@pump-hawk/openapi/client";
import { createAuthClient } from "better-auth/react";
import { phoneNumberClient } from "better-auth/client/plugins";
client.setConfig({ baseUrl: "", credentials: "include" });
export const auth = createAuthClient({
  basePath: "/api/auth",
  plugins: [phoneNumberClient()],
});
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "error" in error)
    return errorMessage(error.error);
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return "We couldn’t load this right now. Please try again.";
}
export const dateLabel = (day: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  }).format(new Date(day + "T12:00:00Z"));
