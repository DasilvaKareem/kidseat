import { NextResponse } from "next/server";
import { pgQuery } from "@/lib/postgres";
import { isLocale, type Locale } from "@/lib/i18n";
import { formatEventTime } from "@/lib/format-time";

export type MapItem = {
  id: string;
  kind: "pantry" | "event";
  name: string;
  address: string;
  zip: string;
  lat: number;
  lon: number;
  when: string;
  starts_at: string;
  tags: string[];
  languages: string[];
  requirements: string;
  phone: string;
  pantry_id: string;
  program_count: number;
  access_tags: string[];
};

// Number(null) is 0 and Number.isFinite(0) is true, so a missing parameter
// must be rejected before it ever reaches Number() — otherwise every absent
// bound silently becomes 0 and the viewport query matches nothing.
const num = (v: string | null, fallback: number) => {
  if (v === null || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Everything visible in the current viewport. Bounds come from the map, so the
 * list and the pins are always describing the same set — the Zillow contract.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams;

  // Default to the whole service area so a first paint works before the map
  // reports its own bounds.
  const north = num(p.get("north"), 38.4);
  const south = num(p.get("south"), 37.6);
  const east = num(p.get("east"), -122.2);
  const west = num(p.get("west"), -122.7);

  const localeParam = p.get("locale");
  const locale: Locale = isLocale(localeParam) ? localeParam : "en";
  const kinds = (p.get("kinds") ?? "pantry,event").split(",");
  const tags = (p.get("tags") ?? "").split(",").filter(Boolean);
  const noId = p.get("no_id") === "1";
  const today = p.get("today") === "1";
  const accessible = p.get("accessible") === "1";
  const dow = new Date().getDay();

  const wantPantries = kinds.includes("pantry");
  const wantEvents = kinds.includes("event");

  try {
    const [pantries, events, programCounts] = await Promise.all([
      wantPantries
        ? pgQuery<any>(
            `SELECT pantry_id, name, address, zip, lat, lon, phone, hours,
                    open_days, languages, tags, requirements, access_tags
             FROM pantries
             WHERE active
               AND lat BETWEEN $1 AND $2
               AND lon BETWEEN $3 AND $4
               AND (NOT $5::boolean OR cardinality(open_days) = 0
                    OR $6::smallint = ANY (open_days))
             LIMIT 300`,
            [south, north, west, east, today, dow],
          )
        : Promise.resolve([]),
      wantEvents
        ? pgQuery<any>(
            // The client parses these as 'YYYY-MM-DD hh:mm:ss' UTC, so they are
            // rendered to text here rather than returned as Date objects.
            `SELECT event_id, pantry_id, title,
                    to_char(starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS starts_text,
                    to_char(ends_at   AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS ends_text,
                    zip, lat, lon, address, languages, tags, requirements, access_tags
             FROM pantry_events
             WHERE NOT cancelled
               AND ends_at > now()
               AND lat BETWEEN $1 AND $2
               AND lon BETWEEN $3 AND $4
               AND starts_at < now() + make_interval(hours => $5::int)
             ORDER BY starts_at
             LIMIT 300`,
            [south, north, west, east, today ? 24 : 168],
          )
        : Promise.resolve([]),
      pgQuery<{ pantry_id: string; n: string }>(
        `SELECT pantry_id, count(*)::text AS n FROM programs
         WHERE active AND pantry_id IS NOT NULL GROUP BY pantry_id`,
      ),
    ]);

    const counts = new Map(programCounts.map((r) => [r.pantry_id, Number(r.n)]));

    const items: MapItem[] = [
      ...pantries.map((r) => ({
        id: `pantry:${r.pantry_id}`,
        kind: "pantry" as const,
        name: r.name,
        address: r.address,
        zip: r.zip,
        lat: r.lat,
        lon: r.lon,
        when: r.hours ?? "",
        starts_at: "",
        tags: r.tags ?? [],
        languages: r.languages ?? [],
        requirements: r.requirements ?? "",
        phone: r.phone ?? "",
        pantry_id: r.pantry_id,
        program_count: counts.get(r.pantry_id) ?? 0,
        access_tags: r.access_tags ?? [],
      })),
      ...events.map((r) => ({
        id: `event:${r.event_id}`,
        kind: "event" as const,
        name: r.title,
        address: r.address,
        zip: r.zip,
        lat: r.lat,
        lon: r.lon,
        when: formatEventTime(r.starts_text, r.ends_text, locale),
        starts_at: r.starts_text,
        tags: r.tags ?? [],
        languages: r.languages ?? [],
        requirements: r.requirements ?? "",
        phone: "",
        pantry_id: r.pantry_id ?? "",
        program_count: counts.get(r.pantry_id) ?? 0,
        access_tags: r.access_tags ?? [],
      })),
    ];

    const filtered = items.filter((i) => {
      if (noId && i.requirements.trim() !== "") return false;
      // An absent tag means unknown, so filtering to "accessible" can only ever
      // show places that positively claim it — never a guess.
      if (
        accessible &&
        !i.access_tags.some((a) => a === "wheelchair" || a === "step_free")
      ) {
        return false;
      }
      if (tags.length > 0 && !tags.some((t) => i.tags.includes(t))) return false;
      return true;
    });

    // Events first — a time you can show up at beats a general listing.
    filtered.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "event" ? -1 : 1;
      return a.starts_at.localeCompare(b.starts_at);
    });

    return NextResponse.json({ items: filtered });
  } catch (err) {
    console.error("[map]", err);
    return NextResponse.json(
      { items: [], error: "unavailable" },
      { status: 503 },
    );
  }
}
