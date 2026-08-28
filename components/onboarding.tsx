"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COPY, FIND, LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n";
import { formatUS } from "@/lib/phone";
import { Button, Choice, Field, Progress, Screen } from "./ui";

type Step = "language" | "phone" | "zip" | "household" | "needs" | "done" | "out_of_area";

const NUMBERED: Step[] = ["phone", "zip", "household", "needs", "done"];
const STORE_KEY = "sffood.onboarding";

type State = {
  step: Step;
  locale: Locale;
  phone: string;
  token: string;
  zip: string;
  household: string;
  needs: string[];
};

const EMPTY: State = {
  step: "language",
  locale: "en",
  phone: "",
  token: "",
  zip: "",
  household: "",
  needs: [],
};

function load(): State {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<State>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function sessionId(): string {
  if (typeof window === "undefined") return "";
  let id = sessionStorage.getItem("sffood.sid");
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem("sffood.sid", id);
  }
  return id;
}

export default function Onboarding() {
  const [s, setS] = useState<State>(EMPTY);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const headingRef = useRef<HTMLDivElement>(null);

  const t = COPY[s.locale];

  const track = useCallback(
    (step: Step, action: string, detail = "") => {
      void fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId(),
          step,
          action,
          locale: s.locale,
          detail,
        }),
        keepalive: true,
      }).catch(() => {});
    },
    [s.locale],
  );

  // Restore a refresh mid-flow. Consent is written server-side at the phone
  // step, so replaying earlier steps can never write it twice.
  useEffect(() => {
    setS(load());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    sessionStorage.setItem(STORE_KEY, JSON.stringify(s));
  }, [s, hydrated]);

  // Real Back button support: each step is a history entry.
  useEffect(() => {
    if (!hydrated) return;
    const onPop = (e: PopStateEvent) => {
      const step = (e.state?.step ?? "language") as Step;
      setError("");
      setS((prev) => ({ ...prev, step }));
      track(step, "back");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [hydrated, track]);

  const go = useCallback(
    (step: Step) => {
      setError("");
      setS((prev) => ({ ...prev, step }));
      history.pushState({ step }, "", `#${step}`);
      track(step, "view");
      // Move focus to the new heading so screen readers announce the change.
      requestAnimationFrame(() => headingRef.current?.focus());
    },
    [track],
  );

  if (!hydrated) return null;

  // --- step 0: language ------------------------------------------------------
  if (s.step === "language") {
    return (
      <Screen>
        <div className="flex h-full min-h-[60svh] flex-col justify-center gap-4">
          <div aria-hidden className="mb-2 text-center text-[44px]">🍎</div>
          {LOCALES.map((loc) => (
            <Choice
              key={loc}
              lang={loc}
              onClick={() => {
                setS((prev) => ({ ...prev, locale: loc }));
                track("language", "submit", loc);
                go("phone");
              }}
            >
              {LOCALE_LABELS[loc]}
            </Choice>
          ))}
        </div>
      </Screen>
    );
  }

  const stepIndex = NUMBERED.indexOf(s.step);

  const errorCopy = (status: number, code?: string, missing?: string[]) => {
    if (code === "bad_phone") return t.phone.error;
    if (status === 429 || code === "rate_limited") return t.common.rateLimited;
    // The server only returns `missing` outside production — it turns an
    // opaque 503 into an actionable one while developing.
    if (code === "not_configured" && missing?.length) {
      return `${t.common.serverError} (missing: ${missing.join(", ")})`;
    }
    return t.common.serverError;
  };

  const submitPhone = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: s.phone, locale: s.locale }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        token?: string;
        error?: string;
        missing?: string[];
      };
      if (!res.ok || !json.token) {
        setError(errorCopy(res.status, json.error, json.missing));
        track("phone", "error", json.error ?? `http_${res.status}`);
        return;
      }
      setS((prev) => ({ ...prev, token: json.token! }));
      track("phone", "submit");
      go("zip");
    } catch {
      setError(t.common.serverError);
      track("phone", "error", "network");
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async (patch: Partial<State>) => {
    const next = { ...s, ...patch };
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: next.token,
        locale: next.locale,
        zip: next.zip,
        household_bucket: next.household,
        needs: next.needs,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      inServiceArea?: boolean;
      error?: string;
      missing?: string[];
    };
    return { status: res.status, json };
  };

  const submitZip = async () => {
    if (!/^\d{5}$/.test(s.zip)) {
      setError(t.zip.error);
      track("zip", "error", "format");
      return;
    }
    setBusy(true);
    try {
      const { status, json } = await saveProfile({});
      if (json.error) {
        setError(json.error === "bad_zip" ? t.zip.error : errorCopy(status, json.error, json.missing));
        track("zip", "error", json.error);
        return;
      }
      track("zip", "submit");
      go(json.inServiceArea ? "household" : "out_of_area");
    } catch {
      setError(t.common.serverError);
      track("zip", "error", "network");
    } finally {
      setBusy(false);
    }
  };

  const finish = async (patch: Partial<State>, skipped: boolean) => {
    setBusy(true);
    try {
      await saveProfile(patch);
      track("needs", skipped ? "skip" : "submit");
      go("done");
    } finally {
      setBusy(false);
    }
  };

  const heading = (
    <div ref={headingRef} tabIndex={-1} className="sr-only" aria-live="polite" />
  );

  // --- step 1: phone + consent ----------------------------------------------
  if (s.step === "phone") {
    return (
      <>
        <Progress step={stepIndex + 1} total={NUMBERED.length} />
        {heading}
        <Screen
          title={t.phone.title}
          sub={t.phone.sub}
          footer={
            <Button onClick={submitPhone} disabled={busy || s.phone.replace(/\D/g, "").length < 10}>
              {t.common.continue}
            </Button>
          }
        >
          <Field
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            autoFocus
            label={t.phone.label}
            placeholder={t.phone.placeholder}
            value={s.phone}
            error={error}
            onChange={(e) =>
              setS((prev) => ({ ...prev, phone: formatUS(e.target.value) }))
            }
          />
          {/* Consent sits above the button, never below it. */}
          <p className="mt-4 rounded-2xl bg-surface p-4 text-[16px] leading-relaxed text-muted">
            {t.phone.consent}
          </p>
        </Screen>
      </>
    );
  }

  // --- step 2: ZIP -----------------------------------------------------------
  if (s.step === "zip") {
    return (
      <>
        <Progress step={stepIndex + 1} total={NUMBERED.length} />
        {heading}
        <Screen
          title={t.zip.title}
          sub={t.zip.sub}
          footer={
            <Button onClick={submitZip} disabled={busy || s.zip.length < 5}>
              {t.common.continue}
            </Button>
          }
        >
          <Field
            name="zip"
            type="text"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={5}
            autoFocus
            label={t.zip.title}
            placeholder={t.zip.placeholder}
            value={s.zip}
            error={error}
            onChange={(e) =>
              setS((prev) => ({ ...prev, zip: e.target.value.replace(/\D/g, "").slice(0, 5) }))
            }
          />
        </Screen>
      </>
    );
  }

  // --- out of area: a referral, never a dead end -----------------------------
  if (s.step === "out_of_area") {
    return (
      <Screen title={t.zip.outOfAreaTitle} sub={t.zip.outOfAreaBody}>
        <a
          href="tel:211"
          className="flex min-h-[60px] w-full items-center justify-center rounded-2xl bg-brand px-5 text-[19px] font-semibold text-white"
        >
          211
        </a>
        <p className="mt-6 text-[17px] text-muted">{t.zip.outOfAreaAction}</p>
      </Screen>
    );
  }

  // --- step 3: household -----------------------------------------------------
  if (s.step === "household") {
    return (
      <>
        <Progress step={stepIndex + 1} total={NUMBERED.length} />
        {heading}
        <Screen
          title={t.household.title}
          sub={t.household.sub}
          footer={
            <Button
              variant="ghost"
              onClick={() => {
                track("household", "skip");
                go("needs");
              }}
            >
              {t.common.skip}
            </Button>
          }
        >
          <div className="space-y-3">
            {t.household.options.map(([value, label]) => (
              <Choice
                key={value}
                selected={s.household === value}
                onClick={() => {
                  setS((prev) => ({ ...prev, household: value }));
                  track("household", "submit", value);
                  go("needs");
                }}
              >
                {label}
              </Choice>
            ))}
          </div>
        </Screen>
      </>
    );
  }

  // --- step 4: needs ---------------------------------------------------------
  if (s.step === "needs") {
    const toggle = (value: string) =>
      setS((prev) => ({
        ...prev,
        needs: prev.needs.includes(value)
          ? prev.needs.filter((n) => n !== value)
          : [...prev.needs, value],
      }));

    return (
      <>
        <Progress step={stepIndex + 1} total={NUMBERED.length} />
        {heading}
        <Screen
          title={t.needs.title}
          sub={t.needs.sub}
          footer={
            <>
              <Button disabled={busy} onClick={() => finish({}, false)}>
                {t.common.continue}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setS((prev) => ({ ...prev, needs: [] }));
                  void finish({ needs: [] }, true);
                }}
              >
                {t.common.skip}
              </Button>
            </>
          }
        >
          <div className="flex flex-wrap gap-3">
            {t.needs.options.map(([value, label]) => {
              const on = s.needs.includes(value);
              return (
                <button
                  key={value}
                  aria-pressed={on}
                  onClick={() => toggle(value)}
                  className={`min-h-[56px] rounded-full border-2 px-5 text-[18px] font-semibold transition-colors ${
                    on
                      ? "border-brand bg-brand text-white"
                      : "border-line bg-surface text-ink hover:border-ink"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Screen>
      </>
    );
  }

  // --- step 5: done ----------------------------------------------------------
  return (
    <Screen title={t.done.title}>
      <p className="text-[20px] leading-relaxed text-ink">
        {t.done.body.replace("{zip}", s.zip)}
      </p>
      <p className="mt-6 rounded-2xl bg-surface p-4 text-[17px] leading-relaxed text-muted">
        {t.done.keywords}
      </p>
      {/* Not everyone wants to wait for a text — the map is the same data. */}
      <a
        href="/map"
        className="mt-6 flex min-h-[60px] w-full items-center justify-center rounded-2xl border-2 border-line text-[18px] font-semibold text-ink"
      >
        {FIND[s.locale].title}
      </a>
    </Screen>
  );
}
