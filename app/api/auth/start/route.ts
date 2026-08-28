import { NextResponse } from "next/server";
import { isLocale } from "@/lib/i18n";
import { toE164 } from "@/lib/phone";
import { phoneHash } from "@/lib/crypto";
import { render } from "@/lib/sms-templates";
import { sendSms } from "@/lib/sms";
import { generateCode, writeChallenge } from "@/lib/session";
import { allow, clientIp } from "@/lib/ratelimit";

/**
 * Sends a 6-digit code. Deliberately does not reveal whether the number is
 * already a subscriber — the response is identical either way, so this endpoint
 * cannot be used to test whether someone uses a food bank.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!allow(`auth:${ip}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as {
    phone?: string;
    locale?: string;
  } | null;

  const locale = isLocale(body?.locale) ? body.locale : "en";
  const e164 = toE164(body?.phone ?? "");
  if (!e164) return NextResponse.json({ error: "bad_phone" }, { status: 400 });

  const hash = phoneHash(e164);
  const code = generateCode();
  await writeChallenge(hash, code, locale);

  if (!allow(`auth-sms:${hash}`, 3, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  await sendSms({
    to: e164,
    phoneHash: hash,
    text: render("login_code", locale, { code }),
    templateKey: "login_code",
    locale,
  });

  return NextResponse.json({ sent: true });
}
