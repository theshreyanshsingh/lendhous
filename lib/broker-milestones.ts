// Brokers hear where their client's loan stands at every step, and see their own numbers (docs/competitor-gaps-2026-11-09.md,
// rank 16). RCN emails brokers at every stage and says 42% of brokers name slow or unclear communication as their main
// complaint. LendHous already tells a broker about conditions, the term sheet, clear to close, funding and a decline;
// these fill the rest: review, underwriting, the term sheet accepted, closing, every document in, each draw released
// and the payoff. They're worked out by comparing each loan before and after any change, so no step can skip them.
// Pure, so tests and the server agree.
import type { Book } from "./book";
import type { Deal, LoanStatus } from "./mockData";

export type Milestone = { dealId: string; subject: string; body: string; event: string };

const longDate = (day: string) => new Date(`${day.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const dollars = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const client = (deal: Deal) => deal.borrowerName.trim() || "your client";

/** The steps brokers didn't hear about before. Clear to close, funding, the term sheet and a decline have their own notices. */
const STEPS: Partial<Record<LoanStatus, (deal: Deal) => string>> = {
  initial_review: (deal) => `LendHous has started reviewing ${client(deal)}'s application for ${deal.address}, ${deal.city}.`,
  underwriting: (deal) => `${client(deal)}'s loan on ${deal.address} is in underwriting. A term sheet comes next.`,
  term_sheet_accepted: (deal) => `${client(deal)} accepted the term sheet for ${deal.address}. Conditions to close come next.`,
  closing: (deal) => `${client(deal)}'s loan on ${deal.address} is with the title company to close${deal.closingDate ? `, aiming for ${longDate(deal.closingDate)}` : ""}.`,
  paid_off: (deal) => `${client(deal)}'s loan on ${deal.address} is paid off${deal.paidOff ? ` as of ${longDate(deal.paidOff.receivedOn)}` : ""}. Thank you for the deal.`,
};
const PRE_FUNDING: LoanStatus[] = ["submitted", "initial_review", "underwriting", "term_sheet_issued", "term_sheet_accepted", "conditions", "clear_to_close", "closing"];

/** Documents still needed before clear to close: the ones a closing doesn't bring. */
export const openDocs = (deal: Pick<Deal, "docs">) => deal.docs.filter((doc) => !doc.stage && doc.status !== "accepted" && doc.status !== "waived").length;

/** What each brokered loan reached in this change, for its broker. */
export function brokerMilestones(before: Book, after: Book): Milestone[] {
  const out: Milestone[] = [];
  for (const deal of after.deals) {
    if (!deal.brokerId) continue;
    const was = before.deals.find((item) => item.id === deal.id);
    if (!was) continue;
    const step = STEPS[deal.status];
    if (step && was.status !== deal.status) out.push({ dealId: deal.id, subject: `Update on ${deal.loanNumber}`, body: step(deal), event: `broker.${deal.status}` });
    if (PRE_FUNDING.includes(deal.status) && openDocs(was) > 0 && openDocs(deal) === 0) out.push({ dealId: deal.id, subject: `Every document is in: ${deal.loanNumber}`, body: `LendHous has every document it asked ${client(deal)} for on ${deal.address}.`, event: "broker.docs_complete" });
  }
  for (const draw of after.draws) {
    const deal = after.deals.find((item) => item.id === draw.dealId);
    if (!deal?.brokerId || draw.status !== "funded" || before.draws.find((item) => item.id === draw.id)?.status === "funded") continue;
    out.push({ dealId: deal.id, subject: `Draw released: ${deal.loanNumber}`, body: `LendHous released a draw of ${dollars(draw.approved ?? 0)} for ${client(deal)}'s project on ${deal.address}.`, event: "broker.draw_released" });
  }
  return out;
}

const DAY = 86_400_000;
const average = (values: number[]) => (values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : null);
const FUNDED: LoanStatus[] = ["funded", "servicing_current", "servicing_delinquent", "matured", "default", "paid_off", "reo"];

/**
 * A brokerage's own numbers: average days from submitting a deal to its term sheet and to funding, how many decided deals
 * funded (pull-through), and conditions still open on its loans in process. Timings count only loans whose submission
 * was recorded, so loans from before stages were kept don't skew them.
 */
export function brokerNumbers(deals: Deal[]) {
  const daysTo = (deal: Deal, status: LoanStatus) => {
    const start = deal.stages?.[0];
    const reached = deal.stages?.find((entry) => entry.status === status);
    return start?.status === "submitted" && reached ? Math.max(0, (Date.parse(reached.at) - Date.parse(start.at)) / DAY) : null;
  };
  const toSheet = deals.map((deal) => daysTo(deal, "term_sheet_issued")).filter((value): value is number => value !== null);
  const toFund = deals.map((deal) => daysTo(deal, "funded")).filter((value): value is number => value !== null);
  const funded = deals.filter((deal) => FUNDED.includes(deal.status)).length;
  const lost = deals.filter((deal) => deal.status === "declined" || deal.status === "withdrawn").length;
  const inProcess = deals.filter((deal) => PRE_FUNDING.includes(deal.status));
  const openConditions = inProcess.reduce((sum, deal) => sum + (deal.conditions ?? []).filter((item) => item.status === "open" || item.status === "submitted").length, 0);
  return {
    submitted: deals.length, funded, lost,
    daysToTermSheet: average(toSheet), daysToFunding: average(toFund),
    pullThrough: funded + lost ? Math.round((funded / (funded + lost)) * 100) : null,
    openConditions, inProcess: inProcess.length,
  };
}
