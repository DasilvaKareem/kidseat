import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import type { Locale } from "./i18n";
import { findNearby, type Match } from "./pantries";
import { upcomingEvents, type EventMatch } from "./events";
import { formatEventTime } from "./format-time";
import { searchFoodPlaces, placeDetails, walkingTimes, mapsLink, mapsEnabled } from "./maps";

// Routed through the Vercel AI Gateway, so the model is a plain
// "provider/model" string and swapping models is an env change.
const MODEL = process.env.AI_MODEL ?? "google/gemini-3.5-flash-lite";

const LANG_NAME: Record<Locale, string> = {
  en: "English",
  "zh-Hans": "Simplified Chinese",
  es: "Spanish",
};

// A results message is the payload, not a notification, so it gets a wider
// budget than the templates in sms-templates.ts. Chinese sends as UCS-2 at
// 67 chars per segment, hence a budget roughly two-thirds the Latin one.
const BUDGET: Record<Locale, number> = { en: 300, "zh-Hans": 130, es: 300 };
const RESULT_BUDGET: Record<Locale, number> = { en: 320, "zh-Hans": 200, es: 320 };

const HEADER: Record<Locale, string> = {
  en: "Free food near you:",
  "zh-Hans": "附近的免费食物：",
  es: "Comida gratis cerca:",
};

function hasModelKey(): boolean {
  return Boolean(
    process.env.AI_GATEWAY_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  );
}

// --- deterministic renders --------------------------------------------------
// Every LLM path below falls back to one of these. A person texting FOOD gets
// an answer even when the model is down, over budget, or hallucinating.

function fallback(matches: Match[], locale: Locale): string {
  const lines = matches.map((m) => {
    const dist = m.miles != null ? ` (${m.miles.toFixed(1)}mi)` : "";
    return `${m.name}${dist}, ${m.address}. ${m.hours}`;
  });
  return [HEADER[locale], ...lines].join("\n").slice(0, BUDGET[locale]);
}

function fallbackWithEvents(
  events: EventMatch[],
  pantries: Match[],
  locale: Locale,
): string {
  const lines: string[] = [];
  for (const e of events) {
    const dist = e.miles != null ? ` (${e.miles.toFixed(1)}mi)` : "";
    lines.push(
      `${formatEventTime(e.starts_at, e.ends_at, locale)}: ${e.title}${dist}, ${e.address}`,
    );
  }
  for (const p of pantries) {
    const dist = p.miles != null ? ` (${p.miles.toFixed(1)}mi)` : "";
    lines.push(`${p.name}${dist}, ${p.address}. ${p.hours}`);
  }
  if (lines.length === 0) return "";

  const first = events[0] ?? pantries[0];
  const link = first ? ` ${mapsLink(first.lat, first.lon)}` : "";
  const body = [HEADER[locale], ...lines].join("\n");
  return (body + link).slice(0, RESULT_BUDGET[locale]);
}

/**
 * Turns already-matched sites into one SMS. The model only rewrites facts it is
 * handed — it never picks the sites.
 */
export async function composeFoodSms(
  matches: Match[],
  locale: Locale,
): Promise<string> {
  if (matches.length === 0) return "";
  if (!hasModelKey()) return fallback(matches, locale);

  const facts = matches
    .map((m, i) =>
      [
        `${i + 1}. ${m.name}`,
        `address: ${m.address}`,
        m.miles != null ? `distance: ${m.miles.toFixed(1)} miles` : null,
        `hours: ${m.hours}`,
        m.requirements ? `requirements: ${m.requirements}` : "requirements: none",
        m.phone ? `phone: ${m.phone}` : null,
      ]
        .filter(Boolean)
        .join("; "),
    )
    .join("\n");

  try {
    const { text } = await generateText({
      model: MODEL,
      temperature: 0.2,
      maxOutputTokens: 300,
      system: smsRules(locale, BUDGET[locale]),
      prompt: facts,
    });
    const out = text.trim();
    return out.length > 0 && out.length <= BUDGET[locale] * 1.3
      ? out
      : fallback(matches, locale);
  } catch (err) {
    console.error("[agent] composeFoodSms failed, using fallback", err);
    return fallback(matches, locale);
  }
}

