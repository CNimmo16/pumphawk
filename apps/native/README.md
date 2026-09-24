# Pump Hawk native

Expo SDK 57 / React Native 0.86, Expo Router, TypeScript and Tailwind 4 through Uniwind. iOS and Android clients for the existing Pump Hawk API. This workspace targets native; `apps/web` remains the web app.

## What is included

- Google sign-in and optional Twilio phone sign-up/sign-in through Better Auth, with session cookies in SecureStore. Saved settings are shared with the web app.
- Overview: personalised fill-up recommendation, buying amount, conditional savings, tank estimate, one combined daily/weekly outlook. The backend remains the single source of prediction and buying logic, including proactive filling ahead of a weekly rise.
- National chart: 14 days of station-average history, seven daily predictions with certainty shading, then discrete official weekly predictions and range bars on available dates. A labelled day-seven handover distinguishes the benchmarks; no weekly-to-daily interpolation or artificial extension. Tap/drag, screen-reader actions and a date list reveal exact prices, ranges and signal contributions.
- A caution appears when matched daily/weekly predicted changes have non-overlapping empirical ranges. Comparisons require fresh fitted models and a shared historical date, and exclude sample data. Missing later weekly dates are explained inline.
- Three-step onboarding: registration lookup when the provider is available; manual car details; average or seven-day mileage; five-mile station search using foreground location or postcode. Missing car specifications remain blank for manual entry.
- Native station map, white five-mile boundary, price markers coloured against the median, tapped/selected markers brought forward, up to three tracked stations, selected-first sorting by distance or price. Android without a configured map key still offers the complete station list.
- Map/List tabs share station selections and preserve the map viewport. Onboarding's Continue/Save action stays fixed above the safe area and follows the keyboard, with Back beside it.
- Tracked station prices and separate coloured histories, with recorded observations up to 30 days. No invented historical prices.
- Tank update with a gesture-driven gauge, preset levels and exact litre input. Changes save only when submitted.
- Account/settings, source explanations, errors/retries, loading skeletons, foreground/network refresh, pull to refresh and hourly refresh.
- Editing stations uses a dedicated API operation that preserves the saved gauge timestamp, mileage and car details.
- Existing SMS preferences are preserved by profile edits. SMS delivery remains the backend stub; no new alerts card or push notification service is added.

## First development build

Use Node 24 and the repository's pnpm version. Run these from the repository root:

```sh
pnpm install --frozen-lockfile
cp apps/native/.env.example apps/native/.env
```

The default API is `https://pump-hawk-web.filodesign.workers.dev`. The backend must include this commit's Better Auth Expo plugin and trusted `pumphawk://` origin before native Google login works. Google continues to redirect to the existing HTTPS `/api/auth/callback/google` endpoint, so no separate native Google OAuth client is needed for this browser-based sign-in flow. The Expo plugin then returns to the app's scheme. Production secrets stay on the server.

For **Android maps**, enable Maps SDK for Android in Google Cloud and set `GOOGLE_MAPS_ANDROID_API_KEY` in `apps/native/.env`. Restrict the key to package `uk.pumphawk.app` and your build's signing certificate SHA-1. For EAS, also define it in the EAS environment used by the build; `.env` is gitignored and should not be relied on in the uploaded source. iOS uses Apple Maps and needs no map key. If you change the package identifier, update the key restriction too.

From `apps/native`, link/create your own EAS project and build:

```sh
pnpm dlx eas-cli@latest init
pnpm dlx eas-cli@latest build --profile development --platform ios
# or
pnpm dlx eas-cli@latest build --profile development --platform android
# iOS simulator instead of a provisioned device:
pnpm dlx eas-cli@latest build --profile simulator --platform ios
```

The project is already linked to `@cnimmo16/pump-hawk`. Only run `eas init` when linking a different project. For local native compilation, `pnpm exec expo run:ios` / `pnpm exec expo run:android` work from this directory with Xcode/Android tooling installed. Generated native directories are ignored.

After installing your development build:

```sh
# repository root
pnpm dev:native
```

Open the QR/development URL in the installed development client. Use a development build, not Expo Go: the app includes custom native keyboard, gesture, map and animation modules. The `pumphawk` scheme is configured in `app.config.ts`; changing it requires a new native build and corresponding server/client auth changes.

## Install directly on an Android device

The `preview` profile builds a signed, standalone APK using the live Pump Hawk API and EAS's `production` environment. It does not require Google Play, Expo Go or a running Metro server. Run from `apps/native`:

```sh
EXPO_NO_DOTENV=1 pnpm dlx eas-cli@24.7.0 build --platform android --profile preview
```

Open the completed build's Expo install link on the Android device, download the APK and install it. If Android asks, allow installation from the browser used for this download. EAS manages the signing key and increments the version code so later preview builds can update the installed app.

Without `GOOGLE_MAPS_ANDROID_API_KEY`, station selection uses the existing list and postcode/location search; the native Android map stays unavailable. Configure the key in Expo's `production` environment and add the EAS signing certificate SHA-1 to its Android restrictions before building a version with maps.

## Google Play release

See [PLAY_STORE.md](PLAY_STORE.md) for the signed Android App Bundle build, maps key and signing-certificate setup, internal-test upload, and outstanding public-launch requirements. The `production` build uses the deployed API and remote version numbering; the `internal` submission profile uploads a draft. Web/API deployments do not automatically publish native releases.

