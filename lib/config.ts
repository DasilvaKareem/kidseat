// Every value the write path needs before it can accept a signup. Missing any
// of these produces a 503 with a named cause, not an opaque 500 that surfaces
// to the person as "check your phone number".
const REQUIRED = [
  "CLICKHOUSE_URL",
  "DATABASE_URL",
  "PHONE_HASH_KEY",
  "PHONE_ENC_KEY",
  "SESSION_SECRET",
] as const;

export function missingConfig(): string[] {
  const missing: string[] = REQUIRED.filter((k) => !process.env[k]);
  // ClickHouse Cloud always requires a password for its user. A blank one is
  // accepted at client-construction time and only fails on the first write, so
  // without this it reaches the person as an opaque 500 at the phone step. A
  // self-hosted instance may legitimately have no password, so only Cloud.
  if (
    (process.env.CLICKHOUSE_URL ?? "").includes(".clickhouse.cloud") &&
    !process.env.CLICKHOUSE_PASSWORD
  ) {
    missing.push("CLICKHOUSE_PASSWORD");
  }
  return missing;
}

/** Names only. Never return or log the values. */
export function configReport() {
  const missing = missingConfig();
  return {
    ok: missing.length === 0,
    // In production a caller could be anyone, so don't enumerate internals.
    missing: process.env.NODE_ENV === "production" ? undefined : missing,
    missingCount: missing.length,
    smsProvider: process.env.SMS_PROVIDER ?? "console",
    mapsConfigured: Boolean(process.env.GOOGLE_MAPS_API_KEY),
    modelConfigured: Boolean(
      process.env.AI_GATEWAY_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    ),
  };
}
