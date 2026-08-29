import crypto from "node:crypto";

// Phone numbers are the most sensitive thing this service holds. ClickHouse only
// ever sees the HMAC (join key) and an AES-GCM blob that the send path decrypts.
// Analytics, LibreChat, and every derived table work off phone_hash alone.

function keyFrom(envName: string): Buffer {
  const raw = process.env[envName];
  if (!raw) throw new Error(`${envName} is not set`);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`${envName} must be 32 bytes, base64-encoded (got ${key.length})`);
  }
  return key;
}

/** Stable, non-reversible id for a phone number. Same input -> same hash. */
export function phoneHash(e164: string): string {
  return crypto
    .createHmac("sha256", keyFrom("PHONE_HASH_KEY"))
    .update(e164)
    .digest("hex");
}

export function encryptPhone(e164: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFrom("PHONE_ENC_KEY"), iv);
  const ct = Buffer.concat([cipher.update(e164, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptPhone(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    keyFrom("PHONE_ENC_KEY"),
    buf.subarray(0, 12),
  );
  decipher.setAuthTag(buf.subarray(12, 28));
  return decipher.update(buf.subarray(28)).toString("utf8") + decipher.final("utf8");
}

// Email gets the same treatment as the phone number: encrypted at rest with
// the same key, decrypted only by the send path. It is deliberately NOT hashed
// into a join key -- phone_hash stays the single identity across both stores,
// and a second one would be a second way to correlate a person.
export function encryptEmail(email: string): string {
  return encryptPhone(email.trim().toLowerCase());
}

export function decryptEmail(blob: string): string {
  return decryptPhone(blob);
}

/** IPs are stored hashed — enough to detect abuse, not enough to track people. */
export function ipHash(ip: string): string {
  return crypto
    .createHmac("sha256", keyFrom("PHONE_HASH_KEY"))
    .update(`ip:${ip}`)
    .digest("hex")
    .slice(0, 32);
}