function smsRules(locale: Locale, budget: number): string {
  return [
    `Write one SMS in ${LANG_NAME[locale]} listing free food.`,
    `Hard limit: ${budget} characters. Shorter is better.`,
    "Rules:",
    "- Use ONLY facts returned by the tools. Never invent an address, time,",
    "  distance, or requirement. If a tool returned nothing, say so.",
    "- Prefer a distribution EVENT with a specific time over a general listing.",
    "- Plain words, short sentences. Assume the reader is stressed, on a small",
    "  screen, and may be walking there today.",
    "- No emoji, no markdown, no greeting, no sign-off.",
    "- One place per line: name, address, and when it is open.",
    "- If a place requires ID or documents, say so. If not, say nothing about it.",
    "- Never imply the person must prove need or income.",
    "- Include at most one maps link, for the closest option, if given one.",
  ].join("\n");
}

// --- agentic path -----------------------------------------------------------

export type Context = {
  locale: Locale;
  zip: string;
  lat: number | null;
  lon: number | null;
  needs: string[];
};

/**
 * Tools are scoped to one person's context: the model cannot widen the search
 * to somebody else's neighborhood, and it never sees a phone number.
 */
export function buildTools(ctx: Context) {
  return {
    find_events: tool({
      description:
        "Scheduled free-food distribution events near the person, from our own " +
        "curated data. Always try this first — events have real start and end " +
        "times, which general listings do not.",
      inputSchema: z.object({
        within_hours: z.number().min(1).max(168).default(72)
          .describe("How far ahead to look. 24 for 'today', 72 for 'this week'."),
        radius_miles: z.number().min(0.1).max(10).default(2),
      }),
      execute: async ({ within_hours, radius_miles }) => {
        const events = await upcomingEvents({
          zip: ctx.zip,
          lat: ctx.lat,
          lon: ctx.lon,
          needs: ctx.needs,
          withinHours: within_hours,
          radiusMiles: radius_miles,
        });
        return events.map((e) => ({
          title: e.title,
          when: formatEventTime(e.starts_at, e.ends_at, ctx.locale),
          address: e.address,
          miles: e.miles != null ? Number(e.miles.toFixed(1)) : null,
          requirements: e.requirements || "none",
          notes: e.notes,
          maps_link: mapsLink(e.lat, e.lon),
        }));
      },
    }),

    find_pantries: tool({
      description:
        "Standing food pantries near the person, from our own curated data. " +
        "Use when there are no events, or to add options.",
      inputSchema: z.object({
        radius_miles: z.number().min(0.1).max(10).default(2),
      }),
      execute: async ({ radius_miles }) => {
        const matches = await findNearby({
          zip: ctx.zip,
          lat: ctx.lat,
          lon: ctx.lon,
          needs: ctx.needs,
          radiusMiles: radius_miles,
        });
        return matches.map((m) => ({
          name: m.name,
          address: m.address,
          hours: m.hours,
          miles: m.miles != null ? Number(m.miles.toFixed(1)) : null,
          phone: m.phone,
          requirements: m.requirements || "none",
          maps_link: mapsLink(m.lat, m.lon),
        }));
      },
    }),

    search_google_maps: tool({
      description:
        "Search Google Maps for food banks, pantries, and free meal programs " +
        "near the person. Use only when our own data returns nothing, or the " +
        "person asks for something we do not track. Google shows a venue's " +
        "general hours, which may not be the distribution window — say the " +
        "hours are approximate and give the phone number when one exists.",
      inputSchema: z.object({
        query: z.string().max(120).default("food bank OR food pantry OR free meals")
          .describe("Plain-language search, e.g. 'free hot meals' or 'halal food pantry'."),
        radius_meters: z.number().min(200).max(16000).default(3200),
      }),
      execute: async ({ query, radius_meters }) => {
        if (!mapsEnabled()) return { error: "google_maps_not_configured" };
        if (ctx.lat == null || ctx.lon == null) {
          return { error: "no_coordinates_for_this_person" };
        }
        const places = await searchFoodPlaces({
          lat: ctx.lat,
          lon: ctx.lon,
          radiusMeters: radius_meters,
          locale: ctx.locale,
          queryText: query,
          limit: 6,
        });
        return places.map((p) => ({
          place_id: p.place_id,
          name: p.name,
          address: p.address,
          phone: p.phone,
          open_now: p.open_now,
          today_hours: p.today_hours,
          hours_are_approximate: true,
          maps_link: mapsLink(p.lat, p.lon),
        }));
      },
    }),

    get_place_hours: tool({
      description:
        "Full weekly hours and phone number for one Google Maps place, by place_id.",
      inputSchema: z.object({ place_id: z.string().min(1).max(400) }),
      execute: async ({ place_id }) => {
        if (!mapsEnabled()) return { error: "google_maps_not_configured" };
        const p = await placeDetails(place_id, ctx.locale);
        if (!p) return { error: "not_found" };
        return {
          name: p.name,
          address: p.address,
          phone: p.phone,
          open_now: p.open_now,
          week_hours: p.week_hours,
          maps_link: mapsLink(p.lat, p.lon),
        };
      },
    }),

    walking_time: tool({
      description:
        "Real walking time from the person to up to 5 places. Worth calling " +
        "when the person said travel is hard, or when two options are close " +
        "in straight-line distance — hills and freeways make those very " +
        "different walks.",
      inputSchema: z.object({
        places: z
          .array(z.object({ name: z.string(), lat: z.number(), lon: z.number() }))
          .min(1)
          .max(5),
      }),
      execute: async ({ places }) => {
        if (!mapsEnabled()) return { error: "google_maps_not_configured" };
        if (ctx.lat == null || ctx.lon == null) {
          return { error: "no_coordinates_for_this_person" };
        }
        const times = await walkingTimes({ lat: ctx.lat, lon: ctx.lon }, places);
        return places.map((p, i) => ({
          name: p.name,
          walk_minutes: times[i]?.minutes ?? null,
          meters: times[i]?.meters ?? null,
        }));
      },
    }),
  };
}

