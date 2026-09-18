# Pump Hawk

Registration-based car setup is optional: see [VEHICLE_LOOKUP.md](./VEHICLE_LOOKUP.md) for provider setup and `ONE_AUTO_API_KEY`. Selected stations stay at the top of the onboarding list under both distance and price sorting.

A UK E10 petrol planner: Hono REST API and TanStack Start on Cloudflare Workers, PostgreSQL, Drizzle Relations v2, Better Auth Google login, typed-inject services and a generated Hey API/TanStack Query client.

**Implemented:** daily Databento B7H/Brent settlement ingestion, hourly government Fuel Finder prices, a 14-day forecast with signal breakdowns, car/weekday-mileage onboarding, a map of stations within five miles, up to three tracked stations, and tank updates. SMS notifications still use a stub. Production deployment is configured through [GitHub Actions](.github/workflows/production.yml); see [deployment setup](PRODUCTION.md).

## Run locally

Requires Node 22.12+, pnpm 11.20 and Docker Compose.

```sh
pnpm install
pnpm run setup
pnpm db:up
pnpm db:migrate
```

Add server-only credentials to `services/api/.dev.vars` (see its `.example` file):

```dotenv
DATABENTO_API_KEY=...
FUEL_FINDER_CLIENT_ID=...
FUEL_FINDER_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Then:

```sh
pnpm data:sync daily          # initial 40-day futures/FX backfill; later runs overlap 7 days
pnpm data:sync hourly         # initial station catalogue and current E10 prices
pnpm dev                     # API, frontend and local data scheduler
```

`pnpm dev` checks stored jobs on startup, then runs daily market collection at 08:00 UTC and hourly station collection at :10. Wrangler itself does not trigger cron schedules locally; `data:watch` runs the same services. To add scheduling to already-running API/web dev servers, use `pnpm data:watch` in another terminal. Stop it with Ctrl-C. The app must be running for local scheduled collection; deployed Workers use cron triggers instead.

- [Dashboard](http://localhost:3100)
- [Interactive REST reference](http://localhost:3100/api/docs)
- [OpenAPI 3.1 contract](http://localhost:3100/api/openapi.json)
- Direct API: `http://localhost:8787`
- Docker Postgres: `localhost:55435`

Create a Google OAuth **Web application** client with `http://localhost:3100/api/auth/callback/google` as an authorised redirect URI. If the consent screen is in testing mode, add your Google account as a test user. Sign in with Google, enter car details and driving estimates, then use your location or a postcode to select one to three E10 stations. UK MPG uses imperial gallons. A separate tank update preserves your car, driving schedule and stations.

`pnpm db:down` stops Postgres and preserves its volume. `/api/v1/demo` remains an explicitly synthetic legacy API example. Normal configuration uses `MARKET_DATA_MODE=live`.

### Sample pump history for local development

After migrations and the initial live imports, run `pnpm db:seed`. It fills 30 calendar days with a deterministic sample national-price series, anchored to the latest fresh Fuel Finder price (171.5p/L if none exists). The example has recent daily increases so the normal momentum signal can be exercised.

Set `MARKET_DATA_MODE=sample` in `services/api/.dev.vars` and restart the API dev server if it does not reload the variable. Local forecasts then combine the sample history with the stored B7H, Brent and FX data using the same 14-day model and buying advice. The dashboard clearly labels the sample history.

- The command only targets a loopback PostgreSQL host. Re-running updates sample rows without duplicating dates or overwriting collected Fuel Finder prices.
- Sample rows have `source=sample` and zero reporting stations. Hourly real observations replace a sample on that date; real rows retain `source=fuel-finder`.
- `MARKET_DATA_MODE=live` excludes samples, even when the rows exist in the database. Sample mode is permitted only with `ENVIRONMENT=development`.
- Accounts, cars, tracked stations and their actual price history are preserved. Re-run the seed on a later day to refresh the dated example; live mode continues to reject stale data normally.

## Data pipeline

| Data                      | Provider                                                                     | Stored                                                                             | Schedule         |
| ------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------- |
| Petrol futures            | Databento `GLBX.MDP3`, `B7H.FUT` definitions, outright settlement statistics | Contract, reference date, USD/tonne price, expiry, publication/download timestamps | Daily, 08:00 UTC |
| Brent crude futures       | Databento `GLBX.MDP3`, `BZ.FUT`                                              | Same fields, USD/barrel                                                            | Same daily job   |
| GBP/USD                   | ECB reference rates via the ECB API                                          | USD per GBP by date                                                                | Same daily job   |
| Forecourts and E10 prices | Government Fuel Finder read-only API                                         | Current station details and latest reported price                                  | Hourly at :10    |
| National E10 average      | Mean of open reporting Fuel Finder stations                                  | One observation per UK day, updated during the day, sample size                    | Hourly           |
| Tracked price history     | Current Fuel Finder observations                                             | One observation per tracked station per successful hourly job                      | Hourly           |

### Download behaviour

