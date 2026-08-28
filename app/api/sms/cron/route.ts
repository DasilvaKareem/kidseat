import { NextResponse } from "next/server";
import { isLocale, type Locale } from "@/lib/i18n";
import { query } from "@/lib/clickhouse";
import { decryptPhone } from "@/lib/crypto";
import { render } from "@/lib/sms-templates";
import { sendSms } from "@/lib/sms";
import { sweepScreeningAnswers } from "@/lib/screenings";

export const maxDuration = 300;

/**
 * One reminder, 24h after signup, to people who never replied YES. After that
 * they stay `pending` and are never texted again — no drip, no re-engagement.
 *
 * The same run erases stale screening answers. That is retention work rather
 * than messaging work, but Hobby allows one cron a day and this is it; the
 * sweep is idempotent, so a run that fails halfway costs nothing but a day.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const due = await query<{ phone_hash: string; phone_enc: string; locale: string }>(
    `SELECT phone_hash, phone_enc, locale
     FROM subscribers FINAL
     WHERE status = 'pending'
       AND created_at < now() - INTERVAL 24 HOUR
       AND created_at > now() - INTERVAL 72 HOUR
       AND phone_hash NOT IN (
         SELECT phone_hash FROM message_events WHERE template_key = 'reminder'
       )
     LIMIT 500`,
  );

  let sent = 0;
  for (const row of due) {
    const locale: Locale = isLocale(row.locale) ? row.locale : "en";
    try {
      await sendSms({
        to: decryptPhone(row.phone_enc),
        phoneHash: row.phone_hash,
        text: render("reminder", locale),
        templateKey: "reminder",
        locale,
      });
      sent++;
    } catch (err) {
      console.error("[cron] reminder failed", row.phone_hash, err);
    }
  }

  // Ordered after the sends: a reminder that goes out matters more than a
  // sweep that can wait until tomorrow, and this way a Postgres outage cannot
  // stop the messages.
  let swept: { erased: number; deleted: number } | { error: string };
  try {
    swept = await sweepScreeningAnswers();
  } catch (err) {
    console.error("[cron] screening sweep failed", err);
    swept = { error: err instanceof Error ? err.message : "unknown" };
  }

  return NextResponse.json({ due: due.length, sent, swept });
}
