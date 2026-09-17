import { writeFile, appendFile } from "node:fs/promises";

// Runs only in the deployment job. Never prints tokens, connection strings or API bodies.
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) throw new Error("Missing GitHub secret CLOUDFLARE_API_TOKEN");
async function api(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok || !data.success)
    throw new Error(
      `Cloudflare ${init.method ?? "GET"} ${path} failed (HTTP ${response.status}, codes ${(data.errors ?? []).map((e) => e.code).join(",")}). Check token permissions.`,
    );
  return data.result;
}
let account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!account) {
  const accounts = await api("/accounts");
  if (accounts.length !== 1)
    throw new Error(
      "Set repository variable CLOUDFLARE_ACCOUNT_ID to select the deployment account.",
    );
  account = accounts[0].id;
}
console.log(`Cloudflare account: ${account}`);
const domain = await api(`/accounts/${account}/workers/subdomain`);
if (!domain.subdomain)
  throw new Error(
    "Configure a workers.dev subdomain in the Cloudflare dashboard first.",
  );
const origin =
  process.env.APP_ORIGIN ||
  `https://pump-hawk-web.${domain.subdomain}.workers.dev`;
if (new URL(origin).protocol !== "https:" || new URL(origin).origin !== origin)
  throw new Error("APP_ORIGIN must be an HTTPS origin without a path.");
const connection = process.env.DATABASE_URL;
if (!connection)
  throw new Error(
    "Add the GitHub secret DATABASE_URL for reachable production PostgreSQL. Local Docker Postgres cannot serve deployed Workers.",
  );
const db = new URL(connection);
if (
  !["postgres:", "postgresql:"].includes(db.protocol) ||
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(db.hostname)
)
  throw new Error(
    "DATABASE_URL must point to reachable production PostgreSQL.",
  );
let hyperdrive = process.env.HYPERDRIVE_ID;
if (!hyperdrive) {
  const configs = await api(`/accounts/${account}/hyperdrive/configs`);
  hyperdrive = configs.find((c) => c.name === "pump-hawk-production")?.id;
  if (!hyperdrive) {
    const created = await api(`/accounts/${account}/hyperdrive/configs`, {
      method: "POST",
      body: JSON.stringify({
        name: "pump-hawk-production",
        origin: {
          scheme: "postgres",
          host: db.hostname,
          port: Number(db.port || 5432),
          database: decodeURIComponent(db.pathname.slice(1)),
          user: decodeURIComponent(db.username),
          password: decodeURIComponent(db.password),
        },
        caching: { disabled: true },
      }),
    });
    hyperdrive = created.id;
  }
}
const configuration = await api(
  `/accounts/${account}/hyperdrive/configs/${hyperdrive}`,
);
if (
  configuration.origin?.host !== db.hostname ||
  Number(configuration.origin?.port) !== Number(db.port || 5432) ||
  configuration.origin?.database !== decodeURIComponent(db.pathname.slice(1))
)
  throw new Error(
    "HYPERDRIVE_ID and DATABASE_URL must refer to the same production database.",
  );
if (configuration.caching?.disabled !== true)
  throw new Error(
    "Disable query caching on the application Hyperdrive connection before deployment.",
  );
const config = {
  name: "pump-hawk-api",
  account_id: account,
  main: "src/index.ts",
  compatibility_date: "2026-09-17",
  compatibility_flags: ["nodejs_compat"],
  workers_dev: true,
  observability: { enabled: true, head_sampling_rate: 1 },
  vars: {
    ENVIRONMENT: "production",
    APP_ORIGIN: origin,
    BETTER_AUTH_URL: origin,
    MARKET_DATA_MODE: "live",
    MARKET_SOURCE: "provider",
  },
  hyperdrive: [{ binding: "HYPERDRIVE", id: hyperdrive }],
  triggers: { crons: ["0 7 * * *", "0 8 * * *", "5 8 * * *", "10 * * * *"] },
};
await writeFile(
  "services/api/wrangler.production.json",
  JSON.stringify(config, null, 2),
);
if (process.env.GITHUB_ENV)
  await appendFile(
    process.env.GITHUB_ENV,
    `CLOUDFLARE_ACCOUNT_ID=${account}\nPRODUCTION_ORIGIN=${origin}\n`,
  );
if (process.env.GITHUB_STEP_SUMMARY)
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `Production origin: ${origin}\n\nHyperdrive: ${hyperdrive}\n`,
  );
console.log(`Prepared production configuration for ${origin}`);
