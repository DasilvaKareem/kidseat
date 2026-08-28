// v1 service area: San Francisco County + Marin County.
// Anything outside this goes to the waitlist screen with a 211 referral —
// never a dead end.
const SF = [
  "94102","94103","94104","94105","94107","94108","94109","94110","94111","94112",
  "94114","94115","94116","94117","94118","94121","94122","94123","94124","94127",
  "94129","94130","94131","94132","94133","94134","94158",
];
const MARIN = [
  "94901","94903","94904","94920","94924","94925","94929","94930","94933","94937",
  "94938","94939","94940","94941","94945","94946","94947","94949","94950","94956",
  "94957","94960","94963","94964","94965","94970","94971","94973",
];

export const SERVICE_AREA = new Set([...SF, ...MARIN]);

export function isValidZip(zip: string): boolean {
  return /^\d{5}$/.test(zip);
}

export function inServiceArea(zip: string): boolean {
  return SERVICE_AREA.has(zip);
}

export function countyOf(zip: string): "sf" | "marin" | null {
  if (SF.includes(zip)) return "sf";
  if (MARIN.includes(zip)) return "marin";
  return null;
}
