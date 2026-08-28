import type { Locale } from "./i18n";
import type { Answers, BandKey } from "./screening";

/**
 * The routing table.
 *
 * Screening answers in, a ranked list of programs out. Two things this file is
 * careful about:
 *
 *  - It estimates likelihood, never eligibility. Every real screener — USDA's,
 *    WIC's, GetCalFresh — says "likely eligible" pending an actual application,
 *    and so does this one.
 *  - It carries the negative rules too. Telling someone they can use their EBT
 *    at a restaurant when they cannot, or that CalFresh is theirs when the 2026
 *    rules say otherwise, costs them a wasted trip and their trust.
 *
 * Two federal rules changed in 2026 and are flagged rather than asserted:
 * H.R.1 narrowed CalFresh noncitizen eligibility on April 1 2026, and the ABAWD
 * work rules resumed June 1 2026. Any referral touching those carries a
 * verify-live flag so the message tells the person to confirm.
 */

// Bump when the rules below are re-checked against CDSS. /api/health reports it
// so a stale rule table is visible without reading the code.
export const RULES_REVIEWED = "2026-08-28";
export const RULES_STALE_AFTER_DAYS = 120;

export function rulesAgeDays(now: Date = new Date()): number {
  const reviewed = Date.parse(RULES_REVIEWED + "T00:00:00Z");
  return Math.floor((now.getTime() - reviewed) / 86_400_000);
}

export function rulesAreStale(now: Date = new Date()): boolean {
  return rulesAgeDays(now) > RULES_STALE_AFTER_DAYS;
}

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

export type ProgramKey =
  | "pantry" | "dining_room" | "calfresh" | "rmp" | "wic" | "csfp"
  | "sun_bucks" | "school_meals" | "calaim" | "hdg";

type ProgramInfo = {
  name: Record<Locale, string>;
  /** What to do next. The only hardcoded contact details in the service —
   *  review these before launch and whenever a provider changes them. */
  action: Record<Locale, string>;
  /** True when the person will be asked for documents. Say so up front. */
  documents: boolean;
};

