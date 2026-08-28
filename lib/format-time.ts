import type { Locale } from "./i18n";

const TZ = "America/Los_Angeles";

const INTL: Record<Locale, string> = {
  en: "en-US",
  "zh-Hans": "zh-CN",
  es: "es-US",
};

const TODAY: Record<Locale, string> = { en: "Today", "zh-Hans": "今天", es: "Hoy" };
const TOMORROW: Record<Locale, string> = { en: "Tomorrow", "zh-Hans": "明天", es: "Mañana" };

/**
 * "Today 2-4pm" beats "2026-08-28T21:00:00Z" by a wide margin over SMS.
 * Everything is rendered in Pacific time regardless of where the server runs.
 */
export function formatEventTime(
  startsAt: string,
  endsAt: string,
  locale: Locale,
  now: Date = new Date(),
): string {
  const start = new Date(`${startsAt.replace(" ", "T")}Z`);
  const end = new Date(`${endsAt.replace(" ", "T")}Z`);
  const intl = INTL[locale];

  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

  const tomorrow = new Date(now.getTime() + 86_400_000);
  let dayLabel: string;
  if (dayKey(start) === dayKey(now)) dayLabel = TODAY[locale];
  else if (dayKey(start) === dayKey(tomorrow)) dayLabel = TOMORROW[locale];
  else
    dayLabel = new Intl.DateTimeFormat(intl, {
      timeZone: TZ,
      weekday: "short",
    }).format(start);

  const time = (d: Date) =>
    new Intl.DateTimeFormat(intl, {
      timeZone: TZ,
      hour: "numeric",
      minute: "2-digit",
    }).format(d).replace(":00", "");

  return `${dayLabel} ${time(start)}-${time(end)}`;
}
