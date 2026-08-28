// DEV FIXTURES ONLY. These are invented sites with invented hours at
// deliberately fake addresses, so a mis-wired dev environment can never text a
// real person a real-looking address that does not exist.
//
// Real data comes from the SF-Marin Food Bank locator, DataSF, and 211 Bay Area
// (Open Referral HSDS). Load real sites before pointing SMS_PROVIDER at a
// live carrier.
import { createClient } from "@clickhouse/client";

const client = createClient({
  url: process.env.CLICKHOUSE_URL,
  username: process.env.CLICKHOUSE_USER ?? "default",
  password: process.env.CLICKHOUSE_PASSWORD ?? "",
  database: process.env.CLICKHOUSE_DATABASE ?? "sffood",
});

const now = new Date().toISOString().replace("T", " ").replace("Z", "");

const rows = [
  {
    pantry_id: "dev-1", name: "DEV SEED - Mission Example Pantry",
    address: "000 Example St (NOT A REAL SITE)", zip: "94110",
    lat: 37.7599, lon: -122.4148, phone: "", hours: "Tue & Thu, 10am-1pm",
    open_days: [2, 4], languages: ["en", "es"],
    tags: ["shelf_stable", "baby"], requirements: "", active: 1,
    access_tags: ["wheelchair", "step_free", "accessible_restroom"],
    source: "dev-seed", updated_at: now,
  },
  {
    pantry_id: "dev-2", name: "DEV SEED - Chinatown Example Meals",
    address: "000 Example Ave (NOT A REAL SITE)", zip: "94108",
    lat: 37.7941, lon: -122.4078, phone: "", hours: "Daily, 11:30am-1pm",
    open_days: [0, 1, 2, 3, 4, 5, 6], languages: ["en", "zh-Hans"],
    tags: ["prepared", "shelf_stable"], requirements: "", active: 1,
    access_tags: [],
    source: "dev-seed", updated_at: now,
  },
  {
    pantry_id: "dev-3", name: "DEV SEED - Tenderloin Example Delivery",
    address: "000 Example Blvd (NOT A REAL SITE)", zip: "94102",
    lat: 37.7835, lon: -122.4152, phone: "", hours: "Wed, home delivery",
    open_days: [3], languages: ["en", "es", "zh-Hans"],
    tags: ["delivery", "shelf_stable", "halal"], requirements: "", active: 1,
    access_tags: ["wheelchair", "near_transit", "asl"],
    source: "dev-seed", updated_at: now,
  },
];

await client.insert({ table: "pantries", values: rows, format: "JSONEachRow" });

// Events are what the agent reaches for first, so the dev data needs some.
// Times are relative to now so the fixtures are always "upcoming".
const iso = (hoursFromNow) =>
  new Date(Date.now() + hoursFromNow * 3600_000)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");

const events = [
  {
    event_id: "dev-evt-1", pantry_id: "dev-1",
    title: "DEV SEED - Mission produce distribution",
    starts_at: iso(3), ends_at: iso(6), zip: "94110",
    lat: 37.7599, lon: -122.4148, address: "000 Example St (NOT A REAL SITE)",
    languages: ["en", "es"], tags: ["shelf_stable", "baby"],
    access_tags: ["wheelchair", "step_free"],
    notes: "Bring a bag if you have one", requirements: "", cancelled: 0,
    source: "dev-seed", updated_at: now,
  },
  {
    event_id: "dev-evt-2", pantry_id: "dev-2",
    title: "DEV SEED - Chinatown hot lunch",
    starts_at: iso(20), ends_at: iso(22), zip: "94108",
    lat: 37.7941, lon: -122.4078, address: "000 Example Ave (NOT A REAL SITE)",
    languages: ["en", "zh-Hans"], tags: ["prepared"],
    access_tags: ["seating", "near_transit"],
    notes: "", requirements: "", cancelled: 0,
    source: "dev-seed", updated_at: now,
  },
  {
    event_id: "dev-evt-3", pantry_id: "dev-3",
    title: "DEV SEED - Tenderloin home delivery window",
    starts_at: iso(44), ends_at: iso(50), zip: "94102",
    lat: 37.7835, lon: -122.4152, address: "000 Example Blvd (NOT A REAL SITE)",
    languages: ["en", "es", "zh-Hans"], tags: ["delivery", "shelf_stable", "halal"],
    access_tags: ["wheelchair"],
    notes: "Call ahead to be added to the route", requirements: "", cancelled: 0,
    source: "dev-seed", updated_at: now,
  },
];

