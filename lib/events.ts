import { pgQuery } from "./postgres";
import { milesBetween } from "./geo";

export type FoodEvent = {
  event_id: string;
  pantry_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  zip: string;
  lat: number;
  lon: number;
  address: string;
  languages: string[];
  tags: string[];
  notes: string;
  requirements: string;
};

export type EventMatch = FoodEvent & { miles: number | null };

// Same hard-filter contract as pantries: a stated need removes options, it does
// not merely reorder them.
const NEED_TAGS: Record<string, string[]> = {
  no_stove: ["shelf_stable", "prepared"],
  no_fridge: ["shelf_stable", "prepared"],
  baby: ["baby"],
  halal_kosher: ["halal", "kosher"],
  allergies: [],
  low_mobility: ["delivery"],
};

export async function upcomingEvents(opts: {
  zip: string;
  lat: number | null;
  lon: number | null;
  needs?: string[];
  withinHours?: number;
  radiusMiles?: number;
  limit?: number;
}): Promise<EventMatch[]> {
  const withinHours = opts.withinHours ?? 72;
  const needs = opts.needs ?? [];
  const radius = opts.radiusMiles ?? (needs.includes("low_mobility") ? 0.75 : 2);
  const limit = opts.limit ?? 3;

  const rows = await pgQuery<
    Omit<FoodEvent, "starts_at" | "ends_at"> & { starts_text: string; ends_text: string }
  >(
    // formatEventTime parses 'YYYY-MM-DD hh:mm:ss' as UTC, so the timestamps are
    // rendered to that shape here rather than handed over as Date objects.
    `SELECT event_id, pantry_id, title,
            to_char(starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS starts_text,
            to_char(ends_at   AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS ends_text,
            zip, lat, lon, address, languages, tags, notes, requirements
     FROM pantry_events
     WHERE NOT cancelled
       AND ends_at > now()
       AND starts_at < now() + make_interval(hours => $1::int)
     ORDER BY starts_at
     LIMIT 200`,
    [withinHours],
  );

  const here =
    opts.lat != null && opts.lon != null ? { lat: opts.lat, lon: opts.lon } : null;
  const required = needs.flatMap((n) => NEED_TAGS[n] ?? []);

  return rows
    .map((e) => ({
      ...e,
      starts_at: e.starts_text,
      ends_at: e.ends_text,
      miles: here ? milesBetween(here, { lat: e.lat, lon: e.lon }) : null,
    }))
    .filter((e) => {
      if (required.length > 0 && !required.some((t) => e.tags.includes(t))) return false;
      if (e.miles == null) return e.zip === opts.zip;
      return e.miles <= radius;
    })
    .slice(0, limit);
}
