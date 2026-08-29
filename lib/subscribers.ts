import crypto from "node:crypto";
import { insert, query, chTime } from "./clickhouse";
import { phoneHash, encryptPhone, decryptPhone, encryptEmail, decryptEmail, ipHash } from "./crypto";
import type { Locale } from "./i18n";

export type Status = "pending" | "active" | "stopped" | "bounced" | "waitlist";

export type Subscriber = {
  phone_hash: string;
  phone_enc: string;
  email_enc: string;
  locale: Locale;
  zip: string;
  lat: number | null;
  lon: number | null;
  household_bucket: string;
  needs: string[];
  status: Status;
  created_at: string;
  confirmed_at: string | null;
  stopped_at: string | null;
  updated_at: string;
};

export async function getByHash(hash: string): Promise<Subscriber | null> {
  const rows = await query<Subscriber>(
    `SELECT * FROM subscribers FINAL WHERE phone_hash = {hash:String} LIMIT 1`,
    { hash },
  );
  return rows[0] ?? null;
}

export async function getByPhone(e164: string): Promise<Subscriber | null> {
  return getByHash(phoneHash(e164));
}

/** Phone number in the clear, for the send path only. */
export function revealPhone(sub: Subscriber): string {
  return decryptPhone(sub.phone_enc);
}

/** Email in the clear, for the send path only. Null when none is on file. */
export function revealEmail(sub: Subscriber): string | null {
  return sub.email_enc ? decryptEmail(sub.email_enc) : null;
}

/**
 * Insert-or-update. ReplacingMergeTree collapses on phone_hash, so a repeat
 * signup edits the existing person rather than creating a duplicate. An
 * already-`stopped` number stays stopped: only an inbound START can revive it.
 */
export async function upsertSubscriber(input: {
  e164: string;
  email?: string | null;
  locale: Locale;
  zip: string;
  lat?: number | null;
  lon?: number | null;
  household_bucket?: string;
  needs?: string[];
  status?: Status;
}): Promise<{ subscriber: Subscriber; isNew: boolean }> {
  const hash = phoneHash(input.e164);
  const existing = await getByHash(hash);
  const now = chTime();

  const status: Status =
    existing?.status === "stopped" ? "stopped" : (input.status ?? existing?.status ?? "pending");

  const row: Subscriber = {
    phone_hash: hash,
    phone_enc: encryptPhone(input.e164),
    // Absent input keeps whatever is on file; only an explicit address changes
    // it, so a later onboarding step can never silently drop someone's email.
    email_enc:
      input.email === undefined
        ? (existing?.email_enc ?? "")
        : input.email
          ? encryptEmail(input.email)
          : "",
    locale: input.locale,
    zip: input.zip,
    lat: input.lat ?? existing?.lat ?? null,
    lon: input.lon ?? existing?.lon ?? null,
    household_bucket: input.household_bucket ?? existing?.household_bucket ?? "",
    needs: input.needs ?? existing?.needs ?? [],
    status,
    created_at: existing?.created_at ?? now,
    confirmed_at: existing?.confirmed_at ?? null,
    stopped_at: existing?.stopped_at ?? null,
    updated_at: now,
  };

  await insert("subscribers", [row]);
  return { subscriber: row, isNew: !existing };
}

export async function setStatus(
  sub: Subscriber,
  status: Status,
): Promise<Subscriber> {
  const now = chTime();
  const row: Subscriber = {
    ...sub,
    status,
    confirmed_at: status === "active" ? (sub.confirmed_at ?? now) : sub.confirmed_at,
    stopped_at: status === "stopped" ? now : sub.stopped_at,
    updated_at: now,
  };
  await insert("subscribers", [row]);
  return row;
}

export async function recordConsent(input: {
  e164: string;
  locale: Locale;
  consentVersion: string;
  consentText: string;
  ip: string;
  userAgent: string;
  source: "web_onboarding" | "sms_start";
}): Promise<void> {
  await insert("consents", [
    {
      consent_id: crypto.randomUUID(),
      phone_hash: phoneHash(input.e164),
      locale: input.locale,
      consent_version: input.consentVersion,
      // Stored verbatim, not as a template id: templates change, evidence can't.
      consent_text: input.consentText,
      ip_hash: input.ip ? ipHash(input.ip) : "",
      user_agent: input.userAgent.slice(0, 512),
      source: input.source,
      created_at: chTime(),
    },
  ]);
}

export async function logInbound(input: {
  phone_hash: string;
  locale: Locale;
  body: string;
  providerId: string;
  provider: string;
}): Promise<void> {
  await insert("message_events", [
    {
      event_id: crypto.randomUUID(),
      phone_hash: input.phone_hash,
      direction: "inbound",
      template_key: "",
      locale: input.locale,
      body: input.body.slice(0, 1024),
      encoding: "",
      segments: 0,
      provider: input.provider,
      provider_id: input.providerId,
      status: "received",
      error: "",
      created_at: chTime(),
    },
  ]);
}
