// Who lives in the property (docs/competitor-gaps-2026-11-09.md, rank 26). Two moments matter. Before a rental loan closes,
// the processor reviews the leases and tenants: a tenant who rented with a forged ID or paystubs is a felony in Florida
// since October 1, 2026, and the landlord can end that lease on 7 days' notice (ch. 2026-143), so the red flags are worth
// catching before the rent sizes the loan. The lease file also has the addendum where the tenant agreed to take notices
// by email (ch. 2025-16), and the landlord's flood disclosure on leases of a year or more (Fla. Stat. 83.512). After a
// foreclosure, when LendHous owns the property, someone may be living there: a tenant (who keeps federal protections),
// the former owner (a writ of possession from the foreclosure court), or people with no right to be there, whom the
// county sheriff removes on LendHous's verified complaint when every condition of 82.036 holds. The session laws' wording
// is from LendHous's research notes; the attorney confirms it (PLACEHOLDER). Pure.
import type { Deal, LeaseReview, ReoOccupancy } from "./mockData";

/** Red flags a processor looks for in a rental's leases and tenants. */
export const TENANT_FLAGS = {
  rent_above_market: "The rent is well above what the appraisal says the market pays",
  related_tenant: "The tenant is related to, or works for, the borrower",
  new_lease: "The lease was signed shortly before the application",
  no_deposit: "No security deposit, or it doesn't show in the bank statements",
  cash_rent: "Rent is paid in cash, or doesn't show in the bank statements",
  documents_edited: "The tenant's ID, paystubs or bank statements look edited",
  unverified_income: "The tenant's employer or income can't be verified",
} as const;
export type TenantFlag = keyof typeof TENANT_FLAGS;

export const ANSWERS = { yes: "Yes", no: "No", na: "Not needed" } as const;

/** A rental on a lease, where the leases and tenants are reviewed. */
export const leaseReviewApplies = (deal: Pick<Deal, "app">) => deal.app.product === "dscr" && (deal.app.rentalType ?? "long_term") === "long_term" && deal.app.occupancy === "tenant";

export type LeaseNote = { tone: "bad" | "warn" | "note"; text: string };

/** What the lease review says the team should act on, worst first. */
export function leaseNotes(deal: Pick<Deal, "app" | "leaseReview" | "fileChecks">): LeaseNote[] {
  if (!leaseReviewApplies(deal)) return [];
  const review = deal.leaseReview;
  // An uploaded lease or tenant file that looks edited is a red flag on its own (lib/pdf-signals.ts).
  const edited = (deal.fileChecks ?? []).filter((check) => /lease|rent|tenant/i.test(check.label) && check.flags.some((flag) => flag.level === "warn"));
  const notes: LeaseNote[] = edited.map((check) => ({ tone: "bad", text: `${check.fileName} shows signs of editing: check it against the original with the tenant or the property manager.` }));
  if (!review) return [...notes, { tone: "note", text: "The leases and tenants haven't been reviewed yet." }];
  if (review.flags.length) notes.push({ tone: "bad", text: `${review.flags.length} red flag${review.flags.length === 1 ? "" : "s"}: ${review.flags.map((flag) => TENANT_FLAGS[flag].toLowerCase()).join("; ")}. Size the loan on market rent until they're cleared. A tenant who rented with forged papers can be given 7 days' notice (ch. 2026-143).` });
  if (review.floodDisclosure === "no") notes.push({ tone: "warn", text: "No landlord's flood disclosure on a lease of a year or more: after a flood, that tenant can end the lease (Fla. Stat. 83.512). Have the borrower give it at the next renewal." });
  if (review.emailAddendum === "no") notes.push({ tone: "note", text: "No email notice addendum, so notices to the tenant go by hand or mail (ch. 2025-16). Worth adding at renewal: it's faster if the loan ever needs them." });
  return notes;
}

export type LeaseReviewInput = Omit<LeaseReview, "by" | "at">;

