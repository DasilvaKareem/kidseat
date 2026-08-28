# SF FOOD

SMS-first free-food discovery for San Francisco and Marin. Three languages,
five screens, no account. Analytics in ClickHouse; staff ask questions of it
through LibreChat.

## Two databases, one rule

Postgres holds rows that **change**. ClickHouse holds rows that are only ever
**appended**.

That single question decides where anything lives, and it is not a preference —
each store is bad at the other's job. The pantry and program catalog and the
applications people submit go in Postgres, because they are edited: hours move,
a program is deactivated, an application goes from `submitted` to `withdrawn`.
Those need a foreign key so an application cannot point at a program that does
not exist, a `CHECK` so a status cannot drift to a typo, and a real `UPDATE`.

Consents, message events, onboarding funnel steps, and application state
transitions go in ClickHouse, because nothing there is ever revised and the
analyst queries are scans — "signups by day and locale" over every row, not a
lookup of one. That is what a column store is for.

Applications used to live in ClickHouse, where withdrawing meant inserting a
whole new copy of the row and trusting `ReplacingMergeTree` to collapse it
later. That is a workaround for a missing `UPDATE`, and it raced with itself.
It is one statement in Postgres now.

The two stores join on `phone_hash`, the same HMAC in both, so neither holds a
phone number. Schemas: `db/postgres/schema.sql`, `db/clickhouse/schema.sql`.

## Why SMS

The people this serves have phones, not smartphones with spare data. Everything
after signup happens over plain text: `FOOD` finds sites now, `CHECK` screens for the programs behind it, `STOP` quits.

## Stack

| Piece | Choice |
|---|---|
| Web app | Next.js 16 App Router on Vercel — SMS onboarding at `/`, map at `/map` |
| Data (state) | Neon Postgres — catalog, programs, applications |
| Data (events) | ClickHouse Cloud — consent, messaging, funnel analytics |
| SMS | provider-agnostic — Telnyx / Twilio / `console` for dev |
| Model | Gemini via Vercel AI Gateway, with tools |
| Places + routing | Google Maps Platform (Places API New, Routes API) |
| Internal analytics | LibreChat + ClickHouse MCP |

## Setup

```bash
cp .env.example .env.local
```

Generate the secrets:

```bash
printf 'PHONE_HASH_KEY=%s\nPHONE_ENC_KEY=%s\nSESSION_SECRET=%s\nCRON_SECRET=%s\n' "$(openssl rand -base64 32)" "$(openssl rand -base64 32)" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)"
```

Paste those into `.env.local`, add your ClickHouse URL and password, then:

```bash
npm run pg:push && npm run db:push && npm run db:seed && npm run dev
```

`SMS_PROVIDER=console` is the default, so nothing is sent — outbound messages
print to the terminal with their encoding and segment count.

## How the flow works

```
language ──▶ phone + consent ──▶ ZIP ──▶ household ──▶ needs ──▶ done
                   │                │        (skip)     (skip)     │
                   │                └──▶ out of area ──▶ 211       │
                   ▼                                               ▼
          consent row written                        extra questions (optional)
          confirm SMS sent  ──▶  reply YES  ──▶  active            │
                             ──▶  no reply  ──▶  one reminder      ▼
                                                        what you may qualify for
```

There is no code-entry screen. The first outbound SMS *is* the double opt-in,
which is both carrier-compliant and one fewer screen to abandon.

The extra questions come after "you're signed up", never before it. Pantries and
dining rooms need no eligibility at all, so the service can hand over something
useful before it asks anything — and the alerts are already theirs whether or
not they answer.

## The map app (`/map`)

A Zillow-style split: pins on the right, a synced list on the left, both driven
by the same viewport query so they always describe the same set. Panning does
not auto-refetch — a "Search this area" pill appears instead, because auto-query
on every pan burns mobile data for people who may be metered.

