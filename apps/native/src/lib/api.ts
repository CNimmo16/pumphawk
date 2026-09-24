import { createAuthClient } from "better-auth/react";
import { phoneNumberClient } from "better-auth/client/plugins";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";
import { client } from "@pump-hawk/openapi/client";
import { fetchWithTimeout } from "./fetch";

export const apiUrl = (
  process.env.EXPO_PUBLIC_API_URL ??
  "https://pump-hawk-web.filodesign.workers.dev"
).replace(/\/$/, "");
if (!/^https?:\/\//.test(apiUrl))
  throw new Error("EXPO_PUBLIC_API_URL must be an http(s) origin.");
// Hide the development form in release builds and when using the deployed API.
// The server independently rejects email authentication outside development.
export const showLocalSignIn =
  __DEV__ &&
  ["localhost", "127.0.0.1", "[::1]", "10.0.2.2"].includes(
    new URL(apiUrl).hostname,
  );
export const auth = createAuthClient({
  baseURL: apiUrl,
  basePath: "/api/auth",
  fetchOptions: { customFetchImpl: fetchWithTimeout },
  plugins: [
    phoneNumberClient(),
    expoClient({
      scheme: "pumphawk",
      storagePrefix: `pumphawk-${new URL(apiUrl).host.replace(/[^a-zA-Z0-9.-]/g, "-")}`,
      storage: SecureStore,
    }),
  ],
});
client.setConfig({
  baseUrl: apiUrl,
  credentials: "omit",
  fetch: fetchWithTimeout,
});
client.interceptors.request.use(async (request) => {
  const cookie = await auth.getCookie();
  if (cookie) request.headers.set("Cookie", cookie);
  request.headers.set("Origin", "pumphawk://");
  return request;
});
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    if ("error" in error) return errorMessage(error.error);
    if ("message" in error && typeof error.message === "string")
      return error.message;
  }
  return "We couldn’t load this right now. Check your connection and try again.";
}
export function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object") {
    if ("error" in error) return errorCode(error.error);
    if ("code" in error && typeof error.code === "string") return error.code;
  }
}
export const dateLabel = (day: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  }).format(new Date(day.length === 10 ? day + "T12:00:00Z" : day));