export const PROGRAMS: Record<ProgramKey, ProgramInfo> = {
  pantry: {
    name: { en: "Food pantries", "zh-Hans": "食物领取点", es: "Despensas de comida" },
    action: {
      en: "Text FOOD for the closest one. No ID, no proof, no questions.",
      "zh-Hans": "回复 FOOD 查看最近地点。无需证件或证明。",
      es: "Envíe FOOD para el más cercano. Sin identificación ni pruebas.",
    },
    documents: false,
  },
  dining_room: {
    name: { en: "Free hot meals", "zh-Hans": "免费热食", es: "Comidas calientes gratis" },
    action: {
      en: "GLIDE, 330 Ellis St, 3 meals a day. St Anthony's, 121 Golden Gate Ave.",
      "zh-Hans": "GLIDE：330 Ellis St，每日三餐。St Anthony's：121 Golden Gate Ave。",
      es: "GLIDE, 330 Ellis St, 3 comidas al día. St Anthony's, 121 Golden Gate Ave.",
    },
    documents: false,
  },
  calfresh: {
    name: { en: "CalFresh (food money)", "zh-Hans": "CalFresh 食物补助", es: "CalFresh (dinero para comida)" },
    action: {
      en: "Apply free at getcalfresh.org, about 10 minutes.",
      "zh-Hans": "在 getcalfresh.org 免费申请，约 10 分钟。",
      es: "Solicite gratis en getcalfresh.org, unos 10 minutos.",
    },
    documents: true,
  },
  rmp: {
    name: { en: "Hot meals with your EBT card", "zh-Hans": "用 EBT 卡买熟食", es: "Comida caliente con su tarjeta EBT" },
    action: {
      en: "Restaurant Meals Program. Ask your county worker to turn it on.",
      "zh-Hans": "餐厅供餐计划（RMP）。请县福利专员为您开通。",
      es: "Programa de Comidas en Restaurantes. Pídale a su trabajador del condado que lo active.",
    },
    documents: false,
  },
  wic: {
    name: { en: "WIC", "zh-Hans": "WIC 妇幼营养", es: "WIC" },
    action: {
      en: "For pregnancy and kids under 5. Start at myfamily.wic.ca.gov.",
      "zh-Hans": "适用于孕期及 5 岁以下儿童。请访问 myfamily.wic.ca.gov。",
      es: "Para embarazo y niños menores de 5. Empiece en myfamily.wic.ca.gov.",
    },
    documents: true,
  },
  csfp: {
    name: { en: "Monthly senior food box", "zh-Hans": "长者每月食物箱", es: "Caja mensual para adultos mayores" },
    action: {
      en: "Free monthly groceries at 60+. Sign up at sfmfoodbank.org.",
      "zh-Hans": "60 岁以上每月免费食品。在 sfmfoodbank.org 报名。",
      es: "Comida gratis cada mes a los 60+. Inscríbase en sfmfoodbank.org.",
    },
    documents: true,
  },
  sun_bucks: {
    name: { en: "SUN Bucks (summer food for kids)", "zh-Hans": "SUN Bucks 暑期儿童食物金", es: "SUN Bucks (comida de verano)" },
    action: {
      en: "$120 per child for the summer. cdss.ca.gov/sunbucks.",
      "zh-Hans": "每个孩子暑期 $120。见 cdss.ca.gov/sunbucks。",
      es: "$120 por niño para el verano. cdss.ca.gov/sunbucks.",
    },
    documents: false,
  },
  school_meals: {
    name: { en: "Free school meals", "zh-Hans": "学校免费餐", es: "Comidas escolares gratis" },
    action: {
      en: "Every California student eats free. Still file the meal form — it unlocks SUN Bucks.",
      "zh-Hans": "加州所有学生均免费用餐。仍请填写餐费表，可开通 SUN Bucks。",
      es: "Todo estudiante en California come gratis. Llene igual el formulario: abre SUN Bucks.",
    },
    documents: false,
  },
  calaim: {
    name: { en: "Medically tailored meals", "zh-Hans": "医疗定制餐", es: "Comidas médicamente adaptadas" },
    action: {
      en: "Ask your Medi-Cal plan for Community Supports food. Plans differ.",
      "zh-Hans": "向您的 Medi-Cal 计划咨询 Community Supports 食物服务，各计划不同。",
      es: "Pregunte a su plan de Medi-Cal por comida de Community Supports. Varía por plan.",
    },
    documents: false,
  },
  hdg: {
    name: { en: "Groceries delivered to you", "zh-Hans": "食品送到家", es: "Comida entregada en su casa" },
    action: {
      en: "SF-Marin Food Bank home delivery. Starts about 2 weeks after signup.",
      "zh-Hans": "SF-Marin 食物银行送货上门，报名后约两周开始。",
      es: "Entrega a domicilio del SF-Marin Food Bank. Empieza unas 2 semanas después.",
    },
    documents: true,
  },
};

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

/** open_to_all: no eligibility at all. likely / possible: an estimate. */
export type Confidence = "open_to_all" | "likely" | "possible";

/** Rules that changed recently enough that we make the person confirm. */
export type VerifyFlag = "hr1_noncitizen" | "abawd" | "plan_dependent";

export type NoteKey =
  | "ssi_not_reduced" | "school_meals_universal" | "rmp_whole_household"
  | "verify_hr1" | "verify_abawd" | "documents_needed" | "not_a_decision";

export type Referral = {
  program: ProgramKey;
  confidence: Confidence;
  /** Machine-readable rule id. Shown to the model and counted in analytics. */
  reason: string;
  verify: VerifyFlag[];
  documents: boolean;
  priority: number;
};

export type Exclusion = { program: ProgramKey; reason: string };

export type Routing = {
  referrals: Referral[];
  excluded: Exclusion[];
  notes: NoteKey[];
};

// ---------------------------------------------------------------------------
// Income band helpers
// ---------------------------------------------------------------------------

const BAND_MAX_PCT: Record<BandKey, number | null> = {
  under_130: 130, "130_165": 165, "165_185": 185, "185_200": 200,
  over_200: null, unknown: null,
};
const BAND_MIN_PCT: Record<BandKey, number> = {
  under_130: 0, "130_165": 130, "165_185": 165, "185_200": 185,
  over_200: 200, unknown: 0,
};

/** True only when the whole band sits at or below the cutoff. */
export function atOrBelow(band: BandKey | undefined, pct: number): boolean {
  if (!band) return false;
  const max = BAND_MAX_PCT[band];
  return max !== null && max <= pct;
}

