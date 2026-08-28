import type { Locale } from "./i18n";
import { render, smsSafe } from "./sms-templates";
import {
  applyAnswer, nextQuestion, parseAnswer, progress, recordSkip, renderQuestion,
  type Answers,
} from "./screening";
import { renderReferralSms, type Routing } from "./eligibility";
import {
  abandonScreening, completeScreening, getScreening, isLive, parseAnswers,
  saveProgress, startScreening, type Screening,
} from "./screenings";

/**
 * The screening as it runs over SMS: one question per message, any reply
 * skippable, and a hard exit back to food at any point.
 *
 * The route hands this a message and sends whatever comes back. Keeping the
 * decisions here rather than in the webhook means the whole conversation is
 * testable without a provider, a database, or a model.
 */

export type Outbound = { text: string; templateKey: string };

export type FlowResult = {
  messages: Outbound[];
  /** True when the person asked for food instead — the caller answers that. */
  handoff: boolean;
  routing?: Routing;
};

const PROGRESS: Record<Locale, (n: number, total: number) => string> = {
  en: (n, total) => `Question ${n} of ${total}. `,
  "zh-Hans": (n, total) => `第 ${n}/${total} 题。`,
  es: (n, total) => `Pregunta ${n} de ${total}. `,
};

function ask(answers: Answers, locale: Locale, prefix = ""): Outbound {
  const q = nextQuestion(answers)!;
  const { asked, total } = progress(answers);
  // A counter is worth its characters: it is the difference between "a few
  // questions" and an interrogation with no visible end. The conditional
  // questions that come after the core eight carry no number rather than
  // pushing the total up as they unlock.
  const head = q.core ? PROGRESS[locale](asked + 1, total) : "";
  return {
    text: smsSafe(prefix + head + renderQuestion(q, answers, locale)),
    templateKey: `screen_q_${q.id}`,
  };
}

/** CHECK from someone with no screening running, or a finished one. */
export async function beginScreening(
  phoneHash: string,
  locale: Locale,
): Promise<FlowResult> {
  const existing = await getScreening(phoneHash);
  if (isLive(existing) && existing) {
    const answers = parseAnswers(existing);
    // Mid-screening CHECK means "where were we", not "start over" — unless
    // there is nothing left to ask, in which case it means "so what did I get".
    if (!nextQuestion(answers)) return finish(existing, answers, locale);
    return { messages: [ask(answers, locale)], handoff: false };
  }
  const { answers } = await startScreening(phoneHash, locale);
  return {
    messages: [ask(answers, locale, render("screen_intro", locale) + "\n")],
    handoff: false,
  };
}

/**
 * A reply that arrived while a screening was running. Returns handoff: true
 * when the person asked for food instead — hunger now beats a questionnaire,
 * and the answers so far are dropped rather than left sitting in storage.
 */
export async function handleScreeningReply(input: {
  row: Screening;
  locale: Locale;
  text: string;
  wantsFood: boolean;
}): Promise<FlowResult> {
  const { row, locale } = input;
  const answers = parseAnswers(row);

  if (input.wantsFood) {
    await abandonScreening(row, answers);
    return {
      messages: [{ text: render("screen_stopped", locale), templateKey: "screen_stopped" }],
      handoff: true,
    };
  }

  const q = nextQuestion(answers);
  if (!q) return finish(row, answers, locale);

  const parsed = parseAnswer(q, input.text, answers);

  if (parsed.kind === "unparsed") {
    const misses = row.misses + 1;
    // Two misreads is the limit. A third attempt at the same question reads as
    // the service arguing with someone who is trying to answer it.
    const next = misses >= 2 ? recordSkip(answers, q.id) : answers;
    if (!nextQuestion(next)) return finish(row, next, locale);
    await saveProgress({
      phoneHash: row.phone_hash,
      locale,
      answers: next,
      startedAt: row.started_at,
      misses: misses >= 2 ? 0 : misses,
    });
    const prefix = misses >= 2 ? "" : render("screen_retry", locale) + "\n";
    return { messages: [ask(next, locale, prefix)], handoff: false };
  }

  const next = applyAnswer(answers, q, parsed);
  if (!nextQuestion(next)) return finish(row, next, locale);

  await saveProgress({
    phoneHash: row.phone_hash,
    locale,
    answers: next,
    startedAt: row.started_at,
    misses: 0,
  });
  return { messages: [ask(next, locale)], handoff: false };
}

async function finish(
  row: Screening,
  answers: Answers,
  locale: Locale,
): Promise<FlowResult> {
  const routing = await completeScreening({
    phoneHash: row.phone_hash,
    locale,
    answers,
    startedAt: row.started_at,
  });
  return {
    messages: [
      { text: smsSafe(renderReferralSms(routing, locale)), templateKey: "screen_results" },
    ],
    handoff: false,
    routing,
  };
}
