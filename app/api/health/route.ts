import { NextResponse } from "next/server";
import { configReport } from "@/lib/config";
import { query } from "@/lib/clickhouse";

/**
 * Answers "why did onboarding just fail?" without anyone reading a stack trace.
 * Reports names and booleans only — never a secret value.
 */
export async function GET() {
  const report = configReport();

  let clickhouse: { ok: boolean; error?: string } = {
    ok: false,
    error: "not_configured",
  };
  if (process.env.CLICKHOUSE_URL) {
    try {
      await query("SELECT 1");
      clickhouse = { ok: true };
    } catch (err) {
      clickhouse = { ok: false, error: err instanceof Error ? err.message : "unknown" };
    }
  }

  return NextResponse.json(
    { ...report, clickhouse },
    { status: report.ok && clickhouse.ok ? 200 : 503 },
  );
}
