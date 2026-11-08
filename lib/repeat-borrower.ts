// Repeat borrowers (docs/next-features-prompt.md, G). Loans paid as agreed with LendHous count toward the next loan's
// pricing, a late payment pauses that, and what was accepted on an earlier loan carries over to the next one while it's
// still fresh. Pure, so the book's reducer, the deal page and the tests count the same way.
import type { Deal, Doc, Sponsor } from "./mockData";
import { addDays, addMonths, asOfFor, ledgerOf, SERVICED } from "./servicing";

/** How far back loans count, and how far back a late payment pauses the cut (research: Kiavi and Backflip use 24 months). */
export const REPEAT_WINDOW_MONTHS = 24;

/** What a borrower's history with LendHous comes to when a new loan is submitted. Kept on the application; set by the server. */
export type RepeatRecord = {
  /** Loans funded in the window and paid as agreed: no late payment and not in default. */
  loans: number;
  counted: string[];
  /** The loan whose late payment (or default) pauses the cut, if any. */
  pausedBy?: string;
  asOf: string;
};

const ACTIVE = new Set([...SERVICED, "paid_off", "reo"]);

/** The payments a loan was late on (past grace, fee not waived) that fell due on or after a day. */
function latePayments(deal: Deal, since: string) {
  const asOf = deal.paidOff && deal.paidOff.receivedOn < asOfFor(deal) ? deal.paidOff.receivedOn : asOfFor(deal);
  return ledgerOf(deal, asOf).rows.filter((row) => row.late && !row.waived && row.due >= since && row.due <= asOf);
}

/**
 * A borrower's loans with LendHous as of a day: the ones funded in the last 24 months and paid as agreed count, and any
 * late payment or default in that window pauses the cut until it's 24 months behind them.
 */
export function repeatHistory(deals: Deal[], borrowerId: string, today: string): RepeatRecord {
  const since = addMonths(today, -REPEAT_WINDOW_MONTHS);
  const theirs = deals.filter((deal) => deal.borrowerId === borrowerId && ACTIVE.has(deal.status) && deal.closingDate <= today)
    .sort((a, b) => b.closingDate.localeCompare(a.closingDate));
  const counted: string[] = [];
  let pausedBy: string | undefined;
  for (const deal of theirs) {
    const troubled = deal.status === "servicing_delinquent" || deal.status === "default" || (deal.defaults ?? []).some((item) => !item.cured || item.effectiveOn >= since);
    const late = troubled || latePayments(deal, since).length > 0;
    if (late) pausedBy ??= deal.loanNumber;
    else if (deal.closingDate >= since) counted.push(deal.loanNumber);
  }
  return { loans: counted.length, counted, ...(pausedBy ? { pausedBy } : {}), asOf: today };
}

/**
 * How long each item accepted on an earlier loan stays good for the next one, in days (null: as long as the entity is the
 * same). PLACEHOLDER until GT and the processor confirm: good standing is asked for "dated in the last 90 days" anyway, and
 * an ID is assumed current for a year.
 */
export const CARRY_OVER: Record<string, { days: number | null; sameEntity: boolean }> = {
  entity: { days: null, sameEntity: true },
  ein: { days: null, sameEntity: true },
  "good-standing": { days: 90, sameEntity: true },
  id: { days: 365, sameEntity: false },
};

const sameName = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");
const guarantorsOf = (sponsor?: Sponsor) => (sponsor?.guarantors ?? []).map((item) => item.name);

/**
 * The new loan's list with what's still good from the borrower's earlier loans marked accepted, pointing at the same file.
 * The entity's papers only carry over for the same entity, and IDs only when every guarantor was on the earlier loan.
 */
export function carryOverDocs(docs: Doc[], earlier: Deal[], next: { entityName: string; sponsor?: Sponsor }, today: string): Doc[] {
  const sorted = [...earlier].sort((a, b) => b.closingDate.localeCompare(a.closingDate));
  return docs.map((item) => {
    const rule = CARRY_OVER[item.id];
    if (!rule || item.status !== "requested") return item;
    for (const deal of sorted) {
      if (rule.sameEntity && !sameName(deal.entityName, next.entityName)) continue;
      if (item.id === "id" && !guarantorsOf(next.sponsor).every((name) => guarantorsOf(deal.sponsor).some((had) => sameName(had, name)))) continue;
      const had = deal.docs.find((doc) => doc.id === item.id && doc.status === "accepted");
      if (!had) continue;
      if (rule.days !== null && (!had.acceptedOn || addDays(had.acceptedOn, rule.days) < today)) continue;
      return { ...item, status: "accepted" as const, fileName: had.fileName, documentId: had.documentId, acceptedOn: had.acceptedOn, carriedFrom: deal.loanNumber };
    }
    return item;
  });
}

const sameDeal = (a: { address: string; kind: string; completed: string }, b: { address: string; kind: string; completed: string }) => sameName(a.address, b.address) && a.kind === b.kind && a.completed === b.completed;

/** A new profile's past deals, with the ones staff already confirmed on an earlier loan still confirmed. */
export function carryOverTrackRecord(sponsor: Sponsor, earlier: Deal[]): Sponsor {
  const confirmed = earlier.flatMap((deal) => (deal.sponsor?.trackRecord ?? []).filter((item) => item.verified));
  return { ...sponsor, trackRecord: sponsor.trackRecord.map((item) => (confirmed.some((had) => sameDeal(had, item)) ? { ...item, verified: true } : item)) };
}

/** With every past deal already confirmed, the settlement statements for them aren't asked for again. */
export function trackDocCarried(docs: Doc[], sponsor: Sponsor | undefined): Doc[] {
  if (!sponsor?.trackRecord.length || sponsor.trackRecord.some((item) => !item.verified)) return docs;
  return docs.map((item) => (item.id === "track" && item.status === "requested" ? { ...item, status: "accepted" as const, note: "Every deal listed was confirmed on an earlier LendHous loan." } : item));
}

/** A borrower's earlier loans that can lend their papers to a new one: funded, not ended before closing. */
export const earlierLoans = (deals: Deal[], borrowerId: string) => deals.filter((deal) => deal.borrowerId === borrowerId && ACTIVE.has(deal.status));
