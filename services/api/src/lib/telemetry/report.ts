import { PostHog } from "posthog-node";
import { errorDiagnostic } from "./error";

export interface TelemetryConfig {
  POSTHOG_PROJECT_TOKEN?: string;
  POSTHOG_HOST?: string;
  RELEASE?: string;
}
// Per-invocation client: no background timer or cross-request queue in Workers.
export async function reportError(
  error: unknown,
  config: TelemetryConfig,
  context: string,
  secrets: string[] = [],
) {
  const diagnostic = errorDiagnostic(error, secrets);
  console.error(
    JSON.stringify({ event: "operation_failed", context, error: diagnostic }),
  );
  if (!config.POSTHOG_PROJECT_TOKEN || !config.POSTHOG_HOST) return;
  let client: PostHog | undefined;
  try {
    client = new PostHog(config.POSTHOG_PROJECT_TOKEN, {
      host: config.POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
      requestTimeout: 3000,
      fetchRetryCount: 0,
      disableGeoip: true,
    });
    const safe = new Error(diagnostic.message);
    safe.name = diagnostic.name;
    safe.stack = `${safe.name}: ${safe.message}\n${diagnostic.stack}`;
    await client.captureExceptionImmediate(safe, "pump-hawk-api", {
      service: "pump-hawk-api",
      context,
      release: config.RELEASE,
      cause: diagnostic.cause,
      $process_person_profile: false,
      $ip: "0.0.0.0",
    });
  } catch {
    // Reporting must never replace the application error or fail the request.
    console.warn(JSON.stringify({ event: "error_reporting_failed", context }));
  } finally {
    await client?.shutdown(1000).catch(() => {});
  }
}
