import { streamText, stepCountIs, convertToModelMessages, tool, type UIMessage } from "ai";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { getByHash } from "@/lib/subscribers";
import { isLocale, type Locale } from "@/lib/i18n";
import { buildTools, buildScreeningTools, ELIGIBILITY_RULES } from "@/lib/agent";
import { listPrograms, listApplications } from "@/lib/programs";

export const maxDuration = 60;

const MODEL = process.env.AI_MODEL ?? "google/gemini-3.5-flash-lite";

const LANG_NAME: Record<Locale, string> = {
  en: "English",
  "zh-Hans": "Simplified Chinese",
  es: "Spanish",
};

/**
 * The chat bar. Signed in only — it can read the person's own applications, so
 * an anonymous session must never reach it.
 */
export async function POST(req: Request) {
  const session = await readSession();
  if (!session) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    messages?: UIMessage[];
  } | null;
  if (!body?.messages) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const locale: Locale = isLocale(session.locale) ? session.locale : "en";

  let zip = "";
  let lat: number | null = null;
  let lon: number | null = null;
  let needs: string[] = [];
  try {
    const sub = await getByHash(session.phoneHash);
    if (sub) {
      zip = sub.zip;
      lat = sub.lat;
      lon = sub.lon;
      needs = sub.needs;
    }
  } catch (err) {
    console.error("[chat] profile lookup failed", err);
  }

  const tools = {
    ...buildTools({ locale, zip, lat, lon, needs }),
    ...buildScreeningTools(locale),

    list_programs: tool({
      description:
        "Programs the person can apply to — CalFresh, home delivery, senior " +
        "boxes, WIC, or registration at a specific site. Use when they ask " +
        "what they qualify for or how to sign up for something.",
      inputSchema: z.object({
        pantry_id: z.string().default("")
          .describe("Limit to programs run by one site. Empty for all."),
      }),
      execute: async ({ pantry_id }) => {
        const programs = await listPrograms({ zip, pantryId: pantry_id || undefined });
        return programs.map((p) => ({
          program_id: p.program_id,
          name: p.name,
          provider: p.provider,
          kind: p.kind,
          summary: p.summary,
          requirements: p.requirements || "none",
          processing_days: p.processing_days,
          question_count: p.fields.length,
        }));
      },
    }),

    my_applications: tool({
      description:
        "The status of applications this person has already submitted. Use " +
        "before suggesting they apply to something, so you never tell someone " +
        "to re-apply to a program they are already in.",
      inputSchema: z.object({}),
      execute: async () => {
        const apps = await listApplications(session.phoneHash);
        // Answers can contain household details they typed. The model gets
        // status only — it has no reason to see what they wrote.
        return apps.map((a) => ({
          application_id: a.application_id,
          program_id: a.program_id,
          status: a.status,
          submitted: a.created_at,
        }));
      },
    }),
  };

  const messages = await convertToModelMessages(body.messages);

  const result = streamText({
    model: MODEL,
    temperature: 0.3,
    tools,
    stopWhen: stepCountIs(6),
    system: [
      `You help people in San Francisco and Marin find free food and apply to`,
      `food programs. Reply in ${LANG_NAME[locale]}.`,
      "",
      zip ? `The person is near ZIP ${zip}.` : "You do not know where they are yet — ask for a ZIP code before searching.",
      needs.length > 0
        ? `They told us: ${needs.join(", ")}. Treat these as hard constraints, not preferences.`
        : "",
      "",
      "Rules:",
      "- Use ONLY facts returned by the tools. Never invent an address, time,",
      "  distance, phone number, or eligibility rule.",
      "- Prefer events with a specific time over general listings.",
      "- Google Maps hours are the venue's, not the distribution window. Say so",
      "  when you use them, and give the phone number.",
      "- Never imply someone must prove need or income to get food.",
      "- Short paragraphs. No markdown tables. This is read on a phone.",
      "- To apply, tell them to press Apply on the program card — do not try to",
      "  collect application answers in chat.",
      "",
      "When they ask what they qualify for, or mention CalFresh, WIC, a senior",
      "box, delivery, or SUN Bucks, walk the screening:",
      ELIGIBILITY_RULES,
    ]
      .filter(Boolean)
      .join("\n"),
    messages,
  });

  return result.toUIMessageStreamResponse();
}
