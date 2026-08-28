import { NextResponse } from "next/server";
import { isLocale } from "@/lib/i18n";
import { verifyToken } from "@/lib/token";
import { missingConfig } from "@/lib/config";
import { getByHash } from "@/lib/subscribers";
import { sanitizeAnswers } from "@/lib/screening";
import { completeScreening } from "@/lib/screenings";
import { noteText, programAction, programName } from "@/lib/eligibility";

/**
 * The optional questions section on the web, submitted in one go.
 *
 * The browser holds the answers while the person is typing them; this endpoint
 * routes on them and stores only the coarse flags and the referral list. The
 * answers themselves are never written down — they exist in the request body
 * and in the routing computed from it, and that is all.
 */
export async function POST(req: Request) {
  const missing = missingConfig();
  if (missing.length > 0) {
    console.error(`[screening] not configured, missing: ${missing.join(", ")}`);
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
    answers?: unknown;
  } | null;

  const hash = body?.token ? verifyToken(body.token) : null;
  if (!hash) return NextResponse.json({ error: "bad_token" }, { status: 401 });
  if (!isLocale(body?.locale)) {
    return NextResponse.json({ error: "bad_locale" }, { status: 400 });
  }
  const locale = body.locale;

  // Anything the question bank did not ask for is dropped here, before it can
  // reach the routing table or storage.
  const answers = sanitizeAnswers(body?.answers);

  let subscriber;
  try {
    subscriber = await getByHash(hash);
  } catch (err) {
    console.error("[screening] storage read failed", err);
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }
  if (!subscriber) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let routing;
  try {
    routing = await completeScreening({
      phoneHash: hash,
      locale,
      answers,
    });
  } catch (err) {
    console.error("[screening] storage write failed", err);
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }

  return NextResponse.json({
    referrals: routing.referrals.map((r) => ({
      program: r.program,
      name: programName(r.program, locale),
      action: programAction(r.program, locale),
      confidence: r.confidence,
      documents: r.documents,
    })),
    notes: routing.notes.map((n) => noteText(n, locale)),
  });
}
