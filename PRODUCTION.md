# Production deployment

Pushes to `main` run `.github/workflows/production.yml`. Pull requests run validation only. Deployments are serialized and run only after contract generation checks, TypeScript, unit tests, real PostgreSQL integration tests and both Worker builds pass.

## GitHub configuration

Repository: `CNimmo16/pumphawk`. The deployment job uses the GitHub environment `production`. Add production secrets and variables under **Settings → Environments → production**. Repository-level values remain available as fallbacks; environment-level values take precedence.

| Encrypted secret            | Purpose                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`      | Deploy Workers                                                                        |
| `POSTHOG_CLI_TOKEN`         | Upload source maps; required when PostHog error capture is enabled                    |
| `DATABASE_URL`              | Neon pooled PostgreSQL URI (hostname contains `-pooler`) for the Worker and bootstrap |
| `DIRECT_DATABASE_URL`       | Neon direct PostgreSQL URI for migrations; same branch/database, pooling disabled     |
| `BETTER_AUTH_SECRET`        | Production session signing; at least 32 random characters                             |
| `GOOGLE_CLIENT_ID`          | Google OAuth Web application client ID                                                |
| `GOOGLE_CLIENT_SECRET`      | Google OAuth client secret                                                            |
| `INGEST_API_KEY`            | Protected collection/bootstrap endpoints; at least 24 random characters               |
| `DATABENTO_API_KEY`         | Existing licensed B7H and BZ historical access                                        |
| `FUEL_FINDER_CLIENT_ID`     | Government Fuel Finder client                                                         |
| `FUEL_FINDER_CLIENT_SECRET` | Government Fuel Finder credential                                                     |

Provider and authentication values are uploaded as API Worker secrets through a temporary private file which is deleted immediately afterward. The pooled database URL is uploaded as a Worker secret. The direct migration URL stays in GitHub Actions. It is never placed in a Worker variable or committed config. Never put secret values in workflow YAML or logs.

Optional repository variables:

- `CLOUDFLARE_ACCOUNT_ID`: recommended; required if the token cannot discover exactly one account.
- `APP_ORIGIN`: HTTPS web origin. Defaults to `https://pump-hawk-web.<account-subdomain>.workers.dev`. A custom origin must already be routed to the web Worker.

The token needs Workers Scripts edit and access to the account/subdomain APIs used by `scripts/production-config.mjs`. Restrict it to the intended account. The account must have a workers.dev subdomain. The PostgreSQL origin must accept Cloudflare connections; local Docker Postgres is not reachable by deployed Workers.

## Google sign-in

Create a **Web application** OAuth client in Google Cloud / Google Auth Platform, with these exact authorised redirect URIs:

- Production: `https://pump-hawk-web.filodesign.workers.dev/api/auth/callback/google`
- Local: `http://localhost:3100/api/auth/callback/google`

For a custom domain, use `APP_ORIGIN` plus `/api/auth/callback/google`. The browser uses the web origin (port 3100 locally), which forwards `/api` to the API Worker. Add the client ID and secret to GitHub's `production` environment secrets as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; add local credentials to `services/api/.dev.vars`. Neither credential uses a `VITE_` prefix. The deployment checks for both before applying migrations or deploying Workers.

