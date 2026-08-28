import { query } from "./clickhouse";
import { milesBetween } from "./geo";

export type Pantry = {
  pantry_id: string;
  name: string;
  address: string;
  zip: string;
  lat: number;
  lon: number;
  phone: string;
  hours: string;
  open_days: number[];
  languages: string[];
  tags: string[];
  requirements: string;
};

export type Match = Pantry & { miles: number | null };

// A stated need is a hard filter, not a ranking hint. Sending someone with no
// stove to a raw-produce distribution is worse than sending nothing.
const NEED_TAGS: Record<string, string[]> = {
  no_stove: ["shelf_stable", "prepared"],
  no_fridge: ["shelf_stable", "prepared"],
  baby: ["baby"],
  halal_kosher: ["halal", "kosher"],
  allergies: [],
  low_mobility: ["delivery"],
};

export async function findNearby(opts: {
  zip: string;
  lat: number | null;
  lon: number | null;
  needs: string[];
  limit?: number;
  radiusMiles?: number;
  day?: number;
}): Promise<Match[]> {
  const limit = opts.limit ?? 3;
  const radius = opts.radiusMiles ?? (opts.needs.includes("low_mobility") ? 0.75 : 2);
  const day = opts.day ?? new Date().getDay();

  const rows = await query<Pantry>(
    `SELECT pantry_id, name, address, zip, lat, lon, phone, hours,
            open_days, languages, tags, requirements
     FROM pantries FINAL
     WHERE active = 1
       AND (empty(open_days) OR has(open_days, {day:UInt8}))`,
    { day },
  );

  const here =
    opts.lat != null && opts.lon != null ? { lat: opts.lat, lon: opts.lon } : null;

  const required = opts.needs.flatMap((n) => NEED_TAGS[n] ?? []);

  return rows
    .map((p) => ({
      ...p,
      miles: here ? milesBetween(here, { lat: p.lat, lon: p.lon }) : null,
    }))
    .filter((p) => {
      if (required.length > 0 && !required.some((t) => p.tags.includes(t))) return false;
      // Without coordinates we can only fall back to same-ZIP.
      if (p.miles == null) return p.zip === opts.zip;
      return p.miles <= radius;
    })
    .sort((a, b) => (a.miles ?? 99) - (b.miles ?? 99))
    .slice(0, limit);
}
