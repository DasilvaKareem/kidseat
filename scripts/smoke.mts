// Pure-logic checks for the parts that are easy to get quietly wrong and
// expensive to get wrong in production: phone parsing, the crypto round-trip,
// keyword handling, and segment math. No network, no database.
import { toE164, formatUS } from "../lib/phone.ts";
import { phoneHash, encryptPhone, decryptPhone } from "../lib/crypto.ts";
import { parseKeyword } from "../lib/keywords.ts";
import { segmentsOf, render, smsSafe } from "../lib/sms-templates.ts";
import { formatEventTime } from "../lib/format-time.ts";
import { inServiceArea, countyOf } from "../lib/zips.ts";
import {
  QUESTIONS, applyAnswer, coarseFlags, fplMonthly, fplThreshold, incomeBands,
  nextQuestion, parseAnswer, progress, renderQuestion, sanitizeAnswers,
  type Answers,
} from "../lib/screening.ts";
import { route, renderReferralSms, rulesAreStale } from "../lib/eligibility.ts";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok   ${name}`);
  } else {
    console.error(`FAIL ${name}\n     expected ${e}\n     actual   ${a}`);
    failed++;
  }
}

check("formats as you type", formatUS("4155550123"), "(415) 555-0123");
check("accepts formatted input", toE164("(415) 555-0123"), "+14155550123");
check("accepts leading 1", toE164("1 415 555 0123"), "+14155550123");
check("rejects short", toE164("415555012"), null);
check("rejects area code starting 1", toE164("1155550123"), null);

const e164 = "+14155550123";
check("hash is stable", phoneHash(e164), phoneHash(e164));
check("hash is not the number", phoneHash(e164).includes("4155550123"), false);
check("encrypt round-trips", decryptPhone(encryptPhone(e164)), e164);
check("encrypt is non-deterministic", encryptPhone(e164) === encryptPhone(e164), false);

check("STOP", parseKeyword("STOP"), "STOP");
check("stop lowercase with punctuation", parseKeyword("stop."), "STOP");
check("Chinese unsubscribe", parseKeyword("退订"), "STOP");
check("Spanish unsubscribe", parseKeyword("PARAR"), "STOP");
// The one that matters: a sentence containing "stop" is not an opt-out.
check("sentence is not an opt-out", parseKeyword("can I stop by the pantry tomorrow?"), null);
check("YES confirms", parseKeyword("yes"), "YES");
check("Chinese yes", parseKeyword("是"), "YES");
check("FOOD", parseKeyword("food"), "FOOD");
check("Spanish food", parseKeyword("comida"), "FOOD");
check("free text is not a keyword", parseKeyword("where can I get milk"), null);

check("GSM-7 single segment", segmentsOf("hello").segments, 1);
check("GSM-7 boundary at 160", segmentsOf("a".repeat(160)).segments, 1);
check("GSM-7 splits at 161", segmentsOf("a".repeat(161)).segments, 2);
check("Chinese is UCS-2", segmentsOf("免费食物").encoding, "UCS-2");
check("UCS-2 boundary at 70", segmentsOf("食".repeat(70)).segments, 1);
check("UCS-2 splits at 71", segmentsOf("食".repeat(71)).segments, 2);

check("template interpolates zip", render("welcome", "en", { zip: "94110" }).includes("94110"), true);
check("every template fits 2 segments",
  (["confirm", "reminder", "welcome", "stop_ack", "help", "no_results"] as const)
    .flatMap((k) => (["en", "zh-Hans", "es"] as const).map((l) => segmentsOf(render(k, l, { zip: "94110" })).segments))
    .every((s) => s <= 2),
  true);

check("SF ZIP is in area", inServiceArea("94110"), true);
check("Marin ZIP is in area", inServiceArea("94965"), true);
check("Oakland ZIP is not", inServiceArea("94601"), false);
check("county lookup", countyOf("94965"), "marin");

// Fixed clock: 2026-08-28 18:00 UTC is 11:00 in Pacific time, so an event at
// 21:00 UTC the same day is "today at 2pm" for the person reading it.
const NOW = new Date("2026-08-28T18:00:00Z");
const today = formatEventTime("2026-08-28 21:00:00", "2026-08-28 23:00:00", "en", NOW);
const tomorrow = formatEventTime("2026-08-29 21:00:00", "2026-08-29 23:00:00", "en", NOW);
const later = formatEventTime("2026-09-01 21:00:00", "2026-09-01 23:00:00", "en", NOW);

check("event today is labelled Today", today.startsWith("Today "), true);
check("event tomorrow is labelled Tomorrow", tomorrow.startsWith("Tomorrow "), true);
check("event further out uses a weekday", /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(later), true);
// ":00" on every hour would waste 3 characters per time, twice per line.
check("whole hours drop the minutes", /:00/.test(today), false);
check("Chinese day label", formatEventTime("2026-08-28 21:00:00", "2026-08-28 23:00:00", "zh-Hans", NOW).startsWith("今天"), true);
check("Spanish day label", formatEventTime("2026-08-28 21:00:00", "2026-08-28 23:00:00", "es", NOW).startsWith("Hoy"), true);
// UTC-day and Pacific-day differ after 5pm local — the label must follow Pacific.
check("late Pacific evening is still today", formatEventTime("2026-08-29 02:00:00", "2026-08-29 04:00:00", "en", NOW).startsWith("Today "), true);

// --- eligibility screening ---------------------------------------------------
// The published FFY2026 CalFresh gross income limits (200% FPL). If a poverty
// guideline update lands and these constants are not refreshed, the screener
// starts quoting last year's money at people — so pin them.
check("FPL 200% for 1 person", fplThreshold(1, 200), 2610);
check("FPL 200% for 2 people", fplThreshold(2, 200), 3526);
check("FPL 200% for 3 people", fplThreshold(3, 200), 4442);
check("FPL 200% for 4 people", fplThreshold(4, 200), 5360);
check("FPL 200% for 5 people", fplThreshold(5, 200), 6276);
check("FPL 100% net limit for 1 person", fplMonthly(1), 1305);
check("FPL 130% gross limit for 1 person", fplThreshold(1, 130), 1697);
check("band edges move with household size",
  incomeBands(4)[0].label.en !== incomeBands(1)[0].label.en, true);
check("rules table is not stale", rulesAreStale(), false);

const q = (id: string) => QUESTIONS.find((x) => x.id === id)!;

// Parsing. Every one of these is something a person actually texts back.
check("household size from digits", parseAnswer(q("household_size"), "4", {}), { kind: "value", patch: { household_size: 4 } });
check("household size from a sentence", parseAnswer(q("household_size"), "there are 3 of us", {}), { kind: "value", patch: { household_size: 3 } });
check("yes", parseAnswer(q("senior"), "Yes", {}), { kind: "value", patch: { senior: "yes" } });
check("Spanish yes", parseAnswer(q("senior"), "sí", {}), { kind: "value", patch: { senior: "yes" } });
check("Chinese no", parseAnswer(q("senior"), "没有", {}), { kind: "value", patch: { senior: "no" } });
check("skip is an answer", parseAnswer(q("income_band"), "skip", {}).kind, "skip");
check("I don't know is a skip, not an error", parseAnswer(q("income_band"), "not sure", {}).kind, "skip");
check("Spanish skip", parseAnswer(q("income_band"), "omitir", {}).kind, "skip");
check("single select by number", parseAnswer(q("housing"), "3", {}), { kind: "value", patch: { housing: "shelter" } });
check("multi select from a list", parseAnswer(q("benefits"), "1, 3", {}), { kind: "value", patch: { benefits: ["calfresh", "medical"] } });
check("none wins only alone", parseAnswer(q("benefits"), "7 and 1", {}), { kind: "value", patch: { benefits: ["calfresh"] } });
check("gibberish is unparsed, not a refusal", parseAnswer(q("housing"), "what do you mean", {}).kind, "unparsed");
check("out-of-range option is unparsed", parseAnswer(q("housing"), "9", {}).kind, "unparsed");

// Sequencing.
check("first question is household size", nextQuestion({})!.id, "household_size");
check("kitchen is skipped for someone in their own place",
  nextQuestion({ household_size: 1, benefits: ["none"], income_band: "over_200", senior: "no", pregnant: "no", children: ["none"], disability: "no", housing: "own_place" })!.id,
  "prefs");
check("kitchen is asked of someone in a shelter",
  nextQuestion({ household_size: 1, benefits: ["none"], income_band: "over_200", senior: "no", pregnant: "no", children: ["none"], disability: "no", housing: "shelter" })!.id,
  "kitchen");
check("the Medi-Cal question is only for Medi-Cal members",
  nextQuestion({ household_size: 1, benefits: ["medical"], income_band: "under_130", senior: "no", pregnant: "no", children: ["none"], disability: "no", housing: "own_place" })!.id,
  "chronic");
check("a skipped question is not asked again",
  nextQuestion(applyAnswer({}, q("household_size"), { kind: "skip" }))!.id, "benefits");
check("changing household size drops the old income band",
  applyAnswer({ household_size: 1, income_band: "under_130" }, q("household_size"), { kind: "value", patch: { household_size: 5 } }).income_band,
  undefined);
check("progress counts the core eight", progress({}).total >= 8, true);

// Every question, in every language, has to fit two SMS segments.
check("every question fits 2 segments as sent",
  QUESTIONS.flatMap((question) =>
    (["en", "zh-Hans", "es"] as const).map((l) =>
      segmentsOf(smsSafe(renderQuestion(question, { household_size: 4 }, l))).segments))
    .every((n) => n <= 2),
  true);
// Folding is what keeps Spanish on GSM-7 — an accent doubles the segment cost.
check("Spanish questions send as GSM-7",
  segmentsOf(smsSafe(renderQuestion(q("income_band"), { household_size: 4 }, "es"))).encoding,
  "GSM-7");

// Server-side validation: a browser can post anything.
check("unknown answer keys are dropped",
  sanitizeAnswers({ household_size: 2, ssn: "123-45-6789", housing: "mansion" }),
  { household_size: 2 });
check("household size is clamped to something real",
  sanitizeAnswers({ household_size: 999 }), {});

// --- routing -----------------------------------------------------------------
const programs = (a: Answers) => route(a).referrals.map((r) => r.program);
const denied = (a: Answers) => route(a).excluded.map((e) => e.program);

// The floor: a pantry is offered to everyone, including someone who answered
// nothing at all, and someone plainly over every income limit.
check("a pantry is always offered", programs({}).includes("pantry"), true);
check("a pantry is offered over the income limit",
  programs({ household_size: 1, income_band: "over_200" }).includes("pantry"), true);
check("no free lunch promised over the limit",
  programs({ household_size: 1, income_band: "over_200", senior: "no", disability: "no" }).includes("calfresh"),
  false);
check("over the limit, CalFresh is named as ruled out, not left silent",
  denied({ household_size: 1, income_band: "over_200", senior: "no", disability: "no" }).includes("calfresh"),
  true);

check("CalWORKs makes CalFresh categorical",
  route({ benefits: ["calworks"] }).referrals.find((r) => r.program === "calfresh")?.reason,
  "categorical_calworks");
check("income under 200% FPL routes to CalFresh",
  route({ household_size: 3, income_band: "under_130", benefits: ["none"] }).referrals
    .find((r) => r.program === "calfresh")?.confidence,
  "likely");
check("over the gross limit, a senior still gets the net income test",
  route({ household_size: 1, income_band: "over_200", senior: "yes" }).referrals
    .find((r) => r.program === "calfresh")?.reason,
  "net_income_test_senior_or_disabled");
check("SSI does not lower with CalFresh, and we say so",
  route({ benefits: ["ssi"], income_band: "under_130" }).notes.includes("ssi_not_reduced"), true);

// The 2026 changes: flagged, never asserted.
check("CalFresh carries the H.R.1 caveat when status is unknown",
  route({ household_size: 2, income_band: "under_130" }).notes.includes("verify_hr1"), true);
check("volunteering citizenship clears the H.R.1 caveat",
  route({ household_size: 2, income_band: "under_130", citizen_branch: "yes" }).notes.includes("verify_hr1"),
  false);
check("a childless adult carries the ABAWD caveat",
  route({ household_size: 1, income_band: "under_130", senior: "no", disability: "no", children: ["none"] })
    .notes.includes("verify_abawd"),
  true);
check("a parent of a young child does not",
  route({ household_size: 3, income_band: "under_130", senior: "no", disability: "no", children: ["under_5"] })
    .notes.includes("verify_abawd"),
  false);

// Restaurant Meals: the rule people are most often told wrong.
check("EBT at restaurants is ruled out for a household that does not qualify",
  denied({ benefits: ["calfresh"], senior: "no", disability: "no", housing: "own_place" }).includes("rmp"),
  true);
check("a single homeless CalFresh recipient does qualify",
  route({ benefits: ["calfresh"], household_size: 1, housing: "outside" }).referrals
    .find((r) => r.program === "rmp")?.confidence,
  "likely");
check("in a bigger household, every member must qualify",
  route({ benefits: ["calfresh"], household_size: 3, senior: "yes" }).notes.includes("rmp_whole_household"),
  true);

check("pregnancy routes to WIC", programs({ pregnant: "yes", income_band: "165_185" }).includes("wic"), true);
check("Medi-Cal makes WIC adjunctive above the income line",
  route({ children: ["under_5"], benefits: ["medical"], income_band: "over_200" }).referrals
    .find((r) => r.program === "wic")?.confidence,
  "likely");
check("a senior under 130% gets the senior box",
  programs({ senior: "yes", income_band: "under_130" }).includes("csfp"), true);
check("a senior over 130% does not", denied({ senior: "yes", income_band: "185_200" }).includes("csfp"), true);
check("school-age kids unlock school meals and SUN Bucks",
  programs({ children: ["5_17"] }).includes("sun_bucks") && programs({ children: ["5_17"] }).includes("school_meals"),
  true);
check("school meals are universal, and we say so",
  route({ children: ["5_17"], income_band: "over_200" }).notes.includes("school_meals_universal"), true);
check("CalAIM meals need a clinical condition, not just food insecurity",
  denied({ benefits: ["medical"], chronic: "no" }).includes("calaim"), true);
check("no kitchen routes to a dining room first",
  route({ housing: "outside", kitchen: "neither" }).referrals[0].program, "dining_room");
check("delivery needs somewhere to deliver to",
  denied({ senior: "yes", disability: "yes", housing: "outside" }).includes("hdg"), true);

// The results message drops programs until it fits rather than running long.
const maximal: Answers = {
  household_size: 1, benefits: ["ssi", "medical"], income_band: "under_130",
  senior: "yes", pregnant: "yes", children: ["under_5", "5_17"],
  disability: "yes", housing: "own_place", kitchen: "neither", chronic: "yes",
};
check("results fit 3 segments in every language",
  (["en", "zh-Hans", "es"] as const)
    .map((l) => segmentsOf(smsSafe(renderReferralSms(route(maximal), l))).segments)
    .every((n) => n <= 3),
  true);
check("the caveat survives the trim",
  renderReferralSms(route(maximal), "en").includes("estimate"), true);
check("someone who qualifies for nothing extra still gets an answer",
  renderReferralSms(route({ household_size: 1, income_band: "over_200", senior: "no", disability: "no" }), "en").length > 0,
  true);

// Data minimization: what survives a screening.
const answered: Answers = {
  household_size: 2, benefits: ["medical"], income_band: "under_130",
  senior: "yes", pregnant: "no", children: ["5_17"], disability: "yes",
  housing: "own_place", kitchen: "both", chronic: "yes", citizen_branch: "yes",
};
check("coarse flags only", coarseFlags(answered),
  ["senior", "has_kids", "homebound_risk", "has_medical"]);
check("no income band survives", JSON.stringify(coarseFlags(answered)).includes("130"), false);
check("no citizenship answer survives", JSON.stringify(coarseFlags(answered)).includes("citizen"), false);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll smoke checks passed.");
