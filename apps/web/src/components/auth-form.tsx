import { useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { auth, errorMessage } from "../lib/api";
export function AuthForm({ initialError = "" }: { initialError?: string }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError);
  async function signIn() {
    setBusy(true);
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
      setBusy(false);
    }
  }
  return (
    <div className="form-stack">
      <div className="form-symbol">
        <ShieldCheck />
      </div>
      <p className="muted">
        Sign in with Google to save your car, track your favourite stations and
        plan your next fill-up.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button
        type="button"
        className="button dark"
        disabled={busy}
        onClick={() => void signIn()}
      >
        {busy ? "Taking you to Google…" : "Continue with Google"}
        <ArrowRight size={17} />
      </button>
      <p className="fine-print">
        <ShieldCheck size={14} />
        Your Google account creates or signs you into Pump Hawk.
      </p>
    </div>
  );
}
