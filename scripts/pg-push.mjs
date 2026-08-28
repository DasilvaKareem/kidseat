// Applies db/postgres/schema.sql. Idempotent — every statement is
// CREATE ... IF NOT EXISTS, so re-running is safe.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Run `vercel env pull` or copy .env.example.");
  process.exit(1);
}

const sql = neon(url);

const schema = readFileSync(new URL("../db/postgres/schema.sql", import.meta.url), "utf8");

// Split on statement terminators only, then strip comment-only lines for the
// label. Table bodies contain no semicolons, so a plain split is enough here.
const statements = schema
  .split(/;\s*$/m)
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter(Boolean);

for (const statement of statements) {
  const label = statement.split("\n")[0].slice(0, 70);
  try {
    await sql.query(statement);
    console.log(`ok   ${label}`);
  } catch (err) {
    console.error(`FAIL ${label}\n     ${err.message}`);
    process.exitCode = 1;
  }
}