## Local backend

Set `EXPO_PUBLIC_API_URL` to the API's reachable origin (without `/api`), e.g. `http://localhost:8787` for the iOS simulator or `http://10.0.2.2:8787` for the Android emulator. A physical phone needs a reachable LAN/tunnel address and the API listening on that interface. Google OAuth also requires the backend's `BETTER_AUTH_URL` and Google redirect configuration to match a browser-reachable callback. Using the deployed HTTPS API is the simplest development-build setup; a device's `localhost` is not your laptop. Clear Metro with `pnpm dev:native --clear` after changing public environment variables.

Only `EXPO_PUBLIC_API_URL` is bundled as a public API setting. Do not copy Databento, Fuel Finder, database, Google client secret or session-signing secrets into this app.

The local API serves **HTTP**, so `https://localhost:8787` will stall during the TLS handshake. Use `http://localhost:8787` and fully reload the app after editing `.env`. API and session requests time out after 15 seconds and offer a retry. You do not need another native build for this setting.

### Phone sign-in

Phone sign-in is also available when the API has all three Twilio Verify credentials. The app discovers this through `/api/v1/auth/providers`; no Twilio settings go in the native bundle. Use **Continue with phone**, enter a UK mobile number, then the six-digit code received on that phone. A simulator can use a code received on your physical phone. New users are created after verification; returning users recover the same phone account. See [Twilio setup](../../PRODUCTION.md#phone-sign-in-optional). This does not enable fuel SMS alerts or merge a Google account.

### Local sign-in without Google

With the simulator pointed at the local API, open **Sign in → New here? Create a local account**. Enter a name, email (a test address such as `driver@example.test` is fine), and a password of at least eight characters. Account creation signs you in immediately; use **Sign in locally** on subsequent visits. Accounts live in local PostgreSQL, passwords are hashed by Better Auth, and sessions use the same SecureStore cookie flow as Google. No email service or OAuth setup is needed.

The form appears only in development JavaScript builds using `localhost`, `127.0.0.1`, `[::1]`, or Android emulator host `10.0.2.2`. The server independently enables email/password authentication **only for `ENVIRONMENT=development`**. Both email routes return 404 in production, and Better Auth's email/password provider is also disabled there. There is no public environment toggle that can enable it against production.

To check connectivity, open `http://localhost:8787/api/health`. If the app loads the weekly outlook but reports that daily petrol prices are stale, connectivity is working: check the data scheduler output from `pnpm dev`. `pnpm data:sync hourly` refreshes the local Fuel Finder observations; model inputs and generated forecasts have separate refresh jobs (`daily` and `models`).

## Architecture and checks

- `app/`: Router screens, tabs, onboarding, sign-in and tank modal.
- `src/components/ui.tsx`: Tailwind primitives; Gesture Handler pressables and Reanimated transitions respect reduced motion.
- `src/components/screen.tsx`: Keyboard Controller's provider-backed aware scroll and previous/next/done toolbar for every input screen.
- `src/components/line-chart.tsx`: SVG chart with Gesture Handler scrubbing; prices retain actual timestamps.
- `src/lib/api.ts`: Better Auth Expo client and Hey API request interceptor. Native requests use `credentials: omit`, explicit secure-store cookies and `Origin: pumphawk://`.
- `src/lib/queries.ts`: generated Hey API/TanStack Query contracts; no hand-written alternative API or prediction model.
- `packages/presentation`: shared station median/colour policy and national outlook handover/disagreement logic used by native and web.
- Reanimated owns custom animations; Gesture Handler owns custom presses, slider/chart gestures and screen scrolling. Native maps retain their platform map gestures; navigation uses Expo Router. No legacy Animated or KeyboardAvoidingView implementation.

```sh
# repository root
pnpm typecheck
pnpm test
pnpm test:integration
pnpm native:check
pnpm build
```

`native:check` validates SDK dependencies and exports both Hermes JavaScript bundles. It does not compile iOS/Android binaries. CI runs it alongside the API/web checks. React and React DOM peers are aligned to the SDK in `pnpm-workspace.yaml` so shared packages resolve a compatible runtime.

### On-device acceptance check after building

1. Google login, cancellation, relaunch session restore, logout, and returning to an existing web-created profile.
2. Onboarding with registration lookup unavailable, blank/invalid fields, decimal keyboard toolbar, and each mileage mode. Confirm selected stations remain first under either sort.
3. Location denied, postcode fallback, search boundary, map pinch/pan and selecting three pins on iOS and Android.
4. Vertical scrolling versus chart/gauge horizontal gestures; large text, VoiceOver/TalkBack and reduced-motion settings.
5. Tank save updates the recommendation; profile edits preserve SMS preference; foreground/pull refresh updates prices; offline errors do not fabricate advice.

## Implementation references

[Expo SDK compatibility](https://docs.expo.dev/versions/latest/), [Better Auth Expo integration](https://better-auth.com/docs/integrations/expo), [Uniwind setup](https://docs.uniwind.dev/quickstart), [Keyboard Controller](https://docs.expo.dev/guides/keyboard-handling/), [native maps configuration](https://docs.expo.dev/versions/v57.0.0/sdk/map-view/).
