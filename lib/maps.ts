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
  access: Access;
};

// Google reports these per place. Absent means "unknown", which is NOT the same
// as "no" — never render a missing value as inaccessible.
export type Access = {
  entrance: boolean | null;
  parking: boolean | null;
  restroom: boolean | null;
  seating: boolean | null;
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
    access: {
      entrance: p.accessibilityOptions?.wheelchairAccessibleEntrance ?? null,
      parking: p.accessibilityOptions?.wheelchairAccessibleParking ?? null,
      restroom: p.accessibilityOptions?.wheelchairAccessibleRestroom ?? null,
      seating: p.accessibilityOptions?.wheelchairAccessibleSeating ?? null,
    },
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
        "places.accessibilityOptions",
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
          "accessibilityOptions",
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

export type TravelMode = "WALK" | "TRANSIT" | "DRIVE" | "BICYCLE";

/**
 * Transit routing preference. Google's Routes API does NOT expose the
 * "wheelchair accessible" transit filter that the consumer Maps app has, so
 * LESS_WALKING is the closest real lever we have — combined with the per-place
 * accessibility attributes above. Do not advertise this as step-free routing.
 */
export type TransitPreference = "LESS_WALKING" | "FEWER_TRANSFERS" | null;

export type Travel = { minutes: number | null; meters: number | null };

/**
 * Straight-line distance is a lie in a city with hills and freeways. For anyone
 * who said travel is hard, the difference between 0.4 miles and a 22-minute
 * walk is the difference between going and not going.
 */
export async function travelTimes(
  origin: { lat: number; lon: number },
  destinations: Array<{ lat: number; lon: number }>,
  mode: TravelMode = "WALK",
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
        travelMode: mode,
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

// --- directions -------------------------------------------------------------

const COMPUTE_ROUTES = "https://routes.googleapis.com/directions/v2:computeRoutes";

export type RouteStep = {
  mode: TravelMode | "OTHER";
  instruction: string;
  meters: number;
  minutes: number;
  // Transit legs only. `line` is what someone actually looks for on a sign.
  line?: string;
  headsign?: string;
  departStop?: string;
  arriveStop?: string;
  departTime?: string;
  stops?: number;
};

export type Route = {
  mode: TravelMode;
  minutes: number;
  meters: number;
  fare: string;
  steps: RouteStep[];
  link: string;
};

const URL_MODE: Record<TravelMode, string> = {
  WALK: "walking",
  TRANSIT: "transit",
  DRIVE: "driving",
  BICYCLE: "bicycling",
};

/** Official Maps URLs deep link — hands off to the app the person already has. */
export function directionsLink(
  dest: { lat: number; lon: number },
  mode: TravelMode = "WALK",
  origin?: { lat: number; lon: number },
): string {
  const params = new URLSearchParams({
    api: "1",
    destination: `${dest.lat.toFixed(5)},${dest.lon.toFixed(5)}`,
    travelmode: URL_MODE[mode],
  });
  if (origin) params.set("origin", `${origin.lat.toFixed(5)},${origin.lon.toFixed(5)}`);
  return `https://www.google.com/maps/dir/?${params}`;
}

const STEP_MODES: TravelMode[] = ["WALK", "TRANSIT", "DRIVE", "BICYCLE"];

function toStep(raw: Record<string, any>): RouteStep {
  const mode = STEP_MODES.includes(raw.travelMode) ? (raw.travelMode as TravelMode) : "OTHER";
  const seconds = Number(String(raw.staticDuration ?? "0s").replace("s", ""));
  const td = raw.transitDetails;
  return {
    mode,
    instruction: raw.navigationInstruction?.instructions ?? "",
    meters: raw.distanceMeters ?? 0,
    minutes: Number.isFinite(seconds) ? Math.round(seconds / 60) : 0,
    ...(td
      ? {
          line: td.transitLine?.nameShort ?? td.transitLine?.name ?? "",
          headsign: td.headsign ?? "",
          departStop: td.stopDetails?.departureStop?.name ?? "",
          arriveStop: td.stopDetails?.arrivalStop?.name ?? "",
          departTime: td.stopDetails?.departureTime ?? "",
          stops: td.stopCount ?? undefined,
        }
      : {}),
  };
}

/**
 * One route, with turn-by-turn (or stop-by-stop) detail.
 *
 * `transitPreference` only applies to TRANSIT — the API rejects it on other
 * modes. Returns null rather than throwing so a failed route never blocks the
 * rest of the page; the deep link still works without us.
 */
export async function computeRoute(opts: {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  mode: TravelMode;
  transitPreference?: TransitPreference;
  locale: Locale;
  departureTime?: string;
}): Promise<Route | null> {
  const { origin, destination, mode } = opts;

  const body: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lon } } },
    destination: {
      location: { latLng: { latitude: destination.lat, longitude: destination.lon } },
    },
    travelMode: mode,
    languageCode: LANG[opts.locale],
    units: "IMPERIAL",
  };

  if (mode === "TRANSIT") {
    body.transitPreferences = {
      allowedTravelModes: ["BUS", "SUBWAY", "TRAIN", "LIGHT_RAIL", "RAIL"],
      ...(opts.transitPreference ? { routingPreference: opts.transitPreference } : {}),
    };
    if (opts.departureTime) body.departureTime = opts.departureTime;
  }

  try {
    const res = await fetch(COMPUTE_ROUTES, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey(),
        "X-Goog-FieldMask": [
          "routes.duration",
          "routes.distanceMeters",
          "routes.legs.steps.navigationInstruction",
          "routes.legs.steps.travelMode",
          "routes.legs.steps.distanceMeters",
          "routes.legs.steps.staticDuration",
          "routes.legs.steps.transitDetails",
          "routes.travelAdvisory.transitFare",
        ].join(","),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.error("[maps] computeRoutes failed", res.status, await res.text());
      return null;
    }

    const json = (await res.json()) as { routes?: Record<string, any>[] };
    const route = json.routes?.[0];
    if (!route) return null;

    const seconds = Number(String(route.duration ?? "0s").replace("s", ""));
    const fare = route.travelAdvisory?.transitFare;

    return {
      mode,
      minutes: Number.isFinite(seconds) ? Math.round(seconds / 60) : 0,
      meters: route.distanceMeters ?? 0,
      fare: fare ? `${fare.currencyCode ?? ""} ${fare.units ?? "0"}`.trim() : "",
      steps: (route.legs?.[0]?.steps ?? []).map(toStep).filter((s: RouteStep) => s.instruction || s.line),
      link: directionsLink(destination, mode, origin),
    };
  } catch (err) {
    console.error("[maps] computeRoutes threw", err);
    return null;
  }
}