```
header      language · sign in
filters     Pantries · Events · Today · No ID needed · dietary tags
list        event cards first, then pantries          map   pins
detail      hours, directions, call, programs         →     Apply
chat bar    signed in only
```

Events outrank pantries in both the sort and the pin styling. A time you can
show up at is worth more than a general listing.

### Applications

`programs` are things a person can apply to — CalFresh help, a delivery route,
a senior box, registration at one site. Each program carries its own `fields`
JSON, and the apply form is rendered from it, so **adding a program is a data
change, not a code change**. Answers are validated server-side against that
same definition, and any key the program did not ask for is dropped rather than
stored.

### Sign-in

Phone number plus a 6-digit SMS code. No password, no email — the audience is
already phone-first, and the number is the identity the SMS side already uses.

Sign-in deliberately never touches ClickHouse. Both the OTP challenge and the
session live in signed, httpOnly cookies, with the attempt counter inside the
signed challenge so it cannot be rolled back to brute-force six digits. That
matters here: a cold ClickHouse Cloud service takes ~20s to wake, and nobody
should wait that long to read their own application status.

`/api/auth/start` returns the same response whether or not the number is known,
so it cannot be used to test whether someone uses a food bank.

> **Clerk is the recommended integration** for this stack (`vercel integration
> add clerk`), and it supports phone/SMS auth. I went with the built-in flow
> because it reuses the existing subscriber record and consent trail rather than
> standing up a second identity system. Everything auth-related is behind
> `lib/session.ts`, so swapping is a contained change.

### The chat bar

Signed-in only, because it can read the person's own applications. It gets the
agent's five tools, the two screening tools, plus `list_programs` and
`my_applications` — the last one so
it never tells someone to re-apply to a program they are already in. It sees
application *statuses* only, never the answers someone typed about their
household.

## How the agent answers "FOOD"

An inbound `FOOD`, or any free text from a confirmed subscriber, runs a tool
loop scoped to that one person's ZIP, coordinates, and stated needs
([lib/agent.ts](lib/agent.ts)):

```
find_events        our curated distributions, with real start/end times   ← try first
find_pantries      our curated standing sites
search_google_maps Places text search near them                           ← discovery
get_place_hours    full weekly hours for one place
walking_time       Routes API walking ETA, for "hard to travel"
```

Order matters. A Google listing for the church that runs a Thursday pantry
shows the *church office's* hours, not the distribution window — so curated
events win, and anything sourced from Maps is labelled approximate with a phone
number attached.

The model never picks results from memory: it may only use facts a tool
returned, and if every tool comes back empty it says so. If the model errors,
runs over budget, or has no API key, the caller falls back to a deterministic
render of the same data — a person who texts FOOD always gets an answer.

Results messages get a wider budget than the notification templates (320 chars
Latin / 200 Chinese, so 2–3 segments) and carry at most one `maps.google.com`
link, for the closest option.

### Finding more than a pantry

A pantry solves today. CalFresh, WIC, a senior box, or a delivery route solves
the month — and most people never find out they qualify. Text `CHECK` (or
`BENEFITS`, or `CALFRESH`) and the agent walks a screening: eight core questions
plus up to three conditional ones, one per message, any of them skippable.

```
household size ─▶ benefits you already get ─▶ income band ─▶ 60+? ─▶ pregnant?
   ─▶ children? ─▶ disability? ─▶ where you're staying
        │
        ├─ (no kitchen or not your own place) ─▶ fridge and stove?
        ├─ (on Medi-Cal)                      ─▶ nutrition-sensitive condition?
        └─ always last, optional              ─▶ language and dietary needs
```

The question bank ([lib/screening.ts](lib/screening.ts)) is shared: the SMS flow
and the web section render the same questions, in the same order, with the same
conditional branches. The routing table ([lib/eligibility.ts](lib/eligibility.ts))
turns the answers into referrals across CalFresh, the Restaurant Meals Program,
WIC, CSFP senior boxes, SUN Bucks, universal school meals, CalAIM medically
supportive food, home-delivered groceries, and the always-open pantries and
dining rooms.

