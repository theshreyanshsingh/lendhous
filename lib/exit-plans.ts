// How each short-term loan will end: the borrower's exit plan, asked for as maturity comes near, and the team's view of
// what's coming due. A fix and flip, bridge or construction loan ends in a sale, a refinance, an extension or a payoff;
// a borrower finishing a rehab they'll keep is LendHous's best rental-loan lead.
import type { Book } from "./book";
import type { Deal } from "./mockData";
import type { Period } from "./reports";
import { addDays, EXIT_OUTREACH_DAYS, ledger, SERVICED } from "./servicing";

export { EXIT_OUTREACH_DAYS };
/** With no answer this close to maturity, it goes in the team's queue. */
export const EXIT_CHASE_DAYS = 60;

export const EXIT_CHOICES = { sell: "Selling it", refi_lendhous: "Refinancing into a LendHous rental loan", refi_other: "Refinancing with another lender", extend: "Asking for an extension", payoff: "Paying it off another way" } as const;
export type ExitChoice = keyof typeof EXIT_CHOICES;
export const CONFIDENCE = { sure: "Sure", likely: "Likely", unsure: "Not sure yet" } as const;
export type Confidence = keyof typeof CONFIDENCE;

export type ExitPlan = { choice: ExitChoice; confidence: Confidence; listPrice?: number; saleBy?: string; lender?: string; note: string; by: string; at: string };

/** Loans with a maturity coming: everything but a 30-year rental loan. */
export const shortTerm = (deal: Deal) => deal.app.product !== "dscr";
const open = (deal: Deal) => SERVICED.includes(deal.status) && deal.status !== "default";

/** Why a plan can't be saved, or null. A sale needs its list price and when it should close. */
export function exitPlanProblem(plan: Omit<ExitPlan, "by" | "at">): string | null {
  if (!(plan.choice in EXIT_CHOICES)) return "Pick how you'll pay off the loan.";
  if (!(plan.confidence in CONFIDENCE)) return "Say how sure you are.";
  if (plan.choice === "sell" && !(plan.listPrice && plan.listPrice > 0)) return "Add the price you're listing it at.";
  if (plan.choice === "sell" && !(plan.saleBy && /^\d{4}-\d{2}-\d{2}$/.test(plan.saleBy))) return "Add when you expect the sale to close.";
  if (plan.note.length > 500) return "Keep the note under 500 characters.";
  return null;
}

/** The outreach days a loan has now reached that it hasn't been asked at yet. None once there's a plan. */
export function outreachDue(deal: Deal, daysToMaturity: number) {
  if (!shortTerm(deal) || !open(deal) || deal.exitPlan) return [];
  return EXIT_OUTREACH_DAYS.filter((days) => daysToMaturity <= days && !(deal.exitAsked ?? []).includes(days));
}

/** A short-term loan near maturity with no plan from the borrower: the team should call. */
export const needsExitAnswer = (deal: Deal, daysToMaturity = ledger(deal).daysToMaturity) => shortTerm(deal) && open(deal) && !deal.exitPlan && daysToMaturity <= EXIT_CHASE_DAYS;
/** The borrower should be asked now: within the outreach window, with no plan yet. */
export const exitAskOpen = (deal: Deal, daysToMaturity = ledger(deal).daysToMaturity) => shortTerm(deal) && open(deal) && !deal.exitPlan && daysToMaturity <= Math.max(...EXIT_OUTREACH_DAYS);

const BUCKETS = [{ key: "due", label: "Matured or due this month", upTo: 30 }, { key: "1", label: "1 to 2 months out", upTo: 60 }, { key: "2", label: "2 to 3 months out", upTo: 90 }, { key: "3", label: "3 to 4 months out", upTo: 120 }, { key: "later", label: "Later", upTo: Infinity }] as const;

export type DeskRow = { deal: Deal; maturity: string; days: number; plan?: ExitPlan; asked: number[] };
/** The maturity desk: open short-term loans grouped by how soon they come due, soonest first within each group. */
export function maturityDesk(deals: Deal[]) {
  const rows: DeskRow[] = deals.filter((deal) => shortTerm(deal) && open(deal)).map((deal) => { const l = ledger(deal); return { deal, maturity: l.maturity, days: l.daysToMaturity, plan: deal.exitPlan, asked: deal.exitAsked ?? [] }; }).sort((a, b) => a.days - b.days);
  return BUCKETS.map((bucket, i) => ({ key: bucket.key, label: bucket.label, rows: rows.filter((row) => row.days <= bucket.upTo && (i === 0 || row.days > BUCKETS[i - 1].upTo)) })).filter((bucket) => bucket.rows.length);
}

/** For the reports: the plans given in the period by choice, refinances LendHous kept, and extensions signed. */
export function exitReport(book: Pick<Book, "deals">, period: Period) {
  const inPeriod = (day?: string) => Boolean(day && day.slice(0, 10) >= period.from && day.slice(0, 10) <= period.to);
  const mix = Object.fromEntries(Object.keys(EXIT_CHOICES).map((choice) => [choice, book.deals.filter((deal) => deal.exitPlan?.choice === choice && inPeriod(deal.exitPlan.at)).length])) as Record<ExitChoice, number>;
  const refinancedHere = book.deals.filter((deal) => deal.refinances && SERVICED.concat("paid_off").includes(deal.status) && inPeriod(deal.closingDate));
  const extensions = book.deals.flatMap((deal) => (deal.extensions ?? []).filter((item) => item.status === "executed" && inPeriod(item.executed?.on)));
  const comingDue = book.deals.filter((deal) => shortTerm(deal) && open(deal) && ledger(deal).maturity <= addDays(period.to, 120)).length;
  return { mix, refinancedHere: refinancedHere.length, extensions: extensions.length, comingDue };
}
