import "../global.css";
import { useEffect, useState } from "react";
import { AppState, View, Text } from "react-native";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Network from "expo-network";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Uniwind } from "uniwind";
import { auth } from "../src/lib/api";
import { colors } from "../src/lib/theme";
import { Button } from "../src/components/ui";

Uniwind.setTheme("light");
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View className="flex-1 justify-center bg-paper p-8 gap-5">
        <Text className="text-2xl font-semibold text-ink">
          Let’s try that again.
        </Text>
        <Text className="text-base text-muted">
          Pump Hawk couldn’t open this screen. Your saved settings are safe.
        </Text>
        <Button onPress={retry}>Reload screen</Button>
      </View>
    </GestureHandlerRootView>
  );
}
export default function RootLayout() {
  const [cache] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 60_000, retry: 1 },
          mutations: { retry: false },
        },
      }),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      focusManager.setFocused(state === "active");
      if (state === "active") void auth.getSession();
    });
    onlineManager.setEventListener((setOnline) => {
      void Network.getNetworkStateAsync().then((s) =>
        setOnline(s.isInternetReachable ?? s.isConnected ?? true),
      );
      const network = Network.addNetworkStateListener((s) =>
        setOnline(s.isInternetReachable ?? s.isConnected ?? true),
      );
      return () => network.remove();
    });
    return () => subscription.remove();
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <QueryClientProvider client={cache}>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.paper },
                headerTintColor: colors.ink,
                headerShadowVisible: false,
                contentStyle: { backgroundColor: colors.paper },
                animation: "none",
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="sign-in"
                options={{
                  title: "Welcome to Pump Hawk",
                  presentation: "modal",
                }}
              />
              <Stack.Screen
                name="onboarding"
                options={{
                  title: "Make it yours",
                  presentation: "modal",
                  gestureEnabled: false,
                }}
              />
              <Stack.Screen
                name="tank"
                options={{ title: "Update your tank", presentation: "modal" }}
              />
            </Stack>
          </QueryClientProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
