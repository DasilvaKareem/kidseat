import type { Locale } from "./i18n";

// SMS copy is deliberately separate from UI copy. Chinese sends as UCS-2:
// 70 chars for a single segment, 67 per segment once concatenated.
// See scripts/check-sms-length.ts — CI fails if any template exceeds 2 segments.

export type TemplateKey =
  | "confirm"
  | "reminder"
  | "welcome"
  | "stop_ack"
  | "help"
  | "no_results"
  | "login_code"
  | "screen_intro"
  | "screen_retry"
  | "screen_stopped";

export const SMS: Record<TemplateKey, Record<Locale, string>> = {
  confirm: {
    en: "SF FOOD: Reply YES to get free food alerts. Reply STOP to quit. Msg&data rates may apply.",
    "zh-Hans": "SF FOOD：回复 YES 接收免费食物提醒。回复 STOP 退订。可能产生短信/数据费用。",
    es: "SF FOOD: Responda YES para recibir avisos de comida gratis. Responda STOP para cancelar.",
  },
  reminder: {
    en: "SF FOOD: Still want free food alerts near you? Reply YES. Reply STOP to quit.",
    "zh-Hans": "SF FOOD：仍想接收附近免费食物提醒吗？回复 YES。回复 STOP 退订。",
    es: "SF FOOD: ¿Aun quiere avisos de comida gratis? Responda YES. Responda STOP para cancelar.",
  },
  welcome: {
    en: "You're in. We'll text free food near {zip}. Text FOOD anytime for food now. STOP to quit.",
    "zh-Hans": "已订阅。{zip} 附近有免费食物时通知您。回复 FOOD 立即查找。回复 STOP 退订。",
    es: "Listo. Le avisamos de comida gratis cerca de {zip}. Envie FOOD para buscar. STOP para salir.",
  },
  stop_ack: {
    en: "You will get no more texts from SF FOOD. Text START to rejoin.",
    "zh-Hans": "您将不再收到 SF FOOD 的短信。回复 START 重新订阅。",
    es: "No recibira mas mensajes de SF FOOD. Envie START para volver.",
  },
  help: {
    en: "SF FOOD: free food near you. Text FOOD for sites, STOP to quit. Help: 211.",
    "zh-Hans": "SF FOOD：查找附近免费食物。回复 FOOD 查看地点，STOP 退订。帮助：211。",
    es: "SF FOOD: comida gratis cerca. Envie FOOD para lugares, STOP para salir. Ayuda: 211.",
  },
  login_code: {
    en: "SF FOOD: your code is {code}. It expires in 10 minutes.",
    "zh-Hans": "SF FOOD：您的验证码是 {code}。10 分钟内有效。",
    es: "SF FOOD: su codigo es {code}. Vence en 10 minutos.",
  },
  // The screening opens by giving something away, not by asking: a pantry is
  // open to anyone today whether or not the person answers a single question.
  screen_intro: {
    en: "SF FOOD: a few questions to find what else you can get. Reply SKIP to any. Text FOOD anytime for a pantry now.",
    "zh-Hans": "SF FOOD：几个问题，看看您还能获得什么。可回复 SKIP 跳过。随时回复 FOOD 查找领取点。",
    es: "SF FOOD: unas preguntas para ver que mas puede recibir. Responda SKIP para omitir. Envie FOOD para una despensa ahora.",
  },
  screen_retry: {
    en: "Sorry, I did not catch that. Reply with a number, or SKIP.",
    "zh-Hans": "抱歉，未能识别。请回复数字，或回复 SKIP 跳过。",
    es: "Perdon, no entendi. Responda con un numero, o SKIP.",
  },
  screen_stopped: {
    en: "Stopped the questions. Text CHECK anytime to pick it back up.",
    "zh-Hans": "已停止提问。随时回复 CHECK 继续。",
    es: "Preguntas detenidas. Envie CHECK cuando quiera continuar.",
  },
  no_results: {
    en: "No open food sites near {zip} right now. We'll text you when one opens. Or call 211.",
    "zh-Hans": "{zip} 附近目前没有开放的领取点。有开放时我们会通知您。或拨打 211。",
    es: "No hay lugares abiertos cerca de {zip} ahora. Le avisaremos. O llame al 211.",
  },
};

export function render(
  key: TemplateKey,
  locale: Locale,
  vars: Record<string, string> = {},
): string {
  const raw = SMS[key][locale] ?? SMS[key].en;
  return raw.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}

const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";

// Spanish and English copy written for a screen carries characters GSM-7 does
// not have — á, í, ó, ú, an em dash, curly quotes — and a single one of them
// flips the whole message to UCS-2, cutting the segment from 153 characters to
// 67. Folding them costs an accent; not folding them doubles the send cost and
// can push a message the person needs into a third segment. The web keeps the
// real characters; only the SMS render folds.
const FOLD: Record<string, string> = {
  "á": "a", "í": "i", "ó": "o", "ú": "u", "Á": "A", "Í": "I", "Ó": "O", "Ú": "U",
  "—": "-", "–": "-", "’": "'", "‘": "'", "“": '"', "”": '"', "…": "...",
};

export function smsSafe(text: string): string {
  return text.replace(/[áíóúÁÍÓÚ—–’‘“”…]/g, (c) => FOLD[c] ?? c);
}

export function encodingOf(text: string): "GSM-7" | "UCS-2" {
  for (const ch of text) {
    if (!GSM7.includes(ch) && !GSM7_EXT.includes(ch)) return "UCS-2";
  }
  return "GSM-7";
}

export function segmentsOf(text: string): {
  encoding: "GSM-7" | "UCS-2";
  units: number;
  segments: number;
} {
  const encoding = encodingOf(text);
  if (encoding === "GSM-7") {
    let units = 0;
    for (const ch of text) units += GSM7_EXT.includes(ch) ? 2 : 1;
    return { encoding, units, segments: units <= 160 ? 1 : Math.ceil(units / 153) };
  }
  // UCS-2 counts UTF-16 code units, so an emoji or rare CJK char costs 2.
  const units = text.length;
  return { encoding, units, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}
