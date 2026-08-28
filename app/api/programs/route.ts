import { NextResponse } from "next/server";
import { listPrograms } from "@/lib/programs";

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  try {
    const programs = await listPrograms({
      pantryId: p.get("pantry_id") ?? undefined,
      zip: p.get("zip") ?? undefined,
    });
    return NextResponse.json({ programs });
  } catch (err) {
    console.error("[programs]", err);
    return NextResponse.json({ programs: [], error: "unavailable" }, { status: 503 });
  }
}
