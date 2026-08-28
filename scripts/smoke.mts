// Pure-logic checks for the parts that are easy to get quietly wrong and
// expensive to get wrong in production: phone parsing, the crypto round-trip,
// keyword handling, and segment math. No network, no database.
import { toE164, formatUS } from "../lib/phone.ts";
import { phoneHash, encryptPhone, decryptPhone } from "../lib/crypto.ts";
import { parseKeyword } from "../lib/keywords.ts";
import { segmentsOf, render } from "../lib/sms-templates.ts";
import { formatEventTime } from "../lib/format-time.ts";
import { inServiceArea, countyOf } from "../lib/zips.ts";

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

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll smoke checks passed.");
