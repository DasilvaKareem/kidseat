import type { Locale } from "./i18n";

/**
 * The screening question bank.
 *
 * Eight core questions plus three conditional ones are enough to route someone
 * through the whole SF/California food stack — CalFresh, WIC, CSFP senior
 * boxes, SUN Bucks, school meals, the Restaurant Meals Program, CalAIM
 * medically supportive food, home-delivered groceries, and the always-open
 * pantries and dining rooms. Every question here is skippable, and the routing
 * in eligibility.ts runs on whatever is known.
 *
 * Three rules shape every line of this file:
 *
 *  1. We never ask immigration or citizenship status to route someone. It is
 *     sensitive personal information under California AB 947, it suppresses
 *     enrollment, and it is unnecessary: pantries, WIC, school meals, SUN
 *     Bucks, and CSFP do not screen on it. The one exception is an optional
 *     CalFresh-only yes/no branch, asked last, never stored.
 *  2. Income is asked in bands tied to household size, never as a figure.
 *     Every program uses a percentage of the federal poverty level, so knowing
 *     which side of 130/165/185/200% someone falls on is the whole job.
 *  3. Disability is asked functionally ("hard to work, shop, or cook"), never
 *     as a diagnosis.
 */

// ---------------------------------------------------------------------------
// Federal poverty level
// ---------------------------------------------------------------------------

// HHS 2025 poverty guidelines, which CalFresh uses for FFY2026 (Oct 1 2025 -
// Sep 30 2026). Regenerate the constants below when the guidelines update —
// smoke.mts pins the published 200% figures so a stale table fails CI.
const FPL_BASE_ANNUAL = 15650;
const FPL_PER_PERSON_ANNUAL = 5500;

/** The FFY the numbers above come from. Surfaced by /api/health. */
export const FPL_YEAR = "FFY2026";

/**
 * Monthly poverty level for a household. Monthly first, rounded up, then the
 * percentage — that order is what reproduces USDA's published table
 * (1 person: $1,305 net, $1,697 gross at 130%, $2,610 at 200%).
 */
export function fplMonthly(size: number): number {
  const n = Math.max(1, Math.min(20, Math.floor(size)));
  return Math.ceil((FPL_BASE_ANNUAL + FPL_PER_PERSON_ANNUAL * (n - 1)) / 12);
}

export function fplThreshold(size: number, pct: number): number {
  return Math.ceil((fplMonthly(size) * pct) / 100);
}

// The only cutoffs any program in the routing table keys on.
export const CUTOFFS = [130, 165, 185, 200] as const;

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export type YesNo = "yes" | "no";

export type BenefitKey =
  | "calfresh" | "calworks" | "medical" | "ssi" | "medicare" | "wic" | "none";
export type BandKey =
  | "under_130" | "130_165" | "165_185" | "185_200" | "over_200" | "unknown";
export type ChildKey = "none" | "under_5" | "5_17";
export type HousingKey =
  | "own_place" | "with_others" | "shelter" | "outside" | "hotel";
export type KitchenKey = "both" | "one" | "neither";

export type QuestionId =
  | "household_size" | "benefits" | "income_band" | "senior" | "pregnant"
  | "children" | "disability" | "housing" | "kitchen" | "chronic" | "prefs"
  | "citizen_branch";

export type Answers = {
  household_size?: number;
  benefits?: BenefitKey[];
  income_band?: BandKey;
  senior?: YesNo;
  pregnant?: YesNo;
  children?: ChildKey[];
  disability?: YesNo;
  housing?: HousingKey;
  kitchen?: KitchenKey;
  chronic?: YesNo;
  prefs?: string;
  /**
   * The optional CalFresh-only branch. Held for the length of one conversation
   * and dropped — never written to storage. See PERSISTABLE below.
   */
  citizen_branch?: YesNo;
  /** Questions the person passed on, so we do not ask them twice. */
  skipped?: QuestionId[];
};

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export type QuestionType = "number" | "single" | "multi" | "yes_no" | "text";

export type Option = { key: string; label: Record<Locale, string> };

export type Question = {
  id: QuestionId;
  type: QuestionType;
  /** One of the core eight, asked of everyone. */
  core: boolean;
  prompt: Record<Locale, string>;
  options?: (a: Answers) => Option[];
  /** Conditional questions only run when this passes. */
  when?: (a: Answers) => boolean;
};

function opt(
  key: string,
  en: string,
  zh: string,
  es: string,
): Option {
  return { key, label: { en, "zh-Hans": zh, es } };
}

