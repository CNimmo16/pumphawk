import { useState } from "react";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { KeyboardController } from "react-native-keyboard-controller";
import { auth, errorMessage, showLocalSignIn } from "../src/lib/api";
import { Screen } from "../src/components/screen";
import {
  Body,
  Button,
  Card,
  ErrorNote,
  Field,
  Heading,
  Label,
} from "../src/components/ui";
import { Icon } from "../src/components/icon";
export default function SignIn() {
  const [busy, setBusy] = useState<"google" | "email" | null>(null),
    [error, setError] = useState("");
  const [createAccount, setCreateAccount] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState("");
  const cache = useQueryClient();
  async function finishSignIn() {
    const session = await auth.getSession();
    if (session.error) throw session.error;
    if (!session.data?.user)
      throw new Error("Sign-in wasn’t completed. Please try again.");
    setPassword("");
    cache.clear();
    router.replace("/");
  }
  async function signIn() {
    if (busy) return;
    setBusy("google");
    setError("");
    try {
      const result = await auth.signIn.social({
        provider: "google",
        callbackURL: "/",
        errorCallbackURL: "/sign-in",
      });
      if (result.error) throw result.error;
      await finishSignIn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  async function signInLocally() {
    if (!showLocalSignIn || busy) return;
    setError("");
    if (!email.trim() || !password || (createAccount && !name.trim())) {
      setError(
        "Enter your email and password, and your name for a new account.",
      );
      return;
    }
    if (createAccount && password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    setBusy("email");
    void KeyboardController.dismiss();
    try {
      const credentials = { email: email.trim(), password };
      const result = createAccount
        ? await auth.signUp.email({ ...credentials, name: name.trim() })
        : await auth.signIn.email(credentials);
      if (result.error) throw result.error;
      await finishSignIn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Screen form>
      <Card>
        <Icon name="hawk" size={52} />
        <Label>A little foresight. A fuller tank.</Label>
        <Heading>A better plan for every fill.</Heading>
        <Body>
          Sign in to save your car, track your regular stops and find the right
          time to fill up.
        </Body>
        {!showLocalSignIn && error && <ErrorNote message={error} />}
        {!showLocalSignIn && (
          <Button
            loading={busy === "google"}
            disabled={!!busy}
            onPress={() => void signIn()}
          >
            Continue with Google
          </Button>
        )}
        {!showLocalSignIn && (
          <Body className="text-sm">
            Your Google account creates or signs you into Pump Hawk. Your saved
            settings work across the website and app.
          </Body>
        )}
      </Card>
      {showLocalSignIn && (
        <Card>
          <Label>Local development</Label>
          <Heading>
            {createAccount ? "Create a local account" : "Sign in with email"}
          </Heading>
          <Body>
            This account is saved in your local database. No verification email
            is needed.
          </Body>
          {createAccount && (
            <Field
              key="name"
              label="Name"
              value={name}
              onChangeText={setName}
              autoComplete="name"
              textContentType="name"
              secureTextEntry={false}
              editable={!busy}
            />
          )}
          <Field
            key="email"
            label="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            secureTextEntry={false}
            editable={!busy}
          />
          <Field
            key={createAccount ? "new-password" : "password"}
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={createAccount ? "new-password" : "current-password"}
            textContentType={createAccount ? "newPassword" : "password"}
            maxLength={128}
            returnKeyType="go"
            onSubmitEditing={() => void signInLocally()}
            editable={!busy}
          />
          {error && <ErrorNote message={error} />}
          <Button
            loading={busy === "email"}
            disabled={!!busy}
            onPress={() => void signInLocally()}
          >
            {createAccount ? "Create local account" : "Sign in locally"}
          </Button>
          <Button
            variant="quiet"
            disabled={!!busy}
            onPress={() => {
              setCreateAccount(!createAccount);
              setError("");
              setPassword("");
            }}
          >
            {createAccount
              ? "Already have a local account? Sign in"
              : "New here? Create a local account"}
          </Button>
          <Button
            variant="outline"
            loading={busy === "google"}
            disabled={!!busy}
            onPress={() => void signIn()}
          >
            Continue with Google
          </Button>
        </Card>
      )}
      <Button variant="quiet" onPress={() => router.replace("/")}>
        Explore the UK outlook
      </Button>
    </Screen>
  );
}
