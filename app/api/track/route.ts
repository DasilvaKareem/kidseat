import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { insert, chTime } from "@/lib/clickhouse";

const STEPS = new Set([
  "language", "phone", "zip", "household", "needs", "done", "out_of_area",
  "screening", "results",
]);
const ACTIONS = new Set(["view", "submit", "skip", "back", "error"]);

/**
 * Funnel only. Keyed on a random per-visit session id, never a phone number,
 * so drop-off is measurable for people who never finish — and unlinkable to
 * anyone who does. On the screening steps `detail` carries the question id —
 * which question people quit on — never what they answered.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    session_id?: string;
    step?: string;
    action?: string;
    locale?: string;
    detail?: string;
  } | null;

  if (!body?.session_id || !STEPS.has(body.step ?? "") || !ACTIONS.has(body.action ?? "")) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  try {
    await insert("onboarding_events", [
      {
        event_id: crypto.randomUUID(),
        session_id: body.session_id.slice(0, 64),
        step: body.step,
        action: body.action,
        locale: body.locale ?? "",
        detail: (body.detail ?? "").slice(0, 128),
        created_at: chTime(),
      },
    ]);
  } catch (err) {
    // Analytics must never break onboarding.
    console.error("[track]", err);
  }
  return NextResponse.json({ ok: true });
}
