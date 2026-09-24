# Google Play release

## App and build settings

- Name: **Pump Hawk**
- Android package: **`uk.pumphawk.app`**
- Expo project: **`@cnimmo16/pump-hawk`**, ID `b4352b09-1b05-4ca8-8089-0a6167b334c8`
- Version: **1.0.0**; EAS manages and increments the Android version code remotely.
- `production` builds a signed Android App Bundle (`.aab`), with the live HTTPS API and the EAS `production` environment. Local `.env` loading is disabled for this build profile.
- `submit.internal` uploads a **draft** to Google Play's internal testing track. Uploading a draft does not start a public rollout.
- Native builds and Play uploads are separate from the GitHub workflow that deploys the web/API Workers.

Start with internal testing and verify the app installed **from Google Play** on an Android device before a public release. The production build profile is also the correct binary for internal testing; the `preview` APK is for direct installation outside Play.

## Android maps

The production environment needs `GOOGLE_MAPS_ANDROID_API_KEY` in **Expo**, not GitHub. Use **Sensitive** visibility so EAS can resolve app config locally. The key is necessarily embedded in the Android app: API and application restrictions provide its protection.

1. In the intended Google Cloud project, enable **Maps SDK for Android** and configure its billing prerequisites.
2. Create a key restricted to **Maps SDK for Android**.
3. Add an Android application restriction for package `uk.pumphawk.app` with the **Google Play app signing certificate SHA-1** from Play Console's App signing page. Google signs installed Play builds with this certificate; it is different from EAS's upload key. For directly installed EAS builds, also add the corresponding signing SHA-1 as another allowed Android application.
4. Save the key as `GOOGLE_MAPS_ANDROID_API_KEY` in this Expo project's **production** environment. Never add server credentials to the app bundle.

The key must be present when building. Its allowed certificate fingerprints can be updated later without rebuilding, which is useful when the Play signing certificate becomes available during initial app setup. Verify the Play certificate restriction before distributing to testers. [Expo Android maps setup](https://docs.expo.dev/versions/latest/sdk/map-view/).

## Build and first upload

Run from `apps/native`, using the current EAS CLI (24.7.0 was available when this guide was prepared):

```sh
pnpm dlx eas-cli@24.7.0 build --platform android --profile production
```

Let EAS manage an Android upload keystore for this package if none exists. Retain those signing credentials; subsequent uploads must use the same upload key unless it is reset through Play. The build page supplies the signed `.aab` download.

In the intended Google Play developer account:

1. Create **Pump Hawk**, choose **App**, and set the default language to **English (United Kingdom)**. Confirm pricing and the required declarations with the account owner.
2. Open **Testing → Internal testing → Create new release** and complete Play App Signing setup.
3. Upload the `.aab`, review validation messages and add the release notes below.
4. Add the intended testers and complete the internal release. Share the opt-in link with them.
5. Check sign-up, returning sessions, station maps/location denial/postcode fallback, forecasts, tank updates and logout on a real Android device.

Manual upload avoids needing a Google service-account key for the first release. EAS Submit can also handle first submissions when a Play app and authorised service-account credential are configured; manual first upload is not mandatory. [Expo submission guide](https://docs.expo.dev/submit/android/).

For later automated draft uploads, configure a service account with access to **this Play app** and its testing releases, upload its JSON credential to EAS, then select the specific completed build:

```sh
pnpm dlx eas-cli@24.7.0 submit --platform android --profile internal --id BUILD_ID
```

Keep credential JSON and keystores outside tracked source (for example, in the ignored repository `.local/` directory). Neither the Google Maps key nor a Google OAuth client secret is the Play submission service account.

## Before public release

The following still need completing; the current app is not ready for a public store listing:

- Public privacy-policy URL plus an in-app link, identifying the operator and support contact and accurately describing data handling and retention.
- In-app account deletion and a public web route for requesting deletion of the account and associated data. The current account screen has sign-out only. [Google's account-deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en).
- Data safety declaration checked against the app, backend and third-party SDKs. Account details, foreground location requests and diagnostics need review; do not declare that no data is collected just because coordinates are not saved to a profile.
- Review access instructions that work without the reviewer depending on someone else's SMS inbox. Keep the development-only email provider disabled in production.
- Store listing, support contact, screenshots, icon/feature graphic, content rating, target audience, countries, pricing and ads declaration. [Play app review setup](https://support.google.com/googleplay/android-developer/answer/9859455?hl=en).
- Any testing/verification requirements shown for the chosen developer account. The 12-testers/14-days closed-test requirement applies to new **personal** developer accounts; it should not be assumed to apply to the existing Waxly organisation account. [Google's testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465).

## Draft listing copy

**Short description**

UK petrol prices, forecasts and a smarter plan for your next fill-up.

**Full description**

Pump Hawk helps UK drivers decide when to buy petrol and how much to put in the tank.

Compare nearby E10 prices on a map, track up to three regular stations, and see recent UK price trends alongside daily and weekly forecasts. Add your car's tank size, average MPG and usual driving schedule to get a personal fill-up plan. Update your tank level whenever you need to keep the advice useful.

Sign in with Google or a UK mobile number to keep your saved settings in sync across the app and website.

Forecasts are estimates, not guaranteed prices or savings. Individual forecourt prices can differ from the national outlook. Keep enough fuel for your journey and check the displayed pump price before filling.

**Release notes**

First Android test release: nearby petrol prices, tracked stations, UK price forecasts, car and mileage setup, tank updates, and Google or phone sign-in.
