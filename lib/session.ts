import crypto from "node:crypto";
import { cookies } from "next/headers";

// Sign-in deliberately does NOT touch ClickHouse. A ClickHouse Cloud service
// with idle scaling takes ~20s to wake, and nobody should wait that long to
// read their own application status. The challenge and the session both live
// in signed, httpOnly cookies.

const SESSION_COOKIE = "sf_session";
const CHALLENGE_COOKIE = "sf_challenge";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function secret(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return Buffer.from(s, "utf8");
}

function sign(payload: string): string {
  const mac = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${mac}`;
}

function unsign(token: string | undefined): string | null {
  if (!token) return null;
  const [b64, mac] = token.split(".");
  if (!b64 || !mac) return null;
  const payload = Buffer.from(b64, "base64url").toString("utf8");
  const expected = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return payload;
}

const cookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

// --- session ----------------------------------------------------------------

export type Session = { phoneHash: string; locale: string };

export async function readSession(): Promise<Session | null> {
  const payload = unsign((await cookies()).get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  const [phoneHash, locale, expires] = payload.split("|");
  if (!phoneHash || Date.now() > Number(expires)) return null;
  return { phoneHash, locale: locale || "en" };
}

export async function writeSession(phoneHash: string, locale: string): Promise<void> {
  const payload = `${phoneHash}|${locale}|${Date.now() + SESSION_TTL_MS}`;
  (await cookies()).set(SESSION_COOKIE, sign(payload), {
    ...cookieOpts,
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(CHALLENGE_COOKIE);
}

// --- OTP challenge ----------------------------------------------------------

export function generateCode(): string {
  // 6 digits, uniform. Not Math.random.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function codeHash(code: string, phoneHash: string): string {
  return crypto
    .createHmac("sha256", secret())
    .update(`${phoneHash}:${code}`)
    .digest("base64url");
}

export async function writeChallenge(
  phoneHash: string,
  code: string,
  locale: string,
): Promise<void> {
  const payload = [
    phoneHash,
    codeHash(code, phoneHash),
    locale,
    String(Date.now() + CHALLENGE_TTL_MS),
    "0",
  ].join("|");
  (await cookies()).set(CHALLENGE_COOKIE, sign(payload), {
    ...cookieOpts,
    maxAge: CHALLENGE_TTL_MS / 1000,
  });
}

export type VerifyResult =
  | { ok: true; phoneHash: string; locale: string }
  | { ok: false; reason: "expired" | "no_challenge" | "too_many_attempts" | "wrong_code" };

/**
 * The attempt counter lives inside the signed cookie and is re-signed on every
 * miss, so a client cannot roll it back to brute-force six digits.
 */
export async function verifyChallenge(code: string): Promise<VerifyResult> {
  const jar = await cookies();
  const payload = unsign(jar.get(CHALLENGE_COOKIE)?.value);
  if (!payload) return { ok: false, reason: "no_challenge" };

  const [phoneHash, expectedHash, locale, expires, attemptsRaw] = payload.split("|");
  const attempts = Number(attemptsRaw);

  if (Date.now() > Number(expires)) {
    jar.delete(CHALLENGE_COOKIE);
    return { ok: false, reason: "expired" };
  }
  if (attempts >= MAX_ATTEMPTS) {
    jar.delete(CHALLENGE_COOKIE);
    return { ok: false, reason: "too_many_attempts" };
  }

  const given = codeHash(code, phoneHash);
  const a = Buffer.from(given);
  const b = Buffer.from(expectedHash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const next = [phoneHash, expectedHash, locale, expires, String(attempts + 1)].join("|");
    jar.set(CHALLENGE_COOKIE, sign(next), { ...cookieOpts, maxAge: CHALLENGE_TTL_MS / 1000 });
    return { ok: false, reason: "wrong_code" };
  }

  jar.delete(CHALLENGE_COOKIE);
  return { ok: true, phoneHash, locale: locale || "en" };
}
