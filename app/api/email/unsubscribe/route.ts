import { getByHash, upsertSubscriber, revealPhone } from "@/lib/subscribers";
import { verifyUnsubscribeToken } from "@/lib/email";
import { isLocale, type Locale } from "@/lib/i18n";

/**
 * The unsubscribe link in every email. One click, no sign-in, no confirmation
 * step — a person who wants out is entitled to get out, and a link that first
 * demands a login is not a working unsubscribe.
 *
 * It clears the email address and leaves the SMS subscription alone: someone
 * who no longer wants mail has not asked to stop being texted. Only STOP over
 * SMS does that.
 */
const DONE: Record<Locale, { title: string; body: string }> = {
  en: {
    title: "You're unsubscribed from emails",
    body: "We won't email you again. If you still want text alerts, nothing has changed — reply STOP to any text to stop those too.",
  },
  "zh-Hans": {
    title: "您已退订邮件",
    body: "我们不会再给您发邮件。短信提醒不受影响；如需停止短信，请回复 STOP。",
  },
  es: {
    title: "Se dio de baja de los correos",
    body: "No le enviaremos más correos. Sus avisos por mensaje de texto no cambian; envíe STOP a cualquier mensaje para cancelarlos también.",
  },
};

function page(locale: Locale, heading: string, body: string, status: number): Response {
  const html = `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#fdfcf7;color:#1a1a1a;
     margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
main{max-width:34rem}h1{font-size:1.5rem;margin:0 0 .75rem}p{font-size:1.05rem;line-height:1.55;color:#444;margin:0}
</style></head>
<body><main><h1>${heading}</h1><p>${body}</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function unsubscribe(token: string | null): Promise<Response> {
  const phoneHash = token ? verifyUnsubscribeToken(token) : null;
  if (!phoneHash) {
    return page("en", "That link didn't work", "The unsubscribe link looks broken or incomplete. Reply STOP to any text message to stop everything.", 400);
  }

  const sub = await getByHash(phoneHash);
  // Already gone, or never existed: say the same thing either way. A different
  // answer here would reveal whether a number is a subscriber.
  const locale: Locale = sub && isLocale(sub.locale) ? sub.locale : "en";
  if (sub?.email_enc) {
    await upsertSubscriber({
      e164: revealPhone(sub),
      email: null,
      locale,
      zip: sub.zip,
    });
  }

  const copy = DONE[locale];
  return page(locale, copy.title, copy.body, 200);
}

export async function GET(req: Request) {
  return unsubscribe(new URL(req.url).searchParams.get("t"));
}

/**
 * Mail clients prefetch links, and some would silently unsubscribe people on
 * GET. RFC 8058 one-click uses POST, so this handles both.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  let token = url.searchParams.get("t");
  if (!token) {
    const form = await req.formData().catch(() => null);
    token = (form?.get("t") as string) ?? null;
  }
  return unsubscribe(token);
}