Three things this is careful about:

**Income is a band, never a figure.** Every program keys on a percentage of the
federal poverty level, so the only question is which side of 130 / 165 / 185 /
200% someone falls on. The bands are generated from household size, so a family
of four sees the edges that apply to a family of four. Nobody is asked for a pay
stub, and no dollar figure is stored.

**Immigration status is not a routing input.** It is sensitive personal
information under California AB 947, it suppresses enrollment, and pantries,
WIC, school meals, SUN Bucks, and CSFP do not screen on it. The one exception is
an optional CalFresh-specific yes/no branch, asked last, that the person can
skip with no effect on anything we send — and its answer is stripped before any
write, so it never reaches storage even transiently.

**It estimates, it does not decide.** Referrals come back as *likely* or
*maybe*, never *yes*, and every message says the county decides. Two federal
rules changed in 2026 — H.R.1 narrowed CalFresh noncitizen eligibility on April
1, and the ABAWD work rules resumed June 1 — so referrals that touch either
carry a verify-live caveat instead of a promise. `lib/eligibility.ts` records
when the rule table was last reviewed and `/api/health` reports how stale it is.

The negative rules matter as much as the positive ones. The screening will
refuse to tell a working-age CalFresh recipient with no disability that they can
spend EBT at a restaurant, refuse to sell CalAIM meals as a fix for food
insecurity, and volunteer that school meals are free for every California
student regardless of income.

### What a screening leaves behind

Route transiently, persist minimally. While the questions are being answered the
raw answers live in `screenings.answers`, because an SMS conversation spans
hours. The moment it finishes, that column is cleared and what remains is coarse
flags (`senior`, `has_kids`, `no_kitchen`) and which programs the person was
pointed at. No income band, no housing status, no disability answer, and never
the citizenship branch. The web section never persists answers at all — the
browser holds them, `/api/screening` routes on them, and only the outcome is
written.

A screening is mutable state — one row per person, rewritten on every reply —
so it lives in Postgres with the catalog and applications, not in ClickHouse.
That makes "a finished screening holds no answers" a CHECK constraint rather
than a promise the calling code keeps, but it also costs the column TTL that
used to erase abandoned screenings on its own. `sweepScreeningAnswers()` does
that job now, from the daily cron: answers untouched for two days are erased,
rows are dropped at 400 days. **If the cron stops running, answers stop being
erased** — the endpoint returns its sweep counts so a run that silently stopped
is visible in the logs.

Analysts get `v_screening_outcomes`: completion rate and referral mix by day and
language, with no per-person row.

### Events vs. hours

A distribution is an event, not a set of opening hours. `pantry_events` holds
mobile pantries, weekly pop-ups, and holiday distributions with a real
`starts_at`/`ends_at`, rendered in Pacific time as "Today 2 PM-4 PM" in the
person's language.

### Directions, transit, and accessibility

The detail panel offers Walk / Transit / Drive / Bike via the Routes API, and
for transit the two preferences Google actually exposes: **Less walking** and
**Fewer transfers**.

**Google's Routes API has no wheelchair-accessible transit filter** — the
consumer Maps app has one, the API does not. So the UI says plainly that "less
walking" is not the same as a step-free route, and tells people to call ahead if
they need one. Do not let that caveat get edited out.

Accessibility comes from two places:

- **`access_tags` on our own rows** — `wheelchair`, `step_free`,
  `accessible_restroom`, `seating`, `near_transit`, `parking`, `asl`,
  `service_animal_ok`. This is authoritative: Google knows a venue's front door,
  it does not know the pantry runs out of the step-free side entrance.
- **Places `accessibilityOptions`** — entrance, parking, restroom, seating —
  used to enrich sites we have not curated.

