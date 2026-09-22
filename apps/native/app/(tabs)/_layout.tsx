import { Tabs } from "expo-router";
import { View, Text } from "react-native";
import { Pressable } from "react-native-gesture-handler";
import { withUniwind } from "uniwind";
import { Icon, type IconName } from "../../src/components/icon";
import { colors } from "../../src/lib/theme";
const Touch = withUniwind(Pressable);
const icons: Record<string, IconName> = {
  index: "home",
  stations: "pin",
  account: "user",
};
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerTitle: () => (
          <View className="flex-row gap-2 items-center">
            <Icon name="hawk" size={30} />
            <Text className="text-2xl font-semibold tracking-tight text-ink">
              pumphawk.
            </Text>
          </View>
        ),
        headerStyle: { backgroundColor: colors.paper },
        headerShadowVisible: false,
      }}
      tabBar={({ state, navigation, descriptors, insets }) => (
        <View
          className="flex-row bg-paper border-t border-line px-3 pt-2"
          style={{ paddingBottom: Math.max(12, insets.bottom) }}
        >
          {state.routes.map((route, index) => {
            const focused = index === state.index;
            return (
              <Touch
                key={route.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={descriptors[route.key]?.options.title}
                className={`flex-1 items-center py-3 gap-1 rounded-2xl ${focused ? "bg-leaf" : ""}`}
                onPress={() => {
                  const event = navigation.emit({
                    type: "tabPress",
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!focused && !event.defaultPrevented)
                    navigation.navigate(route.name);
                }}
                onLongPress={() =>
                  navigation.emit({ type: "tabLongPress", target: route.key })
                }
              >
                <Icon
                  name={icons[route.name] ?? "home"}
                  color={focused ? colors.forest : colors.muted}
                />
                <Text
                  className={`text-xs font-semibold ${focused ? "text-forest" : "text-muted"}`}
                >
                  {descriptors[route.key]?.options.title}
                </Text>
              </Touch>
            );
          })}
        </View>
      )}
    >
      <Tabs.Screen name="index" options={{ title: "Overview" }} />
      <Tabs.Screen name="stations" options={{ title: "Stations" }} />
      <Tabs.Screen name="account" options={{ title: "Account" }} />
    </Tabs>
  );
}
