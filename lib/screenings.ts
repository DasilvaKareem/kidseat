import { pgQuery } from "./postgres";
import type { Locale } from "./i18n";
import {
  type Answers, type Question, coarseFlags, forStorage, nextQuestion,
} from "./screening";
import { route, type Routing } from "./eligibility";

/**
 * Storage for a screening in progress.
 *
 * The design rule is route transiently, persist minimally. While the questions
 * are being answered the raw answers have to live somewhere — an SMS
 * conversation spans hours, not one request — so they sit in `answers` until
 * the screening ends or the sweep below erases them, whichever comes first.
 * The moment the screening finishes, that column is cleared and only coarse
 * flags and the referral list remain; the table's own CHECK constraint refuses
 * a finished row that still holds answers.
 *
 * One row per person, updated in place. Every write here is an UPDATE or an
 * upsert on the primary key, so `started_at` is written once and a reply never
 * has to re-send the columns it is not changing.
 */

export type ScreeningStatus = "in_progress" | "complete" | "abandoned";

export type Screening = {
  phone_hash: string;
  locale: string;
  status: ScreeningStatus;
  answers: Answers;
  flags: string[];
  referrals: string[];
  misses: number;
  started_at: string;
  updated_at: string;
};

// A screening left half-answered overnight is not a screening any more: the
// next inbound text is far more likely to be "where can I eat" than an answer
// to a question asked yesterday.
const RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;

// How long raw answers may sit in a screening nobody came back to finish.
const ANSWER_TTL_DAYS = 2;

// And how long the coarse flags and referrals stay after that.
const ROW_TTL_DAYS = 400;

const STAMPS = `to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS started_at,
                to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS updated_at`;

const COLS = `phone_hash, locale, status, answers, flags, referrals, misses, ${STAMPS}`;

export async function getScreening(phoneHash: string): Promise<Screening | null> {
  const rows = await pgQuery<Screening>(
    `SELECT ${COLS} FROM screenings WHERE phone_hash = $1`,
    [phoneHash],
  );
  return rows[0] ?? null;
}

/**
 * `answers` is jsonb with a CHECK that it is an object, so it arrives parsed
 * and already the right shape — no JSON.parse, and no try/catch around one.
 */
export function parseAnswers(row: Screening | null): Answers {
  return row?.answers ?? {};
}

/** An in-progress screening the next inbound message should be read against. */
export function isLive(row: Screening | null, now: Date = new Date()): boolean {
  if (!row || row.status !== "in_progress") return false;
  const updated = Date.parse(row.updated_at.replace(" ", "T") + "Z");
  return Number.isFinite(updated) && now.getTime() - updated < RESUME_WINDOW_MS;
}

export async function startScreening(
  phoneHash: string,
  locale: Locale,
): Promise<{ answers: Answers; question: Question | null }> {
  // Someone who screened months ago and texts CHECK again is starting over,
  // not resuming, so the conflict path resets the clock and every column with
  // it. started_at is the database's to assign in both branches.
  await pgQuery(
    `INSERT INTO screenings (phone_hash, locale, status)
     VALUES ($1, $2, 'in_progress')
     ON CONFLICT (phone_hash) DO UPDATE
        SET locale     = EXCLUDED.locale,
            status     = 'in_progress',
            answers    = '{}'::jsonb,
            flags      = '{}',
            referrals  = '{}',
            misses     = 0,
            started_at = now(),
            updated_at = now()`,
    [phoneHash, locale],
  );
  return { answers: {}, question: nextQuestion({}) };
}

export async function saveProgress(input: {
  phoneHash: string;
  locale: Locale;
  answers: Answers;
  misses: number;
}): Promise<void> {
  // Scoped to in_progress: a reply that races the person texting FOOD must not
  // resurrect answers on a row that was just abandoned.
  await pgQuery(
    `UPDATE screenings
        SET locale     = $2,
            -- The citizenship branch is stripped here, not at the end: it must
            -- never be written down even for the few minutes a screening is
            -- still running.
            answers    = $3::jsonb,
            misses     = $4,
            updated_at = now()
      WHERE phone_hash = $1 AND status = 'in_progress'`,
    [input.phoneHash, input.locale, JSON.stringify(forStorage(input.answers)), input.misses],
  );
}

/**
 * Finish: compute the routing, keep the coarse flags and which programs the
 * person was pointed at, and drop every answer that produced them.
 */
export async function completeScreening(input: {
  phoneHash: string;
  locale: Locale;
  answers: Answers;
}): Promise<Routing> {
  const routing = route(input.answers);
  // An upsert, not an update: the web form submits a whole screening in one
  // request and has no in-progress row to update. On the SMS path the row is
  // already there and keeps the started_at it was given.
  await pgQuery(
    `INSERT INTO screenings (phone_hash, locale, status, flags, referrals)
     VALUES ($1, $2, 'complete', $3, $4)
     ON CONFLICT (phone_hash) DO UPDATE
        SET locale     = EXCLUDED.locale,
            status     = 'complete',
            answers    = '{}'::jsonb,
            flags      = EXCLUDED.flags,
            referrals  = EXCLUDED.referrals,
            misses     = 0,
            updated_at = now()`,
    [
      input.phoneHash,
      input.locale,
      coarseFlags(input.answers),
      routing.referrals.map((r) => r.program),
    ],
  );
  return routing;
}

/** Someone asked for food mid-screening. Drop the answers, keep the flags. */
export async function abandonScreening(
  phoneHash: string,
  answers: Answers,
): Promise<void> {
  await pgQuery(
    `UPDATE screenings
        SET status     = 'abandoned',
            answers    = '{}'::jsonb,
            flags      = $2,
            referrals  = '{}',
            updated_at = now()
      WHERE phone_hash = $1`,
    [phoneHash, coarseFlags(answers)],
  );
}

/**
 * What the ClickHouse column TTL used to do, run from the daily cron.
 *
 * Two days of silence means the screening is not coming back, so the answers
 * lose their reason to exist while the flags they produced stay. This is the
 * one piece of the move that got harder: a TTL was a line of DDL the database
 * honoured on its own, and this is a job that has to actually run. If the cron
 * stops, answers stop being erased — which is why it returns its counts.
 */
export async function sweepScreeningAnswers(): Promise<{
  erased: number;
  deleted: number;
}> {
  const erased = await pgQuery<{ phone_hash: string }>(
    `UPDATE screenings
        SET status  = CASE WHEN status = 'in_progress' THEN 'abandoned' ELSE status END,
            answers = '{}'::jsonb
      WHERE answers <> '{}'::jsonb
        AND updated_at < now() - ($1::int * INTERVAL '1 day')
      RETURNING phone_hash`,
    [ANSWER_TTL_DAYS],
  );
  // Flags and referrals outlive the answers, but not indefinitely.
  const deleted = await pgQuery<{ phone_hash: string }>(
    `DELETE FROM screenings
      WHERE updated_at < now() - ($1::int * INTERVAL '1 day')
      RETURNING phone_hash`,
    [ROW_TTL_DAYS],
  );
  return { erased: erased.length, deleted: deleted.length };
}