/**
 * The FOOD keyword and any free-text message from a confirmed subscriber land
 * here. Returns "" when there is genuinely nothing to send, so the caller can
 * fall back to the no_results template.
 */
export async function answerFoodRequest(opts: {
  locale: Locale;
  zip: string;
  lat: number | null;
  lon: number | null;
  needs: string[];
  question?: string;
}): Promise<string> {
  const ctx: Context = {
    locale: opts.locale,
    zip: opts.zip,
    lat: opts.lat,
    lon: opts.lon,
    needs: opts.needs,
  };

  // Pre-fetch our own data. It is the fallback if the model path fails, and
  // costs one query either way.
  const [events, pantries] = await Promise.all([
    upcomingEvents({ zip: ctx.zip, lat: ctx.lat, lon: ctx.lon, needs: ctx.needs }),
    findNearby({ zip: ctx.zip, lat: ctx.lat, lon: ctx.lon, needs: ctx.needs }),
  ]);

  if (!hasModelKey()) return fallbackWithEvents(events, pantries, opts.locale);

  const needsNote =
    ctx.needs.length > 0
      ? `The person told us: ${ctx.needs.join(", ")}. Respect these as hard constraints.`
      : "The person told us nothing about their situation.";

  try {
    const { text } = await generateText({
      model: MODEL,
      temperature: 0.2,
      maxOutputTokens: 600,
      tools: buildTools(ctx),
      // Enough steps to try our data, fall through to Maps, and check a walk.
      stopWhen: stepCountIs(5),
      system: [
        smsRules(opts.locale, RESULT_BUDGET[opts.locale]),
        "",
        `The person is near ZIP ${ctx.zip}.`,
        needsNote,
        "Start with find_events. If that is empty, try find_pantries, then",
        "search_google_maps. Stop as soon as you have 1-3 good options.",
      ].join("\n"),
      prompt:
        opts.question?.trim() ||
        "Where can I get free food right now?",
    });

    const out = text.trim();
    if (out.length > 0 && out.length <= RESULT_BUDGET[opts.locale] * 1.3) return out;
    console.warn("[agent] answer out of budget, using fallback", out.length);
  } catch (err) {
    console.error("[agent] answerFoodRequest failed, using fallback", err);
  }

  return fallbackWithEvents(events, pantries, opts.locale);
}
