// Applies db/clickhouse/schema.sql. Idempotent — every statement is
// CREATE ... IF NOT EXISTS or CREATE OR REPLACE VIEW, so re-running is safe.
import { readFileSync } from "node:fs";
import { createClient } from "@clickhouse/client";

const url = process.env.CLICKHOUSE_URL;
if (!url) {
  console.error("CLICKHOUSE_URL is not set. Copy .env.example to .env.local first.");
  process.exit(1);
}

// Connect without a database: the script creates it.
const client = createClient({
  url,
  username: process.env.CLICKHOUSE_USER ?? "default",
  password: process.env.CLICKHOUSE_PASSWORD ?? "",
});

const sql = readFileSync(new URL("../db/clickhouse/schema.sql", import.meta.url), "utf8");

const statements = sql
  .split(/;\s*$/m)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter(Boolean);

for (const query of statements) {
  const label = query.split("\n")[0].slice(0, 70);
  try {
    await client.command({ query });
    console.log(`ok   ${label}`);
  } catch (err) {
    console.error(`FAIL ${label}\n     ${err.message}`);
    process.exitCode = 1;
  }
}

await client.close();
