"use client";

import { useEffect, useState } from "react";
import { COPY, type Locale } from "@/lib/i18n";
import {
  YES_NO, nextQuestion, optionsFor, progress, recordSkip, setAnswer,
  type Answers, type Question,
} from "@/lib/screening";
import { Button, Choice, Field, Progress, Screen } from "./ui";

export type ScreeningResult = {
  referrals: {
    program: string;
    name: string;
    action: string;
    confidence: "likely" | "possible" | "open_to_all";
    documents: boolean;
  }[];
  notes: string[];
};

/**
 * The optional questions, one per screen.
 *
 * The question bank is shared with the SMS flow, so the wording, the order, and
 * the conditional branches are the same on both surfaces — there is one
 * screener here, rendered two ways. Every screen can be skipped, and skipping
 * still produces referrals.
 */
export function ScreeningQuestions({
  locale,
  busy,
  onSubmit,
  onQuit,
  onAnswered,
}: {
  locale: Locale;
  busy: boolean;
  onSubmit: (answers: Answers) => void;
  onQuit: () => void;
  onAnswered?: (id: string, action: "submit" | "skip") => void;
}) {
  const t = COPY[locale].screening;
  const [answers, setAnswers] = useState<Answers>({});
  const [draft, setDraft] = useState<string>("");
  const [multi, setMulti] = useState<string[]>([]);

  const q = nextQuestion(answers);
  const { asked, total } = progress(answers);

  // Every answered question advances through onSubmit, so this only fires if
  // the bank itself has nothing left to ask. Never during a render.
  useEffect(() => {
    if (!q) onSubmit(answers);
  }, [q, answers, onSubmit]);
  if (!q) return null;

  const advance = (next: Answers, action: "submit" | "skip") => {
    onAnswered?.(q.id, action);
    setDraft("");
    setMulti([]);
    if (nextQuestion(next)) setAnswers(next);
    else onSubmit(next);
  };

  const commit = (value: unknown) => advance(setAnswer(answers, q, value), "submit");
  const skip = () => advance(recordSkip(answers, q.id), "skip");

  return (
    <>
      {/* Full bar on the conditional questions that follow the core eight. */}
      <Progress step={q.core ? asked + 1 : total} total={total} />
      <Screen
        title={q.prompt[locale]}
        sub={asked === 0 ? t.sub : undefined}
        footer={
          <>
            {q.type === "multi" && (
              <Button disabled={busy || multi.length === 0} onClick={() => commit(multi)}>
                {COPY[locale].common.continue}
              </Button>
            )}
            {(q.type === "number" || q.type === "text") && (
              <Button disabled={busy || draft.trim() === ""} onClick={() => commit(
                q.type === "number" ? Number(draft) : draft.trim(),
              )}>
                {COPY[locale].common.continue}
              </Button>
            )}
            <Button variant="ghost" disabled={busy} onClick={skip}>
              {t.skipQuestion}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={onQuit}>
              {t.skipAll}
            </Button>
          </>
        }
      >
        <QuestionBody
          q={q}
          answers={answers}
          locale={locale}
          draft={draft}
          multi={multi}
          onDraft={setDraft}
          onToggle={(key) =>
            setMulti((prev) => {
              // "None of these" is exclusive: picking it clears the rest, and
              // picking anything else clears it.
              if (key === "none") return prev.includes("none") ? [] : ["none"];
              const without = prev.filter((k) => k !== "none");
              return without.includes(key)
                ? without.filter((k) => k !== key)
                : [...without, key];
            })
          }
          onPick={commit}
        />
      </Screen>
    </>
  );
}

function QuestionBody({
  q, answers, locale, draft, multi, onDraft, onToggle, onPick,
}: {
  q: Question;
  answers: Answers;
  locale: Locale;
  draft: string;
  multi: string[];
  onDraft: (v: string) => void;
  onToggle: (key: string) => void;
  onPick: (value: unknown) => void;
}) {
  if (q.type === "yes_no") {
    return (
      <div className="space-y-3">
        <Choice onClick={() => onPick("yes")}>{YES_NO[locale].yes}</Choice>
        <Choice onClick={() => onPick("no")}>{YES_NO[locale].no}</Choice>
      </div>
    );
  }

  if (q.type === "number") {
    return (
      <Field
        name={q.id}
        type="text"
        inputMode="numeric"
        autoFocus
        maxLength={2}
        label={q.prompt[locale]}
        placeholder="1"
        value={draft}
        onChange={(e) => onDraft(e.target.value.replace(/\D/g, "").slice(0, 2))}
      />
    );
  }

  if (q.type === "text") {
    return (
      <Field
        name={q.id}
        type="text"
        autoFocus
        maxLength={200}
        label={q.prompt[locale]}
        placeholder=""
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
      />
    );
  }

  const options = optionsFor(q, answers);

  if (q.type === "single") {
    return (
      <div className="space-y-3">
        {options.map((o) => (
          <Choice key={o.key} onClick={() => onPick(o.key)}>
            {o.label[locale]}
          </Choice>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      {options.map((o) => {
        const on = multi.includes(o.key);
        return (
          <button
            key={o.key}
            aria-pressed={on}
            onClick={() => onToggle(o.key)}
            className={`min-h-[56px] rounded-full border-2 px-5 text-[18px] font-semibold transition-colors ${
              on
                ? "border-brand bg-brand text-white"
                : "border-line bg-surface text-ink hover:border-ink"
            }`}
          >
            {o.label[locale]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The referral list. Confidence is on every card because the honest answer is
 * "likely", never "yes" — the county makes the decision, not this service.
 */
export function ScreeningResults({
  locale,
  result,
  zip,
}: {
  locale: Locale;
  result: ScreeningResult;
  zip: string;
}) {
  const t = COPY[locale].screening;
  const extra = result.referrals.filter((r) => r.confidence !== "open_to_all");

  return (
    <Screen title={t.resultsTitle} sub={t.resultsSub}>
      {extra.length === 0 && (
        <p className="text-[19px] leading-relaxed text-ink">{t.none}</p>
      )}

      <ul className="space-y-3">
        {result.referrals.map((r) => (
          <li key={r.program} className="rounded-2xl border-2 border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[20px] font-bold leading-snug text-ink">{r.name}</h2>
              <span className="shrink-0 rounded-full bg-canvas px-3 py-1 text-[14px] font-semibold text-muted">
                {t.confidence[r.confidence]}
              </span>
            </div>
            <p className="mt-2 text-[17px] leading-relaxed text-muted">{r.action}</p>
            {r.documents && (
              <p className="mt-2 text-[15px] font-semibold text-muted">{t.documents}</p>
            )}
          </li>
        ))}
      </ul>

      {result.notes.length > 0 && (
        <ul className="mt-6 space-y-2 rounded-2xl bg-surface p-4">
          {result.notes.map((n) => (
            <li key={n} className="text-[16px] leading-relaxed text-muted">
              {n}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-[15px] leading-relaxed text-muted">{t.privacy}</p>

      <p className="mt-4 text-[17px] leading-relaxed text-muted">
        {COPY[locale].done.body.replace("{zip}", zip)}
      </p>
    </Screen>
  );
}
