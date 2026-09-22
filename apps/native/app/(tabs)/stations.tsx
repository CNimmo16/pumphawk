import { Text, View } from "react-native";
import { router } from "expo-router";
import { useDashboard } from "../../src/lib/queries";
import { errorMessage, showLocalSignIn } from "../../src/lib/api";
import {
  stationPriceComparison,
  stationPriceMedian,
} from "@pump-hawk/presentation/station-prices";
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
import { StationHistory } from "../../src/components/forecast-panels";
import { stationColors } from "../../src/lib/theme";
export default function Stations() {
  const data = useDashboard();
  const stations = data.tracked.data?.stations ?? [],
    median = stationPriceMedian(stations);
  return (
    <Screen refresh>
      <Label>Your local view</Label>
      <Heading>Your regular stops.</Heading>
      <Body>
        Actual E10 prices, collected hourly. Keep your favourite forecourts
        close.
      </Body>
      {data.session.isPending ? (
        <Skeleton />
      ) : data.session.error ? (
        <ErrorNote
          message={errorMessage(data.session.error)}
          retry={() => void data.session.refetch()}
        />
      ) : !data.signedIn ? (
        <Card>
          <Body>Sign in to track up to three stations near you.</Body>
          <Button onPress={() => router.push("/sign-in")}>
            {showLocalSignIn ? "Sign in" : "Sign in with Google"}
          </Button>
        </Card>
      ) : (
        <>
          <Button
            variant="outline"
            onPress={() =>
              router.push({
                pathname: "/onboarding",
                params: { step: "stations" },
              })
            }
          >
            {stations.length ? "Edit tracked stations" : "Choose my stations"}
          </Button>
          {data.tracked.isPending ? (
            <Skeleton label="Loading your stations" />
          ) : data.tracked.error ? (
            <ErrorNote
              message={errorMessage(data.tracked.error)}
              retry={() => void data.tracked.refetch()}
            />
          ) : (
            data.tracked.data && (
              <>
                {stations.map((s, i) => {
                  const { band, description } = stationPriceComparison(
                    s.pricePence,
                    median,
                  );
                  return (
                    <Card key={s.id}>
                      <View className="flex-row gap-3 items-start">
                        <View
                          style={{
                            width: 5,
                            alignSelf: "stretch",
                            borderRadius: 4,
                            backgroundColor:
                              stationColors[i % stationColors.length],
                          }}
                        />
                        <View className="flex-1 gap-1">
                          <Text className="text-lg font-semibold text-ink">
                            {s.name}
                          </Text>
                          <Body className="text-xs">
                            {s.brand} · {s.postcode}
                          </Body>
                          <Body className="text-xs">{s.address}</Body>
                        </View>
                        <View
                          className={`rounded-xl p-3 ${band === "low" ? "bg-low" : band === "high" ? "bg-high" : band === "typical" ? "bg-typical" : "bg-paper"}`}
                        >
                          <Text className="text-xl font-bold text-ink">
                            {s.pricePence?.toFixed(1) ?? "—"}p
                          </Text>
                        </View>
                      </View>
                      <Body className="text-xs">
                        {description.replace(
                          "nearby median",
                          "tracked-station median",
                        )}
                        {s.motorway ? " · Motorway services" : ""}
                        {s.closed ? " · Temporarily closed" : ""}
                      </Body>
                      <Body className="text-xs">
                        {s.checkedAt
                          ? `Checked ${new Date(s.checkedAt).toLocaleString("en-GB")}`
                          : "Awaiting collection"}
                        . Check the forecourt price before filling.
                      </Body>
                    </Card>
                  );
                })}
                {!!stations.length && (
                  <StationHistory data={data.tracked.data} />
                )}
              </>
            )
          )}
        </>
      )}
    </Screen>
  );
}