**An absent tag means unknown, never "no."** The UI renders "Not listed — call
to check", and the accessibility filter only ever shows places that positively
claim access. Rendering unknown as inaccessible decides for someone whether a
trip is worth attempting, which is not our call to make.

`/api/directions` is a POST, not a GET, because the body carries the person's
live coordinates and those do not belong in a URL that lands in access logs and
browser history. Location is requested only on an explicit tap, never on mount,
and falls back to the ZIP centroid when refused. If the Routes API is
unavailable the endpoint still returns a working Google Maps deep link with the
travel mode preselected — the Maps app knows where they are even when we do not.

### Maps cost and caching

Places responses are cached in ClickHouse — 24h for searches, 7 days for place
details — with a 30-day TTL on the table. That's a compliance control as much
as a cost one: Google's terms allow storing place IDs indefinitely but cap other
Places content at 30 days.

Maps is optional. With `GOOGLE_MAPS_API_KEY` unset, the agent still answers from
`pantries` and `pantry_events`; it just cannot discover sites it doesn't
already know about.

## Privacy model

`phone_hash` (HMAC-SHA256) is the join key in every table. `phone_enc`
(AES-256-GCM) lives on exactly one table and is read only by the send path.
Nothing in ClickHouse can be reversed to a phone number, and the LibreChat
analyst user is granted access to the `v_*` views only.

`consents` is append-only. It stores the exact consent string the person read,
in the language they read it in, at the moment they tapped Continue — not a
pointer to a template that will change later. That row is the artifact you
produce if a TCPA complaint ever lands.

Location precision stops at the ZIP centroid. The service never asks for a
street address.

## Before this can text a real person

1. **A2P 10DLC registration.** Register the brand and campaign with the
   provider. Unregistered traffic to US carriers is filtered or blocked.
2. **Real pantry data.** `npm run db:seed` loads obviously-fake fixtures.
   Run `npm run db:import` to replace them with live sites from the SF-Marin
   Food Bank locator, and read what it prints: the needs it reports as having
   zero matching sites are needs the service cannot answer yet. Google Maps fills gaps but
   is not a substitute — it has no idea when a distribution actually happens.
3. **A shared rate limiter.** `lib/ratelimit.ts` is per-instance and will not
   stop SMS pumping across regions. Move it to Redis or provider-side controls.
4. **A review of the eligibility rules.** `lib/eligibility.ts` carries a
   `RULES_REVIEWED` date and `/api/health` reports its age. The CalFresh
   noncitizen rules (H.R.1, April 2026) and ABAWD time limits (June 2026) are
   the two the screener deliberately refuses to assert — confirm the current
   state with CDSS before loosening those caveats. The FPL constants in
   `lib/screening.ts` update every October; `npm run smoke` pins the published
   figures so a stale table fails CI rather than quoting last year's money.
5. **Legal review of the data model** if anything beyond aggregate reporting is
   planned. See below.

## A note on monetization

The schema here supports aggregate program reporting — signups by ZIP, funnel by
language, cost per confirmed subscriber. It deliberately does not support
selling individual-level records about food-insecure people, which is why
`phone_hash` is one-way and the analyst role is view-scoped.

If that changes, it needs counsel first, not a migration: FTC Act §5, the
California Delete Act and data-broker registration, CCPA/CPRA, and USDA
7 CFR 272.1(c) all bear on it. Aggregate insights and government service
contracts are the version of this business that does not require rebuilding
the trust model.

## Commands

```bash
npm run dev          # local, SMS to console
npm run pg:push      # apply db/postgres/schema.sql (idempotent)
npm run db:push      # apply db/clickhouse/schema.sql (idempotent)
npm run db:seed      # dev pantry fixtures
npm run db:import    # real SF + Marin sites; --dry-run to preview
npm run check:sms    # fail if any SMS template exceeds 2 segments
npm run smoke        # phone, crypto, keyword, segment, and event-time checks
npm run test         # all three
npm run typecheck
```

See `librechat/README.md` for the analyst setup.
