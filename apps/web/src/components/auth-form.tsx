import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAuthProvidersOptions } from "@pump-hawk/openapi/react-query";
import { normalizeUkMobile } from "@pump-hawk/presentation/phone-auth";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { auth, errorMessage } from "../lib/api";
export function AuthForm({
  initialError = "",
  onSuccess,
}: {
  initialError?: string;
  onSuccess?: () => void;
}) {
  const [busy, setBusy] = useState<"google" | "send" | "verify" | null>(null),
    [error, setError] = useState(initialError);
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
  async function signIn() {
    if (busy) return;
    setBusy("google");
    setError("");
    try {
      const result = await auth.signIn.social({
        provider: "google",
        callbackURL: "/",
        errorCallbackURL: "/?authError=google",
      });
      if (result.error) throw result.error;
      if (!result.data?.url)
        throw new Error("Google sign-in could not start. Please try again.");
    } catch (error) {
      setError(errorMessage(error));
      setBusy(null);
    }
  }
  async function sendCode() {
    if (busy || cooldown || !providers.data?.phone) return;
    setError("");
    const normalized = normalizeUkMobile(phone);
    if (!normalized) {
      setError("Enter a UK mobile number, such as 07700 900123.");
      return;
    }
    setBusy("send");
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
    setBusy("verify");
    try {
      const result = await auth.phoneNumber.verify({
        phoneNumber: sentPhone,
        code,
      });
      if (result.error) throw result.error;
      const session = await auth.getSession();
      if (session.error) throw session.error;
      if (!session.data?.user)
        throw new Error("Sign-in wasn’t completed. Please try again.");
      setCode("");
      onSuccess?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="form-stack">
      <div className="form-symbol">
        <ShieldCheck />
      </div>
      <p className="muted">
        Sign in to save your car, track your favourite stations and plan your
        next fill-up.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button
        type="button"
        className="button dark"
        disabled={!!busy}
        onClick={() => void signIn()}
      >
        {busy === "google" ? "Taking you to Google…" : "Continue with Google"}
        <ArrowRight size={17} />
      </button>
      {providers.isError && (
        <p role="alert" className="form-error">
          Couldn’t check other sign-in options.{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => void providers.refetch()}
          >
            Try again
          </button>
        </p>
      )}
      {providers.data?.phone && (
        <>
          <button
            type="button"
            className="button outline"
            disabled={!!busy}
            onClick={() => {
              setPhoneOpen(!phoneOpen);
              setError("");
            }}
          >
            {phoneOpen ? "Hide phone sign-in" : "Continue with phone"}
          </button>
          {phoneOpen && (
            <form
              className="form-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void (sentPhone ? verifyCode() : sendCode());
              }}
            >
              {sentPhone ? (
                <>
                  <p className="muted" role="status">
                    Enter the six-digit code sent to {sentPhone}.
                  </p>
                  <label>
                    Verification code
                    <input
                      key="code"
                      name="code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      pattern="[0-9]{6}"
                      required
                      autoFocus
                      value={code}
                      disabled={!!busy}
                      onChange={(event) =>
                        setCode(
                          event.target.value.replace(/\D/g, "").slice(0, 6),
                        )
                      }
                    />
                  </label>
                  <button
                    type="submit"
                    className="button dark"
                    disabled={!!busy || code.length !== 6}
                  >
                    {busy === "verify"
                      ? "Checking code…"
                      : "Verify and sign in"}
                    <ArrowRight size={17} />
                  </button>
                  <button
                    type="button"
                    className="button outline"
                    disabled={!!busy || cooldown > 0}
                    onClick={() => void sendCode()}
                  >
                    {busy === "send"
                      ? "Sending code…"
                      : cooldown
                        ? `Resend in ${cooldown}s`
                        : "Resend code"}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={!!busy}
                    onClick={() => {
                      setSentPhone("");
                      setCode("");
                      setError("");
                    }}
                  >
                    Use a different number
                  </button>
                </>
              ) : (
                <>
                  <label>
                    UK mobile number
                    <input
                      key="phone"
                      name="phone"
                      type="tel"
                      autoComplete="tel"
                      placeholder="07700 900123"
                      maxLength={24}
                      required
                      value={phone}
                      disabled={!!busy}
                      onChange={(event) => setPhone(event.target.value)}
                    />
                  </label>
                  <p className="fine-print">
                    We’ll text you a sign-in code. Your first verification
                    creates an account. This doesn’t subscribe you to fuel
                    alerts.
                  </p>
                  <button
                    type="submit"
                    className="button dark"
                    disabled={!!busy || cooldown > 0}
                  >
                    {busy === "send"
                      ? "Sending code…"
                      : cooldown
                        ? `Send again in ${cooldown}s`
                        : "Text me a code"}
                    <ArrowRight size={17} />
                  </button>
                </>
              )}
            </form>
          )}
        </>
      )}
      <p className="fine-print">
        <ShieldCheck size={14} />
        Your saved settings work across the website and app.
      </p>
    </div>
  );
}
