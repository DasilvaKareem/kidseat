import { NextResponse } from "next/server";
import { query } from "@/lib/clickhouse";
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
};

const num = (v: string | null, fallback: number) => {
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
  const dow = new Date().getDay();

  const wantPantries = kinds.includes("pantry");
  const wantEvents = kinds.includes("event");

  try {
    const [pantries, events, programCounts] = await Promise.all([
      wantPantries
        ? query<any>(
            `SELECT pantry_id, name, address, zip, lat, lon, phone, hours,
                    open_days, languages, tags, requirements
             FROM pantries FINAL
             WHERE active = 1
               AND lat BETWEEN {south:Float64} AND {north:Float64}
               AND lon BETWEEN {west:Float64} AND {east:Float64}
               AND (NOT {today:UInt8} OR empty(open_days) OR has(open_days, {dow:UInt8}))
             LIMIT 300`,
            { south, north, west, east, today: today ? 1 : 0, dow },
          )
        : Promise.resolve([]),
      wantEvents
        ? query<any>(
            `SELECT event_id, pantry_id, title, toString(starts_at) AS starts_at,
                    toString(ends_at) AS ends_at, zip, lat, lon, address,
                    languages, tags, requirements
             FROM v_upcoming_events
             WHERE lat BETWEEN {south:Float64} AND {north:Float64}
               AND lon BETWEEN {west:Float64} AND {east:Float64}
               AND starts_at < now() + INTERVAL {hours:UInt32} HOUR
             ORDER BY starts_at
             LIMIT 300`,
            { south, north, west, east, hours: today ? 24 : 168 },
          )
        : Promise.resolve([]),
      query<{ pantry_id: string; n: string }>(
        `SELECT pantry_id, toString(count()) AS n FROM programs FINAL
         WHERE active = 1 AND pantry_id != '' GROUP BY pantry_id`,
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
      })),
      ...events.map((r) => ({
        id: `event:${r.event_id}`,
        kind: "event" as const,
        name: r.title,
        address: r.address,
        zip: r.zip,
        lat: r.lat,
        lon: r.lon,
        when: formatEventTime(r.starts_at, r.ends_at, locale),
        starts_at: r.starts_at,
        tags: r.tags ?? [],
        languages: r.languages ?? [],
        requirements: r.requirements ?? "",
        phone: "",
        pantry_id: r.pantry_id ?? "",
        program_count: counts.get(r.pantry_id) ?? 0,
      })),
    ];

    const filtered = items.filter((i) => {
      if (noId && i.requirements.trim() !== "") return false;
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
