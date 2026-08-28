import { NextResponse } from "next/server";
import { isLocale, type Locale } from "@/lib/i18n";
import { phoneHash } from "@/lib/crypto";
import { parseKeyword } from "@/lib/keywords";
import { render } from "@/lib/sms-templates";
import { verifyInbound, parseInbound, sendSms, provider } from "@/lib/sms";
import { getByHash, setStatus, logInbound, upsertSubscriber } from "@/lib/subscribers";
import { answerFoodRequest } from "@/lib/agent";

const LANG_WORDS: Record<string, Locale> = {
  english: "en", en: "en",
  chinese: "zh-Hans", 中文: "zh-Hans", zh: "zh-Hans",
  spanish: "es", espanol: "es", español: "es", es: "es",
};

async function reply(to: string, hash: string, key: Parameters<typeof render>[0], locale: Locale, vars?: Record<string, string>) {
  await sendSms({ to, phoneHash: hash, text: render(key, locale, vars), templateKey: key, locale });
}

/**
 * Provider webhook. Always returns 200 — a non-2xx makes carriers retry, and a
 * duplicate opt-out ack is worse than a silent internal error we can see in logs.
 */
export async function POST(req: Request) {
  const raw = await req.text();

  if (!verifyInbound(raw, req.headers, req.url)) {
    return NextResponse.json({ error: "bad_signature" }, { status: 403 });
  }

  const msg = parseInbound(raw);
  if (!msg) return new NextResponse(null, { status: 200 });

  try {
    const hash = phoneHash(msg.from);
    const sub = await getByHash(hash);
    const locale: Locale = sub && isLocale(sub.locale) ? sub.locale : "en";

    await logInbound({
      phone_hash: hash,
      locale,
      body: msg.text,
      providerId: msg.providerId,
      provider: provider(),
    });

    const keyword = parseKeyword(msg.text);

    // STOP is honored before anything else, for anyone, subscribed or not.
    if (keyword === "STOP") {
      if (sub) await setStatus(sub, "stopped");
      await reply(msg.from, hash, "stop_ack", locale);
      return new NextResponse(null, { status: 200 });
    }

    // A cold inbound number has given no consent yet — send the opt-in prompt,
    // never content.
    if (!sub) {
      await upsertSubscriber({ e164: msg.from, locale, zip: "00000", status: "pending" });
      await reply(msg.from, hash, "confirm", locale);
      return new NextResponse(null, { status: 200 });
    }

    if (keyword === "HELP") {
      await reply(msg.from, hash, "help", locale);
      return new NextResponse(null, { status: 200 });
    }

    if (keyword === "LANG") {
      const word = msg.text.trim().toLowerCase().split(/\s+/)[1] ?? "";
      const picked = LANG_WORDS[word];
      if (picked) {
        await upsertSubscriber({ e164: msg.from, locale: picked, zip: sub.zip });
        await reply(msg.from, hash, "help", picked);
      } else {
        await sendSms({
          to: msg.from,
          phoneHash: hash,
          text: "Reply LANG EN, LANG ES, or LANG ZH.",
          templateKey: "lang_prompt",
          locale,
        });
      }
      return new NextResponse(null, { status: 200 });
    }

    if (keyword === "START" || keyword === "YES") {
      const active = await setStatus(sub, "active");
      await reply(msg.from, hash, "welcome", locale, { zip: active.zip });
      return new NextResponse(null, { status: 200 });
    }

    // Anything else from a confirmed subscriber is treated as "I need food now".
    // Unconfirmed numbers get the opt-in prompt again instead of content.
    if (sub.status !== "active") {
      await reply(msg.from, hash, "confirm", locale);
      return new NextResponse(null, { status: 200 });
    }

    // The agent searches our events and pantries first, then falls through to
    // Google Maps. It returns "" only when there is genuinely nothing nearby.
    const text = await answerFoodRequest({
      locale,
      zip: sub.zip,
      lat: sub.lat,
      lon: sub.lon,
      needs: sub.needs,
      question: keyword === "FOOD" ? undefined : msg.text,
    });

    if (!text) {
      await reply(msg.from, hash, "no_results", locale, { zip: sub.zip });
      return new NextResponse(null, { status: 200 });
    }

    await sendSms({
      to: msg.from,
      phoneHash: hash,
      text,
      templateKey: "food_results",
      locale,
    });
  } catch (err) {
    console.error("[sms/inbound]", err);
  }

  return new NextResponse(null, { status: 200 });
}
