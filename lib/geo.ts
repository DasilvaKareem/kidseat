type LatLon = { lat: number; lon: number };

const cache = new Map<string, LatLon | null>();

/**
 * ZIP centroid only — deliberately coarse. We never ask for or store a street
 * address, so the most precise location this service holds is ~1km.
 * Returns null on any failure; lat/lon are nullable downstream and matching
 * falls back to ZIP equality.
 */
export async function zipCentroid(zip: string): Promise<LatLon | null> {
  if (cache.has(zip)) return cache.get(zip)!;
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as { places?: Array<Record<string, string>> };
    const place = json.places?.[0];
    if (!place) throw new Error("no place");
    const out = {
      lat: Number(place.latitude),
      lon: Number(place.longitude),
    };
    if (!Number.isFinite(out.lat) || !Number.isFinite(out.lon)) throw new Error("bad coords");
    cache.set(zip, out);
    return out;
  } catch {
    cache.set(zip, null);
    return null;
  }
}

export function milesBetween(a: LatLon, b: LatLon): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
