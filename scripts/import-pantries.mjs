// Loads real San Francisco and Marin food distribution sites into
// sffood.pantries, replacing the DEV fixtures in seed-pantries.mjs.
//
//   node --env-file-if-exists=.env.local scripts/import-pantries.mjs --dry-run
//   node --env-file-if-exists=.env.local scripts/import-pantries.mjs
//
// The table is a ReplacingMergeTree keyed on pantry_id, so pantry_id is derived
// from the source's own stable key and re-running upserts rather than
// duplicates. Sites that disappear from a feed are set active = 0, never
// deleted, so a retired row can still be joined against old message_events.
//
// ---------------------------------------------------------------------------
// Sources, and why these three
// ---------------------------------------------------------------------------
//
// sfmfb-locator  SF-Marin Food Bank Food Locator. The Angular front end at
//                foodlocator.sfmfoodbank.org is backed by a JSON endpoint
//                (POST /resource) that returns the whole county at once when
//                the ZIP is "unknown". Structured, live, no key, and scoped to
//                exactly our service area. This is the primary source.
//
// 211-bayarea    211's national API (api.211.org), which is what
//                211bayarea.org itself queries. HSDS-derived and the only
//                source here that carries prepared meals, home delivery, and
//                halal/kosher/baby programs. It is behind an Azure API
//                Management subscription key, so it stays off unless
//                TWO11_API_KEY is set. See the caveat on parse211() before
//                trusting its output.
//
// DataSF         Evaluated and rejected. data.sfgov.org has no food
//                distribution dataset — searching food, pantry, meal, food
//                security and CalFresh returns only restaurant inspection
//                scores and mobile vendor permits. The one statewide Socrata
//                list of pantries ("Food Resources in California") is a
//                May 2020 COVID snapshot and has not been touched since; a
//                five-year-old address is worse than no address when the
//                output is an SMS telling someone where to walk.
//
// ---------------------------------------------------------------------------
// The tag mapping is the safety-critical part
// ---------------------------------------------------------------------------
//
// lib/pantries.ts treats a stated need as a hard filter. `shelf_stable` and
// `prepared` are what someone with no stove is matched on, so tagging a
// weekly grocery bag `shelf_stable` because it happens to contain some cans
// would quietly turn that filter into a no-op and send that person to a crate
// of raw produce. Every tag below is therefore mapped from an explicit signal
// in the source, never inferred from a program name, and the run summary
// prints per-tag coverage so a gap is visible instead of silent.
import { neon } from "@neondatabase/serverless";

const TAGS = ["shelf_stable", "prepared", "delivery", "halal", "kosher", "baby"];

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const OPTS = {
  dryRun: flag("dry-run"),
  onlySource: opt("source"),
  out: opt("out"),
  skipWaitlist: flag("skip-waitlist"),
  allowShrink: flag("allow-shrink"),
  purgeDevSeed: flag("purge-dev-seed"),
};

if (flag("help")) {
  console.log(`Usage: node scripts/import-pantries.mjs [options]

  --dry-run           fetch and normalize, print the result, write nothing
                      (needs no ClickHouse credentials)
  --source=NAME       only run one source: sfmfb-locator | 211-bayarea
  --out=FILE          write the normalized rows to FILE as JSON for review
  --skip-waitlist     drop sites the food bank marks Waitlist Only instead of
                      importing them with a waitlist note in requirements
  --allow-shrink      import even if a feed returns far fewer sites than the
                      table already holds (normally that means a broken fetch)
  --purge-dev-seed    hard-DELETE the source='dev-seed' fixture rows instead of
                      just setting active = 0
`);
  process.exit(0);
}

const now = new Date();
const UPDATED_AT = now.toISOString().replace("T", " ").replace("Z", "");

