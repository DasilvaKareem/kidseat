"use client";

import { FIND, fill, type Locale } from "@/lib/i18n";
import type { MapItem } from "./types";

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "brand" | "quiet";
}) {
  const styles = {
    brand: "bg-brand text-white",
    neutral: "bg-canvas text-ink border border-line",
    quiet: "text-muted",
  }[tone];
  return (
    <span className={`rounded-full px-2.5 py-1 text-[13px] font-semibold ${styles}`}>
      {children}
    </span>
  );
}

export default function ResultsList({
  items,
  locale,
  loading,
  selectedId,
  onSelect,
  onHover,
  onApply,
  appliedPantryIds,
}: {
  items: MapItem[];
  locale: Locale;
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onApply: (item: MapItem) => void;
  appliedPantryIds: Set<string>;
}) {
  const t = FIND[locale];

  if (loading && items.length === 0) {
    return <p className="p-5 text-[17px] text-muted">{t.loading}</p>;
  }
  if (items.length === 0) {
    return <p className="p-5 text-[17px] text-muted">{t.none}</p>;
  }

  return (
    <ul className="divide-y divide-line">
      {items.map((item) => {
        const selected = item.id === selectedId;
        const noId = item.requirements.trim() === "";
        const applied = item.pantry_id !== "" && appliedPantryIds.has(item.pantry_id);
        return (
          <li key={item.id}>
            <div
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              onClick={() => onSelect(item.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(item.id);
                }
              }}
              onMouseEnter={() => onHover(item.id)}
              onMouseLeave={() => onHover(null)}
              className={`w-full cursor-pointer px-5 py-4 text-left transition-colors ${
                selected ? "bg-canvas" : "bg-surface hover:bg-canvas"
              }`}
            >
              <div className="flex items-center gap-2">
                <Badge tone={item.kind === "event" ? "brand" : "neutral"}>
                  {item.kind === "event" ? t.filters.events : t.filters.pantries}
                </Badge>
                {item.when && (
                  <span className="text-[15px] font-semibold text-ink">{item.when}</span>
                )}
              </div>

              <h3 className="mt-2 text-[19px] font-bold leading-snug text-ink">
                {item.name}
              </h3>
              <p className="mt-1 text-[16px] text-muted">
                {item.address}
                {item.zip ? ` · ${item.zip}` : ""}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {noId && <Badge tone="neutral">{t.card.noId}</Badge>}
                {item.program_count > 0 && (
                  <Badge tone="quiet">
                    {fill(t.card.programs, { n: item.program_count })}
                  </Badge>
                )}
                {item.program_count > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onApply(item);
                    }}
                    disabled={applied}
                    className="ml-auto min-h-[44px] rounded-xl bg-brand px-4 text-[16px] font-semibold text-white disabled:bg-line disabled:text-muted"
                  >
                    {applied ? t.apply.applied : t.apply.action}
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
