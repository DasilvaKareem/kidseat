"use client";

import { useState } from "react";
import { FIND, type Locale } from "@/lib/i18n";
import { formatUS } from "@/lib/phone";
import Modal from "./modal";

export default function SignInDialog({
  open,
  locale,
  onClose,
  onSignedIn,
}: {
  open: boolean;
  locale: Locale;
  onClose: () => void;
  onSignedIn: () => void;
}) {
  const t = FIND[locale];
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, locale }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error === "rate_limited" ? t.auth.tooMany : t.auth.wrongCode);
        return;
      }
      setStep("code");
    } catch {
      setError(t.auth.wrongCode);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(
          json.error === "expired"
            ? t.auth.expired
            : json.error === "too_many_attempts"
              ? t.auth.tooMany
              : t.auth.wrongCode,
        );
        return;
      }
      onSignedIn();
      onClose();
      setStep("phone");
      setCode("");
    } catch {
      setError(t.auth.wrongCode);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t.auth.title} closeLabel={t.close}>
      <p className="text-[17px] text-muted">{t.auth.sub}</p>

      {step === "phone" ? (
        <div className="mt-5">
          <label htmlFor="signin-phone" className="mb-2 block text-[16px] font-semibold text-muted">
            {t.auth.phoneLabel}
          </label>
          <input
            id="signin-phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(formatUS(e.target.value))}
            placeholder="(415) 555-0123"
            className="min-h-[60px] w-full rounded-2xl border-2 border-line bg-surface px-5 text-[20px] tabular-nums text-ink focus:border-brand"
          />
          <button
            onClick={send}
            disabled={busy || phone.replace(/\D/g, "").length < 10}
            className="mt-4 min-h-[60px] w-full rounded-2xl bg-brand text-[18px] font-semibold text-white disabled:opacity-50"
          >
            {t.auth.send}
          </button>
        </div>
      ) : (
        <div className="mt-5">
          <label htmlFor="signin-code" className="mb-2 block text-[16px] font-semibold text-muted">
            {t.auth.codeLabel}
          </label>
          <input
            id="signin-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="min-h-[60px] w-full rounded-2xl border-2 border-line bg-surface px-5 text-center text-[28px] tracking-[0.4em] tabular-nums text-ink focus:border-brand"
          />
          <button
            onClick={verify}
            disabled={busy || code.length !== 6}
            className="mt-4 min-h-[60px] w-full rounded-2xl bg-brand text-[18px] font-semibold text-white disabled:opacity-50"
          >
            {t.auth.verify}
          </button>
          <button
            onClick={() => {
              setStep("phone");
              setCode("");
              setError("");
            }}
            className="mt-3 min-h-[48px] w-full text-[16px] text-muted underline underline-offset-4"
          >
            {t.auth.resend}
          </button>
        </div>
      )}

      <p role="alert" aria-live="polite" className="mt-3 min-h-[24px] text-[16px] font-semibold text-danger">
        {error}
      </p>
    </Modal>
  );
}