Set up the Google consent screen for external users; while it is in testing mode, add the Google accounts that should be allowed to sign in as test users. Only the default `openid`, `email` and `profile` scopes are requested. Better Auth manages state, PKCE, the callback and HttpOnly session cookies. Cancelled sign-in returns to the app with a retry message. [Better Auth Google setup](https://better-auth.com/docs/authentication/google).

No database migration is required: Better Auth's existing account/session tables support Google, and the notification phone fields are retained. Existing phone-only identities use placeholder emails and are not automatically merged into newly created Google identities; preserve their data and use an explicit identity-linking migration if needed.

## Neon connections

In Neon’s **Connect** dialog, select the production branch, database and role. Copy the URI with **Connection pooling** enabled into `DATABASE_URL`; switch pooling off and copy the direct URI into `DIRECT_DATABASE_URL`. Preserve Neon’s TLS parameters. Both URLs must target the same database and branch. The migration role needs permission to create schemas, tables and indexes.

The existing Postgres.js driver connects over TCP with `nodejs_compat`; Drizzle transactions and v2 queries are unchanged. Prepared statements are disabled for transaction-pool compatibility, and connections are disposed at the end of each request/job. Local migrations fall back to `DATABASE_URL` when no direct URL is set.

## Deployment sequence

1. Resolve the account and origin; validate both production database URLs and refuse localhost.
2. Generate the ignored `services/api/wrangler.production.json` with production origins and live-data mode.
3. Build both Workers with source maps. When PostHog is enabled, inject bundle identifiers and upload the maps before deploying. Remove browser `.map` files from the public assets.
4. Run forward database migrations and idempotently import genuine daily/weekly history and observed-station state. No user accounts or station selections are replaced.
5. Deploy the injected `pump-hawk-api` bundle without rebuilding, upload its secrets, then deploy the built `pump-hawk-web` with the API service binding.
6. Check the public page and API health; bootstrap daily market and hourly station collection, refresh models, then require `daily-ridge` and `weekly-huber` responses from the two production endpoints. A heuristic fallback does not pass this smoke check.

On later deployments, successful daily/hourly collection slots are reused. Failed data jobs remain recorded; inspect the provider failure before retrying. The production bootstrap source cutoff and archive revisions are embedded in `services/api/data/*.json`. Refresh this genuine archive if first deployment is delayed beyond the daily model's freshness window. Never shift old observations to today's date.

### Recovering a missed daily snapshot

The daily model accepts an anchor at most 48 hours old. A successful hourly sync after 08:00 UTC cannot replace a failed collection before that cutoff. If no recent archive is available either, model bootstrap returns `SNAPSHOT_FEED_STALE` with the missing cutoff; the smoke check prints that explanation. Keep this failure visible rather than relaxing freshness checks or accepting the heuristic as a trained-model success.

To recover from a longer collection outage, download `stations.csv` and `price_history.csv` from one **pinned commit** of [FuelCosts' public archive](https://huggingface.co/datasets/jamesb7/fuel-prices-uk) into `.local/fuelcosts-backfill/<revision>/`. Then run, using the ML Python environment:

```sh
PYTHONPATH=ml .local/ml-venv/bin/python -m scripts.backfill_daily \
  --revision <40-character-commit> \
  --archive-dir .local/fuelcosts-backfill/<revision>
```

Review the appended observations and provenance in `services/api/data/model-history.json`, then deploy normally. The existing bootstrap imports missing rows with `ON CONFLICT DO NOTHING`. The exporter reuses training's equal-station E10 calculation, honours both source and observation timestamps, excludes the final partial London day, and records file hashes. It leaves existing observations, forecast runs, fitted models and research datasets unchanged. Raw downloads stay outside git. This is an explicit maintenance backfill, not another scheduled provider download.

On 18 September 2026, production's last daily observation was 16 September and all 06:00–08:00 collections had failed. Recovery appended the genuine 17 September snapshot from archive revision `9975b48c037a6f4c3b7c40c385b2688c0041b9b7`. The archive does not cover today's cutoff, so no 18 September snapshot was invented. Normal collection supplies the next daily snapshot after recovery.

## Operations

- Markets: once daily at 08:00 UTC; final settlements and definitions, up to 40 days on first import, seven-day overlap afterward. Each provider request has a $0.25 quote cap; no subscriptions are purchased.
- Fuel Finder: hourly at :10; all eligible station observations are retained for model snapshots, while tracked-station charts keep their normal hourly history.
- Models: 08:05 UTC; daily snapshots freeze information available strictly before 08:00. The weekly origin stays at the conservative Thursday 08:00 cutoff. Dashboard requests can materialise a missing forecast from stored inputs without provider calls.
- `forecast_run` preserves each model version's features and results at each origin. Compare future observations against these immutable runs rather than recomputing past forecasts with corrected inputs.
- Daily buying advice uses seven forecast days and explicit 0.5p/L / £1 materiality thresholds. The weekly outlook can trigger an early fill ahead of a later material rise, even if fuel is not needed within seven days. Dashboard, recommendation API and SMS evaluation share these inputs and rules. Days 8–14 of the daily model remain informational; its 14-day band is not calibrated to 90% coverage.
- Sign-in uses Google OAuth. SMS alerts retain their database-backed stub, opt-in flags and verified notification numbers; phone authentication and development OTP routes are removed. Google users do not need a phone number to access their car or dashboard.

Roll back a faulty Worker version with Wrangler or the Cloudflare dashboard, then rerun the deployment smoke checks. These database migrations are additive. Do not drop new tables during an application rollback or delete issued forecasts to make monitoring look better.

## Error capture (PostHog)

Set these **variables** in the GitHub `production` environment to enable error capture on the next deployment:

- `POSTHOG_PROJECT_TOKEN`: the chosen project's public ingestion token (`phc_…`), **not** a personal API token.
- `POSTHOG_HOST`: `https://eu.i.posthog.com` for EU or `https://us.i.posthog.com` for US; match the project's region.
- `POSTHOG_PROJECT_ID`: the numeric ID of that same project, used to upload source maps.

Also add the **secret** `POSTHOG_CLI_TOKEN`: a PostHog personal API key with **error tracking write** and **organization read** scopes for that project. It is used only by the deployment job, never passed to a Worker or the browser. The workflow uses the same `PostHog/upload-source-maps@v0.5.7.0` action and input names as Waxly's app-stack workflow. Uploads go to `https://eu.posthog.com` or `https://us.posthog.com`, derived from the ingestion host.

PostHog remains optional: leave the ingestion token and host unset to keep errors in Cloudflare's structured logs only. When enabled, the deployment requires the project ID and upload secret before migrations or deployment, and source-map upload failures stop deployment. The workflow passes the ingestion token/host to the API Worker and browser build and tags events and source maps with the Git commit. The browser token is public by design. No session replay, pageview analytics, person profiles, or click autocapture is enabled. Errors are sanitized, and browser event properties are restricted to an allowlist; request bodies, headers, user IDs, phone numbers, coordinates and SQL parameters are not attached. Stack frames retain script origins, paths, line numbers and column numbers for source-map resolution; URL credentials, queries and fragments are removed.

API failures and scheduled sync errors use a per-invocation PostHog client with bounded delivery time. Browser uncaught errors, rejected promises, React route-boundary errors and failed queries/mutations are captured. Both builds generate source maps; the workflow injects and uploads them to PostHog, removes browser maps from `dist/client`, and deploys the same bundles without rebuilding. Worker maps remain available for Cloudflare's private source-map upload. Web Worker SSR error capture is not configured yet.

After deployment, verify the uploaded symbol sets in the selected PostHog project's Error tracking settings, then capture a controlled browser/API error and check that its stack resolves to the original TypeScript source. See [PostHog's source-map upload guidance](https://posthog.com/docs/error-tracking/upload-source-maps/github-actions).

Provider requests use manual redirects, reject non-success statuses, and never forward credentials to a redirect target. Daily/hourly sync claims permit at most three attempts per period, only retry failed jobs, and never repeat a completed download. Running or exhausted jobs return `SYNC_UNAVAILABLE` rather than falsely reporting success. Inspect Cloudflare/PostHog before any manual recovery of exhausted/stuck jobs; retries can incur additional Databento download charges (each download remains cost-capped).

SDK guidance: https://posthog.com/docs/libraries/cloudflare-workers and https://posthog.com/docs/error-tracking/installation/web.

## Native client

The Expo app in `apps/native` uses this API. Better Auth includes its Expo plugin and trusts the `pumphawk://` return scheme. Authenticated application writes accept exactly `APP_ORIGIN` or `pumphawk://`; session authentication and browser origin checks remain required. No API/database secrets belong in the native bundle. Native Google login uses the existing Google HTTPS callback followed by a secure-store session handoff to the app. See [native setup](apps/native/README.md) for build-time configuration. The workflow validates native bundles but does not submit an EAS build or publish an app-store release.
