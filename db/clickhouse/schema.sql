-- SF FOOD — ClickHouse schema
-- Run: clickhouse client --queries-file db/clickhouse/schema.sql
--   or: npm run db:push
--
-- Privacy contract: no raw phone number is ever stored in a queryable column.
-- `phone_hash` (HMAC-SHA256) is the join key across every table. `phone_enc`
-- (AES-256-GCM) exists on exactly one table and is only ever read by the send
-- path. Anything pointed at this database for analytics — including LibreChat —
-- should query the v_* views, which do not expose phone_enc at all.

CREATE DATABASE IF NOT EXISTS sffood;

-- One row per person. ReplacingMergeTree: re-onboarding updates in place.
CREATE TABLE IF NOT EXISTS sffood.subscribers
(
    phone_hash        String,
    phone_enc         String,
    locale            LowCardinality(String),
    zip               FixedString(5),
    lat               Nullable(Float64),
    lon               Nullable(Float64),
    household_bucket  LowCardinality(String) DEFAULT '',
    needs             Array(LowCardinality(String)) DEFAULT [],
    status            LowCardinality(String),  -- pending|active|stopped|bounced|waitlist
    created_at        DateTime64(3, 'UTC'),
    confirmed_at      Nullable(DateTime64(3, 'UTC')),
    stopped_at        Nullable(DateTime64(3, 'UTC')),
    updated_at        DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY phone_hash;

-- Append-only. Never UPDATE, never DELETE. This is the TCPA evidence trail:
-- the exact consent string the person saw, at the moment they tapped Continue.
CREATE TABLE IF NOT EXISTS sffood.consents
(
    consent_id       UUID,
    phone_hash       String,
    locale           LowCardinality(String),
    consent_version  LowCardinality(String),
    consent_text     String,
    ip_hash          String,
    user_agent       String,
    source           LowCardinality(String),  -- web_onboarding|sms_start
    created_at       DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (phone_hash, created_at);

-- Funnel. Keyed on an ephemeral session id so drop-off is measurable without
-- needing a phone number for people who never finish.
CREATE TABLE IF NOT EXISTS sffood.onboarding_events
(
    event_id    UUID,
    session_id  String,
    step        LowCardinality(String),  -- language|phone|zip|household|needs|done|out_of_area|screening|results
    action      LowCardinality(String),  -- view|submit|skip|back|error
    locale      LowCardinality(String),
    detail      String DEFAULT '',
    created_at  DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (created_at, session_id)
TTL toDateTime(created_at) + INTERVAL 400 DAY;

CREATE TABLE IF NOT EXISTS sffood.message_events
(
    event_id      UUID,
    phone_hash    String,
    direction     LowCardinality(String),  -- outbound|inbound
    template_key  LowCardinality(String) DEFAULT '',
    locale        LowCardinality(String),
    body          String DEFAULT '',       -- inbound only; outbound is template_key
    encoding      LowCardinality(String) DEFAULT '',
    segments      UInt8 DEFAULT 0,
    provider      LowCardinality(String) DEFAULT '',
    provider_id   String DEFAULT '',
    status        LowCardinality(String) DEFAULT '',
    error         String DEFAULT '',
    created_at    DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (created_at, phone_hash);

-- Distribution sites. Loaded from SF-Marin Food Bank / DataSF / 211 feeds.
CREATE TABLE IF NOT EXISTS sffood.pantries
(
    pantry_id     String,
    name          String,
    address       String,
    zip           FixedString(5),
    lat           Float64,
    lon           Float64,
    phone         String DEFAULT '',
    hours         String DEFAULT '',       -- human-readable, sent verbatim over SMS
    open_days     Array(UInt8) DEFAULT [], -- 0=Sun
    languages     Array(LowCardinality(String)) DEFAULT [],
    tags          Array(LowCardinality(String)) DEFAULT [], -- shelf_stable|prepared|delivery|halal|kosher|baby
    requirements  String DEFAULT '',       -- '' means no ID / no docs
    active        UInt8 DEFAULT 1,
    source        LowCardinality(String) DEFAULT '',
    updated_at    DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY pantry_id;

-- ---------------------------------------------------------------------------
-- Views. Point LibreChat at these, not at the base tables.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW sffood.v_subscribers AS
SELECT phone_hash, locale, zip, household_bucket, needs, status,
       created_at, confirmed_at, stopped_at
FROM sffood.subscribers FINAL;

CREATE OR REPLACE VIEW sffood.v_daily_signups AS
SELECT toDate(created_at) AS day,
       locale,
       zip,
       countIf(status != 'waitlist')                       AS started,
       countIf(confirmed_at IS NOT NULL)                    AS confirmed,
       countIf(status = 'stopped')                          AS stopped
FROM sffood.subscribers FINAL
GROUP BY day, locale, zip;

CREATE OR REPLACE VIEW sffood.v_funnel AS
SELECT toDate(created_at) AS day,
       locale,
       step,
       uniqExactIf(session_id, action = 'view')   AS reached,
       uniqExactIf(session_id, action = 'submit') AS completed,
       uniqExactIf(session_id, action = 'skip')   AS skipped,
       uniqExactIf(session_id, action = 'error')  AS errored
FROM sffood.onboarding_events
GROUP BY day, locale, step;

CREATE OR REPLACE VIEW sffood.v_sms_cost AS
SELECT toDate(created_at) AS day,
       locale,
       direction,
       encoding,
       count()          AS messages,
       sum(segments)    AS segments
FROM sffood.message_events
GROUP BY day, locale, direction, encoding;

-- ---------------------------------------------------------------------------
-- Events and Maps
-- ---------------------------------------------------------------------------

-- A distribution is an event, not a set of opening hours. Mobile pantries,
-- weekly pop-ups, and holiday distributions all have a start and an end, and a
-- Google listing for the host building will never show them.
--
-- pantry_id links to pantries.pantry_id for curated sites, or carries a
-- 'gmaps:<place_id>' prefix for a site that only exists in Google's data.
CREATE TABLE IF NOT EXISTS sffood.pantry_events
(
    event_id      String,
    pantry_id     String,
    title         String,
    starts_at     DateTime('UTC'),
    ends_at       DateTime('UTC'),
    zip           FixedString(5),
    lat           Float64,
    lon           Float64,
    address       String,
    languages     Array(LowCardinality(String)) DEFAULT [],
    tags          Array(LowCardinality(String)) DEFAULT [],
    notes         String DEFAULT '',
    requirements  String DEFAULT '',
    cancelled     UInt8 DEFAULT 0,
    source        LowCardinality(String) DEFAULT '',
    updated_at    DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY event_id;

-- Google Places responses. Their terms allow place IDs to be stored
-- indefinitely but cap other Places content at 30 days, so the TTL below is a
-- compliance control, not just a cost control.
CREATE TABLE IF NOT EXISTS sffood.places_cache
(
    cache_key   String,
    payload     String,
    fetched_at  DateTime('UTC')
)
ENGINE = ReplacingMergeTree(fetched_at)
ORDER BY cache_key
TTL fetched_at + INTERVAL 30 DAY;

CREATE OR REPLACE VIEW sffood.v_upcoming_events AS
SELECT event_id, pantry_id, title, starts_at, ends_at, zip, lat, lon, address,
       languages, tags, notes, requirements, source
FROM sffood.pantry_events FINAL
WHERE cancelled = 0
  AND ends_at > now();

-- ---------------------------------------------------------------------------
-- Programs and applications
-- ---------------------------------------------------------------------------

-- Things a person can apply to: CalFresh, home delivery routes, senior boxes,
-- WIC, or registration at a specific site. A program may hang off a pantry
-- (pantry_id set) or stand on its own.
CREATE TABLE IF NOT EXISTS sffood.programs
(
    program_id       String,
    name             String,
    provider         String,
    kind             LowCardinality(String),  -- calfresh|delivery|senior_box|wic|registration|summer_meals|other
    summary          String,
    pantry_id        String DEFAULT '',
    zip_scope        Array(String) DEFAULT [],   -- empty = whole service area
    languages        Array(LowCardinality(String)) DEFAULT [],
    requirements     String DEFAULT '',
    processing_days  UInt16 DEFAULT 0,
    -- JSON array of field definitions; the apply form is rendered from this so
    -- a new program needs no code change.
    fields           String DEFAULT '[]',
    external_url     String DEFAULT '',
    active           UInt8 DEFAULT 1,
    updated_at       DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY program_id;

CREATE TABLE IF NOT EXISTS sffood.applications
(
    application_id  UUID,
    phone_hash      String,
    program_id      String,
    status          LowCardinality(String),  -- submitted|in_review|approved|denied|withdrawn
    answers         String DEFAULT '{}',     -- JSON, keyed by field key
    note            String DEFAULT '',
    locale          LowCardinality(String) DEFAULT '',
    created_at      DateTime64(3, 'UTC'),
    updated_at      DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY application_id;

CREATE OR REPLACE VIEW sffood.v_applications AS
SELECT application_id, phone_hash, program_id, status, locale, created_at, updated_at
FROM sffood.applications FINAL;

-- Answers can contain what someone wrote about their own household. Analysts
-- get counts and statuses; the free text stays out of the view.
CREATE OR REPLACE VIEW sffood.v_application_funnel AS
SELECT toDate(created_at) AS day,
       program_id,
       locale,
       status,
       count() AS applications
FROM sffood.applications FINAL
GROUP BY day, program_id, locale, status;

-- ---------------------------------------------------------------------------
-- Eligibility screening
-- ---------------------------------------------------------------------------

-- One row per person, replaced as they answer. `answers` is the only place raw
-- screening answers exist, and it is deliberately short-lived: the column TTL
-- blanks it two days after the last reply, and completeScreening() clears it
-- the moment the routing is computed. What survives is `flags` (coarse
-- categories like senior or has_kids) and `referrals` (which programs the
-- person was pointed at) — enough to report on, not enough to profile.
--
-- Immigration status is never asked as a routing gate, and the one optional
-- CalFresh citizenship branch is stripped in lib/screenings.ts before any
-- write, so it cannot appear in this table even transiently.
CREATE TABLE IF NOT EXISTS sffood.screenings
(
    phone_hash  String,
    locale      LowCardinality(String),
    status      LowCardinality(String),  -- in_progress|complete|abandoned
    answers     String DEFAULT '' TTL toDateTime(updated_at) + INTERVAL 2 DAY,
    flags       Array(LowCardinality(String)) DEFAULT [],
    referrals   Array(LowCardinality(String)) DEFAULT [],
    misses      UInt8 DEFAULT 0,         -- consecutive unparsed replies
    started_at  DateTime64(3, 'UTC'),
    updated_at  DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY phone_hash
TTL toDateTime(updated_at) + INTERVAL 400 DAY;

-- Which programs the screening sends people to, and where it stalls. No
-- answers, no flags per person — the analyst sees rates, not people.
CREATE OR REPLACE VIEW sffood.v_screening_outcomes AS
SELECT toDate(started_at) AS day,
       locale,
       status,
       count()                                   AS screenings,
       countIf(has(referrals, 'calfresh'))       AS to_calfresh,
       countIf(has(referrals, 'wic'))            AS to_wic,
       countIf(has(referrals, 'csfp'))           AS to_senior_box,
       countIf(has(referrals, 'sun_bucks'))      AS to_sun_bucks,
       countIf(has(referrals, 'hdg'))            AS to_delivery,
       countIf(has(referrals, 'rmp'))            AS to_restaurant_meals,
       countIf(length(referrals) <= 1)           AS nothing_beyond_pantries
FROM sffood.screenings FINAL
GROUP BY day, locale, status;
