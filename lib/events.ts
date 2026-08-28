import { query } from "./clickhouse";
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

  const rows = await query<FoodEvent>(
    `SELECT event_id, pantry_id, title, toString(starts_at) AS starts_at,
            toString(ends_at) AS ends_at, zip, lat, lon, address,
            languages, tags, notes, requirements
     FROM v_upcoming_events
     WHERE starts_at < now() + INTERVAL {hours:UInt32} HOUR
     ORDER BY starts_at
     LIMIT 200`,
    { hours: withinHours },
  );

  const here =
    opts.lat != null && opts.lon != null ? { lat: opts.lat, lon: opts.lon } : null;
  const required = needs.flatMap((n) => NEED_TAGS[n] ?? []);

  return rows
    .map((e) => ({
      ...e,
      miles: here ? milesBetween(here, { lat: e.lat, lon: e.lon }) : null,
    }))
    .filter((e) => {
      if (required.length > 0 && !required.some((t) => e.tags.includes(t))) return false;
      if (e.miles == null) return e.zip === opts.zip;
      return e.miles <= radius;
    })
    .slice(0, limit);
}
