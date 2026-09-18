const origin = process.env.PRODUCTION_ORIGIN;
if (!origin || !process.env.INGEST_API_KEY)
  throw new Error("Missing production smoke-test configuration");
for (const kind of ["daily", "hourly", "models"]) {
  const response = await fetch(`${origin}/api/v1/data/sync/${kind}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.INGEST_API_KEY}` },
    signal: AbortSignal.timeout(600000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      `${kind} bootstrap failed: ${result.error?.code ?? response.status}${result.error?.message ? ` — ${result.error.message}` : ""}`,
    );
  console.log(`${kind}: ${result.skipped ? "already collected" : "complete"}`);
}
for (const [path, model] of [
  ["/api/v1/forecast", "daily-ridge"],
  ["/api/v1/forecast/weekly", "weekly-huber"],
]) {
  const response = await fetch(origin + path, {
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok || result.model !== model)
    throw new Error(`${path} did not return ${model}`);
  console.log(`${model}: live (${result.points.length} points)`);
}
