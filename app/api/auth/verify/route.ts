import { NextResponse } from "next/server";
import { verifyChallenge, writeSession } from "@/lib/session";
import { allow, clientIp } from "@/lib/ratelimit";

export async function POST(req: Request) {
  if (!allow(`verify:${clientIp(req)}`, 15, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as { code?: string } | null;
  const code = (body?.code ?? "").replace(/\D/g, "");
  if (code.length !== 6) {
    return NextResponse.json({ error: "bad_code" }, { status: 400 });
  }

  const result = await verifyChallenge(code);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 401 });
  }

  await writeSession(result.phoneHash, result.locale);
  return NextResponse.json({ ok: true, locale: result.locale });
}
