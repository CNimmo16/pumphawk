import { useEffect, useState } from "react";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAuthProvidersOptions } from "@pump-hawk/openapi/react-query";
import { normalizeUkMobile } from "@pump-hawk/presentation/phone-auth";
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
  const [busy, setBusy] = useState<
      "google" | "email" | "phone-send" | "phone-verify" | null
    >(null),
    [error, setError] = useState("");
  const [createAccount, setCreateAccount] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState("");
  const cache = useQueryClient();
  const providers = useQuery({
    ...getAuthProvidersOptions(),
    staleTime: 60_000,
    retry: 1,
  });
  const [phoneOpen, setPhoneOpen] = useState(false),
    [phone, setPhone] = useState(""),
    [sentPhone, setSentPhone] = useState(""),
    [code, setCode] = useState(""),
    [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(
      () => setCooldown((n) => Math.max(0, n - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [cooldown]);
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
    setPhoneOpen(false);
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
    setPhoneOpen(false);
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
  async function sendCode() {
    if (busy || cooldown || !providers.data?.phone) return;
    const normalized = normalizeUkMobile(phone);
    setError("");
    if (!normalized) {
      setError("Enter a UK mobile number, such as 07700 900123.");
      return;
    }
    setBusy("phone-send");
    void KeyboardController.dismiss();
    try {
      const result = await auth.phoneNumber.sendOtp({
        phoneNumber: normalized,
      });
      if (result.error) throw result.error;
      setSentPhone(normalized);
      setCode("");
      setCooldown(60);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  async function verifyCode() {
    if (busy || !sentPhone || !providers.data?.phone) return;
    setError("");
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the six-digit code from your text message.");
      return;
    }
    setBusy("phone-verify");
    void KeyboardController.dismiss();
    try {
      const result = await auth.phoneNumber.verify({
        phoneNumber: sentPhone,
        code,
      });
      if (result.error) throw result.error;
      setCode("");
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
        {!showLocalSignIn && !phoneOpen && error && (
          <ErrorNote message={error} />
        )}
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
      {providers.isError && (
        <ErrorNote
          message="Couldn’t check other sign-in options."
          retry={() => void providers.refetch()}
        />
      )}
      {providers.data?.phone && (
        <Card>
          <Button
            variant="outline"
            disabled={!!busy}
            onPress={() => {
              setPhoneOpen(!phoneOpen);
              setError("");
            }}
          >
            {phoneOpen ? "Hide phone sign-in" : "Continue with phone"}
          </Button>
          {phoneOpen && (
            <>
              <Heading>
                {sentPhone ? "Check your messages" : "Your mobile number"}
              </Heading>
              {sentPhone ? (
                <>
                  <Body>Enter the six-digit code sent to {sentPhone}.</Body>
                  <Field
                    label="Verification code"
                    value={code}
                    onChangeText={(value) =>
                      setCode(value.replace(/\D/g, "").slice(0, 6))
                    }
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="sms-otp"
                    maxLength={6}
                    editable={!busy}
                    onSubmitEditing={() => void verifyCode()}
                  />
                  <Button
                    loading={busy === "phone-verify"}
                    disabled={!!busy || code.length !== 6}
                    onPress={() => void verifyCode()}
                  >
                    Verify and continue
                  </Button>
                  <Button
                    variant="quiet"
                    loading={busy === "phone-send"}
                    disabled={!!busy || cooldown > 0}
                    onPress={() => void sendCode()}
                  >
                    {cooldown ? `Resend code in ${cooldown}s` : "Resend code"}
                  </Button>
                  <Button
                    variant="quiet"
                    disabled={!!busy}
                    onPress={() => {
                      setSentPhone("");
                      setCode("");
                      setError("");
                    }}
                  >
                    Change number
                  </Button>
                </>
              ) : (
                <>
                  <Field
                    label="UK mobile number"
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="07700 900123"
                    keyboardType="phone-pad"
                    textContentType="telephoneNumber"
                    autoComplete="tel"
                    maxLength={24}
                    editable={!busy}
                    onSubmitEditing={() => void sendCode()}
                  />
                  <Body className="text-sm">
                    We’ll text you a sign-in code. Your first verification
                    creates your account. This does not subscribe you to fuel
                    alerts.
                  </Body>
                  <Button
                    loading={busy === "phone-send"}
                    disabled={!!busy || cooldown > 0}
                    onPress={() => void sendCode()}
                  >
                    {cooldown ? `Send code in ${cooldown}s` : "Send text code"}
                  </Button>
                </>
              )}
              {error && <ErrorNote message={error} />}
            </>
          )}
        </Card>
      )}
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
          {!phoneOpen && error && <ErrorNote message={error} />}
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
