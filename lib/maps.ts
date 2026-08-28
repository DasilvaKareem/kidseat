import { query, insert, chTime } from "./clickhouse";
import type { Locale } from "./i18n";

// Google Maps Platform — Places API (New) for discovery, Routes API for real
// walking time. This is the *fallback and enrichment* layer: curated rows in
// `pantries` and `pantry_events` always win, because a Google listing for a
// church that runs a pantry on Thursdays will show the church's office hours,
// not the distribution window.

const PLACES_SEARCH = "https://places.googleapis.com/v1/places:searchText";
const PLACES_DETAILS = "https://places.googleapis.com/v1/places";
const ROUTE_MATRIX =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

// Google returns localized names and hours if you ask in the right language.
const LANG: Record<Locale, string> = {
  en: "en",
  "zh-Hans": "zh-CN",
  es: "es",
};

export type Place = {
  place_id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  phone: string;
  website: string;
  open_now: boolean | null;
  today_hours: string;
  week_hours: string[];
};

function apiKey(): string {
  const k = process.env.GOOGLE_MAPS_API_KEY;
  if (!k) throw new Error("GOOGLE_MAPS_API_KEY is not set");
  return k;
}

export function mapsEnabled(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

/** Compact enough to survive an SMS budget: ~38 characters. */
export function mapsLink(lat: number, lon: number): string {
  return `https://maps.google.com/?q=${lat.toFixed(5)},${lon.toFixed(5)}`;
}

// --- cache ------------------------------------------------------------------
// Google's terms let you store place IDs indefinitely but cap other Places
// content at 30 days. Both TTLs below stay well inside that, and the table
// itself carries a 30-day TTL so nothing lingers past the limit.

async function cacheGet(key: string, ttlHours: number): Promise<unknown | null> {
  try {
    const rows = await query<{ payload: string }>(
      `SELECT payload FROM places_cache FINAL
       WHERE cache_key = {key:String}
         AND fetched_at > now() - INTERVAL {ttl:UInt32} HOUR
       LIMIT 1`,
      { key, ttl: ttlHours },
    );
    return rows[0] ? JSON.parse(rows[0].payload) : null;
  } catch {
    return null;
  }
}

async function cachePut(key: string, payload: unknown): Promise<void> {
  try {
    await insert("places_cache", [
      { cache_key: key, payload: JSON.stringify(payload), fetched_at: chTime() },
    ]);
  } catch (err) {
    console.error("[maps] cache write failed", err);
  }
}

// --- places -----------------------------------------------------------------

function toPlace(p: Record<string, any>, day: number): Place {
  const hours = p.regularOpeningHours ?? p.currentOpeningHours ?? {};
  // weekdayDescriptions runs Monday..Sunday; JS getDay() is Sunday..Saturday.
  const descriptions: string[] = hours.weekdayDescriptions ?? [];
  return {
    place_id: p.id ?? "",
    name: p.displayName?.text ?? "",
    address: p.formattedAddress ?? "",
    lat: p.location?.latitude ?? 0,
    lon: p.location?.longitude ?? 0,
    phone: p.nationalPhoneNumber ?? "",
    website: p.websiteUri ?? "",
    open_now: typeof hours.openNow === "boolean" ? hours.openNow : null,
    today_hours: descriptions[(day + 6) % 7] ?? "",
    week_hours: descriptions,
  };
}

/**
 * Text Search rather than a type filter: Google has no place type that reliably
 * covers food banks, pantries, and free-meal programs, and the three are the
 * same thing to someone who is hungry.
 */
export async function searchFoodPlaces(opts: {
  lat: number;
  lon: number;
  radiusMeters?: number;
  locale: Locale;
  queryText?: string;
  limit?: number;
}): Promise<Place[]> {
  const radius = Math.min(opts.radiusMeters ?? 3200, 50000);
  const text = opts.queryText ?? "food bank OR food pantry OR free meals";
  const limit = opts.limit ?? 8;
  const day = new Date().getDay();

  const key = `search:${opts.lat.toFixed(3)},${opts.lon.toFixed(3)}:${radius}:${LANG[opts.locale]}:${text}`;
  const cached = (await cacheGet(key, 24)) as Record<string, any>[] | null;
  if (cached) return cached.map((p) => toPlace(p, day)).slice(0, limit);

  const res = await fetch(PLACES_SEARCH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.location",
        "places.nationalPhoneNumber",
        "places.websiteUri",
        "places.regularOpeningHours",
        "places.businessStatus",
      ].join(","),
    },
    body: JSON.stringify({
      textQuery: text,
      languageCode: LANG[opts.locale],
      maxResultCount: limit,
      locationBias: {
        circle: {
          center: { latitude: opts.lat, longitude: opts.lon },
          radius,
        },
      },
    }),
    signal: AbortSignal.timeout(6000),
  });

  if (!res.ok) {
    console.error("[maps] searchText failed", res.status, await res.text());
    return [];
  }

  const json = (await res.json()) as { places?: Record<string, any>[] };
  // Permanently closed listings are worse than no result — drop them here so
  // neither the cache nor the model ever sees them.
  const places = (json.places ?? []).filter(
    (p) => p.businessStatus !== "CLOSED_PERMANENTLY",
  );
  await cachePut(key, places);
  return places.map((p) => toPlace(p, day)).slice(0, limit);
}

