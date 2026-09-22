import type { PropsWithChildren, ReactNode } from "react";
import { useState } from "react";
import { RefreshControl, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import {
  KeyboardAwareScrollView,
  KeyboardStickyView,
  KeyboardToolbar,
} from "react-native-keyboard-controller";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { withUniwind } from "uniwind";
import { colors } from "../lib/theme";

const SafeScreen = withUniwind(SafeAreaView);
const keyboardToolbarHeight = 42;
export function Screen({
  children,
  form = false,
  refresh = false,
  footer,
}: PropsWithChildren<{
  form?: boolean;
  refresh?: boolean;
  footer?: ReactNode;
}>) {
  const [refreshing, setRefreshing] = useState(false);
  const [footerHeight, setFooterHeight] = useState(0);
  const insets = useSafeAreaInsets();
  const cache = useQueryClient();
  const content = (
    <View className="w-full max-w-2xl self-center gap-5 px-5 pb-10 pt-5">
      {children}
    </View>
  );
  return (
    <SafeScreen edges={["left", "right"]} className="flex-1 bg-paper">
      {form ? (
        <>
          <KeyboardAwareScrollView
            style={{ flex: 1 }}
            bottomOffset={Math.max(
              84,
              footerHeight - insets.bottom + keyboardToolbarHeight + 16,
            )}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
          >
            {content}
          </KeyboardAwareScrollView>
          <KeyboardToolbar />
        </>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            refresh ? (
              <RefreshControl
                refreshing={refreshing}
                tintColor={colors.forest}
                onRefresh={async () => {
                  setRefreshing(true);
                  try {
                    await cache.invalidateQueries();
                  } finally {
                    setRefreshing(false);
                  }
                }}
              />
            ) : undefined
          }
        >
          {content}
        </ScrollView>
      )}
      {footer && (
        <KeyboardStickyView
          enabled={form}
          offset={{ opened: insets.bottom - keyboardToolbarHeight }}
          onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
        >
          <SafeScreen
            edges={["bottom"]}
            className="border-t border-line bg-white"
          >
            <View className="w-full max-w-2xl self-center gap-3 px-5 py-3">
              {footer}
            </View>
          </SafeScreen>
        </KeyboardStickyView>
      )}
    </SafeScreen>
  );
}
