import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { getByHash } from "@/lib/subscribers";

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ signedIn: false });

  // The profile is a nicety; a working session should not depend on a cold
  // ClickHouse being reachable.
  let profile: { zip: string; needs: string[]; household: string } | null = null;
  try {
    const sub = await getByHash(session.phoneHash);
    if (sub) {
      profile = { zip: sub.zip, needs: sub.needs, household: sub.household_bucket };
    }
  } catch (err) {
    console.error("[auth/me] profile lookup failed", err);
  }

  return NextResponse.json({ signedIn: true, locale: session.locale, profile });
}