await client.insert({ table: "pantry_events", values: events, format: "JSONEachRow" });

// Programs render their own apply form from `fields`, so adding a real program
// later is a data change, not a code change.
const L = (en, zh, es) => ({ en, "zh-Hans": zh, es });

const programs = [
  {
    program_id: "dev-prog-calfresh",
    name: "DEV SEED - CalFresh application help",
    provider: "Example Community Org (NOT REAL)",
    kind: "calfresh",
    summary: "Help filling out a CalFresh (SNAP) application. Someone calls you back.",
    pantry_id: "",
    zip_scope: [],
    languages: ["en", "es", "zh-Hans"],
    requirements: "",
    processing_days: 30,
    fields: JSON.stringify([
      {
        key: "household_size", type: "select", required: true,
        options: ["1", "2-3", "4-5", "6+"],
        label: L("How many people in your household?", "您家中有几口人？", "¿Cuántas personas hay en su hogar?"),
      },
      {
        key: "callback", type: "tel", required: true,
        label: L("Best number to call you", "最方便联系您的号码", "Mejor número para llamarle"),
        help: L("We only use this for your application.", "仅用于您的申请。", "Solo lo usamos para su solicitud."),
      },
      {
        key: "interpreter", type: "checkbox",
        label: L("I would like an interpreter", "我需要口译员", "Quiero un intérprete"),
      },
    ]),
    external_url: "", active: 1, updated_at: now,
  },
  {
    program_id: "dev-prog-delivery",
    name: "DEV SEED - Home grocery delivery",
    provider: "Example Delivery Route (NOT REAL)",
    kind: "delivery",
    summary: "Weekly groceries delivered if leaving home is hard.",
    pantry_id: "dev-3",
    zip_scope: ["94102", "94103", "94110"],
    languages: ["en", "es", "zh-Hans"],
    requirements: "",
    processing_days: 7,
    fields: JSON.stringify([
      {
        key: "address", type: "text", required: true,
        label: L("Delivery address", "送货地址", "Dirección de entrega"),
      },
      {
        key: "access_notes", type: "textarea",
        label: L("Anything the driver should know?", "配送员需要知道什么？", "¿Algo que el conductor deba saber?"),
        help: L("Stairs, buzzer, best time of day.", "楼梯、门铃、最佳时间。", "Escaleras, timbre, mejor hora."),
      },
    ]),
    external_url: "", active: 1, updated_at: now,
  },
  {
    program_id: "dev-prog-senior",
    name: "DEV SEED - Senior food box",
    provider: "Example Senior Services (NOT REAL)",
    kind: "senior_box",
    summary: "A monthly box of shelf-stable food for people 60 and over.",
    pantry_id: "dev-1",
    zip_scope: [],
    languages: ["en", "zh-Hans"],
    requirements: "Proof of age (any document showing date of birth)",
    processing_days: 14,
    fields: JSON.stringify([
      {
        key: "birth_year", type: "text", required: true,
        label: L("Year you were born", "您的出生年份", "Año de nacimiento"),
      },
    ]),
    external_url: "", active: 1, updated_at: now,
  },
];

await client.insert({ table: "programs", values: programs, format: "JSONEachRow" });

console.log(
  `Seeded ${rows.length} DEV pantries, ${events.length} DEV events, ` +
    `${programs.length} DEV programs. Do not ship these.`,
);
await client.close();
