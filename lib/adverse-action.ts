// Adverse action notices for business credit under Regulation B (12 CFR 1002.9, 1002.12). A declined applicant whose
// business had $1 million or less in gross revenue last year gets a written notice within 30 days of a completed
// application: the action, the lender's name and address, the ECOA notice with the federal agency, and the specific
// reasons. Above $1 million the notice comes in a reasonable time, and a written statement of the reasons and the ECOA
// notice follow a written request made within 60 days. Records are kept 12 months (60 days for the larger businesses
// unless they asked), or until a pending investigation or lawsuit ends. The reducer, the access rules, the screens and
// the PDF all ask these, so they can't disagree.
import type { AdverseAction, Closure, Deal } from "./mockData";
import { addDays, daysBetween } from "./servicing";

/** The revenue line in 1002.9(a)(3) and 1002.12(b)(5). */
export const REVENUE_LIMIT = 1_000_000;
/** 1002.9(a)(1): 30 days after a completed application, or after deciding an incomplete one. */
export const NOTICE_DAYS = 30;
/** PLACEHOLDER until the attorney sets it: what counts as a "reasonable time" for a business over $1 million. */
export const REASONABLE_DAYS = 30;
/** The window to ask for the reasons in writing, and the time to answer (1002.9(a)(2)(ii), (a)(3)(ii)). */
export const REQUEST_DAYS = 60;
export const STATEMENT_DAYS = 30;

/** PLACEHOLDER until the attorney confirms it from Reg B Appendix A: the agency for a lender that isn't a bank. */
export const AGENCY = "Federal Trade Commission, Consumer Response Center, Washington, DC 20580";
/** The ECOA notice, as in Reg B's model forms (Appendix C). */
export const ECOA_NOTICE = `The Federal Equal Credit Opportunity Act prohibits creditors from discriminating against credit applicants on the basis of race, color, religion, national origin, sex, marital status, age (provided the applicant has the capacity to enter into a binding contract); because all or part of the applicant's income derives from any public assistance program; or because the applicant has in good faith exercised any right under the Consumer Credit Protection Act. The Federal agency that administers compliance with this law concerning this creditor is the ${AGENCY}.`;

/**
 * The specific reason each decline reason starts as (1002.9(b)(2)). PLACEHOLDER wording until the attorney approves it;
 * staff make it specific to the loan before the notice goes out.
 */
export const REASON_TEXT: Record<string, string> = {
  credit: "Credit history of the guarantor",
  experience: "Limited experience completing projects like this one",
  leverage: "Value of the collateral not sufficient for the loan amount requested",
  liquidity: "Not enough verified cash to close and to hold in reserve",
  property: "The property, its title or its market isn't acceptable for this loan",
  incomplete: "Incomplete application",
  compliance: "Unable to verify the identity or background information provided",
  capital: "We do not grant credit on the terms and conditions you requested",
  other: "",
};

/** Why this revenue can't be recorded, or null. It's the business's last full fiscal year. */
export function revenueProblem(amount: number, year: number, today: string) {
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000_000) return "Enter the gross revenue in dollars.";
  const thisYear = Number(today.slice(0, 4));
  if (!Number.isInteger(year) || year < thisYear - 3 || year > thisYear) return "Enter the year it's for: the business's last fiscal year.";
  return null;
}

/** Above $1 million in revenue. Unknown revenue counts as $1 million or less, which is the stricter rule. */
export const isLarge = (revenue: Deal["revenue"]) => Boolean(revenue && revenue.amount > REVENUE_LIMIT);

/** When the notice is due: 30 days from the completed application (or from the decision, if it was never complete), or a reasonable time for a larger business. */
export const noticeDueOn = (deal: Pick<Deal, "completed" | "revenue">, decidedOn: string) => (isLarge(deal.revenue) ? addDays(decidedOn, REASONABLE_DAYS) : addDays(deal.completed?.on ?? decidedOn, NOTICE_DAYS));

/** The adverse action record a decline starts. */
export function startAdverseAction(deal: Pick<Deal, "completed" | "revenue">, closure: Pick<Closure, "reason">, decidedOn: string, at: string): AdverseAction {
  const reason = REASON_TEXT[closure.reason];
  return { decidedAt: at, decidedOn, reasons: reason ? [reason] : [], large: isLarge(deal.revenue), dueOn: noticeDueOn(deal, decidedOn) };
}

