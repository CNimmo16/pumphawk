export const REQUEST_TIMEOUT_MS = 15_000;

/** Bound connection attempts, including a stalled TLS handshake on a local API. */
export async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0] | URL,
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const controller = new AbortController();
  const signal =
    init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input instanceof URL ? input.toString() : input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut)
      throw new Error(
        "The connection to Pump Hawk timed out. Check your connection and try again.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
