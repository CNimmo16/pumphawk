import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const names = [
  "BETTER_AUTH_SECRET",
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