function money(n: number): string {
  return "$" + n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Income bands for one household size, with edges landing on the cutoffs the
 * programs actually use. The agent only ever needs to know which side of a
 * cutoff someone is on, so this is all the income precision the service holds.
 */
export function incomeBands(size: number): Option[] {
  const [a, b, c, d] = CUTOFFS.map((pct) => fplThreshold(size, pct));
  return [
    opt("under_130", `Under ${money(a)}`, `低于 ${money(a)}`, `Menos de ${money(a)}`),
    opt("130_165", `${money(a)}-${money(b)}`, `${money(a)}-${money(b)}`, `${money(a)}-${money(b)}`),
    opt("165_185", `${money(b)}-${money(c)}`, `${money(b)}-${money(c)}`, `${money(b)}-${money(c)}`),
    opt("185_200", `${money(c)}-${money(d)}`, `${money(c)}-${money(d)}`, `${money(c)}-${money(d)}`),
    opt("over_200", `Over ${money(d)}`, `高于 ${money(d)}`, `Más de ${money(d)}`),
    opt("unknown", "Not sure", "不确定", "No estoy seguro"),
  ];
}

function benefitOptions(): Option[] {
  return [
    opt("calfresh", "CalFresh / EBT", "CalFresh / EBT", "CalFresh / EBT"),
    opt("calworks", "CalWORKs or cash aid", "CalWORKs 或现金补助", "CalWORKs o ayuda en efectivo"),
    opt("medical", "Medi-Cal", "Medi-Cal", "Medi-Cal"),
    opt("ssi", "SSI", "SSI", "SSI"),
    opt("medicare", "Medicare", "Medicare", "Medicare"),
    opt("wic", "WIC", "WIC", "WIC"),
    opt("none", "None of these", "都没有", "Ninguno"),
  ];
}

/**
 * Least sensitive first. Household size and "what do you already get" are
 * transactional; income sits in the middle; disability and housing come later;
 * the optional CalFresh citizenship branch is dead last and can be skipped
 * without changing anything we send.
 */
export const QUESTIONS: Question[] = [
  {
    id: "household_size",
    type: "number",
    core: true,
    prompt: {
      en: "How many people do you buy and make food with, including you?",
      "zh-Hans": "包括您自己，家里有几个人一起买菜做饭？",
      es: "¿Con cuántas personas compra y prepara comida, incluyéndose usted?",
    },
  },
  {
    id: "benefits",
    type: "multi",
    core: true,
    prompt: {
      en: "Do you already get any of these? Reply with all that apply.",
      "zh-Hans": "您目前有以下哪些？可回复多个数字。",
      es: "¿Ya recibe alguno de estos? Responda con todos los que apliquen.",
    },
    options: benefitOptions,
  },
  {
    id: "income_band",
    type: "single",
    core: true,
    prompt: {
      en: "About how much does your whole household get in a month, before anything is taken out?",
      "zh-Hans": "全家每月总收入大约是多少（扣除任何费用之前）？",
      es: "¿Cuánto recibe todo su hogar al mes, antes de descuentos?",
    },
    options: (a) => incomeBands(a.household_size ?? 1),
  },
  {
    id: "senior",
    type: "yes_no",
    core: true,
    prompt: {
      en: "Is anyone in your home 60 or older?",
      "zh-Hans": "家里有 60 岁或以上的人吗？",
      es: "¿Hay alguien de 60 años o más en su hogar?",
    },
  },
  {
    id: "pregnant",
    type: "yes_no",
    core: true,
    prompt: {
      en: "Is anyone pregnant, or had a baby in the last 6 months?",
      "zh-Hans": "家里有人怀孕，或过去 6 个月内生过宝宝吗？",
      es: "¿Hay alguien embarazada o que tuvo un bebé en los últimos 6 meses?",
    },
  },
  {
    id: "children",
    type: "multi",
    core: true,
    prompt: {
      en: "Are there children under 18 at home?",
      "zh-Hans": "家里有 18 岁以下的孩子吗？",
      es: "¿Hay niños menores de 18 años en casa?",
    },
    // Age buckets, not ages. WIC turns on "under 5" and school meals and SUN
    // Bucks turn on "school age" — nothing downstream needs a birthday, and
    // free-text ages over SMS are unparseable anyway.
    options: () => [
      opt("none", "No children", "没有", "No hay niños"),
      opt("under_5", "Yes, under 5", "有，5 岁以下", "Sí, menores de 5"),
      opt("5_17", "Yes, ages 5-17", "有，5-17 岁", "Sí, de 5 a 17"),
    ],
  },
  {
    id: "disability",
    type: "yes_no",
    core: true,
    // Functional wording, mirroring the CMS AHC-HRSN screener. We never ask for
    // a diagnosis, and a diagnosis would not change the routing if we had one.
    prompt: {
      en: "Does anyone have a disability or health condition that makes it hard to work, shop, or cook?",
      "zh-Hans": "家里有人因残疾或健康状况难以工作、买菜或做饭吗？",
      es: "¿Alguien tiene una discapacidad o condición de salud que dificulte trabajar, comprar o cocinar?",
    },
  },
  {
    id: "housing",
    type: "single",
    core: true,
    prompt: {
      en: "Where are you staying right now?",
      "zh-Hans": "您现在住在哪里？",
      es: "¿Dónde se queda ahora?",
    },
    options: () => [
      opt("own_place", "My own place", "自己的住处", "Mi propia casa"),
      opt("with_others", "Staying with others", "借住在别人家", "Con otras personas"),
      opt("shelter", "Shelter", "收容所", "Albergue"),
      opt("outside", "Car or outside", "车里或街上", "Carro o afuera"),
      opt("hotel", "Hotel or motel", "旅馆", "Hotel o motel"),
    ],
  },
  {
    id: "kitchen",
    type: "single",
    core: false,
    // Only worth asking when there is real doubt: it decides groceries versus
    // hot meals, and someone in their own place almost always has a kitchen.
    when: (a) =>
      (a.housing !== undefined && a.housing !== "own_place") ||
      a.disability === "yes",
    prompt: {
      en: "Do you have a working fridge and stove where you are staying?",
      "zh-Hans": "您住的地方有能用的冰箱和炉灶吗？",
      es: "¿Tiene refrigerador y estufa que funcionen donde se queda?",
    },
    options: () => [
      opt("both", "Yes, both", "都有", "Los dos"),
      opt("one", "Only one of them", "只有一个", "Solo uno"),
      opt("neither", "Neither", "都没有", "Ninguno"),
    ],
  },
  {
    id: "chronic",
    type: "yes_no",
    core: false,
    // CalAIM medically supportive food runs through a Medi-Cal managed care
    // plan, so there is no point asking anyone who is not on Medi-Cal.
    when: (a) => (a.benefits ?? []).includes("medical"),
    prompt: {
      en: "Do you have diabetes, heart disease, or another condition that special meals could help?",
      "zh-Hans": "您有糖尿病、心脏病或其他适合特殊餐食的健康状况吗？",
      es: "¿Tiene diabetes, enfermedad del corazón u otra condición que comidas especiales podrían ayudar?",
    },
  },
  {
    id: "prefs",
    type: "text",
    core: false,
    prompt: {
      en: "Last one: any food needs to match — allergies, diabetes, halal, kosher, vegetarian?",
      "zh-Hans": "最后一题：有饮食需求吗，例如过敏、糖尿病、清真、洁食、素食？",
      es: "Última: ¿alguna necesidad de comida — alergias, diabetes, halal, kosher, vegetariana?",
    },
  },
  {
    id: "citizen_branch",
    type: "yes_no",
    core: false,
    // The one immigration-adjacent question in the service, and it exists only
    // because CalFresh's own rules changed on April 1 2026. It is optional, it
    // is asked last, it changes nothing about the food we send, and the answer
    // is dropped the moment the routing is computed.
    when: (a) => calfreshInPlay(a),
    prompt: {
      en: "Only for CalFresh, and you can skip it: do you or someone you would apply for have a green card or U.S. citizenship?",
      "zh-Hans": "仅与 CalFresh 有关，可跳过：您或您要申请的人中，有人持绿卡或美国公民身份吗？",
      es: "Solo para CalFresh, puede omitirla: ¿usted o alguien por quien aplicaría tiene green card o ciudadanía?",
    },
  },
];

export const CORE_COUNT = QUESTIONS.filter((q) => q.core).length;

/** Would a CalFresh referral fire? Decides whether the branch above is asked. */
function calfreshInPlay(a: Answers): boolean {
  const benefits = a.benefits ?? [];
  if (benefits.includes("calfresh")) return false; // already on it
  if (benefits.includes("calworks") || benefits.includes("ssi")) return true;
  const band = a.income_band;
  if (!band) return false;
  return band !== "over_200" || a.senior === "yes" || a.disability === "yes";
}

// ---------------------------------------------------------------------------
// Sequencing
// ---------------------------------------------------------------------------

export function isAnswered(a: Answers, id: QuestionId): boolean {
  if ((a.skipped ?? []).includes(id)) return true;
  return a[id as keyof Answers] !== undefined;
}

export function applies(q: Question, a: Answers): boolean {
  return q.when ? q.when(a) : true;
}

/** The next question to ask, or null when the screening is done. */
export function nextQuestion(a: Answers): Question | null {
  for (const q of QUESTIONS) {
    if (!applies(q, a)) continue;
    if (!isAnswered(a, q.id)) return q;
  }
  return null;
}

/**
 * Progress over the core eight only.
 *
 * Counting the conditional questions would move the finish line while someone
 * is walking toward it — answering "I have Medi-Cal" would turn "3 of 8" into
 * "3 of 9". So the counter covers the questions everyone gets, and the few
 * conditional ones that follow are shown without a number, after the count is
 * already complete.
 */
export function progress(a: Answers): { asked: number; total: number } {
  const core = QUESTIONS.filter((q) => q.core);
  return {
    asked: core.filter((q) => isAnswered(a, q.id)).length,
    total: core.length,
  };
}

export function optionsFor(q: Question, a: Answers): Option[] {
  return q.options ? q.options(a) : [];
}

/** One SMS: the question, then its options as a numbered list. */
export function renderQuestion(q: Question, a: Answers, locale: Locale): string {
  const opts = optionsFor(q, a);
  const lines = opts.map((o, i) => `${i + 1} ${o.label[locale]}`);
  return [q.prompt[locale], ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// Parsing SMS replies
// ---------------------------------------------------------------------------

// "I don't know" and "prefer not to say" are first-class answers, not errors.
const SKIP_WORDS = [
  "skip", "pass", "next", "idk", "dunno", "no idea", "not sure", "dont know",
  "don't know", "prefer not to say", "?",
  "omitir", "saltar", "pasar", "no se", "no sé", "no estoy seguro",
  "跳过", "略过", "不知道", "不确定", "不想说",
];
const YES_WORDS = ["yes", "y", "yeah", "yep", "yea", "sure", "si", "sí", "s", "是", "对", "有", "好"];
const NO_WORDS = ["no", "n", "nope", "nah", "否", "不", "没有", "沒有"];

function normalize(text: string): string {
  return text.trim().toLowerCase()
    .replace(/[.!;:'"“”‘’。！、]/g, "")
    .replace(/\s+/g, " ");
}

export type Parsed =
  | { kind: "value"; patch: Answers }
  | { kind: "skip" }
  | { kind: "unparsed" };

function pickNumbers(text: string, max: number): number[] {
  const found = [...text.matchAll(/\d+/g)]
    .map((m) => Number(m[0]))
    .filter((n) => n >= 1 && n <= max);
  return [...new Set(found)];
}

/**
 * Turns "2", "1,3", "yes", or "skip" into an answer. Deliberately forgiving:
 * an unparsed reply is re-asked once, never treated as a refusal.
 */
export function parseAnswer(q: Question, text: string, a: Answers): Parsed {
  const t = normalize(text);
  if (!t) return { kind: "unparsed" };
  if (SKIP_WORDS.some((w) => t === w || t.startsWith(w + " "))) return { kind: "skip" };

  if (q.type === "text") {
    return { kind: "value", patch: { prefs: text.trim().slice(0, 200) } };
  }

  if (q.type === "number") {
    const n = pickNumbers(t, 20)[0];
    if (n === undefined) return { kind: "unparsed" };
    return { kind: "value", patch: { household_size: n } };
  }

  if (q.type === "yes_no") {
    const first = t.split(" ")[0];
    let v: YesNo | null = null;
    if (YES_WORDS.includes(first) || first === "1") v = "yes";
    else if (NO_WORDS.includes(first) || first === "2") v = "no";
    if (!v) return { kind: "unparsed" };
    return { kind: "value", patch: { [q.id]: v } as Answers };
  }

  const opts = optionsFor(q, a);
  const picked = pickNumbers(t, opts.length).map((n) => opts[n - 1].key);
  if (picked.length === 0) return { kind: "unparsed" };

  if (q.type === "single") {
    return { kind: "value", patch: { [q.id]: picked[0] } as Answers };
  }
  // Multi-select: "none" only means anything on its own.
  const keys = picked.includes("none") && picked.length > 1
    ? picked.filter((k) => k !== "none")
    : picked;
  return { kind: "value", patch: { [q.id]: keys } as Answers };
}

/**
 * Server-side validation of an answer set posted by a browser. Every value is
 * checked against the bank itself, and anything the bank did not ask for is
 * dropped rather than stored — the same contract the program application form
 * uses in lib/programs.ts.
 */
export function sanitizeAnswers(raw: unknown): Answers {
  const input = (raw ?? {}) as Record<string, unknown>;
  const clean: Answers = {};

  for (const q of QUESTIONS) {
    const value = input[q.id];
    if (value === undefined || value === null) continue;

    if (q.type === "number") {
      const n = Math.floor(Number(value));
      if (Number.isFinite(n) && n >= 1 && n <= 20) clean.household_size = n;
      continue;
    }
    if (q.type === "text") {
      if (typeof value === "string" && value.trim()) {
        clean.prefs = value.trim().slice(0, 200);
      }
      continue;
    }
    if (q.type === "yes_no") {
      if (value === "yes" || value === "no") {
        Object.assign(clean, { [q.id]: value });
      }
      continue;
    }

    const keys = new Set(optionsFor(q, clean).map((o) => o.key));
    if (q.type === "single") {
      if (typeof value === "string" && keys.has(value)) {
        Object.assign(clean, { [q.id]: value });
      }
      continue;
    }
    if (Array.isArray(value)) {
      const picked = value.filter((v): v is string => typeof v === "string" && keys.has(v));
      if (picked.length > 0) Object.assign(clean, { [q.id]: picked });
    }
  }

  const skipped = input.skipped;
  if (Array.isArray(skipped)) {
    const ids = QUESTIONS.map((q) => q.id) as string[];
    clean.skipped = skipped.filter(
      (v): v is QuestionId => typeof v === "string" && ids.includes(v),
    );
  }
  return clean;
}

export function recordSkip(a: Answers, id: QuestionId): Answers {
  const skipped = a.skipped ?? [];
  return skipped.includes(id) ? a : { ...a, skipped: [...skipped, id] };
}

/**
 * Record one answer. Shared by the SMS parser and the web form so both surfaces
 * treat a correction the same way.
 */
export function setAnswer(a: Answers, q: Question, value: unknown): Answers {
  const next = { ...a, [q.id]: value } as Answers;
  // Household size sets the income band edges, so a later correction to size
  // must invalidate a band that was chosen against the old edges.
  if (q.id === "household_size" && a.income_band !== undefined) {
    delete next.income_band;
  }
  const skipped = next.skipped ?? [];
  if (skipped.includes(q.id)) next.skipped = skipped.filter((id) => id !== q.id);
  return next;
}

/** Apply one parsed SMS reply to the running answer set. */
export function applyAnswer(a: Answers, q: Question, parsed: Parsed): Answers {
  if (parsed.kind === "skip") return recordSkip(a, q.id);
  if (parsed.kind === "unparsed") return a;
  const value = (parsed.patch as Record<string, unknown>)[q.id];
  return setAnswer(a, q, value);
}

/** Yes/no questions carry no option list of their own — these are the labels. */
export const YES_NO: Record<Locale, { yes: string; no: string }> = {
  en: { yes: "Yes", no: "No" },
  "zh-Hans": { yes: "是", no: "否" },
  es: { yes: "Sí", no: "No" },
};

// ---------------------------------------------------------------------------
// What may be kept
// ---------------------------------------------------------------------------

/**
 * Route transiently, persist minimally. Everything in Answers lives in the
 * active screening only; when it finishes, these coarse flags and the referral
 * list are all that survive. No income band, no housing status, no disability
 * answer, and never the CalFresh citizenship branch.
 */
export function coarseFlags(a: Answers): string[] {
  const flags: string[] = [];
  const benefits = a.benefits ?? [];
  const children = a.children ?? [];

  if (a.senior === "yes") flags.push("senior");
  if (children.includes("under_5") || children.includes("5_17")) flags.push("has_kids");
  if (children.includes("under_5")) flags.push("young_child");
  if (a.pregnant === "yes") flags.push("pregnant");
  if (a.disability === "yes") flags.push("homebound_risk");
  if (a.kitchen === "neither") flags.push("no_kitchen");
  if (benefits.includes("calfresh")) flags.push("has_calfresh");
  if (benefits.includes("medical")) flags.push("has_medical");
  if (a.prefs) flags.push("has_diet_needs");
  return flags;
}

/** Answer keys that must never reach storage in any form. */
export const NEVER_PERSIST: QuestionId[] = ["citizen_branch"];

export function forStorage(a: Answers): Answers {
  const copy: Answers = { ...a };
  for (const id of NEVER_PERSIST) delete copy[id as keyof Answers];
  return copy;
}
