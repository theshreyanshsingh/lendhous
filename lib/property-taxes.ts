// Property-tax status on every funded loan (docs/competitor-gaps-2026-11-09.md, rank 7). No LendHous loan escrows
// taxes, so until now a missed bill surfaced only when LendHous paid it as an advance in collections, and an unpaid
// Florida tax bill turns into a tax certificate: a lien that comes ahead of the mortgage. The team records each parcel
// and what the county's tax collector shows for the year's bill; from March the loans whose bill isn't paid come up in
// the work queue, and the nightly check reminds the team and the borrower once at each step.
//
// Florida's calendar (Fla. Stat. ch. 197): a year's bills go out on November 1, or as soon after as the tax roll is
// certified (197.333), with a discount for paying early, 4% in November down to 1% in February (197.162). They're
// delinquent on April 1 (197.333). The tax collector sells a tax certificate on a delinquent parcel by June 1 (197.432).
// These dates are from the statutes as LendHous's notes record them; the ranked list flagged the calendar as unsourced,
// so the attorney or a county tax collector confirms them before anyone relies on the exact days. A late tax roll moves
// them, which the team would see on the county's site. Pure, so the server, the job and the screens agree.
import type { Deal, TaxCheck } from "./mockData";
import { SERVICED } from "./servicing";

export const TAX_STATUS: Record<TaxCheck["status"], string> = { paid: "Paid", unpaid: "Not paid yet", delinquent: "Delinquent", certificate_sold: "Tax certificate sold" };

/** The year whose bill matters today: this year's from November 1, last year's before that. */
export const billYear = (today: string) => (Number(today.slice(5, 7)) >= 11 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1);

/** The newest check of each parcel's bill for a year. */
export function latestChecks(deal: Pick<Deal, "taxes">, year: number) {
  const latest = new Map<string, TaxCheck>();
  for (const check of deal.taxes?.checks ?? []) {
    if (check.year !== year) continue;
    const had = latest.get(check.parcel);
    if (!had || check.checkedOn > had.checkedOn || (check.checkedOn === had.checkedOn && check.at >= had.at)) latest.set(check.parcel, check);
  }
  return latest;
}

export type TaxStage = "no_parcel" | "due_soon" | "delinquent" | "certificate";

/**
 * Where a funded loan's taxes stand today, or null when nothing needs doing: no step before March, nothing once every
 * parcel's bill is paid, and nothing for a bill settled at closing (a loan that closed after it went delinquent).
 */
export function taxStage(deal: Pick<Deal, "status" | "closingDate" | "taxes">, today: string): TaxStage | null {
  if (!SERVICED.includes(deal.status)) return null;
  const parcels = deal.taxes?.parcels ?? [];
  if (!parcels.length) return "no_parcel";
  const year = billYear(today);
  if (deal.closingDate >= `${year + 1}-04-01`) return null;
  const latest = latestChecks(deal, year);
  const unpaid = parcels.filter((parcel) => latest.get(parcel)?.status !== "paid");
  if (!unpaid.length) return null;
  if (unpaid.some((parcel) => latest.get(parcel)?.status === "certificate_sold") || today >= `${year + 1}-06-01`) return "certificate";
  if (today >= `${year + 1}-04-01`) return "delinquent";
  return today >= `${year + 1}-03-01` ? "due_soon" : null;
}

/** What the team does about it, for the work queue and the loan's page. */
export function taxTask(deal: Pick<Deal, "status" | "closingDate" | "taxes">, today: string) {
  const stage = taxStage(deal, today);
  const year = billYear(today);
  if (stage === "no_parcel") return "Add the property's tax parcel number";
  if (stage === "due_soon") return `Check the ${year} property taxes: due by March 31`;
  if (stage === "delinquent") return `${year} property taxes delinquent: get them paid before a tax certificate is sold`;
  if (stage === "certificate") return `${year} taxes: a tax certificate is or will be sold, ahead of the mortgage. Get it redeemed`;
  return null;
}

/** The reminder this check owes the loan today, once per step and year, or null. */
export function taxReminder(deal: Pick<Deal, "status" | "closingDate" | "taxes">, today: string) {
  const stage = taxStage(deal, today);
  if (!stage || stage === "no_parcel") return null;
  const key = `${billYear(today)}:${stage}`;
  return deal.taxes?.reminded?.includes(key) ? null : key;
}

/** Why this check can't be recorded, or null. */
export function taxCheckProblem(deal: Pick<Deal, "taxes"> | undefined, check: Omit<TaxCheck, "id" | "by" | "at">, today: string) {
  if (!deal) return "That loan no longer exists.";
  if (!(deal.taxes?.parcels ?? []).includes(check.parcel)) return "Add the parcel to the loan first.";
  if (!Number.isInteger(check.year) || check.year < 2000 || check.year > billYear(today)) return "Choose a tax year whose bill has gone out.";
  if (!(check.status in TAX_STATUS)) return "Choose what the county shows.";
  if (check.amount !== undefined && !(check.amount >= 0)) return "Enter the bill's amount, or leave it blank.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(check.checkedOn) || check.checkedOn > today) return "Enter the day you checked, today or earlier.";
  if (check.status === "paid" && check.paidOn && (!/^\d{4}-\d{2}-\d{2}$/.test(check.paidOn) || check.paidOn > check.checkedOn)) return "The day it was paid is on or before the day you checked.";
  return null;
}

/** Tidies parcel numbers as typed: one per line or comma, no blanks or repeats, at most 20. */
export const cleanParcels = (parcels: string[]) => [...new Set(parcels.map((parcel) => parcel.trim().toUpperCase()).filter(Boolean))].slice(0, 20);
