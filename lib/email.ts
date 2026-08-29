import crypto from "node:crypto";
import type { Locale } from "./i18n";
import { insert, chTime } from "./clickhouse";

// The same seam as lib/sms.ts, for the same reason: one place that knows the
// vendor. `console` is the dev default, so a mis-wired environment logs instead
// of mailing a real person.
//
// Email is a second channel, never a replacement. Phone stays the identity and
// the login; an address is optional and many subscribers will not have one.
export type EmailProvider = "resend" | "console";

export function emailProvider(): EmailProvider {
  return process.env.RESEND_API_KEY ? "resend" : "console";
}

export function emailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/**
 * CAN-SPAM wants a working unsubscribe in every message, and the link has to
 * survive in an inbox for months -- so this is signed rather than given a TTL.
 * Unsigned, the link would be a phone_hash in a URL and anyone could
 * unsubscribe anyone by editing it.
 */
function secret(): Buffer {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not set");
  return Buffer.from(value, "utf8");
}

export function unsubscribeToken(phoneHash: string): string {
  const mac = crypto
    .createHmac("sha256", secret())
    .update(`unsub:${phoneHash}`)
    .digest("base64url");
  return `${phoneHash}.${mac}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  const [phoneHash, mac] = token.split(".");
  if (!phoneHash || !mac) return null;
  const expected = crypto
    .createHmac("sha256", secret())
    .update(`unsub:${phoneHash}`)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return phoneHash;
}

export type EmailResult = {
  ok: boolean;
  providerId: string;
  status: string;
  error?: string;
};

const SUBJECTS: Record<string, Record<Locale, string>> = {
  confirm: {
    en: "Confirm your free food alerts",
    "zh-Hans": "确认您的免费食物提醒",
    es: "Confirme sus avisos de comida gratis",
  },
  alert: {
    en: "Free food near you",
    "zh-Hans": "您附近有免费食物",
    es: "Comida gratis cerca de usted",
  },
  reminder: {
    en: "Still want free food alerts?",
    "zh-Hans": "还需要免费食物提醒吗？",
    es: "¿Todavía quiere avisos de comida gratis?",
  },
};

export function subjectFor(templateKey: string, locale: Locale): string {
  return SUBJECTS[templateKey]?.[locale] ?? SUBJECTS.alert[locale];
}

/**
 * The body is the same text the SMS carries. That is deliberate: one wording to
 * keep translated and to hold to the consent language, and it is already
 * written to be read on a small screen.
 */
function html(text: string, unsubscribeUrl: string, locale: Locale): string {
  const unsub: Record<Locale, string> = {
    en: "Unsubscribe",
    "zh-Hans": "退订",
    es: "Cancelar suscripción",
  };
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:16px;line-height:1.5;color:#111">
<p>${escape(text)}</p>
<p style="font-size:13px;color:#666"><a href="${unsubscribeUrl}" style="color:#666">${unsub[locale]}</a></p>
</div>`;
}

async function sendResend(
  to: string,
  subject: string,
  text: string,
  bodyHtml: string,
): Promise<EmailResult> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to,
      subject,
      text,
      html: bodyHtml,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
    name?: string;
  };
  if (!res.ok) {
    return {
      ok: false,
      providerId: "",
      status: "failed",
      error: json.message ?? json.name ?? `HTTP ${res.status}`,
    };
  }
  return { ok: true, providerId: json.id ?? "", status: "queued" };
}

/**
 * Sends and records the attempt. `phoneHash` is what lands in ClickHouse; the
 * address itself never leaves this function, exactly as with sendSms.
 */
export async function sendEmail(opts: {
  to: string;
  phoneHash: string;
  text: string;
  templateKey: string;
  locale: Locale;
}): Promise<EmailResult> {
  const p = emailProvider();
  const subject = subjectFor(opts.templateKey, opts.locale);
  const base = process.env.PUBLIC_BASE_URL ?? "https://kidseat.vercel.app";
  const unsubscribeUrl = `${base}/api/email/unsubscribe?t=${encodeURIComponent(unsubscribeToken(opts.phoneHash))}`;

  let result: EmailResult;
  try {
    if (p === "resend" && process.env.EMAIL_FROM) {
      result = await sendResend(
        opts.to,
        subject,
        opts.text,
        html(opts.text, unsubscribeUrl, opts.locale),
      );
    } else {
      console.log(`[email:console] -> ${opts.to} | ${subject} | ${opts.text}`);
      result = { ok: true, providerId: `console-${crypto.randomUUID()}`, status: "sent" };
    }
  } catch (err) {
    result = {
      ok: false,
      providerId: "",
      status: "failed",
      error: err instanceof Error ? err.message : "unknown",
    };
  }

  // Same contract as the SMS path: logging must never take down a send.
  try {
    await insert("message_events", [
      {
        event_id: crypto.randomUUID(),
        phone_hash: opts.phoneHash,
        direction: "outbound",
        template_key: opts.templateKey,
        locale: opts.locale,
        body: "",
        encoding: "email",
        segments: 0,
        provider: p,
        provider_id: result.providerId,
        status: result.status,
        error: result.error ?? "",
        created_at: chTime(),
      },
    ]);
  } catch (err) {
    console.error("[email] failed to log message_event", err);
  }

  return result;
}
