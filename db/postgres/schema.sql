-- Postgres: the system of record for mutable state.
--
-- Everything here is edited in place -- a pantry changes its hours, a program
-- is deactivated, an application moves from submitted to withdrawn. That is
-- what earns the relational constraints below: an application cannot reference
-- a program that does not exist, and status cannot drift to a typo.
--
-- The append-only half of the system (consents, message_events,
-- onboarding_events, places_cache) stays in ClickHouse. See
-- db/clickhouse/schema.sql.
--
-- Idempotent: safe to re-run. Applied by `npm run pg:push`.

-- Distribution sites. Loaded from SF-Marin Food Bank / DataSF / 211 feeds.
CREATE TABLE IF NOT EXISTS pantries (
    pantry_id     text PRIMARY KEY,
    name          text NOT NULL,
    address       text NOT NULL DEFAULT '',
    zip           char(5) NOT NULL,
    lat           double precision NOT NULL,
    lon           double precision NOT NULL,
    phone         text NOT NULL DEFAULT '',
    hours         text NOT NULL DEFAULT '',        -- human-readable, sent verbatim over SMS
    open_days     smallint[] NOT NULL DEFAULT '{}', -- 0=Sun
    languages     text[] NOT NULL DEFAULT '{}',
    tags          text[] NOT NULL DEFAULT '{}',    -- shelf_stable|prepared|delivery|halal|kosher|baby
    requirements  text NOT NULL DEFAULT '',        -- '' means no ID / no docs
    active        boolean NOT NULL DEFAULT true,
    source        text NOT NULL DEFAULT '',
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pantries_active_zip ON pantries (zip) WHERE active;

-- A dated distribution. pantry_id is deliberately NOT a foreign key: an event
-- may carry a 'gmaps:<place_id>' id for a site that exists only in Google's
-- data and has no curated pantries row.
CREATE TABLE IF NOT EXISTS pantry_events (
    event_id      text PRIMARY KEY,
    pantry_id     text NOT NULL,
    title         text NOT NULL DEFAULT '',
    starts_at     timestamptz NOT NULL,
    ends_at       timestamptz NOT NULL,
    zip           char(5) NOT NULL,
    lat           double precision NOT NULL,
    lon           double precision NOT NULL,
    address       text NOT NULL DEFAULT '',
    languages     text[] NOT NULL DEFAULT '{}',
    tags          text[] NOT NULL DEFAULT '{}',
    notes         text NOT NULL DEFAULT '',
    requirements  text NOT NULL DEFAULT '',
    cancelled     boolean NOT NULL DEFAULT false,
    source        text NOT NULL DEFAULT '',
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pantry_events_window CHECK (ends_at >= starts_at)
);

-- Every read of this table is "what is on soon, not cancelled".
CREATE INDEX IF NOT EXISTS pantry_events_upcoming
    ON pantry_events (starts_at) WHERE NOT cancelled;

-- Things a person can apply to: CalFresh, home delivery routes, senior boxes,
-- WIC, or registration at a specific site. A program may hang off a pantry or
-- stand on its own, in which case pantry_id is NULL.
CREATE TABLE IF NOT EXISTS programs (
    program_id       text PRIMARY KEY,
    name             text NOT NULL,
    provider         text NOT NULL DEFAULT '',
    kind             text NOT NULL,
    summary          text NOT NULL DEFAULT '',
    pantry_id        text REFERENCES pantries (pantry_id) ON DELETE SET NULL,
    zip_scope        text[] NOT NULL DEFAULT '{}',  -- empty = whole service area
    languages        text[] NOT NULL DEFAULT '{}',
    requirements     text NOT NULL DEFAULT '',
    processing_days  integer NOT NULL DEFAULT 0,
    -- Field definitions for the apply form, so a new program needs no code
    -- change. jsonb, not text: malformed definitions are rejected on write
    -- rather than swallowed by a try/catch on every read.
    fields           jsonb NOT NULL DEFAULT '[]'::jsonb,
    external_url     text NOT NULL DEFAULT '',
    active           boolean NOT NULL DEFAULT true,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT programs_fields_is_array CHECK (jsonb_typeof(fields) = 'array')
);

CREATE INDEX IF NOT EXISTS programs_active ON programs (kind, name) WHERE active;

-- What someone submitted, and where it stands. phone_hash is the same HMAC
-- join key ClickHouse uses, so the two stores line up on a person without
-- either of them holding a phone number.
CREATE TABLE IF NOT EXISTS applications (
    application_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_hash      text NOT NULL,
    program_id      text NOT NULL REFERENCES programs (program_id) ON DELETE RESTRICT,
    status          text NOT NULL DEFAULT 'submitted',
    answers         jsonb NOT NULL DEFAULT '{}'::jsonb,
    note            text NOT NULL DEFAULT '',
    locale          text NOT NULL DEFAULT '',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT applications_status CHECK (
        status IN ('submitted', 'in_review', 'approved', 'denied', 'withdrawn')
    )
);

-- Every read is "this person's applications, newest first".
CREATE INDEX IF NOT EXISTS applications_by_person
    ON applications (phone_hash, created_at DESC);
