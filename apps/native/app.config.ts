import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Pump Hawk",
  slug: "pump-hawk",
  version: "1.0.0",
  icon: "./assets/icon.png",
  scheme: "pumphawk",
  orientation: "portrait",
  platforms: ["ios", "android"],
  userInterfaceStyle: "light",
  ios: {
    bundleIdentifier: "uk.pumphawk.app",
    supportsTablet: true,
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: "uk.pumphawk.app",
    softwareKeyboardLayoutMode: "resize",
    // Station lookup uses foreground location; the app does not access user files.
    blockedPermissions: [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      ...(["production", "preview"].includes(
        process.env.EAS_BUILD_PROFILE ?? "",
      )
        ? ["android.permission.SYSTEM_ALERT_WINDOW"]
        : []),
    ],
  },
  plugins: [
    "expo-router",
    "expo-status-bar",
    "expo-secure-store",
    "expo-web-browser",
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Find petrol stations within five miles of you. Your location is not saved to your profile.",
      },
    ],
    [
      "expo-splash-screen",
      {
        backgroundColor: "#f7f8f2",
        image: "./assets/icon.png",
        imageWidth: 96,
      },
    ],
    [
      "react-native-maps",
      {
        androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? "",
      },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    androidMapsConfigured: Boolean(process.env.GOOGLE_MAPS_ANDROID_API_KEY),
    eas: {
      projectId: "b4352b09-1b05-4ca8-8089-0a6167b334c8",
    },
  },
};
export default config;