- Browser requests only read stored market/station prices; they never download paid futures data.
- Discover the three nearest unexpired outright B7H and BZ contracts, then download final settlement statistics. Ignore spread contracts, preliminary/intraday prices and price limits. The first run requests 40 days; later daily runs overlap seven days. Download intervals end at collection time; model features filter publication timestamps to their fixed forecast origin. Historical definitions are downloaded for the same contract interval.
- A metadata estimate checks each Databento request before download, failing closed above **$0.25 per request** (up to three downloads per daily job). There are no live subscriptions or vendor requests. Credentials go only to the intended provider and are never logged.
- Fuel Finder uses one OAuth token per hourly run, sequential paginated calls (500 forecourts per batch), incremental timestamps with a one-hour overlap, and a full refresh each new UK day. The live API host is `https://www.fuel-finder.service.gov.uk`.
- Provider responses have timeouts, size limits and validation. Station catalogue updates, prices, hourly tracked observations, the national average and watermark commit together. Failed runs retain the last committed data.
- PostgreSQL `data_job` primary keys claim a UTC day/hour before contacting providers. Concurrent invocations and repeat dashboard visits cannot duplicate downloads. Failures remain recorded and retry at the next scheduled period. A stopped/interrupted job also waits until the next period; inspect `data_job` for operational status.
- Raw futures settlements remain server-side; the public forecast contains derived signals. Production entitlements and derived-data rights remain subject to your Databento/CME agreement.

**Live history:** Fuel Finder's current-price feed does not provide a retroactive daily history. The initial import supplies today's actual national price. In live mode, the national chart reserves the past 14 days and fills them as observations accumulate; station charts start at the earliest collected observation, capped at 30 days. Synthetic development rows are excluded from live forecasts. Existing provider prices can contain reporting/location errors; displayed stations use the provider's coordinates.

## Trained models

The dashboard uses the daily ridge model for the 14-day road-ahead chart and a separate weekly Huber model for the official sales-weighted UK outlook. Daily buying advice evaluates meaningful savings over reachable dates in the next seven days; days 8–14 from that model are informational. A meaningful later rise in the separate weekly outlook can recommend an early fill even with plenty of fuel remaining. A worthwhile short-term dip takes priority; weekly predictions are never interpolated into daily prices. Tooltips show fitted pence-per-litre contributions. Empirical ranges are not guaranteed probabilities, especially at day 14.

`pnpm data:bootstrap` imports genuine source-labelled daily/weekly history and the last-known observed-station baseline. It is idempotent and preserves existing observations. For local use of previously downloaded research markets, run `pnpm --filter @pump-hawk/api exec node --import tsx scripts/import-market-history.ts`. Production obtains market inputs through its daily provider job. `pnpm data:sync models` refreshes model observations and materialises forecasts; browser requests never contact data providers.

Model inputs live in append-only event tables and immutable 08:00 UTC daily snapshots. The daily observed-station proxy is separate from the hourly open-station average and the official weekly sales-weighted series. Each issued forecast retains its model version, input vector and predictions. Missing required model inputs produce an explicitly labelled heuristic fallback on the daily endpoint; weekly unavailability is reported directly.

The public `GET /api/v1/forecast/weekly` endpoint returns only the next two official observation forecasts. `POST /api/v1/data/sync/models` is protected by the ingestion key. Python/TypeScript parity and as-of timing are tested. See [full model evaluation](ml/TRAINING_RESULTS.md).

## Forecast and fuel policy

The supplied research and exact assumptions are in [PRICES.md](./PRICES.md), referenced by the business logic.

For the labelled heuristic fallback, the next day's recent pump momentum gets 90% weight once five daily changes are available, falling to about 10% by day 14. Remaining weight goes 80/20 to GBP-converted B7H/Brent signals. Comparing the same futures contract across time avoids rollover jumps. Missing/stale signals are disabled and reduce certainty. Faster rises and slower cuts follow the supplied research. Ranges are illustrative, not calibrated confidence intervals; this fallback has not been fitted; the primary models have separate held-out evaluations.

Fuel planning uses the actual weekday schedule, imperial MPG and the last gauge reading. It keeps at least 5L or 10% of capacity in reserve, chooses reachable fill dates and caps purchases at free capacity. Readings over seven days old require an update. National average prices are not quotes for a particular station.

## Structure

Follows the service/package conventions in `~/Documents/waxly/monorepo`:

```text
apps/web/src/components/   Google login, three-step onboarding, Leaflet map, SVG charts
services/api/src/
  app/                     Hono/OpenAPI routes, config and typed-inject composition
  data/                    Databento, FX, Fuel Finder, job ingestion and station services
  pricing/                 Pure forecast/recommendation policies and stored-data queries
  drivers/                 Car, mileage and tank settings
  alerts/                  Legacy manual alert evaluation
  lib/auth/                Better Auth Google signup/login
  lib/db/                  PostgreSQL schema, Drizzle v2 relations and connections
  lib/sms/                 Persisted no-network SMS stub
services/api/drizzle/      Generated migrations and snapshots
packages/contracts/       Zod request/response schemas
packages/openapi/         Generated OpenAPI, Hey API SDK and TanStack Query bindings
```