export async function placeDetails(
  placeId: string,
  locale: Locale,
): Promise<Place | null> {
  const day = new Date().getDay();
  const key = `details:${placeId}:${LANG[locale]}`;
  const cached = (await cacheGet(key, 24 * 7)) as Record<string, any> | null;
  if (cached) return toPlace(cached, day);

  const res = await fetch(
    `${PLACES_DETAILS}/${encodeURIComponent(placeId)}?languageCode=${LANG[locale]}`,
    {
      headers: {
        "X-Goog-Api-Key": apiKey(),
        "X-Goog-FieldMask": [
          "id",
          "displayName",
          "formattedAddress",
          "location",
          "nationalPhoneNumber",
          "websiteUri",
          "regularOpeningHours",
          "businessStatus",
        ].join(","),
      },
      signal: AbortSignal.timeout(6000),
    },
  );

  if (!res.ok) {
    console.error("[maps] placeDetails failed", res.status);
    return null;
  }
  const json = (await res.json()) as Record<string, any>;
  await cachePut(key, json);
  return toPlace(json, day);
}

// --- travel time ------------------------------------------------------------

export type Travel = { minutes: number | null; meters: number | null };

/**
 * Straight-line distance is a lie in a city with hills and freeways. For anyone
 * who said travel is hard, the difference between 0.4 miles and a 22-minute
 * walk is the difference between going and not going.
 */
export async function walkingTimes(
  origin: { lat: number; lon: number },
  destinations: Array<{ lat: number; lon: number }>,
): Promise<Travel[]> {
  const empty: Travel[] = destinations.map(() => ({ minutes: null, meters: null }));
  if (destinations.length === 0) return [];

  try {
    const res = await fetch(ROUTE_MATRIX, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey(),
        "X-Goog-FieldMask":
          "originIndex,destinationIndex,duration,distanceMeters,condition",
      },
      body: JSON.stringify({
        origins: [
          {
            waypoint: {
              location: { latLng: { latitude: origin.lat, longitude: origin.lon } },
            },
          },
        ],
        destinations: destinations.map((d) => ({
          waypoint: {
            location: { latLng: { latitude: d.lat, longitude: d.lon } },
          },
        })),
        travelMode: "WALK",
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      console.error("[maps] computeRouteMatrix failed", res.status);
      return empty;
    }

    const rows = (await res.json()) as Array<{
      destinationIndex: number;
      duration?: string;
      distanceMeters?: number;
      condition?: string;
    }>;

    const out = [...empty];
    for (const r of rows) {
      if (r.condition !== "ROUTE_EXISTS") continue;
      const seconds = Number((r.duration ?? "0s").replace("s", ""));
      out[r.destinationIndex] = {
        minutes: Number.isFinite(seconds) ? Math.round(seconds / 60) : null,
        meters: r.distanceMeters ?? null,
      };
    }
    return out;
  } catch (err) {
    console.error("[maps] computeRouteMatrix threw", err);
    return empty;
  }
}
