import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import {
  getProgram,
  listApplications,
  submitApplication,
  validateAnswers,
  withdrawApplication,
} from "@/lib/programs";

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ applications: await listApplications(session.phoneHash) });
  } catch (err) {
    console.error("[applications:get]", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    program_id?: string;
    answers?: Record<string, unknown>;
  } | null;

  if (!body?.program_id) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const program = await getProgram(body.program_id);
    if (!program) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const validated = validateAnswers(program, body.answers ?? {});
    if (!validated.ok) {
      return NextResponse.json(
        { error: "missing_fields", missing: validated.missing },
        { status: 400 },
      );
    }

    const application = await submitApplication({
      phoneHash: session.phoneHash,
      programId: program.program_id,
      answers: validated.clean,
      locale: session.locale,
    });

    return NextResponse.json({ application });
  } catch (err) {
    console.error("[applications:post]", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

export async function DELETE(req: Request) {
  const session = await readSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  try {
    const ok = await withdrawApplication(session.phoneHash, id);
    return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
  } catch (err) {
    console.error("[applications:delete]", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
