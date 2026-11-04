export function q(sp: Record<string, string | string[] | undefined>, key: string) {
  const value = sp[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/**
 * A date as people read it: "Nov 13, 2026". Takes a day (YYYY-MM-DD, read as that calendar day) or a timestamp (shown
 * as the day it was in Florida). Spreadsheets keep the ISO form.
 */
export function shortDay(value: string | undefined | null) {
  if (!value) return "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(day ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: day ? "UTC" : "America/New_York" });
}

/** How far off a closing date is, in words. */
export function closingIn(day: string, today: string) {
  const left = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return left > 1 ? `${left} days to go` : left === 1 ? "tomorrow" : left === 0 ? "today" : `${-left} day${left === -1 ? "" : "s"} past`;
}
