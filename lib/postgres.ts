import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// The split between the two stores is one rule: does the row change?
//
// Postgres owns everything that gets edited -- the pantry and program catalog,
// and the applications people submit. Those need foreign keys, a CHECK on
// status, and a real UPDATE. ClickHouse owns the append-only side: consents,
// message events, onboarding funnel steps, the Places cache. Nothing there is
// ever revised, and the analyst views scan millions of rows by day and locale,
// which is what a column store is for.
//
// Applications used to live in ClickHouse, where "withdraw" meant inserting a
// whole new version of the row and trusting ReplacingMergeTree to collapse it
// later. That is a workaround for a missing UPDATE, not a design.

let client: NeonQueryFunction<false, false> | null = null;

export function pg(): NeonQueryFunction<false, false> {
  if (client) return client;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // Built lazily: Next evaluates module scope during `next build`, and neon()
  // throws on a missing URL, so a module-level client fails the build on any
  // deployment created before the env vars land.
  client = neon(url);
  return client;
}

/** Parameterised query with $1-style placeholders. */
export async function pgQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pg().query(sql, params)) as T[];
}

/** Postgres returns timestamptz as a Date; the SMS and web paths want a string. */
export function pgTime(value: unknown): string {
  if (value instanceof Date) return value.toISOString().replace("T", " ").replace("Z", "");
  return String(value ?? "");
}
