import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const names = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "INGEST_API_KEY",
  "DATABENTO_API_KEY",
  "FUEL_FINDER_CLIENT_ID",
  "FUEL_FINDER_CLIENT_SECRET",
];
const values = Object.fromEntries(
  names.map((name) => {
    if (!process.env[name]) throw new Error(`Missing GitHub secret ${name}`);
    return [name, process.env[name]];
  }),
);
const directory = await mkdtemp(join(tmpdir(), "pump-hawk-secrets-"));
// Registration lookup is optional; missing configuration leaves manual entry available.
if (process.env.ONE_AUTO_API_KEY)
  values.ONE_AUTO_API_KEY = process.env.ONE_AUTO_API_KEY;
// Wrangler's bulk API deletes secrets whose value is null.
// Removing a GitHub credential must also disable an already-configured Worker.
for (const name of [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_VERIFY_SERVICE_SID",
])
  values[name] = process.env[name]?.trim() || null;
try {
  const file = join(directory, "secrets.json");
  await writeFile(file, JSON.stringify(values), { mode: 0o600 });
  const result = spawnSync(
    "pnpm",
    [
      "--filter",
      "@pump-hawk/api",
      "exec",
      "wrangler",
      "secret",
      "bulk",
      file,
      "--config",
      "wrangler.production.json",
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error("Worker secret upload failed");
} finally {
  await rm(directory, { recursive: true, force: true });
}
