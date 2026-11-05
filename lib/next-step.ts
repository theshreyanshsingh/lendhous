// The one thing a borrower should do next on a loan, so their loan card and loan page always agree and never show two
// next steps at once. The team's own next step is lib/loan-stages.ts.
import { shortDay } from "./format";
import { isClosedApplication } from "./loan-exits";
import type { Deal } from "./mockData";
import { ledger, SERVICED } from "./servicing";
import { exitAskOpen } from "./exit-plans";

export type NextStep = {
  kind: "sign" | "finish" | "send" | "late" | "exit" | "pay" | "default" | "wait" | "done";
  title: string;
  detail?: string;
  /** Where the step is done: a place on the loan page, or another page. */
  href?: string;
  action?: string;
};

const EARLY = ["submitted", "initial_review", "underwriting"];

/** What the borrower is asked for on this loan: documents asked for or sent back, and their own open conditions. */
export function itemsOwed(deal: Deal) {
  const docs = deal.docs.filter((doc) => doc.status === "requested" || doc.status === "rejected").length;
  const conditions = (deal.conditions ?? []).filter((item) => item.owner === "borrower" && item.status === "open").length;
  return docs + conditions;
}

/** Null for an application that ended: the page explains that instead. */
export function nextStepFor(deal: Deal, l = SERVICED.includes(deal.status) ? ledger(deal) : null): NextStep | null {
  if (isClosedApplication(deal.status)) return null;
  if (deal.status === "paid_off") return { kind: "done", title: "Nothing to do. Your loan is paid in full." };
  const sheet = deal.termSheets?.at(-1);
  if (deal.status === "term_sheet_issued" && sheet?.status === "sent") return { kind: "sign", title: "Review and sign your term sheet", detail: `It's good until ${shortDay(sheet.expiresOn)}.`, href: "#term-sheet", action: "Review it" };
  if (!deal.sponsor && EARLY.includes(deal.status)) return { kind: "finish", title: "Finish your application", detail: "Add your guarantors and past deals, and answer the credit questions, so the team can price and approve your loan.", href: `/admin/borrower/${deal.id}/profile`, action: "Finish it now" };
  const owed = itemsOwed(deal);
  if (owed) return { kind: "send", title: owed === 1 ? "Send the 1 item we need" : `Send the ${owed} items we need`, detail: "They're listed below. Each one opens where you upload it.", href: "#needs-from-you", action: "See the list" };
  if (deal.status === "default") return { kind: "default", title: "Call us about your loan", detail: "It's in default. Your team can talk through bringing it current.", href: "#messages", action: "Message your team" };
  if (l && l.amountDue > 0) return { kind: "late", title: "Your payment is past due", detail: "Please pay it as soon as you can.", href: "#payments", action: "See what's due" };
  if (l && exitAskOpen(deal, l.daysToMaturity)) return { kind: "exit", title: "Tell us how you'll pay off the loan", detail: `It matures ${shortDay(l.maturity)}. A sale, a LendHous rental loan, an extension or a payoff: we'll help in time.`, href: "#exit-plan", action: "Tell us" };
  if (l?.nextDue) return { kind: "pay", title: `Next payment due ${shortDay(l.nextDue)}`, detail: "Nothing else needed from you right now.", href: "#payments", action: "See payments" };
  return { kind: "wait", title: "Nothing needed from you right now", detail: "Your team is working on it. We'll email you when that changes." };
}
