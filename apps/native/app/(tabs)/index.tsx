import { Text, View } from "react-native";
import { Redirect, router } from "expo-router";
import { useDashboard } from "../../src/lib/queries";
import { dateLabel, errorMessage } from "../../src/lib/api";
import { Screen } from "../../src/components/screen";
import {
  Body,
  Button,
  Card,
  ErrorNote,
  Heading,
  Label,
  Skeleton,
} from "../../src/components/ui";
import { OutlookPanel } from "../../src/components/forecast-panels";
import { TankCard } from "../../src/components/tank-card";
export default function Dashboard() {
  const data = useDashboard();
  const { forecast, advice, car } = data;
  if (data.onboarding) return <Redirect href="/onboarding" />;
  return (
    <Screen refresh>
      <Label>A little foresight. A fuller tank.</Label>
      <Text
        accessibilityRole="header"
        className="text-4xl font-semibold tracking-tighter text-ink"
      >
        Stay a step ahead{"\n"}of the pump.
      </Text>
      <Body>Know when to fill up. Keep a little more in your pocket.</Body>
      {forecast && <Label>Prices as of {dateLabel(forecast.asOf)}</Label>}
      {forecast && forecast.mode !== "live" && (
        <Card className="bg-wheat">
          <Body className="text-ink">
            {forecast.mode === "demo"
              ? "Demo data: these are synthetic examples."
              : "Local sample history: seeded pump prices inform this forecast."}
          </Body>
        </Card>
      )}
      {data.loadingAdvice ? (
        <Skeleton />
      ) : data.failure ? (
        <ErrorNote
          message={errorMessage(data.failure)}
          retry={() => void data.retryAdvice()}
        />
      ) : advice ? (
        <Card className={advice.action === "fill-now" ? "bg-wheat" : "bg-leaf"}>
          <Label>Your fill-up forecast</Label>
          <Heading>{advice.title}</Heading>
          <Body className="text-ink">{advice.reason}</Body>
          <View className="flex-row flex-wrap gap-6 border-t border-forest/20 pt-4">
            <View className="gap-1">
              <Label>Buy now</Label>
              <Text className="text-3xl font-semibold text-ink">
                {advice.litresToBuy.toFixed(1)}
                <Text className="text-base"> litres</Text>
              </Text>
              <Body className="text-xs">
                {advice.litresToBuy
                  ? `About £${advice.estimatedCostGbp.toFixed(2)}`
                  : "Nothing to buy today"}
              </Body>
            </View>
            <View className="gap-1">
              <Label>Estimated saving</Label>
              <Text className="text-3xl font-semibold text-ink">
                £{advice.estimatedSavingsGbp.toFixed(2)}
              </Text>
              <Body className="text-xs">
                {advice.priceSignal === "weekly"
                  ? "If your station follows the weekly rise"
                  : advice.action === "fill-now"
                    ? "If prices rise as forecast"
                    : "On fuel you defer buying"}
              </Body>
            </View>
          </View>
          <Body className="text-sm">
            Reassess on {dateLabel(advice.nextFillDate)}. Check prices before
            you fill.
          </Body>
          {advice.action === "update-tank" && (
            <Button onPress={() => router.push("/tank")}>
              Update tank level
            </Button>
          )}
        </Card>
      ) : data.signedIn ? (
        <Card>
          <Heading>Your plan is temporarily unavailable</Heading>
          <Body>
            {data.personal.data?.forecastError ??
              "Your settings are saved. Pull down to try the forecast again."}
          </Body>
        </Card>
      ) : (
        <Card className="bg-leaf">
          <Label>Your fill-up forecast</Label>
          <Heading>Make it yours.</Heading>
          <Body>
            A plan built around your car, your week and your regular stops.
          </Body>
          <Button onPress={() => router.push("/sign-in")}>Sign in</Button>
        </Card>
      )}
      {car && <TankCard car={car} advice={advice} />}
      {forecast || data.weekly.data ? (
        <OutlookPanel
          forecast={forecast}
          weekly={data.weekly.data}
          weeklyLoading={data.weekly.isPending}
        />
      ) : data.national.error && data.weekly.error ? (
        <ErrorNote
          message={errorMessage(data.national.error)}
          retry={() => {
            void data.national.refetch();
            void data.weekly.refetch();
          }}
        />
      ) : (
        <Skeleton label="Loading the UK outlook" />
      )}
      <Button variant="outline" onPress={() => router.push("/stations")}>
        See your regular stops →
      </Button>
    </Screen>
  );
}
