import { NextResponse } from "next/server";
import { isLocale } from "@/lib/i18n";
import { isValidZip, inServiceArea } from "@/lib/zips";
import { zipCentroid } from "@/lib/geo";
import { getByHash, upsertSubscriber, revealPhone } from "@/lib/subscribers";
import { verifyToken } from "@/lib/token";
import { missingConfig } from "@/lib/config";

const HOUSEHOLD = new Set(["1", "2-3", "4-5", "6+", ""]);
const NEEDS = new Set([
  "no_fridge", "no_stove", "baby", "halal_kosher", "low_mobility", "allergies",
]);

/**
 * Steps 2–4. Everything after consent is an edit to an existing record, so this
 * is idempotent and safe to call on every step or once at the end.
 */
export async function POST(req: Request) {
  const missing = missingConfig();
  if (missing.length > 0) {
    console.error(`[profile] not configured, missing: ${missing.join(", ")}`);
    return NextResponse.json(
      {
        error: "not_configured",
        missing: process.env.NODE_ENV === "production" ? undefined : missing,
      },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    token?: string;
    locale?: string;
    zip?: string;
    household_bucket?: string;
    needs?: string[];
  } | null;

  const hash = body?.token ? verifyToken(body.token) : null;
  if (!hash) return NextResponse.json({ error: "bad_token" }, { status: 401 });
  if (!isLocale(body?.locale)) {
    return NextResponse.json({ error: "bad_locale" }, { status: 400 });
  }

  let sub;
  try {
    sub = await getByHash(hash);
  } catch (err) {
    console.error("[profile] storage read failed", err);
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
  if (!sub) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const zip = body?.zip ?? sub.zip;
  if (!isValidZip(zip)) {
    return NextResponse.json({ error: "bad_zip" }, { status: 400 });
  }

  const household = body?.household_bucket ?? "";
  if (!HOUSEHOLD.has(household)) {
    return NextResponse.json({ error: "bad_household" }, { status: 400 });
  }

  const needs = (body?.needs ?? []).filter((n) => NEEDS.has(n));
  const served = inServiceArea(zip);
  const centroid = served ? await zipCentroid(zip) : null;

  try {
    await upsertSubscriber({
      e164: revealPhone(sub),
      locale: body.locale,
      zip,
      lat: centroid?.lat ?? null,
      lon: centroid?.lon ?? null,
      household_bucket: household,
      needs,
      // Out of area still keeps the number, but on the waitlist — never texted
      // until the service actually reaches them.
      status: served ? sub.status : "waitlist",
    });
  } catch (err) {
    console.error("[profile] storage write failed", err);
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }

  return NextResponse.json({ inServiceArea: served });
}
