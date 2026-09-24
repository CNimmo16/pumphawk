import { useState } from "react";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useQueryClient } from "@tanstack/react-query";
import { useDashboard } from "../../src/lib/queries";
import { apiUrl, auth, errorMessage, showLocalSignIn } from "../../src/lib/api";
import { Screen } from "../../src/components/screen";
import {
  Body,
  Button,
  Card,
  ErrorNote,
  Heading,
  Label,
} from "../../src/components/ui";
export default function Account() {
  const data = useDashboard(),
    cache = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const result = await auth.signOut();
      if (result.error) throw result.error;
      cache.clear();
      router.replace("/");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Label>Your Pump Hawk</Label>
      <Heading>A little foresight goes a long way.</Heading>
      <Card>
        <Heading>
          {data.signedIn
            ? (data.session.data?.user.name ?? "Your account")
            : "Make it yours"}
        </Heading>
        <Body>
          {data.signedIn
            ? (data.session.data?.user.phoneNumber ??
              data.session.data?.user.email)
            : "Your car, driving schedule and stations stay in sync across the app and website."}
        </Body>
        {data.session.error ? (
          <ErrorNote
            message={errorMessage(data.session.error)}
            retry={() => void data.session.refetch()}
          />
        ) : data.signedIn ? (
          <>
            <Button
              variant="outline"
              onPress={() => router.push("/onboarding")}
            >
              Edit car and driving
            </Button>
            <Button
              variant="outline"
              onPress={() =>
                router.push({
                  pathname: "/onboarding",
                  params: { step: "stations" },
                })
              }
            >
              Edit regular stops
            </Button>
            <Button
              variant="quiet"
              loading={busy}
              onPress={() => void signOut()}
            >
              Sign out
            </Button>
          </>
        ) : (
          <Button
            loading={data.session.isPending}
            onPress={() => router.push("/sign-in")}
          >
            {showLocalSignIn ? "Sign in" : "Sign in with Google"}
          </Button>
        )}
        {error && <ErrorNote message={error} />}
      </Card>
      <Card>
        <Label>How it works</Label>
        <Heading>Watch the wholesale. Beat the lag.</Heading>
        <Label>01 · Start at the pump</Label>
        <Body>
          Recent pump price changes inform the near-term daily outlook.
        </Body>
        <Label>02 · Look further upstream</Label>
        <Body>
          B7H petrol and Brent crude futures, converted to pounds, help shape
          the outlook. Wholesale rises typically reach pumps faster than cuts.
        </Body>
        <Label>03 · Make the right-sized stop</Label>
        <Body>
          Your tank and daily driving schedule help decide whether to fill, top
          up or wait. Keep a reserve and compare nearby prices.
        </Body>
      </Card>
      <Card>
        <Heading>About the forecast</Heading>
        <Body className="text-sm">
          Fuel Finder provides station observations. The daily model uses an
          equal-station E10 average and FuelCosts history. The weekly model uses
          the separate official DESNZ sales-weighted series. Market inputs come
          from Databento, with ECB exchange rates.
        </Body>
        <Body className="text-sm">
          The chart shows seven daily predictions, then available weekly
          predictions on their actual dates. The handover changes the national
          benchmark. A meaningful later weekly rise can recommend filling ahead.
          Weekly predictions are never interpolated into daily prices.
        </Body>
        <Body className="text-sm">
          National forecasts are not quotes for a particular forecourt.
          Estimated savings and ranges are not guaranteed. Update your tank
          regularly.
        </Body>
        {data.forecast?.warnings.map((warning) => (
          <Body key={warning} className="text-xs">
            {warning}
          </Body>
        ))}
        {data.weekly.data?.warnings.map((warning) => (
          <Body key={warning} className="text-xs">
            {warning}
          </Body>
        ))}
        <Button
          variant="outline"
          onPress={() => {
            void WebBrowser.openBrowserAsync(`${apiUrl}/api/docs`).catch((e) =>
              setError(errorMessage(e)),
            );
          }}
        >
          API documentation ↗
        </Button>
      </Card>
    </Screen>
  );
}
