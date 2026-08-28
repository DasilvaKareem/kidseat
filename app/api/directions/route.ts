import { NextResponse } from "next/server";
import { isLocale, type Locale } from "@/lib/i18n";
import { computeRoute, directionsLink, mapsEnabled, type TravelMode, type TransitPreference } from "@/lib/maps";
import { readSession } from "@/lib/session";
import { getByHash } from "@/lib/subscribers";
import { allow, clientIp } from "@/lib/ratelimit";

const MODES: TravelMode[] = ["WALK", "TRANSIT", "DRIVE", "BICYCLE"];
const PREFS = ["LESS_WALKING", "FEWER_TRANSFERS"];

/**
 * POST, not GET, deliberately: the body carries the person's current location,
 * and precise coordinates do not belong in a URL that lands in access logs,
 * referrers, and browser history.
 */
export async function POST(req: Request) {
  if (!allow(`directions:${clientIp(req)}`, 40, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as {
    dest?: { lat?: number; lon?: number };
    origin?: { lat?: number; lon?: number };
    mode?: string;
    transitPreference?: string | null;
    locale?: string;
  } | null;

  const destLat = body?.dest?.lat;
  const destLon = body?.dest?.lon;
  if (typeof destLat !== "number" || typeof destLon !== "number") {
    return NextResponse.json({ error: "bad_destination" }, { status: 400 });
  }

  const mode = (MODES.includes(body?.mode as TravelMode) ? body!.mode : "WALK") as TravelMode;
  const locale: Locale = isLocale(body?.locale) ? body.locale : "en";
  const transitPreference = (
    PREFS.includes(body?.transitPreference ?? "") ? body!.transitPreference : null
  ) as TransitPreference;

  // Prefer the origin the browser offered. Otherwise fall back to the signed-in
  // person's ZIP centroid — coarse, but enough for a useful transit estimate.
  let origin: { lat: number; lon: number } | null =
    typeof body?.origin?.lat === "number" && typeof body?.origin?.lon === "number"
      ? { lat: body.origin.lat, lon: body.origin.lon }
      : null;

  if (!origin) {
    const session = await readSession();
    if (session) {
      try {
        const sub = await getByHash(session.phoneHash);
        if (sub?.lat != null && sub?.lon != null) origin = { lat: sub.lat, lon: sub.lon };
      } catch (err) {
        console.error("[directions] profile lookup failed", err);
      }
    }
  }

  const link = directionsLink({ lat: destLat, lon: destLon }, mode, origin ?? undefined);

  // No origin, or no Maps key: the deep link still gets them there, because the
  // Maps app knows where they are even when we do not.
  if (!origin || !mapsEnabled()) {
    return NextResponse.json({
      route: null,
      link,
      reason: !origin ? "no_origin" : "google_maps_not_configured",
    });
  }

  const route = await computeRoute({
    origin,
    destination: { lat: destLat, lon: destLon },
    mode,
    transitPreference,
    locale,
  });

  return NextResponse.json({ route, link: route?.link ?? link });
}
