"use client";

import { useState } from "react";
import { FIND, fill, type Locale } from "@/lib/i18n";
import Modal from "./modal";
import type { Program } from "./types";

export default function ApplyDialog({
  program,
  locale,
  onClose,
  onSubmitted,
}: {
  program: Program | null;
  locale: Locale;
  onClose: () => void;
  onSubmitted: (programId: string) => void;
}) {
  const t = FIND[locale];
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  if (!program) return null;

  // Field labels fall back to English rather than rendering a raw key — a
  // program added without a translation is still usable.
  const label = (m: Record<string, string>) => m[locale] ?? m.en ?? "";

  const submit = async () => {
    setBusy(true);
    setError("");
    setMissing([]);
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program_id: program.program_id, answers }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        missing?: string[];
      };
      if (!res.ok) {
        if (json.missing) setMissing(json.missing);
        else setError(t.auth.wrongCode);
        return;
      }
      setDone(true);
      onSubmitted(program.program_id);
    } catch {
      setError(t.auth.wrongCode);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={fill(t.apply.title, { name: program.name })}
      closeLabel={t.close}
    >
      {done ? (
        <div>
          <p className="text-[19px] font-semibold text-ink">{t.apply.success}</p>
          {program.processing_days > 0 && (
            <p className="mt-2 text-[17px] text-muted">
              {fill(t.apply.processing, { n: program.processing_days })}
            </p>
          )}
          <button
            onClick={onClose}
            className="mt-6 min-h-[60px] w-full rounded-2xl bg-brand text-[18px] font-semibold text-white"
          >
            {t.close}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {program.summary && (
            <p className="text-[17px] leading-relaxed text-muted">{program.summary}</p>
          )}

          {program.fields.map((field) => {
            const isMissing = missing.includes(field.key);
            const id = `field-${field.key}`;
            const common =
              "min-h-[56px] w-full rounded-2xl border-2 bg-surface px-4 text-[18px] text-ink " +
              (isMissing ? "border-danger" : "border-line focus:border-brand");

            return (
              <div key={field.key}>
                <label htmlFor={id} className="mb-2 block text-[16px] font-semibold text-ink">
                  {label(field.label)}
                  {field.required && <span aria-hidden className="text-danger"> *</span>}
                </label>

                {field.type === "select" ? (
                  <select
                    id={id}
                    className={common}
                    value={(answers[field.key] as string) ?? ""}
                    onChange={(e) =>
                      setAnswers((a) => ({ ...a, [field.key]: e.target.value }))
                    }
                  >
                    <option value="">—</option>
                    {(field.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : field.type === "checkbox" ? (
                  <label className="flex min-h-[56px] items-center gap-3 rounded-2xl border-2 border-line px-4">
                    <input
                      id={id}
                      type="checkbox"
                      className="h-6 w-6 accent-brand"
                      checked={Boolean(answers[field.key])}
                      onChange={(e) =>
                        setAnswers((a) => ({ ...a, [field.key]: e.target.checked }))
                      }
                    />
                    <span className="text-[17px] text-ink">{label(field.label)}</span>
                  </label>
                ) : field.type === "textarea" ? (
                  <textarea
                    id={id}
                    rows={3}
                    className={`${common} py-3`}
                    value={(answers[field.key] as string) ?? ""}
                    onChange={(e) =>
                      setAnswers((a) => ({ ...a, [field.key]: e.target.value }))
                    }
                  />
                ) : (
                  <input
                    id={id}
                    type={field.type === "tel" ? "tel" : "text"}
                    inputMode={field.type === "tel" ? "numeric" : undefined}
                    className={common}
                    value={(answers[field.key] as string) ?? ""}
                    onChange={(e) =>
                      setAnswers((a) => ({ ...a, [field.key]: e.target.value }))
                    }
                  />
                )}

                {field.help && (
                  <p className="mt-1.5 text-[15px] text-muted">{label(field.help)}</p>
                )}
                {isMissing && (
                  <p role="alert" className="mt-1.5 text-[15px] font-semibold text-danger">
                    {t.apply.required}
                  </p>
                )}
              </div>
            );
          })}

          {program.requirements && (
            <p className="rounded-2xl bg-canvas p-4 text-[16px] text-ink">
              {fill(t.card.bring, { x: program.requirements })}
            </p>
          )}

          <button
            onClick={submit}
            disabled={busy}
            className="min-h-[60px] w-full rounded-2xl bg-brand text-[18px] font-semibold text-white disabled:opacity-50"
          >
            {t.apply.submit}
          </button>

          <p role="alert" aria-live="polite" className="min-h-[24px] text-[16px] font-semibold text-danger">
            {error}
          </p>
        </div>
      )}
    </Modal>
  );
}
