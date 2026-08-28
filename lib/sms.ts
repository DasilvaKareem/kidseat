import crypto from "node:crypto";
import type { Locale } from "./i18n";
import { insert, chTime } from "./clickhouse";
import { segmentsOf } from "./sms-templates";

// One seam for every provider. The Vercel Marketplace messaging integration was
// not provisionable in this environment, so nothing here assumes a specific
// vendor: set SMS_PROVIDER and the matching credentials.
//   telnyx  — cheapest per segment for high-volume A2P (see research notes)
//   twilio  — most nonprofit-program support
//   console — dev; logs instead of sending, costs nothing, needs no account
export type Provider = "telnyx" | "twilio" | "console";

export function provider(): Provider {
  return (process.env.SMS_PROVIDER as Provider) ?? "console";
}

export type SendResult = {
  ok: boolean;
  providerId: string;
  status: string;
  error?: string;
};

async function sendTelnyx(to: string, text: string): Promise<SendResult> {
  const res = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID,
      from: process.env.SMS_FROM_NUMBER,
      to,
      text,
    }),
  });
  const json = (await res.json()) as {
    data?: { id?: string };
    errors?: Array<{ detail?: string }>;
  };
  if (!res.ok) {
    return {
      ok: false,
      providerId: "",
      status: "failed",
      error: json.errors?.[0]?.detail ?? `HTTP ${res.status}`,
    };
  }
  return { ok: true, providerId: json.data?.id ?? "", status: "queued" };
}

async function sendTwilio(to: string, text: string): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: to,
        From: process.env.SMS_FROM_NUMBER!,
        Body: text,
      }),
    },
  );
  const json = (await res.json()) as { sid?: string; status?: string; message?: string };
  if (!res.ok) {
    return {
      ok: false,
      providerId: "",
      status: "failed",
      error: json.message ?? `HTTP ${res.status}`,
    };
  }
  return { ok: true, providerId: json.sid ?? "", status: json.status ?? "queued" };
}

/**
 * Sends and records the attempt. `phoneHash` is what lands in ClickHouse;
 * `to` (the real E.164 number) never leaves this function.
 */
export async function sendSms(opts: {
  to: string;
  phoneHash: string;
  text: string;
  templateKey: string;
  locale: Locale;
}): Promise<SendResult> {
  const p = provider();
  const seg = segmentsOf(opts.text);

  let result: SendResult;
  try {
    if (p === "telnyx") result = await sendTelnyx(opts.to, opts.text);
    else if (p === "twilio") result = await sendTwilio(opts.to, opts.text);
    else {
      console.log(
        `[sms:console] -> ${opts.to} (${seg.encoding}, ${seg.segments} seg): ${opts.text}`,
      );
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

  // Delivery logging must never take down a send or a signup.
  try {
    await insert("message_events", [
      {
        event_id: crypto.randomUUID(),
        phone_hash: opts.phoneHash,
        direction: "outbound",
        template_key: opts.templateKey,
        locale: opts.locale,
        body: "",
        encoding: seg.encoding,
        segments: seg.segments,
        provider: p,
        provider_id: result.providerId,
        status: result.status,
        error: result.error ?? "",
        created_at: chTime(),
      },
    ]);
  } catch (err) {
    console.error("[sms] failed to log message_event", err);
  }

  return result;
}

// --- inbound webhook verification -------------------------------------------

function verifyTelnyx(rawBody: string, headers: Headers): boolean {
  const pubKey = process.env.TELNYX_PUBLIC_KEY;
  const sig = headers.get("telnyx-signature-ed25519");
  const ts = headers.get("telnyx-timestamp");
  if (!pubKey || !sig || !ts) return false;
  // Reject anything older than 5 minutes to kill replays.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  try {
    const der = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(pubKey, "base64"),
    ]);
    const key = crypto.createPublicKey({ key: der, format: "der", type: "spki" });
    return crypto.verify(
      null,
      Buffer.from(`${ts}|${rawBody}`),
      key,
      Buffer.from(sig, "base64"),
    );
  } catch {
    return false;
  }
}

function verifyTwilio(rawBody: string, headers: Headers, url: string): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  const sig = headers.get("x-twilio-signature");
  if (!token || !sig) return false;
  const params = new URLSearchParams(rawBody);
  const sorted = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const payload = url + sorted.map(([k, v]) => k + v).join("");
  const expected = crypto.createHmac("sha1", token).update(payload).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyInbound(
  rawBody: string,
  headers: Headers,
  url: string,
): boolean {
  const p = provider();
  if (p === "telnyx") return verifyTelnyx(rawBody, headers);
  if (p === "twilio") return verifyTwilio(rawBody, headers, url);
  return process.env.NODE_ENV !== "production";
}

export type InboundMessage = { from: string; text: string; providerId: string };

export function parseInbound(rawBody: string): InboundMessage | null {
  const p = provider();
  if (p === "twilio") {
    const f = new URLSearchParams(rawBody);
    const from = f.get("From");
    if (!from) return null;
    return { from, text: f.get("Body") ?? "", providerId: f.get("MessageSid") ?? "" };
  }
  try {
    const json = JSON.parse(rawBody) as {
      data?: {
        event_type?: string;
        id?: string;
        payload?: { from?: { phone_number?: string }; text?: string };
      };
    };
    if (json.data?.event_type !== "message.received") return null;
    const from = json.data.payload?.from?.phone_number;
    if (!from) return null;
    return {
      from,
      text: json.data.payload?.text ?? "",
      providerId: json.data.id ?? "",
    };
  } catch {
    return null;
  }
}
