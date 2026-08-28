"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

const BASE =
  "w-full min-h-[60px] rounded-2xl px-5 text-[19px] font-semibold " +
  "transition-colors disabled:opacity-50 disabled:cursor-not-allowed " +
  "flex items-center justify-center text-center";

export function Button({
  variant = "primary",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  const styles = {
    primary: "bg-brand text-white hover:bg-brand-ink active:bg-brand-ink",
    secondary:
      "bg-surface text-ink border-2 border-line hover:border-ink active:bg-canvas",
    ghost: "bg-transparent text-muted underline underline-offset-4 min-h-[52px]",
  }[variant];
  return (
    <button className={`${BASE} ${styles}`} {...props}>
      {children}
    </button>
  );
}

/** Single-select tile. Tapping it commits — no separate Continue tap. */
export function Choice({
  children,
  selected,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      aria-pressed={selected}
      className={`w-full min-h-[64px] rounded-2xl border-2 px-5 text-left text-[19px] font-semibold transition-colors ${
        selected
          ? "border-brand bg-brand text-white"
          : "border-line bg-surface text-ink hover:border-ink"
      }`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  error,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
}) {
  const id = props.id ?? props.name ?? "field";
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[17px] font-semibold text-muted">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={`w-full min-h-[64px] rounded-2xl border-2 bg-surface px-5 text-[22px] tabular-nums text-ink placeholder:text-line ${
          error ? "border-danger" : "border-line focus:border-brand"
        }`}
        {...props}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-2 text-[16px] text-muted">
          {hint}
        </p>
      )}
      {/* aria-live so a screen reader announces the error without a focus jump */}
      <p
        id={`${id}-error`}
        role="alert"
        aria-live="polite"
        className="mt-2 min-h-[24px] text-[16px] font-semibold text-danger"
      >
        {error ?? ""}
      </p>
    </div>
  );
}

export function Screen({
  title,
  sub,
  children,
  footer,
}: {
  title?: string;
  sub?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-[calc(100svh-1.75rem)] flex-col">
      <div className="mx-auto flex w-full max-w-[520px] flex-1 flex-col px-5 pt-8 pb-6">
        {title && (
          <h1 className="text-[30px] font-bold leading-tight tracking-tight text-ink">
            {title}
          </h1>
        )}
        {sub && <p className="mt-2 text-[18px] text-muted">{sub}</p>}
        <div className="mt-7 flex-1">{children}</div>
        {footer && <div className="mt-6 space-y-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Progress({ step, total }: { step: number; total: number }) {
  return (
    <div className="mx-auto w-full max-w-[520px] px-5 pt-5">
      <div className="flex gap-1.5" role="presentation">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full ${i < step ? "bg-brand" : "bg-line"}`}
          />
        ))}
      </div>
    </div>
  );
}
