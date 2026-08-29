import { NextResponse } from "next/server";
import { isLocale, COPY, CONSENT_VERSION } from "@/lib/i18n";
import { toE164, normalizeEmail } from "@/lib/phone";
import { phoneHash } from "@/lib/crypto";
import { upsertSubscriber, recordConsent, getByHash } from "@/lib/subscribers";
import { sendSms } from "@/lib/sms";
import { sendEmail } from "@/lib/email";
import { render } from "@/lib/sms-templates";
import { signToken } from "@/lib/token";
import { allow, clientIp } from "@/lib/ratelimit";
import { missingConfig } from "@/lib/config";

/**
 * Step 1 of onboarding. This is the moment consent is given, so this is the
 * moment it is written — before the ZIP or anything optional. The confirm SMS
 * is the double opt-in; there is no code-entry screen.
 */
export async function POST(req: Request) {
  // A missing env var is an operator problem, not a bad phone number. Say so,
  // so the UI never blames the person for our misconfiguration.
  const missing = missingConfig();
  if (missing.length > 0) {
    console.error(`[consent] not configured, missing: ${missing.join(", ")}`);
    return NextResponse.json(
      {
        error: "not_configured",
        missing: process.env.NODE_ENV === "production" ? undefined : missing,
      },
      { status: 503 },
    );
  }

  const ip = clientIp(req);
  if (!allow(`consent:${ip}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as {
    phone?: string;
    email?: string;
    locale?: string;
  } | null;

  if (!body || !isLocale(body.locale)) {
    return NextResponse.json({ error: "bad_locale" }, { status: 400 });
  }
  const e164 = toE164(body.phone ?? "");
  if (!e164) {
    return NextResponse.json({ error: "bad_phone" }, { status: 400 });
  }

  // Email is optional. Blank is fine; malformed is not, because silently
  // dropping a typo'd address means someone waits for mail that never comes.
  const rawEmail = (body.email ?? "").trim();
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  if (rawEmail && !email) {
    return NextResponse.json({ error: "bad_email" }, { status: 400 });
  }

  const locale = body.locale;
  // The exact string rendered on screen, in the language they read it in.
  const consentText = COPY[locale].phone.consent;

  // Consent has to be durable before anyone is texted, so a storage failure
  // stops here rather than half-completing a signup. Named 503, not a bare 500:
  // the person sees "our end", and the cause is in the server log.
  let existing: Awaited<ReturnType<typeof getByHash>> = null;
  try {
    await recordConsent({
      e164,
      locale,
      consentVersion: CONSENT_VERSION,
      consentText,
      ip,
      userAgent: req.headers.get("user-agent") ?? "",
      source: "web_onboarding",
    });

    existing = await getByHash(phoneHash(e164));
    await upsertSubscriber({ e164, email, locale, zip: existing?.zip ?? "00000" });
  } catch (err) {
    console.error("[consent] storage write failed", err);
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }

  // Already opted in, or previously opted out — either way, don't re-text.
  const shouldConfirm = !existing || existing.status === "pending";
  if (shouldConfirm) {
    // Fire and forget: a slow carrier must not stall the next screen.
    void sendSms({
      to: e164,
      phoneHash: phoneHash(e164),
      text: render("confirm", locale),
      templateKey: "confirm",
      locale,
    });
    // Same message to the inbox when there is one. Separate call rather than a
    // fallback: a person who gave both asked for both, and email is the channel
    // that actually arrives while A2P registration is pending.
    if (email) {
      void sendEmail({
        to: email,
        phoneHash: phoneHash(e164),
        text: render("confirm", locale),
        templateKey: "confirm",
        locale,
      });
    }
  }

  return NextResponse.json({
    token: signToken(phoneHash(e164)),
    alreadyActive: existing?.status === "active",
  });
}
