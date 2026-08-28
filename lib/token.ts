import crypto from "node:crypto";

// Ties the later onboarding steps to the phone number consented to at step 1,
// without ever putting the number (or its hash) in client-visible state.
const TTL_MS = 30 * 60 * 1000;

function secret(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return Buffer.from(s, "utf8");
}

export function signToken(phoneHash: string): string {
  const payload = `${phoneHash}.${Date.now()}`;
  const mac = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${mac}`;
}

export function verifyToken(token: string): string | null {
  const [b64, mac] = token.split(".");
  if (!b64 || !mac) return null;
  const payload = Buffer.from(b64, "base64url").toString("utf8");
  const expected = crypto
    .createHmac("sha256", secret())
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [phoneHash, issued] = payload.split(".");
  if (Date.now() - Number(issued) > TTL_MS) return null;
  return phoneHash;
}