/** Why these reasons can't go out, or null. Specific and principal, at most four, never just "internal standards" (1002.9(b)(2)). */
export function reasonsProblem(reasons: string[]) {
  const given = reasons.map((item) => item.trim()).filter(Boolean);
  if (!given.length) return "Give at least one specific reason.";
  if (given.length > 4) return "Give the principal reasons, four at most.";
  if (given.some((item) => /internal (standards|policies|criteria)|qualifying score|didn'?t (meet|qualify)|not qualif/i.test(item))) return "Say the specific reason. \"Internal standards\" or not qualifying isn't enough (12 CFR 1002.9(b)(2)).";
  return null;
}

/** What's waiting: the notice, or for a larger business the statement of reasons someone asked for. */
export function noticeOwed(deal: Pick<Deal, "adverseAction" | "status">) {
  const action = deal.adverseAction;
  if (!action || deal.status !== "declined") return null;
  if (!action.notice) return { kind: "notice" as const, dueOn: action.dueOn };
  if (action.request && !action.statement) return { kind: "statement" as const, dueOn: action.request.dueOn };
  return null;
}

/** Why a written request for the reasons can't be logged, or null: a larger business, after the notice, within 60 days. */
export function requestProblem(action: AdverseAction | undefined, receivedOn: string, today: string) {
  if (!action?.notice) return "Send the notice first.";
  if (!action.large) return "The notice already gave the reasons.";
  if (action.request) return "A request is already logged.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn) || receivedOn > today) return "Enter the day it came in, today or earlier.";
  if (receivedOn < action.notice.sentOn) return "That's before the notice went out.";
  if (receivedOn > addDays(action.notice.sentOn, REQUEST_DAYS)) return `It came more than ${REQUEST_DAYS} days after the notice, so the reasons aren't owed (it can still be answered).`;
  return null;
}

/**
 * How long the records have to be kept (1002.12(b)): 12 months from the notice; for a larger business 60 days, or 12
 * months if they asked for the reasons. Null while the notice hasn't gone out or a legal hold stands.
 */
export function keepUntil(deal: Pick<Deal, "adverseAction" | "legalHold" | "closure">) {
  if (deal.legalHold) return null;
  const action = deal.adverseAction;
  const year = (day: string) => { const [y, m, d] = day.split("-").map(Number); return new Date(Date.UTC(y + 1, m - 1, d)).toISOString().slice(0, 10); };
  if (!action) return deal.closure ? year(deal.closure.at.slice(0, 10)) : null;
  if (!action.notice) return null;
  return action.large && !action.request ? addDays(action.notice.sentOn, REQUEST_DAYS) : year(action.notice.sentOn);
}

/** What the team hears each morning: notices and statements due within five days or late. */
export function noticeReminders(deals: Deal[], today: string) {
  return deals.flatMap((deal) => {
    const owed = noticeOwed(deal);
    if (!owed) return [];
    const left = daysBetween(today, owed.dueOn);
    if (left > 5) return [];
    return [`${deal.loanNumber}: the ${owed.kind === "notice" ? "adverse action notice" : "statement of reasons"} to ${deal.borrowerName} is ${left < 0 ? `${-left} day${left === -1 ? "" : "s"} late` : left === 0 ? "due today" : `due ${owed.dueOn}`}.`];
  });
}

const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const money = (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`;

export type Lender = { name: string; address: string; phone: string };
export type NoticeContent = { lender: Lender; title: string; date: string; to: string[]; re: string; paragraphs: string[]; reasons: string[]; ecoa: string; sample?: boolean };

/**
 * The notice (or, for a larger business, the statement of reasons it asked for). PLACEHOLDER wording until the attorney
 * approves it; the ECOA paragraph follows Reg B's model form.
 */
export function noticeContent(deal: Deal, action: AdverseAction, kind: "notice" | "statement", lender: Lender, noteAmount: number, on: string): NoticeContent {
  const contact = `${lender.name}, ${lender.address}${lender.phone ? `, ${lender.phone}` : ""}`;
  const giveReasons = kind === "statement" || !action.large;
  return {
    lender, title: kind === "statement" ? "Statement of reasons for credit denial" : "Notice of action taken", date: longDay(on),
    to: [deal.entityName || deal.borrowerName, `Attention: ${deal.borrowerName}`],
    re: `Your application for a ${money(noteAmount)} business loan secured by ${deal.address}, ${deal.city} (${deal.loanNumber})`,
    paragraphs: [
      kind === "statement"
        ? `You asked for the reasons we declined your application. We received your request on ${longDay(action.request!.receivedOn)}.`
        : `Thank you for applying to ${lender.name}. After reviewing your application, we are unable to approve it.`,
      giveReasons
        ? (action.reasons.length > 1 ? "The principal reasons are:" : "The principal reason is:")
        : `If you would like a statement of the specific reasons, write to us at ${contact} within ${REQUEST_DAYS} days of the date of this letter. We will send it within ${STATEMENT_DAYS} days of receiving your request.`,
    ],
    reasons: giveReasons ? action.reasons : [],
    ecoa: `${ECOA_NOTICE} If you have questions about this ${kind === "statement" ? "statement" : "notice"}, contact ${contact}.`,
  };
}
