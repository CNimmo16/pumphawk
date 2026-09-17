import { useState, type FormEvent } from "react";
import { ArrowRight, MessageSquare, ShieldCheck } from "lucide-react";
import { auth, errorMessage } from "../lib/api";
export function AuthForm({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState(""),
    [code, setCode] = useState(""),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [localCode, setLocalCode] = useState<string | null>(null);
  const normalized = () => {
    const n = phone.replace(/[\s()-]/g, "");
    return n.startsWith("0")
      ? "+44" + n.slice(1)
      : n.startsWith("44")
        ? "+" + n
        : n.startsWith("+")
          ? n
          : "+44" + n;
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (sent) {
        const result = await auth.phoneNumber.verify({
          phoneNumber: normalized(),
          code,
        });
        if (result.error) throw result.error;
        onDone();
      } else {
        if (!/^\+447\d{9}$/.test(normalized()))
          throw new Error("Enter a UK mobile number, such as 07700 900123.");
        const result = await auth.phoneNumber.sendOtp({
          phoneNumber: normalized(),
        });
        if (result.error) throw result.error;
        setSent(true);
        if (import.meta.env.DEV) {
          const response = await fetch(
            `/api/dev/otp?phone=${encodeURIComponent(normalized())}`,
          );
          if (response.ok) {
            const result: { code: string | null } = await response.json();
            setLocalCode(result.code);
          }
        }
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="form-stack">
      <div className="form-symbol">
        <MessageSquare />
      </div>
      <p className="muted">
        A smarter fill-up starts with your number. We’ll use a one-time code to
        sign you in or create your account.
      </p>
      {!sent ? (
        <label>
          UK mobile number
          <input
            autoFocus
            autoComplete="tel"
            type="tel"
            placeholder="07700 900123"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </label>
      ) : (
        <>
          <p className="muted">
            Enter the six-digit code for <strong>{normalized()}</strong>.
          </p>
          <label>
            Verification code
            <input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
            />
          </label>
          {localCode && (
            <div className="local-code">
              <span>
                Local SMS stub · code <strong>{localCode}</strong>
              </span>
              <button
                type="button"
                className="text-button"
                onClick={() => setCode(localCode)}
              >
                Use code
              </button>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <button className="button dark" disabled={busy}>
        {busy ? "One moment…" : sent ? "Verify & continue" : "Send my code"}
        <ArrowRight size={17} />
      </button>
      {sent && (
        <button
          className="text-button"
          type="button"
          disabled={busy}
          onClick={() => {
            setSent(false);
            setCode("");
            setError("");
          }}
        >
          Change number or resend code
        </button>
      )}
      <p className="fine-print">
        <ShieldCheck size={14} />
        Just your phone number. No password to remember.
      </p>
      <p className="fine-print">
        SMS delivery is currently a stub. Local codes appear here in
        development.
      </p>
    </form>
  );
}
