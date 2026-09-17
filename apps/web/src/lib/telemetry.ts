import posthog from "posthog-js";
import { errorDiagnostic } from "@pump-hawk/contracts/telemetry";
let started = false;
export function initErrorReporting() {
  if (started || typeof window === "undefined") return;
  const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN;
  const host = import.meta.env.VITE_POSTHOG_HOST;
  if (!token || !host) return;
  started = true;
  posthog.init(token, {
    api_host: host,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_exceptions: false,
    disable_session_recording: true,
    disable_persistence: true,
    person_profiles: "never",
    ip: false,
    advanced_disable_feature_flags: true,
    before_send: (event) => {
      if (!event || event.event !== "$exception") return null;
      // Allow only error metadata; discard SDK URL/referrer/device/session context.
      const p = event.properties;
      event.properties = {
        distinct_id: p.distinct_id,
        $exception_list: p.$exception_list,
        $exception_level: p.$exception_level,
        $exception_fingerprint: p.$exception_fingerprint,
        $exception_personURL: undefined,
        $process_person_profile: false,
        $geoip_disable: true,
        $ip: "0.0.0.0",
        service: "pump-hawk-web",
        context: p.context,
        release: import.meta.env.VITE_RELEASE,
      };
      return event;
    },
  });
  window.addEventListener("error", (event) =>
    captureError(event.error, "uncaught"),
  );
  window.addEventListener("unhandledrejection", (event) =>
    captureError(event.reason, "unhandled-rejection"),
  );
}
export function captureError(error: unknown, context: string) {
  if (!started) return;
  const diagnostic = errorDiagnostic(error);
  const safe = new Error(diagnostic.message);
  safe.name = diagnostic.name;
  safe.stack = `${safe.name}: ${safe.message}\n${diagnostic.stack}`;
  try {
    posthog.captureException(safe, { context });
  } catch {
    /* Preserve app behaviour. */
  }
}
