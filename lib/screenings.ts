import { insert, query, chTime } from "./clickhouse";
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
 * conversation spans hours, not one request — so they sit in `answers` with a
 * two-day column TTL. The moment the screening finishes, that column is
 * cleared and only coarse flags and the referral list remain.
 */

export type ScreeningStatus = "in_progress" | "complete" | "abandoned";

export type Screening = {
  phone_hash: string;
  locale: string;
  status: ScreeningStatus;
  answers: string;
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

export async function getScreening(phoneHash: string): Promise<Screening | null> {
  const rows = await query<Screening>(
    `SELECT phone_hash, locale, status, answers, flags, referrals, misses,
            toString(started_at) AS started_at, toString(updated_at) AS updated_at
     FROM screenings FINAL WHERE phone_hash = {hash:String} LIMIT 1`,
    { hash: phoneHash },
  );
  return rows[0] ?? null;
}

export function parseAnswers(row: Screening | null): Answers {
  if (!row?.answers) return {};
  try {
    return JSON.parse(row.answers) as Answers;
  } catch {
    return {};
  }
}

/** An in-progress screening the next inbound message should be read against. */
export function isLive(row: Screening | null, now: Date = new Date()): boolean {
  if (!row || row.status !== "in_progress") return false;
  const updated = Date.parse(row.updated_at.replace(" ", "T") + "Z");
  return Number.isFinite(updated) && now.getTime() - updated < RESUME_WINDOW_MS;
}

async function write(row: Screening): Promise<void> {
  await insert("screenings", [row]);
}

export async function startScreening(
  phoneHash: string,
  locale: Locale,
): Promise<{ answers: Answers; question: Question | null }> {
  const now = chTime();
  await write({
    phone_hash: phoneHash,
    locale,
    status: "in_progress",
    answers: "{}",
    flags: [],
    referrals: [],
    misses: 0,
    started_at: now,
    updated_at: now,
  });
  return { answers: {}, question: nextQuestion({}) };
}

export async function saveProgress(input: {
  phoneHash: string;
  locale: Locale;
  answers: Answers;
  startedAt: string;
  misses: number;
}): Promise<void> {
  await write({
    phone_hash: input.phoneHash,
    locale: input.locale,
    status: "in_progress",
    // The citizenship branch is stripped here, not at the end: it must never
    // be written down even for the few minutes a screening is still running.
    answers: JSON.stringify(forStorage(input.answers)),
    flags: [],
    referrals: [],
    misses: input.misses,
    started_at: input.startedAt,
    updated_at: chTime(),
  });
}

/**
 * Finish: compute the routing, keep the coarse flags and which programs the
 * person was pointed at, and drop every answer that produced them.
 */
export async function completeScreening(input: {
  phoneHash: string;
  locale: Locale;
  answers: Answers;
  startedAt: string;
}): Promise<Routing> {
  const routing = route(input.answers);
  await write({
    phone_hash: input.phoneHash,
    locale: input.locale,
    status: "complete",
    answers: "",
    flags: coarseFlags(input.answers),
    referrals: routing.referrals.map((r) => r.program),
    misses: 0,
    started_at: input.startedAt,
    updated_at: chTime(),
  });
  return routing;
}

/** Someone asked for food mid-screening. Drop the answers, keep the flags. */
export async function abandonScreening(
  row: Screening,
  answers: Answers,
): Promise<void> {
  await write({
    ...row,
    status: "abandoned",
    answers: "",
    flags: coarseFlags(answers),
    referrals: [],
    updated_at: chTime(),
  });
}
