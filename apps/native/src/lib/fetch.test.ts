import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, REQUEST_TIMEOUT_MS } from "./fetch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stalledFetch() {
  const transport = vi.fn<typeof fetch>(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        const abort = () => reject(new DOMException("Aborted", "AbortError"));
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      }),
  );
  vi.stubGlobal("fetch", transport);
  return transport;
}

describe("native API transport", () => {
  it("aborts stalled connections and exposes a useful error within 15 seconds", async () => {
    vi.useFakeTimers();
    const transport = stalledFetch();
    const request = fetchWithTimeout("https://localhost:8787/api/health");
    const result = expect(request).rejects.toThrow(
      "connection to Pump Hawk timed out",
    );
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await result;
    expect(transport.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves cancellation from a generated client's Request", async () => {
    vi.useFakeTimers();
    stalledFetch();
    const controller = new AbortController();
    const request = fetchWithTimeout(
      new Request("http://localhost:8787/api/health", {
        signal: controller.signal,
      }),
    );
    const result = expect(request).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honours an already cancelled request", async () => {
    stalledFetch();
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchWithTimeout("http://localhost:8787/api/health", {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("preserves the response and auth request options, and clears the deadline", async () => {
    vi.useFakeTimers();
    const response = new Response("null", {
      headers: { "Content-Type": "application/json" },
    });
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response);
    vi.stubGlobal("fetch", transport);
    const options = {
      method: "GET",
      headers: { Origin: "pumphawk://" },
      credentials: "omit" as const,
    };
    await expect(
      fetchWithTimeout("http://localhost:8787/api/auth/get-session", options),
    ).resolves.toBe(response);
    expect(transport.mock.calls[0]![1]).toMatchObject(options);
    expect(vi.getTimerCount()).toBe(0);
  });
});