export function leaseReviewProblem(deal: Pick<Deal, "app"> | undefined, input: LeaseReviewInput) {
  if (!deal || !leaseReviewApplies(deal)) return "Only a rental with tenants on a lease has its leases reviewed.";
  if (input.flags.some((flag) => !(flag in TENANT_FLAGS))) return "Choose the red flags from the list.";
  if (!(input.emailAddendum in ANSWERS) || !(input.floodDisclosure in ANSWERS)) return "Answer each question about the lease file.";
  if (input.flags.length && !input.note.trim()) return "Say what you found, so the underwriter can clear or keep each flag.";
  return null;
}

/** Fla. Stat. 82.036(2): every one has to hold before the sheriff can be asked. */
export const SHERIFF_CONDITIONS = {
  owner: "LendHous owns the property (or the person filing is its authorized agent)",
  dwelling: "The property includes a residential dwelling",
  unlawful: "The people entered unlawfully and remain there",
  closed: "The property wasn't open to the public when they entered",
  told: "LendHous (or its agent) has told them to leave",
  not_tenant: "They aren't current or former tenants under any written or oral lease LendHous or the former owner authorized",
  not_family: "They aren't immediate family of the owner",
  no_suit: "There's no pending lawsuit about the property between LendHous and any of them",
} as const;
export type SheriffCondition = keyof typeof SHERIFF_CONDITIONS;

export const OCCUPANCY_STATE: Record<ReoOccupancy["state"], string> = { unknown: "Not checked yet", vacant: "Vacant", former_owner: "The former owner is still there", tenant: "A tenant is living there", squatter: "People with no right to be there" };

/** What to do about who's in a bank-owned property. */
export function occupancyGuide(state: ReoOccupancy["state"]) {
  switch (state) {
    case "unknown": return "Have the inspector drive by and look, without going in: lights, cars, a lockbox, mail piling up.";
    case "vacant": return "Change the locks, winterize if it's needed, and check it every week: a vacant house invites squatters. Make sure the policy covers a vacant property.";
    case "former_owner": return "The former owner stayed after the certificate of title: the foreclosure attorney asks the foreclosure court for a writ of possession, which the sheriff serves.";
    case "tenant": return "A bona fide tenant keeps the lease (or gets at least 90 days' notice) under the federal Protecting Tenants at Foreclosure Act. Removing a tenant is an eviction under Florida's landlord and tenant law, not the sheriff's complaint.";
    case "squatter": return "Florida lets the owner ask the county sheriff to remove people living there unlawfully, on a verified complaint (Fla. Stat. 82.036), when every condition below holds. If one doesn't, it's an unlawful detainer suit instead: ask the attorney.";
  }
}

/** Why the sheriff can't be asked yet, or null. */
export function sheriffProblem(occupancy: Pick<ReoOccupancy, "state" | "confirmed">) {
  if (occupancy.state !== "squatter") return "The sheriff's complaint is only for people with no right to be there.";
  const missing = (Object.keys(SHERIFF_CONDITIONS) as SheriffCondition[]).filter((key) => !occupancy.confirmed?.includes(key));
  return missing.length ? `Confirm every condition first: ${missing.length} ${missing.length === 1 ? "isn't" : "aren't"} confirmed.` : null;
}

export type OccupancyInput = Omit<ReoOccupancy, "by" | "at">;

export function occupancyProblem(deal: Pick<Deal, "status" | "reo" | "app"> | undefined, input: OccupancyInput, today: string) {
  if (!deal?.reo || deal.status !== "reo") return "Only a property LendHous owns after a foreclosure has its occupancy recorded here.";
  if (!(input.state in OCCUPANCY_STATE)) return "Choose who's living there.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.checkedOn) || input.checkedOn > today) return "Enter the day it was checked, today or earlier.";
  if ((input.confirmed ?? []).some((key) => !(key in SHERIFF_CONDITIONS))) return "Confirm conditions from the list.";
  if (input.sheriff) {
    const refused = sheriffProblem(input);
    if (refused) return refused;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.sheriff.filedOn) || input.sheriff.filedOn > today) return "Enter the day the complaint was filed, today or earlier.";
    if (!input.sheriff.county.trim()) return "Name the county the sheriff serves.";
    if (input.sheriff.outcome && (!input.sheriff.outcomeOn || input.sheriff.outcomeOn < input.sheriff.filedOn || input.sheriff.outcomeOn > today)) return "Enter the day the sheriff acted, after the filing and today or earlier.";
  }
  return null;
}
