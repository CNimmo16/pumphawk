import { router } from "expo-router";
import { Screen } from "../src/components/screen";
import { Body, Button, Heading } from "../src/components/ui";
export default function NotFound() {
  return (
    <Screen>
      <Heading>That road doesn’t lead anywhere.</Heading>
      <Body>This screen is unavailable.</Body>
      <Button onPress={() => router.replace("/")}>Back to your forecast</Button>
    </Screen>
  );
}