Services declare typed `static inject` tokens. Each request/job owns and disposes its injector and PostgreSQL connection pool. Reads use Drizzle **v2 `db.query`** object filters/relations. Mutations use inserts/updates/transactions; Fuel Finder price batches use parameterised SQL to avoid thousands of round trips. ORM/Kit are pinned to `1.0.0-rc.4`; Better Auth uses the Relations v2 adapter.

The frontend Worker forwards `/api/*` to the API Worker through a service binding; Vite uses a local same-origin proxy. No provider, ingestion or database secrets enter the client. Leaflet is loaded on the client only; OpenStreetMap tiles and optional Postcodes.io lookup require network access.

## REST contract

```sh
pnpm openapi
```

Do not hand-edit generated clients. Frontend queries/mutations consume `@pump-hawk/openapi/react-query`.

| Method   | Endpoint                                              | Access                     | Purpose                                                         |
| -------- | ----------------------------------------------------- | -------------------------- | --------------------------------------------------------------- |
| GET      | `/api/health`, `/api/docs`, `/api/openapi.json`       | Public                     | Health and documentation                                        |
| POST     | `/api/auth/sign-in/social`                            | Rate limited               | Start Google signup/login                                       |
| GET/POST | `/api/auth/get-session`, `/sign-out`                  | Cookie                     | Session/logout                                                  |
| GET      | `/api/v1/forecast`                                    | Public                     | Actual history and next 14 days, bounds and signals             |
| GET      | `/api/v1/demo`                                        | Public                     | Explicitly synthetic example                                    |
| GET/PUT  | `/api/v1/me/driver`                                   | Session cookie             | Car and mileage; PUT confirms a fresh gauge reading             |
| PUT      | `/api/v1/me/onboarding`                               | Session cookie             | Save car, driving and selected nearby stations atomically       |
| PATCH    | `/api/v1/me/tank`                                     | Session cookie             | Update current litres only                                      |
| GET      | `/api/v1/me/stations/nearby?latitude=…&longitude=…`   | Session cookie             | Available E10 stations within five miles                        |
| GET      | `/api/v1/me/stations`                                 | Session cookie             | Selected stations and up to 30 days of price observations       |
| GET      | `/api/v1/me/dashboard`, `/api/v1/me/recommendation`   | Session cookie             | Personal buying plan                                            |
| POST     | `/api/v1/data/sync/daily`, `/api/v1/data/sync/hourly` | Ingestion bearer key       | Run the same idempotent jobs manually                           |
| POST     | `/api/v1/market/observations`                         | Ingestion bearer key       | Legacy manual observation import; not used by the live pipeline |
| GET/POST | `/api/v1/me/messages`, `/api/v1/alerts/evaluate`      | Session/admin respectively | Legacy SMS stub endpoints                                       |

Application errors use `{ "error": { "code": "...", "message": "..." } }`; Better Auth keeps its own code/message format. Unsafe `/me` operations require the configured `Origin`; ownership comes from the verified session, never a submitted user ID. Onboarding validates one to three distinct stations within five miles on the server. Search coordinates are not stored on the driver profile.

The dashboard can return `forecast: null`, `recommendation: null` and `forecastError` when market data is missing/stale, so users can still see/update their car. Live mode never falls back to a demo.

## SMS

Google is the only sign-in method; phone sign-in, OTP routes and the local OTP endpoint are removed. SMS notifications retain `StubSmsTransport`, the outbox, consent flags, retries and scheduled evaluation at 08:00 Europe/London. No real SMS is sent yet. Alerts still require an opted-in driver and a stored verified notification phone number. Those fields and existing sessions are preserved; a Google account without a phone can use the app and simply receives no SMS. The text-alert card remains removed and new onboardings default to no alerts. Adding/verifying a notification phone independently of sign-in will be a separate flow before enabling SMS for new Google users.

Google identities are matched by their provider account, not by a phone number. Legacy phone-only users have placeholder emails and are not automatically merged with Google accounts. Their records remain intact; any account migration must explicitly link the correct identity.

## Validation

```sh
pnpm test                    # forecasting, provider parsers and fuel planning
pnpm test:integration        # PostgreSQL, Better Auth, ownership, onboarding and job deduplication
pnpm typecheck
pnpm build                   # generated contract, API dry run and web Worker production build
pnpm format:check
```

Integration tests migrate/reset only the dedicated `pumphawk_test` database. Custom `TEST_DATABASE_URL` must end in `_test`.

## Production deployment

The [CI/deployment workflow](.github/workflows/production.yml) runs generated-contract checks, TypeScript, unit tests, PostgreSQL integration tests and Worker builds. Main-branch deployments migrate PostgreSQL, import genuine history, deploy the API and web Workers, bootstrap feeds and verify that both model endpoints are live.

See [PRODUCTION.md](PRODUCTION.md) for required GitHub secrets, Neon connection settings, smoke checks and rollback. Production uses Neon’s pooled `DATABASE_URL` as a Worker secret and `DIRECT_DATABASE_URL` for migrations. Local development uses Docker PostgreSQL through `.dev.vars`.
