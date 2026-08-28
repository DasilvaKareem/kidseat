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

-- ---------------------------------------------------------------------------
-- Programs and applications
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Eligibility screening
-- ---------------------------------------------------------------------------
-- Not here. A screening is one row per person rewritten on every reply, and it
-- moves in_progress -> complete or abandoned, so it belongs with the other
-- mutable state in db/postgres/schema.sql. Storing it here meant re-inserting
-- the whole row on each SMS and leaning on ReplacingMergeTree to tidy up.

-- ---------------------------------------------------------------------------
-- Applications: analytics only
-- ---------------------------------------------------------------------------
-- The applications themselves live in Postgres, which owns their current
-- state. What lands here is the history of that state changing -- one
-- append-only row per transition, never revised. That is the shape the analyst
-- views want anyway: "how many applications reached approved, by week and
-- locale" is a scan, not a lookup.
--
-- Deliberately no `answers`. Those are what someone wrote about their own
-- household, and they stay in Postgres behind the app.
CREATE TABLE IF NOT EXISTS sffood.application_events
(
    event_id        UUID,
    application_id  UUID,
    phone_hash      String,
    program_id      String,
    status          LowCardinality(String),  -- submitted|in_review|approved|denied|withdrawn
    locale          LowCardinality(String),
    created_at      DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (program_id, created_at);

CREATE OR REPLACE VIEW sffood.v_application_funnel AS
SELECT toDate(created_at) AS day,
       program_id,
       locale,
       status,
       count() AS applications
FROM sffood.application_events
GROUP BY day, program_id, locale, status;
