import type { PropsWithChildren } from "react";
import {
  Text,
  TextInput,
  View,
  ActivityIndicator,
  type TextInputProps,
  type ViewProps,
} from "react-native";
import { Pressable, type PressableProps } from "react-native-gesture-handler";
import Animated, {
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  ReduceMotion,
} from "react-native-reanimated";
import { withUniwind } from "uniwind";
import { colors } from "../lib/theme";

const Touch = withUniwind(Pressable);
export const MotionView = withUniwind(Animated.View);
export function Card({
  children,
  className = "",
  ...props
}: PropsWithChildren<ViewProps & { className?: string }>) {
  return (
    <MotionView
      entering={FadeInDown.duration(250).reduceMotion(ReduceMotion.System)}
      layout={LinearTransition.duration(200).reduceMotion(ReduceMotion.System)}
      className={`rounded-3xl border border-line bg-white p-5 gap-4 ${className}`}
      {...props}
    >
      {children}
    </MotionView>
  );
}
export function Heading({ children }: PropsWithChildren) {
  return (
    <Text
      accessibilityRole="header"
      className="text-2xl font-semibold tracking-tight text-ink"
    >
      {children}
    </Text>
  );
}
export function Body({
  children,
  className = "",
}: PropsWithChildren<{ className?: string }>) {
  return (
    <Text className={`text-base leading-6 text-muted ${className}`}>
      {children}
    </Text>
  );
}
export function Label({ children }: PropsWithChildren) {
  return (
    <Text className="text-xs font-semibold uppercase tracking-widest text-muted">
      {children}
    </Text>
  );
}
export function Button({
  children,
  onPress,
  disabled,
  loading,
  variant = "primary",
  accessibilityLabel,
  accessibilityRole = "button",
  accessibilityState,
  ...props
}: PropsWithChildren<
  PressableProps & {
    loading?: boolean;
    variant?: "primary" | "outline" | "quiet";
  }
>) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <Animated.View style={style}>
      <Touch
        {...props}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{
          ...accessibilityState,
          disabled: !!disabled || !!loading,
          busy: loading,
        }}
        disabled={disabled || loading}
        onPress={onPress}
        onPressIn={() => {
          scale.value = withTiming(0.98, { duration: 100 });
        }}
        onPressOut={() => {
          scale.value = withTiming(1, { duration: 140 });
        }}
        className={`min-h-12 rounded-2xl px-4 py-3 flex-row gap-2 items-center justify-center ${variant === "primary" ? "bg-forest" : variant === "outline" ? "border border-line bg-white" : "bg-transparent"} ${disabled || loading ? "opacity-50" : ""}`}
      >
        {loading && (
          <ActivityIndicator
            color={variant === "primary" ? "white" : colors.forest}
          />
        )}
        <Text
          className={`text-base font-semibold ${variant === "primary" ? "text-white" : "text-ink"}`}
        >
          {children}
        </Text>
      </Touch>
    </Animated.View>
  );
}
export function Field({
  label,
  unit,
  error,
  ...props
}: TextInputProps & { label: string; unit?: string; error?: string }) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-semibold text-ink">{label}</Text>
      <View
        className={`min-h-14 rounded-2xl border bg-white px-4 flex-row items-center gap-2 ${error ? "border-high-ink" : "border-line"}`}
      >
        <TextInput
          {...props}
          accessibilityLabel={label}
          placeholderTextColor={colors.muted}
          selectionColor={colors.forest}
          className="flex-1 py-3 text-lg text-ink"
        />
        {unit && <Text className="text-sm text-muted">{unit}</Text>}
      </View>
      {error && <ErrorNote message={error} />}
    </View>
  );
}
export function ErrorNote({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <View accessibilityRole="alert" className="rounded-2xl bg-high p-4 gap-2">
      <Text className="text-sm leading-5 text-high-ink">{message}</Text>
      {retry && (
        <Button variant="outline" onPress={retry}>
          Try again
        </Button>
      )}
    </View>
  );
}
export function Skeleton({
  label = "Loading your forecast",
}: {
  label?: string;
}) {
  return (
    <Card>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        className="gap-5"
      >
        <ActivityIndicator color={colors.forest} />
        <View className="h-6 w-3/4 rounded-lg bg-line" />
        <View className="h-16 rounded-xl bg-paper" />
        <View className="h-8 w-1/2 rounded-lg bg-line" />
      </View>
    </Card>
  );
}
