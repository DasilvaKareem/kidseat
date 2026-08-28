"use client";

import { useEffect, useState } from "react";
import { FIND, fill, type Locale } from "@/lib/i18n";
import type { MapItem, Program } from "./types";

export default function DetailPanel({
  item,
  locale,
  appliedProgramIds,
  onClose,
  onApply,
}: {
  item: MapItem;
  locale: Locale;
  appliedProgramIds: Set<string>;
  onClose: () => void;
  onApply: (program: Program) => void;
}) {
  const t = FIND[locale];
  const [programs, setPrograms] = useState<Program[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPrograms(null);
    const params = new URLSearchParams();
    if (item.pantry_id) params.set("pantry_id", item.pantry_id);
    if (item.zip) params.set("zip", item.zip);
    fetch(`/api/programs?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setPrograms(d.programs ?? []);
      })
      .catch(() => {
        if (!cancelled) setPrograms([]);
      });
    return () => {
      cancelled = true;
    };
  }, [item.pantry_id, item.zip]);

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <div className="flex-1">
          <p className="text-[14px] font-semibold uppercase tracking-wide text-muted">
            {item.kind === "event" ? t.filters.events : t.filters.pantries}
          </p>
          <h2 className="mt-1 text-[24px] font-bold leading-tight text-ink">
            {item.name}
          </h2>
        </div>
        <button
          onClick={onClose}
          aria-label={t.close}
          className="min-h-[44px] min-w-[44px] rounded-xl border border-line text-[18px] text-muted"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {item.when && <p className="text-[18px] font-semibold text-ink">{item.when}</p>}
        <p className="mt-1 text-[17px] text-muted">
          {item.address}
          {item.zip ? ` · ${item.zip}` : ""}
        </p>

        <p className="mt-3 text-[16px] text-ink">
          {item.requirements.trim() === ""
            ? t.card.noId
            : fill(t.card.bring, { x: item.requirements })}
        </p>

        <div className="mt-4 flex gap-3">
          <a
            href={`https://maps.google.com/?q=${item.lat},${item.lon}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[52px] flex-1 items-center justify-center rounded-2xl border-2 border-line text-[17px] font-semibold text-ink"
          >
            {t.card.directions}
          </a>
          {item.phone && (
            <a
              href={`tel:${item.phone.replace(/[^\d+]/g, "")}`}
              className="flex min-h-[52px] flex-1 items-center justify-center rounded-2xl border-2 border-line text-[17px] font-semibold text-ink"
            >
              {t.card.call}
            </a>
          )}
        </div>

        {programs === null ? (
          <p className="mt-6 text-[16px] text-muted">{t.loading}</p>
        ) : programs.length > 0 ? (
          <div className="mt-6 space-y-3">
            {programs.map((p) => {
              const applied = appliedProgramIds.has(p.program_id);
              return (
                <div key={p.program_id} className="rounded-2xl border border-line p-4">
                  <h3 className="text-[18px] font-bold text-ink">{p.name}</h3>
                  <p className="mt-0.5 text-[15px] text-muted">{p.provider}</p>
                  {p.summary && (
                    <p className="mt-2 text-[16px] leading-relaxed text-ink">{p.summary}</p>
                  )}
                  {p.processing_days > 0 && (
                    <p className="mt-2 text-[15px] text-muted">
                      {fill(t.apply.processing, { n: p.processing_days })}
                    </p>
                  )}
                  <button
                    onClick={() => onApply(p)}
                    disabled={applied}
                    className="mt-3 min-h-[52px] w-full rounded-2xl bg-brand px-4 text-[17px] font-semibold text-white disabled:bg-line disabled:text-muted"
                  >
                    {applied ? t.apply.applied : t.apply.action}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
