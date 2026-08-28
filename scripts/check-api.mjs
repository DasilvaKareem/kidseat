// Integration checks against a running server. These exist because the two
// worst bugs in this app so far were both invisible to typecheck and unit
// tests: a ClickHouse alias that shadowed a column, and Number(null) === 0
// turning every absent map bound into zero. Both returned an empty list with a
// 200, which looks exactly like "no results nearby".
//
//   npm run dev            # in one terminal
//   npm run check:api      # in another

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`ok   ${name}`);
  else {
    console.error(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
    failed++;
  }
};

async function get(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* streaming or empty body */
  }
  return { status: res.status, json, text };
}

try {
  await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
} catch {
  console.log(`No server at ${BASE} — skipping. Start it with: npm run dev`);
  process.exit(0);
}

const health = await get("/api/health");
check("health reports config", health.json !== null);
if (!health.json?.clickhouse?.ok) {
  console.log("\nClickHouse not reachable — skipping data checks.");
  console.log(JSON.stringify(health.json));
  process.exit(failed > 0 ? 1 : 0);
}

// The regression that matters: no bounds at all must fall back to the whole
// service area, not to a zero-width box.
const wide = await get("/api/map?locale=en");
check("map without bounds returns data", (wide.json?.items?.length ?? 0) > 0,
  `got ${wide.json?.items?.length ?? 0} items — absent bounds may be collapsing to 0`);

const bounded = await get("/api/map?locale=en&north=38.4&south=37.6&east=-122.2&west=-122.7");
check("map with explicit bounds returns data", (bounded.json?.items?.length ?? 0) > 0);

const tiny = await get("/api/map?locale=en&north=1&south=0&east=1&west=0");
check("map respects bounds (empty box is empty)", (tiny.json?.items?.length ?? 0) === 0);

// Exercises the DateTime column vs. String alias path.
const events = await get("/api/map?locale=en&kinds=event");
check("event query does not throw", events.status === 200, `status ${events.status}`);
check("events carry a formatted time",
  (events.json?.items ?? []).every((i) => typeof i.when === "string" && i.when.length > 0));

const zh = await get("/api/map?locale=zh-Hans&kinds=event");
check("event times localize", (zh.json?.items ?? []).length === (events.json?.items ?? []).length);

const access = await get("/api/map?locale=en&accessible=1");
check("accessibility filter only returns positively-tagged places",
  (access.json?.items ?? []).every((i) =>
    i.access_tags?.some((a) => a === "wheelchair" || a === "step_free")),
  "an untagged place leaked through — unknown must never read as accessible");
check("accessibility filter is narrower than unfiltered",
  (access.json?.items?.length ?? 0) < (wide.json?.items?.length ?? 0));

// Must degrade to a working deep link when Routes API is unavailable.
const dir = await get("/api/directions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    dest: { lat: 37.7599, lon: -122.4148 },
    origin: { lat: 37.7749, lon: -122.4194 },
    mode: "TRANSIT",
    transitPreference: "LESS_WALKING",
    locale: "en",
  }),
});
check("directions always return a usable link",
  typeof dir.json?.link === "string" && dir.json.link.includes("travelmode=transit"));
check("directions reject a missing destination",
  (await get("/api/directions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "WALK" }),
  })).status === 400);

const programs = await get("/api/programs");
check("programs load", (programs.json?.programs?.length ?? 0) > 0);
check("program fields parse to arrays",
  (programs.json?.programs ?? []).every((p) => Array.isArray(p.fields)));

check("applications require auth", (await get("/api/applications")).status === 401);
check("chat requires auth",
  (await get("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [] }),
  })).status === 401);

const badPhone = await get("/api/consent", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ phone: "1234567890", locale: "en" }),
});
check("consent rejects an invalid number", badPhone.status === 400);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll API checks passed.");
