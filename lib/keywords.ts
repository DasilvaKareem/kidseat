export type Keyword = "STOP" | "START" | "HELP" | "YES" | "FOOD" | "LANG" | null;

// Carrier-mandated English keywords must work no matter what language the
// person picked. Localized aliases are added on top, never in place of them.
const STOP = ["stop","stopall","unsubscribe","unsub","cancel","end","quit",
  "退订","停止","取消","parar","alto","baja","cancelar"];
const START = ["start","unstop","yes","si","sí","是","好","订阅","subscribe","sub"];
const HELP = ["help","info","ayuda","帮助","信息"];
const FOOD = ["food","eat","hungry","comida","hambre","食物","吃","饿"];
const LANG = ["lang","language","idioma","语言"];

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:'"“”‘’。，！？、]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Only the first word is treated as a command, and only when the message is
 * short. "stop by the pantry tomorrow?" is a question, not an opt-out.
 */
export function parseKeyword(text: string): Keyword {
  const t = normalize(text);
  if (!t) return null;
  const first = t.split(" ")[0];
  const isShort = t.length <= 24;

  if (STOP.includes(first) && isShort) return "STOP";
  if (HELP.includes(first) && isShort) return "HELP";
  if (LANG.includes(first) && isShort) return "LANG";
  if (START.includes(first) && isShort) return first === "start" || first === "unstop" ? "START" : "YES";
  if (FOOD.includes(first) && isShort) return "FOOD";
  return null;
}
