import { createClient, type ClickHouseClient } from "@clickhouse/client";

let client: ClickHouseClient | null = null;

export function ch(): ClickHouseClient {
  if (client) return client;
  const url = process.env.CLICKHOUSE_URL;
  if (!url) throw new Error("CLICKHOUSE_URL is not set");
  client = createClient({
    url,
    username: process.env.CLICKHOUSE_USER ?? "default",
    password: process.env.CLICKHOUSE_PASSWORD ?? "",
    database: process.env.CLICKHOUSE_DATABASE ?? "sffood",
    // A ClickHouse Cloud service with idle scaling on takes ~15-30s to wake
    // from cold. That is survivable for a cron or a health check, but an
    // inbound SMS webhook has to answer long before then — so the send paths
    // treat a timeout as "no results" rather than blocking the carrier.
    request_timeout: Number(process.env.CLICKHOUSE_TIMEOUT_MS ?? 20_000),
    clickhouse_settings: {
      // Signup writes must not be lost to an async-insert buffer, and the
      // onboarding request should not return before the row is durable.
      async_insert: 1,
      wait_for_async_insert: 1,
    },
  });
  return client;
}

export async function insert<T>(table: string, values: T[]): Promise<void> {
  if (values.length === 0) return;
  await ch().insert({ table, values, format: "JSONEachRow" });
}

export async function query<T>(
  sql: string,
  params: Record<string, unknown> = {},
): Promise<T[]> {
  const rs = await ch().query({
    query: sql,
    query_params: params,
    format: "JSONEachRow",
  });
  return rs.json<T>();
}

/** ClickHouse DateTime64(3) wants 'YYYY-MM-DD hh:mm:ss.sss', not ISO-8601. */
export function chTime(d: Date = new Date()): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}
