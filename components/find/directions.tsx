"use client";

import { useCallback, useState } from "react";
import { FIND, fill, type Locale } from "@/lib/i18n";

type Mode = "WALK" | "TRANSIT" | "DRIVE" | "BICYCLE";
type Pref = "LESS_WALKING" | "FEWER_TRANSFERS" | null;

type Step = {
  mode: string;
  instruction: string;
  minutes: number;
  line?: string;
  headsign?: string;
  departStop?: string;
  arriveStop?: string;
  departTime?: string;
};

type Route = {
  mode: Mode;
  minutes: number;
  meters: number;
  fare: string;
  steps: Step[];
  link: string;
};

export default function Directions({
  dest,
  locale,
}: {
  dest: { lat: number; lon: number };
  locale: Locale;
}) {
  const t = FIND[locale];
  const [mode, setMode] = useState<Mode>("TRANSIT");
  const [pref, setPref] = useState<Pref>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [link, setLink] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [origin, setOrigin] = useState<{ lat: number; lon: number } | null>(null);

  const fetchRoute = useCallback(
    async (m: Mode, p: Pref, o: { lat: number; lon: number } | null) => {
      setBusy(true);
      setNote("");
      try {
        const res = await fetch("/api/directions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dest,
            origin: o ?? undefined,
            mode: m,
            transitPreference: m === "TRANSIT" ? p : null,
            locale,
          }),
        });
        const json = (await res.json()) as {
          route: Route | null;
          link: string;
          reason?: string;
        };
        setRoute(json.route);
        setLink(json.link);
        if (!json.route) setNote(t.directions.noRoute);
      } catch {
        setRoute(null);
        setNote(t.directions.noRoute);
      } finally {
        setBusy(false);
      }
    },
    [dest, locale, t.directions.noRoute],
  );

  // Location is only ever requested on an explicit tap — never on mount.
  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setNote(t.directions.locationDenied);
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const o = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setOrigin(o);
        void fetchRoute(mode, pref, o);
      },
      () => {
        setBusy(false);
        setNote(t.directions.locationDenied);
        void fetchRoute(mode, pref, null);
      },
      { timeout: 8000, maximumAge: 60_000 },
    );
  };

  const pick = (m: Mode) => {
    setMode(m);
    void fetchRoute(m, pref, origin);
  };

  const togglePref = (p: Exclude<Pref, null>) => {
    const next = pref === p ? null : p;
    setPref(next);
    void fetchRoute(mode, next, origin);
  };

  const MODES: Array<[Mode, string]> = [
    ["WALK", t.directions.walk],
    ["TRANSIT", t.directions.transit],
    ["DRIVE", t.directions.drive],
    ["BICYCLE", t.directions.bike],
  ];

  return (
    <section className="mt-6 rounded-2xl border border-line p-4">
      <h3 className="text-[18px] font-bold text-ink">{t.directions.title}</h3>

      <div className="mt-3 flex flex-wrap gap-2">
        {MODES.map(([m, label]) => (
          <button
            key={m}
            onClick={() => pick(m)}
            aria-pressed={mode === m}
            className={`min-h-[44px] rounded-full border-2 px-4 text-[15px] font-semibold ${
              mode === m ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "TRANSIT" && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => togglePref("LESS_WALKING")}
              aria-pressed={pref === "LESS_WALKING"}
              className={`min-h-[44px] rounded-full border-2 px-4 text-[15px] font-semibold ${
                pref === "LESS_WALKING" ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink"
              }`}
            >
              {t.directions.lessWalking}
            </button>
            <button
              onClick={() => togglePref("FEWER_TRANSFERS")}
              aria-pressed={pref === "FEWER_TRANSFERS"}
              className={`min-h-[44px] rounded-full border-2 px-4 text-[15px] font-semibold ${
                pref === "FEWER_TRANSFERS" ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink"
              }`}
            >
              {t.directions.fewerTransfers}
            </button>
          </div>
          {/* Google exposes no wheelchair-accessible transit filter. Saying so
              is better than letting "less walking" be mistaken for step-free. */}
          {pref === "LESS_WALKING" && (
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              {t.directions.caveat}
            </p>
          )}
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={useMyLocation}
          disabled={busy}
          className="min-h-[48px] flex-1 rounded-2xl border-2 border-line px-4 text-[16px] font-semibold text-ink disabled:opacity-50"
        >
          {t.directions.useMyLocation}
        </button>
        <a
          href={link || `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lon}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-[48px] flex-1 items-center justify-center rounded-2xl bg-brand px-4 text-center text-[16px] font-semibold text-white"
        >
          {t.directions.openInMaps}
        </a>
      </div>

      {busy && <p className="mt-3 text-[16px] text-muted">{t.loading}</p>}
      {note && !busy && <p className="mt-3 text-[15px] text-muted">{note}</p>}

      {route && !busy && (
        <div className="mt-4">
          <p className="text-[19px] font-bold text-ink">
            {fill(t.directions.minutes, { n: route.minutes })}
            {route.fare ? ` · ${fill(t.directions.fare, { x: route.fare })}` : ""}
          </p>
          <ol className="mt-3 space-y-3">
            {route.steps.map((step, i) => (
              <li key={i} className="border-l-2 border-line pl-3">
                {step.line ? (
                  <>
                    <p className="text-[16px] font-semibold text-ink">
                      {fill(t.directions.board, {
                        line: step.line,
                        headsign: step.headsign ?? "",
                      })}
                    </p>
                    {step.departStop && (
                      <p className="text-[15px] text-muted">{step.departStop}</p>
                    )}
                    {step.arriveStop && (
                      <p className="text-[15px] text-muted">
                        {fill(t.directions.getOff, { stop: step.arriveStop })}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[16px] text-ink">{step.instruction}</p>
                )}
                {step.minutes > 0 && (
                  <p className="text-[14px] text-muted">
                    {fill(t.directions.minutes, { n: step.minutes })}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