/** True only when the whole band sits above the cutoff. */
export function above(band: BandKey | undefined, pct: number): boolean {
  if (!band || band === "unknown") return false;
  return BAND_MIN_PCT[band] >= pct;
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

export function route(a: Answers): Routing {
  const referrals: Referral[] = [];
  const excluded: Exclusion[] = [];
  const notes = new Set<NoteKey>();

  const benefits = a.benefits ?? [];
  const children = a.children ?? [];
  const band = a.income_band;
  const senior = a.senior === "yes";
  const disabled = a.disability === "yes";
  const unhoused = a.housing === "shelter" || a.housing === "outside" || a.housing === "hotel";
  const noKitchen = a.kitchen === "neither" || a.kitchen === "one";
  const hasCalfresh = benefits.includes("calfresh");

  const add = (
    program: ProgramKey,
    confidence: Confidence,
    reason: string,
    priority: number,
    verify: VerifyFlag[] = [],
  ) => {
    referrals.push({
      program,
      confidence,
      reason,
      verify,
      documents: PROGRAMS[program].documents,
      priority,
    });
  };

  // --- the floor, always ---------------------------------------------------
  // Pantries and dining rooms have no eligibility test at all, so there is
  // always something to give — before, during, and after any screening.
  add("pantry", "open_to_all", "no_eligibility_required", 10);
  if (noKitchen || unhoused) {
    add("dining_room", "open_to_all", noKitchen ? "no_cooking_or_storage" : "unhoused", 1);
  }

  // --- CalFresh ------------------------------------------------------------
  if (!hasCalfresh) {
    // A green card / citizenship "yes" clears the H.R.1 question; anything
    // else — "no", skipped, never asked — means we flag rather than promise.
    const hr1: VerifyFlag[] = a.citizen_branch === "yes" ? [] : ["hr1_noncitizen"];
    // ABAWD: adults 18-64 with no dependent child under 14 and no disability
    // face a 3-in-36-month time limit again. Our age buckets stop at "under 5",
    // so a school-age child leaves it genuinely uncertain — flag it.
    const childUnder14 = children.includes("under_5");
    const abawd: VerifyFlag[] =
      !senior && !disabled && !childUnder14 ? ["abawd"] : [];
    const verify = [...hr1, ...abawd];

    if (benefits.includes("calworks")) {
      // Categorically eligible: CalWORKs/GA/GR settles it without an income test.
      add("calfresh", "likely", "categorical_calworks", 2, hr1);
    } else if (atOrBelow(band, 200)) {
      add("calfresh", "likely", "gross_income_under_200_fpl", 2, verify);
    } else if (above(band, 200) && (senior || disabled)) {
      // Over the gross limit, an elderly or disabled household still gets the
      // net-income test, which deductions often bring them under.
      add("calfresh", "possible", "net_income_test_senior_or_disabled", 2, hr1);
    } else if (benefits.includes("ssi")) {
      add("calfresh", "possible", "ssi_recipient_eligible_since_2019", 2, hr1);
    } else if (!band || band === "unknown") {
      add("calfresh", "possible", "income_unknown", 2, verify);
    } else {
      excluded.push({ program: "calfresh", reason: "gross_income_over_200_fpl" });
    }

    if (benefits.includes("ssi")) notes.add("ssi_not_reduced");
    if (referrals.some((r) => r.verify.includes("hr1_noncitizen"))) notes.add("verify_hr1");
    if (referrals.some((r) => r.verify.includes("abawd"))) notes.add("verify_abawd");
  }

  // --- Restaurant Meals Program -------------------------------------------
  const willHaveCalfresh = hasCalfresh || referrals.some((r) => r.program === "calfresh");
  if (willHaveCalfresh) {
    if (senior || disabled || unhoused) {
      // Since May 19 2025 every member of the household must be RMP-eligible,
      // and a screening cannot establish that for a household of several.
      const solo = (a.household_size ?? 1) === 1;
      add("rmp", solo ? "likely" : "possible", "calfresh_and_senior_disabled_or_homeless", 8);
      if (!solo) notes.add("rmp_whole_household");
    } else {
      excluded.push({ program: "rmp", reason: "requires_senior_disabled_or_homeless" });
    }
  }

  // --- WIC -----------------------------------------------------------------
  if (a.pregnant === "yes" || children.includes("under_5")) {
    const adjunctive =
      benefits.includes("medical") || hasCalfresh || benefits.includes("calworks");
    const likely = adjunctive || atOrBelow(band, 185);
    if (likely || !above(band, 185)) {
      add("wic", likely ? "likely" : "possible",
        adjunctive ? "adjunctive_via_medi_cal_calfresh_or_calworks" : "income_under_185_fpl", 3);
    } else {
      excluded.push({ program: "wic", reason: "income_over_185_fpl_and_no_adjunctive_program" });
    }
  }

  // --- Senior food box -----------------------------------------------------
  if (senior) {
    if (atOrBelow(band, 130)) {
      add("csfp", "likely", "age_60_plus_income_under_130_fpl", 5);
    } else if (!band || band === "unknown") {
      add("csfp", "possible", "age_60_plus_income_unknown", 5);
    } else {
      excluded.push({ program: "csfp", reason: "income_over_130_fpl" });
    }
  }

  // --- Children ------------------------------------------------------------
  if (children.includes("5_17")) {
    // Universal in California: no income line, no application, no exceptions.
    add("school_meals", "open_to_all", "california_universal_school_meals", 7);
    notes.add("school_meals_universal");
    const auto = hasCalfresh || benefits.includes("calworks") || benefits.includes("medical");
    add("sun_bucks", auto ? "likely" : "possible",
      auto ? "auto_enrolled_via_existing_benefit" : "apply_via_school_meal_form", 6);
  }

  // --- CalAIM medically supportive food ------------------------------------
  if (benefits.includes("medical")) {
    if (a.chronic === "yes") {
      // Optional for plans, referral-based, and never available for food
      // insecurity on its own — so it is possible, never likely.
      add("calaim", "possible", "medi_cal_with_nutrition_sensitive_condition", 9, ["plan_dependent"]);
      notes.add("not_a_decision");
    } else if (a.chronic === "no") {
      excluded.push({ program: "calaim", reason: "requires_a_clinical_condition" });
    }
  }

  // --- Home-delivered groceries -------------------------------------------
  const canReceiveDelivery = a.housing === "own_place" || a.housing === "with_others";
  const deliveryCategory =
    disabled || senior || a.pregnant === "yes" || children.includes("under_5");
  if (canReceiveDelivery && deliveryCategory) {
    add("hdg", disabled || a.pregnant === "yes" ? "likely" : "possible",
      "homebound_senior_disabled_pregnant_or_infant_caregiver", 4);
  } else if (deliveryCategory && unhoused) {
    excluded.push({ program: "hdg", reason: "needs_an_address_to_deliver_to" });
  }

  if (referrals.some((r) => r.documents)) notes.add("documents_needed");
  notes.add("not_a_decision");

  referrals.sort((x, y) => x.priority - y.priority);
  return { referrals, excluded, notes: [...notes] };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const NOTE_COPY: Record<NoteKey, Record<Locale, string>> = {
  ssi_not_reduced: {
    en: "Getting CalFresh will not lower your SSI.",
    "zh-Hans": "领取 CalFresh 不会减少您的 SSI。",
    es: "Recibir CalFresh no reduce su SSI.",
  },
  school_meals_universal: {
    en: "School meals are free for every student, whatever you earn.",
    "zh-Hans": "无论收入多少，学校餐对所有学生免费。",
    es: "Las comidas escolares son gratis para todos, sin importar sus ingresos.",
  },
  rmp_whole_household: {
    en: "For EBT at restaurants, everyone in the household must qualify.",
    "zh-Hans": "EBT 用于餐厅时，家中每个人都须符合条件。",
    es: "Para usar EBT en restaurantes, todos en el hogar deben calificar.",
  },
  verify_hr1: {
    en: "CalFresh rules for non-citizens changed in April 2026 — confirm with a county worker.",
    "zh-Hans": "2026 年 4 月起非公民的 CalFresh 规定有变，请向县福利专员确认。",
    es: "Las reglas de CalFresh para no ciudadanos cambiaron en abril de 2026 — confirme con el condado.",
  },
  verify_abawd: {
    en: "Adults 18-64 without kids now face CalFresh work rules — ask what applies to you.",
    "zh-Hans": "18-64 岁无子女成人现受 CalFresh 工作规定限制，请咨询适用情况。",
    es: "Adultos de 18-64 sin hijos ahora tienen reglas de trabajo de CalFresh — pregunte cuáles aplican.",
  },
  documents_needed: {
    en: "Some of these ask for ID or proof of income. Pantries never do.",
    "zh-Hans": "部分项目需要证件或收入证明。食物领取点从不需要。",
    es: "Algunos piden identificación o comprobante de ingresos. Las despensas nunca.",
  },
  not_a_decision: {
    en: "This is an estimate, not a decision. The county decides.",
    "zh-Hans": "这只是估计，不是决定，最终由县政府决定。",
    es: "Esto es una estimación, no una decisión. El condado decide.",
  },
};

export function noteText(note: NoteKey, locale: Locale): string {
  return NOTE_COPY[note][locale];
}

export function programName(program: ProgramKey, locale: Locale): string {
  return PROGRAMS[program].name[locale];
}

export function programAction(program: ProgramKey, locale: Locale): string {
  return PROGRAMS[program].action[locale];
}

const RESULT_HEADER: Record<Locale, string> = {
  en: "You may be able to get:",
  "zh-Hans": "您可能可以获得：",
  es: "Puede que califique para:",
};

const NOTHING_MORE: Record<Locale, string> = {
  en: "Nothing extra came up, but pantries are open to anyone. Text FOOD for the closest.",
  "zh-Hans": "没有额外项目，但食物领取点对所有人开放。回复 FOOD 查看最近地点。",
  es: "No salió nada extra, pero las despensas son para todos. Envíe FOOD para la más cercana.",
};

// Three segments for the payoff message of the whole screening — the same
// shape of budget the food results get in agent.ts, and for the same reason:
// this one is the content, not a notification.
const RESULT_BUDGET: Record<Locale, number> = { en: 440, "zh-Hans": 195, es: 440 };

/**
 * The results SMS, before the GSM-7 fold the send path applies. Three programs
 * at most, and fewer if they do not fit: a
 * message that runs to five segments gets skimmed and none of it gets acted
 * on. The caveats never get trimmed — a wrong promise costs more than a
 * missed program — so the program list is what gives way.
 */
export function renderReferralSms(
  routing: Routing,
  locale: Locale,
  limit = 3,
): string {
  const picks = routing.referrals
    .filter((r) => r.confidence !== "open_to_all" || r.program !== "pantry")
    .slice(0, limit);
  if (picks.length === 0) return NOTHING_MORE[locale];

  const caveats: NoteKey[] = routing.notes.filter(
    (n): n is NoteKey => n === "verify_hr1" || n === "verify_abawd" || n === "ssi_not_reduced",
  );
  const tail = [
    ...caveats.slice(0, 1).map((n) => noteText(n, locale)),
    noteText("not_a_decision", locale),
  ];

  const build = (n: number) =>
    [
      RESULT_HEADER[locale],
      ...picks.slice(0, n).map(
        (r) => `${programName(r.program, locale)}: ${programAction(r.program, locale)}`,
      ),
      ...tail,
    ].join("\n");

  for (let n = picks.length; n > 1; n--) {
    const text = build(n);
    if (text.length <= RESULT_BUDGET[locale]) return text;
  }
  return build(1).slice(0, RESULT_BUDGET[locale]);
}

/**
 * What the model is allowed to know about eligibility. It gets the decision,
 * never the raw answers, and never a chance to invent a rule of its own.
 */
export function forModel(routing: Routing, locale: Locale) {
  return {
    likely_eligible: routing.referrals
      .filter((r) => r.confidence !== "open_to_all")
      .map((r) => ({
        program: r.program,
        name: programName(r.program, locale),
        confidence: r.confidence,
        why: r.reason,
        how_to_apply: programAction(r.program, locale),
        asks_for_documents: r.documents,
        verify_before_promising: r.verify,
      })),
    open_to_everyone: routing.referrals
      .filter((r) => r.confidence === "open_to_all")
      .map((r) => ({
        program: r.program,
        name: programName(r.program, locale),
        how_to_get_it: programAction(r.program, locale),
      })),
    do_not_suggest: routing.excluded.map((e) => ({
      program: e.program,
      name: programName(e.program, locale),
      because: e.reason,
    })),
    must_say: routing.notes.map((n) => noteText(n, locale)),
    rules_reviewed: RULES_REVIEWED,
  };
}
