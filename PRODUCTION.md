# Production deployment

Pushes to `main` run `.github/workflows/production.yml`. Pull requests run validation only. Deployments are serialized and run only after contract generation checks, TypeScript, unit tests, real PostgreSQL integration tests and both Worker builds pass.

## GitHub configuration

Repository: `CNimmo16/pumphawk`.

| Encrypted secret            | Purpose                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`      | Deploy Workers and manage the application's Hyperdrive connection           |
| `DATABASE_URL`              | Direct reachable PostgreSQL connection for migrations and history bootstrap |
| `BETTER_AUTH_SECRET`        | Production session signing; at least 32 random characters                   |
| `INGEST_API_KEY`            | Protected collection/bootstrap endpoints; at least 24 random characters     |
| `DATABENTO_API_KEY`         | Existing licensed B7H and BZ historical access                              |
| `FUEL_FINDER_CLIENT_ID`     | Government Fuel Finder client                                               |
| `FUEL_FINDER_CLIENT_SECRET` | Government Fuel Finder credential                                           |

Provider and authentication values are uploaded as API Worker secrets through a temporary private file which is deleted immediately afterward. The database password is sent only to GitHub's encrypted secret store, PostgreSQL and the configured Cloudflare Hyperdrive origin. It is never placed in a Worker variable or committed config. Never put secret values in workflow YAML or logs.

Optional repository variables:

- `CLOUDFLARE_ACCOUNT_ID`: recommended; required if the token cannot discover exactly one account.
- `HYPERDRIVE_ID`: an existing connection with query caching **disabled**. Without it, the workflow finds or creates `pump-hawk-production` using `DATABASE_URL`.
- `APP_ORIGIN`: HTTPS web origin. Defaults to `https://pump-hawk-web.<account-subdomain>.workers.dev`. A custom origin must already be routed to the web Worker.

The token needs Workers Scripts edit and access to the account/subdomain and Hyperdrive APIs used by `scripts/production-config.mjs`. Restrict it to the intended account. The account must have a workers.dev subdomain. The PostgreSQL origin must accept Cloudflare connections; local Docker Postgres is not reachable by deployed Workers.

## Deployment sequence

1. Resolve the account, origin and Hyperdrive ID; refuse localhost database URLs and query caching.
2. Generate the ignored `services/api/wrangler.production.json` with production origins, live-data mode and actual Hyperdrive binding.
3. Run forward database migrations and idempotently import genuine daily/weekly history and observed-station state. No user accounts or station selections are replaced.
4. Deploy `pump-hawk-api`, upload its secrets, build/deploy `pump-hawk-web` with the API service binding.
5. Check the public page and API health; bootstrap daily market and hourly station collection, refresh models, then require `daily-ridge` and `weekly-huber` responses from the two production endpoints. A heuristic fallback does not pass this smoke check.

On later deployments, successful daily/hourly collection slots are reused. Failed data jobs remain recorded; inspect the provider failure before retrying. The production bootstrap source cutoff and archive revisions are embedded in `services/api/data/*.json`. Refresh this genuine archive if first deployment is delayed beyond the daily model's freshness window. Never shift old observations to today's date.

## Operations

- Markets: once daily at 08:00 UTC; final settlements and definitions, up to 40 days on first import, seven-day overlap afterward. Each provider request has a $0.25 quote cap; no subscriptions are purchased.
- Fuel Finder: hourly at :10; all eligible station observations are retained for model snapshots, while tracked-station charts keep their normal hourly history.
- Models: 08:05 UTC; daily snapshots freeze information available strictly before 08:00. The weekly origin stays at the conservative Thursday 08:00 cutoff. Dashboard requests can materialise a missing forecast from stored inputs without provider calls.
- `forecast_run` preserves each model version's features and results at each origin. Compare future observations against these immutable runs rather than recomputing past forecasts with corrected inputs.
- Daily buying advice uses seven forecast days and explicit 0.5p/L / £1 materiality thresholds. Days 8–14 are informational; the daily 14-day band is not calibrated to 90% coverage.
- SMS verification is still the existing database-backed stub. Production does not expose development OTPs; real phone signup needs a real SMS transport.

Roll back a faulty Worker version with Wrangler or the Cloudflare dashboard, then rerun the deployment smoke checks. These database migrations are additive. Do not drop new tables during an application rollback or delete issued forecasts to make monitoring look better.