// ---------------------------------------------------------------------------
// Shared formatting. `hours` is sent verbatim over SMS, so it is built to be
// short and readable, not complete: "Sat 8-9:15am", not "Saturday, 8:00 AM to
// 9:15 AM". Everything here caps rather than wraps.
// ---------------------------------------------------------------------------

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_INDEX = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/** "8:00 am" -> "8am"; "9:15 am" -> "9:15am"; "12:00 pm" -> "12pm". */
function shortTime(raw) {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([ap])\.?m\.?\s*$/i.exec(String(raw ?? ""));
  if (!m) return "";
  const [, h, min, mer] = m;
  const suffix = `${mer.toLowerCase()}m`;
  return min === "00" ? `${Number(h)}${suffix}` : `${Number(h)}:${min}${suffix}`;
}

/** Drops the repeated meridiem: 8am + 9:15am -> "8-9:15am". */
function timeRange(start, end) {
  const a = shortTime(start);
  const b = shortTime(end);
  if (!a) return b;
  if (!b) return a;
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -2)}-${b}` : `${a}-${b}`;
}

function clamp(text, max) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function fiveDigitZip(raw) {
  const m = /(\d{5})/.exec(String(raw ?? ""));
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Geocoding. The feeds we use today always carry coordinates, but a source
// that does not must still produce a usable row: lat and lon are Float64 and
// NOT nullable, and lib/pantries.ts measures distance from whatever is there,
// so a 0,0 placeholder would not fall back to ZIP matching — it would put the
// site in the Gulf of Guinea and silently hide it from every search.
//
// Chain: the source's own coordinates, then the Census geocoder (free, no key,
// US only), then the ZIP centroid — which is the same precision the app already
// holds for the person searching. A row that resolves to none of these is
// dropped rather than guessed at.
// ---------------------------------------------------------------------------

const geoCache = new Map();

async function censusGeocode(address, city, zip) {
  const oneLine = [address, city, "CA", zip].filter(Boolean).join(", ");
  if (geoCache.has(oneLine)) return geoCache.get(oneLine);
  let out = null;
  try {
    const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
    url.searchParams.set("address", oneLine);
    url.searchParams.set("benchmark", "Public_AR_Current");
    url.searchParams.set("format", "json");
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const json = await res.json();
      const c = json?.result?.addressMatches?.[0]?.coordinates;
      if (c && Number.isFinite(c.y) && Number.isFinite(c.x)) out = { lat: c.y, lon: c.x };
    }
  } catch {
    out = null;
  }
  geoCache.set(oneLine, out);
  return out;
}

async function zipCentroid(zip) {
  const key = `zip:${zip}`;
  if (geoCache.has(key)) return geoCache.get(key);
  let out = null;
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const place = (await res.json())?.places?.[0];
      const lat = Number(place?.latitude);
      const lon = Number(place?.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lon)) out = { lat, lon };
    }
  } catch {
    out = null;
  }
  geoCache.set(key, out);
  return out;
}

/** Returns {lat, lon, precision} or null. */
async function resolveCoords(row) {
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
    return { lat, lon, precision: "source" };
  }
  const hit = await censusGeocode(row.address, row.city, row.zip);
  if (hit) return { ...hit, precision: "geocoded" };
  const centroid = await zipCentroid(row.zip);
  if (centroid) return { ...centroid, precision: "zip_centroid" };
  return null;
}

// ---------------------------------------------------------------------------
// Source: SF-Marin Food Bank Food Locator
// ---------------------------------------------------------------------------

const LOCATOR = "https://foodlocator.sfmfoodbank.org";
const USER_AGENT = "sf-food-importer/1.0 (+https://github.com/sffood; free food SMS service)";

// Language ids from the locator's own locator.languages.js. English is added to
// every site: the list names the extra languages a site is staffed in, not the
// complete set, and the locator itself is English-first.
const LOCATOR_LANGUAGES = {
  374: "es", 375: "yue", 376: "zh-Hans", 377: "ru", 378: "tl", 379: "ko",
  380: "ja", 381: "wo", 382: "de", 383: "fr", 384: "ar", 385: "ur",
  386: "vi", 387: "bn", 389: "km", 391: "lo", 392: "ase", 393: "yue",
  394: "sm",
};

// From the locator's Statuses map: open, enroll, wait, closed.
const LOCATOR_CLOSED = "closed";
const LOCATOR_WAITLIST = "wait";

// EnrollPatterns, again from locator.languages.js. Patterns 2, 5, 6 and 9 name
// the days enrollment happens, so they still mean enrollment is required; only
// 7 ("No Enrollment Required") and 0 (not applicable) mean it is not.
// The wording of ENROLL_ID comes from the locator's own Weekly Pantry FAQ.
const ENROLL_ID = "Enroll at site: photo ID + proof of address";
const ENROLL_ASK = "Ask at site about enrolling";
const LOCATOR_ENROLLMENT = {
  0: "", 1: ENROLL_ID, 2: ENROLL_ID, 3: ENROLL_ID, 4: ENROLL_ASK,
  5: ENROLL_ID, 6: ENROLL_ID, 7: "", 8: ENROLL_ASK, 9: ENROLL_ID,
};

async function fetchLocatorCounty(county) {
  // The results page mints a Laravel CSRF token bound to a session cookie, and
  // POST /resource checks both. The senior, disabled and urgent flags widen the
  // result set rather than narrowing it, so they are all on: senior adds the
  // five senior-restricted pantries and urgent adds the emergency food list.
  const page = await fetch(`${LOCATOR}/en/${county}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!page.ok) throw new Error(`locator ${county} page HTTP ${page.status}`);
  const html = await page.text();

  const token = /name="_token" value="([^"]+)"/.exec(html)?.[1];
  if (!token) throw new Error(`locator ${county}: no CSRF token in page`);
  const cookies = (page.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");

  const res = await fetch(`${LOCATOR}/resource`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-TOKEN": token,
      "X-Requested-With": "XMLHttpRequest",
      Referer: `${LOCATOR}/en/${county}`,
      "User-Agent": USER_AGENT,
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: JSON.stringify({
      visit_county: county,
      visit_zip: "unknown", // county-wide rather than one ZIP at a time
      visit_senior: 1,
      visit_urgent: 1,
      visit_disabled: 1,
      visit_lang: "en",
      visit_calfresh: 1,
      visit_hdg: 1,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`locator ${county} /resource HTTP ${res.status}`);

  const json = await res.json();
  // ngns = Weekly Groceries, sfps = Monthly Food, efbs = Emergency Food.
  const groups = [
    ["ngn", json.ngns],
    ["sfp", json.sfps],
    ["efb", json.efbs],
  ];
  const out = [];
  for (const [kind, list] of groups) {
    for (const row of Array.isArray(list) ? list : []) out.push({ kind, county, row });
  }
  return out;
}


function locatorOpenDays(row) {
  // day is 1=Monday..7=Sunday, or 8 for "multiple / not on a fixed weekday".
  const day = Number(row.day);
  if (Number.isInteger(day) && day >= 1 && day <= 7) return [day % 7];
  const names = [
    row.distro_next_dayname, row.distro_next2_dayname,
    row.distro_next3_dayname, row.distro_next4_dayname,
  ];
  const days = new Set();
  for (const n of names) {
    const i = DAY_INDEX[String(n ?? "").toLowerCase()];
    if (i !== undefined) days.add(i);
  }
  // These come from the next four scheduled distributions, so every day listed
  // is a real one, but a site open more often than that will look narrower than
  // it is. Under-reporting hides an option; over-reporting sends someone to a
  // locked door, so this errs the safe way.
  //
  // Empty is meaningful: lib/pantries.ts reads it as "no weekday restriction",
  // which is right for a walk-in emergency food site.
  return [...days].sort((a, b) => a - b);
}

function locatorHours(row, openDays) {
  const range = timeRange(row.distro_start, row.distro_end);
  if (openDays.length === 1) return clamp(`${DAY_ABBR[openDays[0]]} ${range}`.trim(), 40);
  if (openDays.length > 1) {
    const days = openDays.map((d) => DAY_ABBR[d]).join("/");
    return clamp(range ? `${days} ${range}` : days, 40);
  }
  // No distribution day at all. A bare time range reads as "any day", which is
  // how somebody ends up walking to a closed door on a Sunday. Saying to call
  // first is advice, not a schedule we invented — but it is only worth saying
  // when there is a number to call, and `phone` rides along in the same SMS.
  if (row.phone) return clamp(range ? `Call first: ${range}` : "Call for hours", 40);
  return clamp(range, 40);
}

function locatorRequirements(row) {
  const parts = [];
  // Eligibility first: it is the line that decides whether the walk is wasted.
  if (row.senior === 1) parts.push("Seniors 60+ or adults w/ disabilities");
  if (row.status === LOCATOR_WAITLIST) parts.push("Waitlist - sign up first");
  const enrollment = LOCATOR_ENROLLMENT[Number(row.enroll_pattern)] ?? "";
  if (enrollment) parts.push(enrollment);
  // '' is a promise: no ID, no documents. Only the branches above break it.
  // The cap clears the longest combination of all three, so nothing is ever
  // truncated into something that reads as a different rule.
  return clamp(parts.join("; "), 110);
}

function locatorTags(row) {
  const tags = [];
  // `lowcook` is the locator's own flag for food that needs little or no
  // cooking, and it is the only signal in this feed that a bag can be eaten
  // without a stove. Weekly grocery distributions hand out fresh produce and
  // protein; tagging them all shelf_stable because the bag also holds cans
  // would make the no_stove filter match everything.
  if (row.lowcook === 1) tags.push("shelf_stable");
  // Deliberately not mapped from this feed:
  //   prepared  the locator carries no hot-meal or dining-room programs. St.
  //             Anthony's appears here as an emergency food box site; its
  //             dining room is a different program at a different door, and
  //             guessing would send someone to the wrong one.
  //   delivery  Home Delivered Groceries is an application, not a site list —
  //             visit_hdg=1 returns no rows of its own.
  //   halal / kosher / baby  not represented in this feed at all.
  return tags;
}

function locatorLanguages(row) {
  const langs = new Set(["en"]);
  for (const code of row.languages ?? []) {
    const tag = LOCATOR_LANGUAGES[Number(code)];
    if (tag) langs.add(tag);
  }
  return [...langs];
}

async function loadSfmfb() {
  const raw = [
    ...(await fetchLocatorCounty("sf")),
    ...(await fetchLocatorCounty("marin")),
  ];

  const rows = [];
  const skipped = [];
  for (const { kind, row } of raw) {
    if (row.status === LOCATOR_CLOSED) {
      skipped.push({ name: row.name, why: "temporary closure" });
      continue;
    }
    if (OPTS.skipWaitlist && row.status === LOCATOR_WAITLIST) {
      skipped.push({ name: row.name, why: "waitlist only (--skip-waitlist)" });
      continue;
    }
    const zip = fiveDigitZip(row.zip);
    if (!zip) {
      skipped.push({ name: row.name, why: "no usable ZIP" });
      continue;
    }
    const openDays = locatorOpenDays(row);
    const coords = await resolveCoords({
      lat: row.lat, lon: row.lng, address: row.address, city: row.city, zip,
    });
    if (!coords) {
      skipped.push({ name: row.name, why: "could not resolve coordinates" });
      continue;
    }
    rows.push({
      // link_id is the food bank's own site key and is unique across both
      // counties, so this id is stable run to run.
      pantry_id: `sfmfb:${row.link_id}`,
      name: clamp(row.name, 80),
      address: clamp(row.address, 80),
      zip,
      lat: coords.lat,
      lon: coords.lon,
      phone: clamp(row.phone ?? "", 20),
      hours: locatorHours(row, openDays),
      open_days: openDays,
      languages: locatorLanguages(row),
      tags: locatorTags(row),
      requirements: locatorRequirements(row),
      active: true,
      source: "sfmfb-locator",
      updated_at: UPDATED_AT,
      _precision: coords.precision,
      _kind: kind,
    });
  }
  return { rows, skipped };
}

// ---------------------------------------------------------------------------
// Source: 211 Bay Area, via 211's national API
// ---------------------------------------------------------------------------
//
// GET https://api.211.org/search/v1/api/Search/Keyword?keyword=…&location=…
// with an Ocp-Apim-Subscription-Key header. Keys come from apiportal.211.org.
//
// CAVEAT, and it is the reason this source is off by default: the response
// field names below are the HSDS-shaped ones 211 documents, but they have not
// been exercised against a live key from this machine — the endpoint answers
// 401 without one. parse211() therefore refuses a record it cannot read rather
// than filling in blanks, and any run that touches this source should start
// with --source=211-bayarea --dry-run and a human reading the output.
const TWO11_URL = "https://api.211.org/search/v1/api/Search/Keyword";
const TWO11_KEY = process.env.TWO11_API_KEY ?? "";

// SF + Marin, one query per ZIP cluster. 211 searches by radius from a
// location, so a handful of anchors covers both counties.
const TWO11_ANCHORS = ["94102", "94110", "94124", "94132", "94901", "94947"];

// The only keyword searches whose results can be tagged from the source's own
// words. A term that does not map cleanly onto one of the six tags is not worth
// importing here, because an untagged row is invisible to a needs-filtered
// search anyway.
const TWO11_QUERIES = [
  { keyword: "soup kitchen", tags: ["prepared"] },
  { keyword: "congregate meals", tags: ["prepared"] },
  { keyword: "home delivered meals", tags: ["prepared", "delivery"] },
  { keyword: "home delivered groceries", tags: ["delivery"] },
  { keyword: "food pantry", tags: [] },
  { keyword: "halal food", tags: ["halal"] },
  { keyword: "kosher food", tags: ["kosher"] },
  { keyword: "infant formula", tags: ["baby"] },
  { keyword: "baby food", tags: ["baby"] },
];

// Applied to the record's own name/description/taxonomy text, on top of the
// tags implied by the query. Each phrase is something a directory says
// explicitly, not a category we are reading into it.
const TWO11_TEXT_TAGS = [
  [/\b(shelf[- ]stable|non[- ]?perishable|no[- ]cook)\b/i, "shelf_stable"],
  [/\b(soup kitchen|hot meals?|prepared meals?|congregate meals?|dining room)\b/i, "prepared"],
  [/\b(home[- ]deliver\w*|meals on wheels|delivered to your home)\b/i, "delivery"],
  [/\bhalal\b/i, "halal"],
  [/\bkosher\b/i, "kosher"],
  [/\b(infant formula|baby food|formula for infants)\b/i, "baby"],
];

function shortEnough(text, max) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > 0 && t.length <= max ? t : "";
}

function pick(record, ...names) {
  for (const n of names) {
    const v = record?.[n];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function parse211(record, queryTags) {
  const name = pick(record, "nameServiceAtLocation", "serviceName", "name", "organizationName");
  const address = pick(record, "address1", "address", "physicalAddress1", "street");
  const zip = fiveDigitZip(pick(record, "zip", "postalCode", "zipCode", "postal_code"));
  if (!name || !address || !zip) return null;

  const blob = [
    name,
    pick(record, "description", "serviceDescription") ?? "",
    pick(record, "taxonomyTerm", "taxonomyTerms", "serviceTaxonomy") ?? "",
  ].join(" ");

  const tags = new Set(queryTags);
  for (const [re, tag] of TWO11_TEXT_TAGS) if (re.test(blob)) tags.add(tag);

  const idPart =
    pick(record, "idServiceAtLocation", "serviceAtLocationId", "id", "locationId") ??
    `${name}|${address}`;

  return {
    pantry_id: `211:${String(idPart).replace(/\s+/g, "_").slice(0, 64)}`,
    name: clamp(name, 80),
    address: clamp(address, 80),
    zip,
    lat: Number(pick(record, "latitude", "lat") ?? NaN),
    lon: Number(pick(record, "longitude", "lon", "lng") ?? NaN),
    city: pick(record, "city", "cityName") ?? "",
    phone: clamp(pick(record, "phone", "phoneNumber", "mainPhone") ?? "", 20),
    // Only 211's own hours fields, never applicationProcess — that is prose
    // about how to apply, and this string is sent verbatim over SMS. A text
    // too long to fit is dropped rather than truncated: half a sentence about
    // opening times is worse than no sentence.
    hours: shortEnough(pick(record, "hours", "hoursText"), 40),
    tags: [...tags],
    // 211 records eligibility in prose. Only a record that says so explicitly
    // gets a requirements string; everything else keeps the '' promise.
    requirements: /\b(photo )?id\b|\bidentification\b|\bproof of\b|\bdocument/i.test(
      pick(record, "eligibility", "eligibilityText") ?? "",
    )
      ? clamp(pick(record, "eligibility", "eligibilityText"), 96)
      : "",
  };
}

async function loadTwo11() {
  if (!TWO11_KEY) {
    return {
      rows: [],
      skipped: [],
      note: "TWO11_API_KEY is not set — skipped. Get a subscription key at apiportal.211.org.",
    };
  }

  const byId = new Map();
  const skipped = [];
  for (const anchor of TWO11_ANCHORS) {
    for (const { keyword, tags } of TWO11_QUERIES) {
      const url = new URL(TWO11_URL);
      url.searchParams.set("keyword", keyword);
      url.searchParams.set("location", anchor);
      const res = await fetch(url, {
        headers: { "Ocp-Apim-Subscription-Key": TWO11_KEY, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        skipped.push({ name: `${keyword} @ ${anchor}`, why: `211 HTTP ${res.status}` });
        continue;
      }
      const json = await res.json();
      const records = Array.isArray(json) ? json : (json.results ?? json.data ?? []);
      if (!Array.isArray(records)) {
        skipped.push({ name: `${keyword} @ ${anchor}`, why: "unrecognized 211 response shape" });
        continue;
      }
      for (const record of records) {
        const parsed = parse211(record, tags);
        if (!parsed) {
          skipped.push({ name: "(211 record)", why: "missing name, address or ZIP" });
          continue;
        }
        // Same service can come back from several anchors; merge the tags.
        const existing = byId.get(parsed.pantry_id);
        if (existing) {
          existing.tags = [...new Set([...existing.tags, ...parsed.tags])];
        } else {
          byId.set(parsed.pantry_id, parsed);
        }
      }
    }
  }

  if (byId.size === 0 && skipped.length > 0) {
    // Every request failed. That is a broken source, not an empty one, and the
    // difference matters: "empty" would retire every 211 row in the table.
    throw new Error(`211 returned nothing usable (${skipped[0].why})`);
  }

  const rows = [];
  for (const p of byId.values()) {
    const coords = await resolveCoords(p);
    if (!coords) {
      skipped.push({ name: p.name, why: "could not resolve coordinates" });
      continue;
    }
    rows.push({
      pantry_id: p.pantry_id,
      name: p.name,
      address: p.address,
      zip: p.zip,
      lat: coords.lat,
      lon: coords.lon,
      phone: p.phone,
      hours: p.hours,
      // 211 does not publish a machine-readable weekly schedule here, and an
      // empty array reads as "no weekday restriction" rather than "never open".
      open_days: [],
      languages: ["en"],
      tags: p.tags,
      requirements: p.requirements,
      active: true,
      source: "211-bayarea",
      updated_at: UPDATED_AT,
      _precision: coords.precision,
      _kind: "211",
    });
  }
  return { rows, skipped };
}

// ---------------------------------------------------------------------------
// Validation. Nothing reaches the table without passing this, because the next
// thing that reads it is a text message telling somebody where to walk.
// ---------------------------------------------------------------------------

// Roughly SF + Marin plus slack. A site outside it means a geocode went wrong.
const BBOX = { minLat: 37.4, maxLat: 38.4, minLon: -123.3, maxLon: -122.2 };
const FIXTURE_RE = /NOT A REAL SITE|DEV SEED|dev-seed|\bexample\b/i;

function validate(row) {
  const problems = [];
  if (!row.pantry_id) problems.push("empty pantry_id");
  if (!row.name) problems.push("empty name");
  if (!row.address) problems.push("empty address");
  if (FIXTURE_RE.test(`${row.name} ${row.address}`)) problems.push("looks like a dev fixture");
  if (!/^\d{5}$/.test(row.zip)) problems.push(`bad zip ${JSON.stringify(row.zip)}`);
  if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) problems.push("non-finite coords");
  else if (
    row.lat < BBOX.minLat || row.lat > BBOX.maxLat ||
    row.lon < BBOX.minLon || row.lon > BBOX.maxLon
  ) problems.push(`coords outside the Bay Area (${row.lat}, ${row.lon})`);
  for (const t of row.tags) if (!TAGS.includes(t)) problems.push(`unknown tag ${t}`);
  for (const d of row.open_days) {
    if (!Number.isInteger(d) || d < 0 || d > 6) problems.push(`bad open_day ${d}`);
  }
  if (row.hours.length > 40) problems.push("hours too long for SMS");
  return problems;
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

let client = null;
function db() {
  if (client) return client;
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Use --dry-run, or run `vercel env pull`.");
    process.exit(1);
  }
  client = neon(url);
  return client;
}

const COLUMNS = [
  "pantry_id", "name", "address", "zip", "lat", "lon", "phone", "hours",
  "open_days", "languages", "tags", "requirements", "active", "source", "updated_at",
];

const forInsert = (row) => Object.fromEntries(COLUMNS.map((c) => [c, row[c]]));

/**
 * Batched upsert on the primary key. access_tags is deliberately absent from
 * COLUMNS and so is never overwritten here: accessibility is curated by hand
 * and no upstream feed carries it. A nightly import must not wipe it.
 */
async function upsertPantries(values) {
  if (values.length === 0) return;
  const assignments = COLUMNS.filter((c) => c !== "pantry_id")
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(", ");
  const CHUNK = 100;
  for (let i = 0; i < values.length; i += CHUNK) {
    const chunk = values.slice(i, i + CHUNK);
    const params = [];
    const tuples = chunk.map((row) => {
      const base = params.length;
      for (const c of COLUMNS) params.push(row[c]);
      return `(${COLUMNS.map((_, j) => `$${base + j + 1}`).join(", ")})`;
    });
    await db().query(
      `INSERT INTO pantries (${COLUMNS.join(", ")}) VALUES ${tuples.join(", ")}
       ON CONFLICT (pantry_id) DO UPDATE SET ${assignments}`,
      params,
    );
  }
}

/** Retiring a site is now an UPDATE, not a re-insert of the whole row. */
async function deactivate(pantryIds) {
  if (pantryIds.length === 0) return;
  await db().query(
    `UPDATE pantries SET active = false, updated_at = $2
     WHERE pantry_id = ANY ($1::text[])`,
    [pantryIds, UPDATED_AT],
  );
}

async function existingRows(sources) {
  return db().query(
    `SELECT ${COLUMNS.join(", ")} FROM pantries
     WHERE active AND source = ANY ($1::text[])`,
    [sources],
  );
}

async function retireDevSeed() {
  if (OPTS.purgeDevSeed) {
    // programs.pantry_id is ON DELETE SET NULL, so a purge orphans any seeded
    // program rather than failing or silently deleting it.
    await db().query("DELETE FROM pantries WHERE source = 'dev-seed'");
    await db().query("DELETE FROM pantry_events WHERE source = 'dev-seed'");
    return "deleted";
  }

  // Events as well as sites. A fixture event carries its own address, so
  // retiring only the pantries left "000 Example St (NOT A REAL SITE)" showing
  // in /api/map next to the real ones -- the fake row a dev seed exists to keep
  // out of real output.
  const stale = await existingRows(["dev-seed"]);
  if (stale.length > 0) await deactivate(stale.map((r) => r.pantry_id));

  const events = await db().query(
    `UPDATE pantry_events SET cancelled = true, updated_at = $1
      WHERE source = 'dev-seed' AND NOT cancelled
      RETURNING event_id`,
    [UPDATED_AT],
  );

  if (stale.length === 0 && events.length === 0) return "none present";
  return `${stale.length} sites deactivated, ${events.length} events cancelled`;
}

// ---------------------------------------------------------------------------

const SOURCES = {
  "sfmfb-locator": loadSfmfb,
  "211-bayarea": loadTwo11,
};

async function main() {
  const names = OPTS.onlySource ? [OPTS.onlySource] : Object.keys(SOURCES);
  for (const n of names) {
    if (!SOURCES[n]) {
      console.error(`Unknown source ${n}. Known: ${Object.keys(SOURCES).join(", ")}`);
      process.exit(1);
    }
  }

  const rows = [];
  const skipped = [];
  const invalid = [];

  for (const name of names) {
    process.stdout.write(`fetching ${name} … `);
    let result;
    try {
      result = await SOURCES[name]();
    } catch (err) {
      console.log("FAILED");
      console.error(`  ${err.message}`);
      // A source that failed must not be treated as "returned nothing", or the
      // retire step below would deactivate every site it owns.
      process.exit(1);
    }
    const good = [];
    for (const row of result.rows) {
      const problems = validate(row);
      if (problems.length) invalid.push({ row, problems });
      else good.push(row);
    }
    rows.push(...good);
    skipped.push(...result.skipped.map((s) => ({ ...s, source: name })));
    console.log(`${good.length} sites${result.note ? ` (${result.note})` : ""}`);
  }

  // --- report ---------------------------------------------------------------

  const bySource = {};
  for (const r of rows) bySource[r.source] = (bySource[r.source] ?? 0) + 1;
  const byTag = Object.fromEntries(
    TAGS.map((t) => [t, rows.filter((r) => r.tags.includes(t)).length]),
  );
  const approx = rows.filter((r) => r._precision !== "source").length;

  console.log("\nby source   ", bySource);
  console.log("by tag      ", byTag);
  console.log("no ID/docs  ", rows.filter((r) => r.requirements === "").length, "of", rows.length);
  console.log("approx coords", approx);
  if (skipped.length) {
    console.log(`\nskipped ${skipped.length}:`);
    for (const s of skipped.slice(0, 20)) console.log(`  - ${s.name}: ${s.why}`);
    if (skipped.length > 20) console.log(`  … and ${skipped.length - 20} more`);
  }
  if (invalid.length) {
    console.log(`\nfailed validation ${invalid.length}:`);
    for (const i of invalid) console.log(`  - ${i.row.name}: ${i.problems.join(", ")}`);
  }

  // A need with no tagged sites is not a quiet gap — lib/pantries.ts filters on
  // it, so those people get the no_results message every time they text FOOD.
  const empty = TAGS.filter((t) => byTag[t] === 0);
  if (empty.length) {
    console.log(
      `\nNOTE: no site carries ${empty.join(", ")}. Anyone whose stated need maps` +
        `\n      to those tags will match nothing and be referred to 211.`,
    );
  }

  if (OPTS.out) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(OPTS.out, `${JSON.stringify(rows, null, 2)}\n`);
    console.log(`\nwrote ${rows.length} rows to ${OPTS.out}`);
  }

  if (rows.length === 0) {
    console.error("\nNothing to import. Refusing to write.");
    process.exit(1);
  }

  if (OPTS.dryRun) {
    console.log("\n--dry-run: nothing written. Sample row:");
    console.log(JSON.stringify(forInsert(rows[0]), null, 2));
    return;
  }

  // --- write ----------------------------------------------------------------

  const before = await existingRows(names);
  for (const name of names) {
    const had = before.filter((r) => r.source === name).length;
    const now = bySource[name] ?? 0;
    if (had > 0 && now < had * 0.5 && !OPTS.allowShrink) {
      console.error(
        `\nRefusing to import: ${name} returned ${now} sites, replacing ${had} active ones.` +
          "\nThat usually means a feed changed shape or a fetch half-failed." +
          "\nRe-run with --allow-shrink if the shrink is real.",
      );
      process.exit(1);
    }
  }

  await upsertPantries(rows.map(forInsert));
  console.log(`\nupserted ${rows.length} sites`);

  const fresh = new Set(rows.map((r) => r.pantry_id));
  const gone = before.filter((r) => !fresh.has(r.pantry_id));
  if (gone.length) {
    await deactivate(gone.map((r) => r.pantry_id));
    console.log(`retired ${gone.length} sites no longer in their feed`);
  }

  console.log(`dev fixtures: ${await retireDevSeed()}`);
}

// No OPTIMIZE step any more: an upsert replaces the row in place, so there are
// no superseded versions to compact away.
await main();
