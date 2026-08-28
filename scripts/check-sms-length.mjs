// CI guard: an SMS template that silently splits into 3 segments triples the
// cost of every send and often arrives out of order. Chinese is the risk —
// UCS-2 gives you 67 characters per segment, not 153.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../lib/sms-templates.ts", import.meta.url), "utf8");

const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const EXT = "^{}\\[~]|€";

function segments(text) {
  const gsm = [...text].every((c) => GSM7.includes(c) || EXT.includes(c));
  if (gsm) {
    let n = 0;
    for (const c of text) n += EXT.includes(c) ? 2 : 1;
    return { enc: "GSM-7", units: n, segs: n <= 160 ? 1 : Math.ceil(n / 153) };
  }
  const n = text.length;
  return { enc: "UCS-2", units: n, segs: n <= 70 ? 1 : Math.ceil(n / 67) };
}

const MAX = 2;
let failed = 0;

// Templates are plain string literals keyed by locale — pull them out directly.
for (const m of src.matchAll(/^\s{4}(en|"zh-Hans"|es):\s*"((?:[^"\\]|\\.)*)",?$/gm)) {
  const locale = m[1].replace(/"/g, "");
  const text = m[2].replace(/\\"/g, '"').replace(/\{(\w+)\}/g, "94103");
  const { enc, units, segs } = segments(text);
  const flag = segs > MAX ? "FAIL" : "ok  ";
  if (segs > MAX) failed++;
  console.log(`${flag} ${locale.padEnd(8)} ${enc} ${String(units).padStart(3)}u ${segs} seg  ${text.slice(0, 48)}`);
}

if (failed > 0) {
  console.error(`\n${failed} template(s) exceed ${MAX} segments.`);
  process.exit(1);
}
console.log("\nAll SMS templates fit within 2 segments.");
