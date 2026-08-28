import { NextResponse } from "next/server";
import { configReport } from "@/lib/config";
import { query } from "@/lib/clickhouse";
import { RULES_REVIEWED, rulesAgeDays, rulesAreStale } from "@/lib/eligibility";
import { FPL_YEAR } from "@/lib/screening";

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

  // Eligibility rules and poverty levels go out of date on a calendar, not on
  // an error, so the only way anyone finds out is if something says so.
  const eligibility = {
    rulesReviewed: RULES_REVIEWED,
    rulesAgeDays: rulesAgeDays(),
    rulesStale: rulesAreStale(),
    povertyGuidelines: FPL_YEAR,
  };

  return NextResponse.json(
    { ...report, clickhouse, eligibility },
    { status: report.ok && clickhouse.ok ? 200 : 503 },
  );
}
