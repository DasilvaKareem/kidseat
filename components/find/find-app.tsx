"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FIND,
  LOCALES,
  LOCALE_LABELS,
  plural,
  isLocale,
  type Locale,
} from "@/lib/i18n";
import MapPanel from "./map-panel";
import ResultsList from "./results-list";
import DetailPanel from "./detail-panel";
import ApplyDialog from "./apply-dialog";
import SignInDialog from "./sign-in-dialog";
import ChatBar from "./chat-bar";
import type { Application, Bounds, MapItem, Program } from "./types";

const TAG_FILTERS = ["shelf_stable", "prepared", "delivery", "halal", "kosher", "baby"];

export default function FindApp() {
  const [locale, setLocale] = useState<Locale>("en");
  const [signedIn, setSignedIn] = useState(false);
  const [items, setItems] = useState<MapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "map">("list");

  const [kinds, setKinds] = useState<string[]>(["pantry", "event"]);
  const [tags, setTags] = useState<string[]>([]);
  const [noId, setNoId] = useState(false);
  const [today, setToday] = useState(false);
  const [accessible, setAccessible] = useState(false);

  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [movedBounds, setMovedBounds] = useState<Bounds | null>(null);

  const [applications, setApplications] = useState<Application[]>([]);
  const [applyProgram, setApplyProgram] = useState<Program | null>(null);
  const [pendingProgram, setPendingProgram] = useState<Program | null>(null);
  const [signInOpen, setSignInOpen] = useState(false);

  const t = FIND[locale];

  // Locale survives a reload but is never guessed from the browser: the SMS
  // flow treats an explicit pick as authoritative, and so does this.
  useEffect(() => {
    const stored = localStorage.getItem("sffood.locale");
    if (isLocale(stored)) setLocale(stored);
  }, []);

  const chooseLocale = (l: Locale) => {
    setLocale(l);
    localStorage.setItem("sffood.locale", l);
  };

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      const json = (await res.json()) as { signedIn?: boolean; locale?: string };
      setSignedIn(Boolean(json.signedIn));
      if (json.signedIn && isLocale(json.locale)) setLocale(json.locale);
    } catch {
      setSignedIn(false);
    }
  }, []);

  const refreshApplications = useCallback(async () => {
    try {
      const res = await fetch("/api/applications");
      if (!res.ok) return setApplications([]);
      const json = (await res.json()) as { applications?: Application[] };
      setApplications(json.applications ?? []);
    } catch {
      setApplications([]);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (signedIn) void refreshApplications();
    else setApplications([]);
  }, [signedIn, refreshApplications]);

  const requestSeq = useRef(0);

  const load = useCallback(
    async (b: Bounds | null) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          locale,
          kinds: kinds.join(","),
          tags: tags.join(","),
          no_id: noId ? "1" : "0",
          today: today ? "1" : "0",
          accessible: accessible ? "1" : "0",
        });
        if (b) {
          params.set("north", String(b.north));
          params.set("south", String(b.south));
          params.set("east", String(b.east));
          params.set("west", String(b.west));
        }
        const res = await fetch(`/api/map?${params}`);
        const json = (await res.json()) as { items?: MapItem[] };
        // A response that is no longer the newest is dropped, not rendered:
        // otherwise the initial English fetch can land after the restored
        // locale's fetch and repaint the list in the wrong language.
        if (seq !== requestSeq.current) return;
        setItems(json.items ?? []);
      } catch {
        if (seq === requestSeq.current) setItems([]);
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [locale, kinds, tags, noId, today, accessible],
  );

  // Filters re-query immediately; panning does not, so nobody burns mobile data
  // on a map they are still moving.
  useEffect(() => {
    void load(bounds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, kinds, tags, noId, today, accessible]);

  const boundsRef = useRef<Bounds | null>(null);
  const onBounds = useCallback((b: Bounds) => {
    boundsRef.current = b;
    setBounds((prev) => prev ?? b);
    setMovedBounds(b);
  }, []);

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  const appliedProgramIds = useMemo(
    () =>
      new Set(
        applications.filter((a) => a.status !== "withdrawn").map((a) => a.program_id),
      ),
    [applications],
  );

  const openApply = (program: Program) => {
    if (!signedIn) {
      // Remember the intent so signing in lands them back on the form they
      // were already looking at, not on a blank map.
      setPendingProgram(program);
      setSignInOpen(true);
      return;
    }
    setApplyProgram(program);
  };

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const chip = (active: boolean) =>
    `min-h-[44px] rounded-full border-2 px-4 text-[15px] font-semibold transition-colors ${
      active ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink"
    }`;

  return (
    <div className="flex h-[100svh] flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <h1 className="flex-1 truncate text-[20px] font-bold text-ink">{t.title}</h1>

        <select
          aria-label="Language"
          value={locale}
          onChange={(e) => chooseLocale(e.target.value as Locale)}
          className="min-h-[44px] rounded-xl border-2 border-line bg-surface px-3 text-[16px] font-semibold text-ink"
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_LABELS[l]}
            </option>
          ))}
        </select>

        {signedIn ? (
          <button
            onClick={async () => {
              await fetch("/api/auth/signout", { method: "POST" });
              setSignedIn(false);
            }}
            className="min-h-[44px] rounded-xl border-2 border-line px-4 text-[16px] font-semibold text-ink"
          >
            {t.auth.signOut}
          </button>
        ) : (
          <button
            onClick={() => setSignInOpen(true)}
            className="min-h-[44px] rounded-xl bg-brand px-4 text-[16px] font-semibold text-white"
          >
            {t.auth.signIn}
          </button>
        )}
      </header>

      <div className="flex items-center gap-2 overflow-x-auto border-b border-line bg-surface px-4 py-2">
        <button onClick={() => setKinds(toggle(kinds, "pantry"))} className={chip(kinds.includes("pantry"))}>
          {t.filters.pantries}
        </button>
        <button onClick={() => setKinds(toggle(kinds, "event"))} className={chip(kinds.includes("event"))}>
          {t.filters.events}
        </button>
        <button onClick={() => setToday(!today)} className={chip(today)}>
          {t.filters.today}
        </button>
        <button onClick={() => setNoId(!noId)} className={chip(noId)}>
          {t.filters.noId}
        </button>
        <button onClick={() => setAccessible(!accessible)} className={chip(accessible)}>
          {t.access.filter}
        </button>
        {TAG_FILTERS.map((tag) => (
          <button key={tag} onClick={() => setTags(toggle(tags, tag))} className={chip(tags.includes(tag))}>
            {t.tagLabels[tag] ?? tag}
          </button>
        ))}
        {/* Mobile only: the map and the list compete for the same screen. */}
        <button
          onClick={() => setView(view === "list" ? "map" : "list")}
          className={`${chip(false)} ml-auto shrink-0 sm:hidden`}
        >
          {view === "list" ? "Map" : "List"}
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside
          className={`${
            view === "map" ? "hidden" : "flex"
          } w-full min-w-0 flex-col border-r border-line bg-surface sm:flex sm:w-[420px] sm:shrink-0`}
        >
          {selected ? (
            <DetailPanel
              item={selected}
              locale={locale}
              appliedProgramIds={appliedProgramIds}
              onClose={() => setSelectedId(null)}
              onApply={openApply}
            />
          ) : (
            <>
              <p className="border-b border-line px-5 py-3 text-[16px] font-semibold text-muted">
                {loading ? t.loading : plural(locale, items.length, t.places)}
              </p>
              <div className="flex-1 overflow-y-auto pb-28">
                <ResultsList
                  items={items}
                  locale={locale}
                  loading={loading}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onHover={setHoveredId}
                  onApply={(item) => setSelectedId(item.id)}
                  appliedPantryIds={new Set()}
                />
              </div>
            </>
          )}
        </aside>

        <div className={`${view === "list" ? "hidden" : "block"} relative min-w-0 flex-1 sm:block`}>
          <MapPanel
            items={items}
            selectedId={selectedId}
            hoveredId={hoveredId}
            onSelect={setSelectedId}
            onBounds={onBounds}
            unavailableLabel={t.mapUnavailable}
          />
          {movedBounds && (
            <button
              onClick={() => {
                setBounds(movedBounds);
                setMovedBounds(null);
                void load(movedBounds);
              }}
              className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-surface px-5 py-3 text-[16px] font-semibold text-ink shadow-[0_4px_16px_rgba(27,23,20,0.22)]"
            >
              {t.searchArea}
            </button>
          )}
        </div>
      </div>

      <ChatBar
        locale={locale}
        signedIn={signedIn}
        onRequestSignIn={() => setSignInOpen(true)}
      />

      <SignInDialog
        open={signInOpen}
        locale={locale}
        onClose={() => setSignInOpen(false)}
        onSignedIn={async () => {
          await refreshSession();
          await refreshApplications();
          if (pendingProgram) {
            setApplyProgram(pendingProgram);
            setPendingProgram(null);
          }
        }}
      />

      <ApplyDialog
        program={applyProgram}
        locale={locale}
        onClose={() => setApplyProgram(null)}
        onSubmitted={() => void refreshApplications()}
      />
    </div>
  );
}
