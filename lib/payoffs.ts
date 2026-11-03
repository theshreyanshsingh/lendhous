// Payoff letters under Fla. Stat. 701.04(1), which calls them estoppel letters. The borrower, the record owner or anyone
// they authorize in writing may ask; the letter is due 10 days after the request is received; it itemizes principal,
// interest and other charges as of a date, with interest per day after that. Once sent, LendHous can't deny its figures
// to anyone who relies on them, and it may not say they're subject to change, so when the figures move a corrected
// letter goes out the same way, with a copy to the borrower. The reducer, the access rules, the screens and the PDF all
// ask these, so the button a screen offers and the rule the server applies can't disagree.
import { z } from "zod";
import { evaluate } from "./engine";
import type { Deal, PayoffChannel, PayoffLetter, PayoffRequest } from "./mockData";
import { currentPricing } from "./pricing-versions";
import { addDays, daysBetween, defaultInterestFrom, defaultRateOf, ledgerOf, maturityOf, payoffFor, SERVICED } from "./servicing";

/** The statute's 10 days. */
export const LETTER_DAYS = 10;
/** PLACEHOLDER until GT sets it: how far ahead a letter may be good through. */
export const MAX_GOOD_THROUGH_DAYS = 30;

export const CHANNELS: Record<PayoffChannel, string> = { portal: "Borrower portal", web_form: "Payoff request form", email: "Email", fax: "Fax", mail: "First-class mail", courier: "Courier or hand delivery" };
/** The ways staff log a request that didn't come through the portal or the form. */
export const LOGGED_CHANNELS = ["email", "fax", "mail", "courier"] as const;
export const REQUESTERS = { borrower: "The borrower", title: "Title company or closing attorney", other: "Someone else the borrower authorized" } as const;
export type RequesterKind = keyof typeof REQUESTERS;

const iso = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
/** The nth weekday (0 Sunday … 6 Saturday) of a month. */
const nth = (year: number, month: number, weekday: number, n: number) => iso(year, month, 1 + ((weekday - new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 7) % 7) + (n - 1) * 7);
const last = (year: number, month: number, weekday: number) => { const end = new Date(Date.UTC(year, month, 0)); return iso(year, month, end.getUTCDate() - ((end.getUTCDay() - weekday + 7) % 7)); };
// A holiday on a Sunday is kept the Monday after. One on a Saturday isn't moved, as at the Federal Reserve.
const fixed = (year: number, month: number, day: number) => { const date = iso(year, month, day); return weekdayOf(date) === 0 ? addDays(date, 1) : date; };

/** PLACEHOLDER until counsel confirms which holidays count under 701.04: the Federal Reserve's. */
export function holidaysIn(year: number) {
  return new Set([fixed(year, 1, 1), nth(year, 1, 1, 3), nth(year, 2, 1, 3), last(year, 5, 1), fixed(year, 6, 19), fixed(year, 7, 4), nth(year, 9, 1, 1), nth(year, 10, 1, 2), fixed(year, 11, 11), nth(year, 11, 4, 4), fixed(year, 12, 25)]);
}
const holidays = new Map<number, Set<string>>();
export function isBusinessDay(day: string) {
  if (weekdayOf(day) === 0 || weekdayOf(day) === 6) return false;
  const year = Number(day.slice(0, 4));
  if (!holidays.has(year)) holidays.set(year, holidaysIn(year));
  return !holidays.get(year)!.has(day);
}
export function businessDayFrom(day: string) {
  let date = day;
  while (!isBusinessDay(date)) date = addDays(date, 1);
  return date;
}
export function addBusinessDays(day: string, count: number) {
  let date = day;
  for (let added = 0; added < count;) { date = addDays(date, 1); if (isBusinessDay(date)) added++; }
  return date;
}

/**
 * The day a request counts as received (701.04(1)(f)1): mail five business days after it was posted, anything else the
 * day it was sent or delivered. One sent on a weekend or holiday counts from the next business day.
 */
export const receivedOnFor = (channel: PayoffChannel, sentOn: string) => (channel === "mail" ? addBusinessDays(sentOn, 5) : businessDayFrom(sentOn));
/** The letter is due 10 days after receipt, or the next business day when that's a weekend or holiday (701.04(1)(f)2). */
export const letterDueBy = (receivedOn: string) => businessDayFrom(addDays(receivedOn, LETTER_DAYS));
export const receivedOf = (request: PayoffRequest) => request.receivedOn ?? request.requestedAt.slice(0, 10);
export const dueOf = (request: PayoffRequest) => letterDueBy(receivedOf(request));
export const latestLetter = (request: PayoffRequest) => request.letters?.[request.letters.length - 1];
/** Someone other than the borrower asked, so the borrower is told and a correction goes to them too. */
export const fromThirdParty = (request: PayoffRequest) => Boolean(request.requester && request.requester.kind !== "borrower");

export type LetterFigures = Omit<PayoffLetter, "number" | "issuedAt" | "issuedBy" | "replaces" | "reason" | "delivery">;

/** The itemized payoff good through a day, from what has happened on the loan up to today. */
export function letterFigures(deal: Deal, goodThrough: string, today: string): LetterFigures {
  const l = ledgerOf(deal, today);
  const quote = payoffFor(deal, goodThrough, l);
  // The same split payoffFor makes: the note rate up to maturity or a default, the default rate after.
  const from = defaultInterestFrom(deal, l.maturity);
  const regularEnd = goodThrough < from ? goodThrough : from;
  const defaultFrom = l.paidThrough > from ? l.paidThrough : from;
  const figures: LetterFigures = { issuedOn: today, goodThrough, principal: quote.principal, accrued: quote.accrued, defaultAccrued: quote.defaultAccrued, fees: quote.fees, credit: quote.credit, perDiem: quote.perDiem, total: quote.total, rate: evaluate(deal.app).rate, interestFrom: l.paidThrough, interestDays: Math.max(0, daysBetween(l.paidThrough, regularEnd)) };
  return quote.defaultAccrued > 0 ? { ...figures, defaultRate: defaultRateOf(deal), defaultFrom, defaultDays: Math.max(0, daysBetween(defaultFrom, goodThrough)) } : figures;
}

export function goodThroughProblem(goodThrough: string, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(goodThrough)) return "Choose the date the payoff should be good through.";
  if (goodThrough < today) return "The good-through date can't be in the past.";
  if (goodThrough > addDays(today, MAX_GOOD_THROUGH_DAYS)) return `A payoff can be good through at most ${MAX_GOOD_THROUGH_DAYS} days from today.`;
  return null;
}

/** Why a letter can't go out on this request today, or null. */
export function issueProblem(deal: Deal, request: PayoffRequest, goodThrough: string, reason: string, today: string) {
  if (!SERVICED.includes(deal.status)) return "This loan isn't being serviced, so there's no payoff to state.";
  if (request.status === "refused" || request.status === "paid") return "This request is closed.";
  if (request.check?.status === "pending") return request.requester?.kind === "borrower" ? "Confirm it's the borrower first." : "Check the borrower's written authorization first.";
  if (request.letters?.length && !reason.trim()) return "Say why a new letter is going out.";
  return goodThroughProblem(goodThrough, today);
}

/** The latest letter and today's figures for it, when they no longer agree: a payment, a reversal, a fee, a draw or a default since. */
export function staleLetter(deal: Deal, request: PayoffRequest, today: string) {
  const letter = latestLetter(request);
  if (!letter || request.status !== "sent" || letter.goodThrough < today || !SERVICED.includes(deal.status)) return null;
  const now = letterFigures(deal, letter.goodThrough, today);
  return Math.abs(now.total - letter.total) >= 0.005 ? { letter, now } : null;
}

const money = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** What moved between a letter and today's figures, in words. */
export function letterChanges(letter: LetterFigures, now: LetterFigures) {
  const lines: [string, number, number][] = [["Principal", letter.principal, now.principal], ["Interest", letter.accrued, now.accrued], ["Default interest", letter.defaultAccrued, now.defaultAccrued], ["Late fees", letter.fees, now.fees], ["Credit held", letter.credit, now.credit]];
  return lines.filter(([, then, today]) => Math.abs(then - today) >= 0.005).map(([label, then, today]) => `${label} ${money(then)} → ${money(today)}`);
}

/** A payoff received on a day can be taken on a letter good through that day or later, for at least the letter's total. */
export const letterCovers = (letter: PayoffLetter, amount: number, receivedOn: string) => letter.goodThrough >= receivedOn && amount + 0.005 >= letter.total;

/** Who it's for, in one line. */
export const requesterLine = (request: PayoffRequest) => {
  const who = request.requester;
  if (!who) return request.by;
  return [who.name, who.company].filter(Boolean).join(", ") + (who.kind === "borrower" ? "" : ` (${who.kind === "title" ? "title company" : "authorized by the borrower"})`);
};

/** What's still needed before a letter can go out, in a word, for lists. */
export function requestState(request: PayoffRequest) {
  if (request.status === "refused") return { label: "Refused", tone: "slate" as const };
  if (request.status === "paid") return { label: "Paid off", tone: "green" as const };
  if (request.check?.status === "pending") return { label: request.requester?.kind === "borrower" ? "Confirm identity" : "Check authorization", tone: "amber" as const };
  if (request.status === "requested") return { label: "Letter due", tone: "amber" as const };
  return { label: `Letter ${latestLetter(request)?.number ?? 1} sent`, tone: "blue" as const };
}

export type LetterContent = {
  lender: string; reference: string; issuedOn: string; corrected?: string; sample?: boolean;
  to: string[]; loan: [string, string][];
  rows: { label: string; detail?: string; amount: number }[];
  total: { label: string; amount: number }; perDiem: string; paragraphs: string[];
};

/**
 * The letter itself, for the page and the PDF alike. PLACEHOLDER wording until the attorney approves it. Nothing in it
 * qualifies the figures or reserves a right to change them: 701.04(1)(c) makes that void.
 */
export function letterContent(deal: Deal, request: PayoffRequest, letter: PayoffLetter, lender = "LendHous"): LetterContent {
  const good = longDay(letter.goodThrough);
  const prior = letter.replaces ? request.letters?.find((item) => item.number === letter.replaces) : undefined;
  const who = request.requester;
  const rows: LetterContent["rows"] = [{ label: "Unpaid principal", amount: letter.principal }];
  rows.push({ label: `Interest at ${letter.rate.toFixed(2)}%`, detail: `${letter.interestDays} day${letter.interestDays === 1 ? "" : "s"} from ${longDay(letter.interestFrom)}`, amount: letter.accrued });
  if (letter.defaultAccrued > 0 && letter.defaultFrom) rows.push({ label: `Default interest at ${(letter.defaultRate ?? 0).toFixed(2)}%`, detail: `${letter.defaultDays} day${letter.defaultDays === 1 ? "" : "s"} from ${longDay(letter.defaultFrom)}`, amount: letter.defaultAccrued });
  if (letter.fees > 0) rows.push({ label: "Unpaid late fees", amount: letter.fees });
  if (letter.credit > 0) rows.push({ label: "Less credit held for the borrower", amount: -letter.credit });
  return {
    lender,
    reference: `${deal.loanNumber}-P${request.id.replace(/^payoff-?/, "").slice(-4).toUpperCase()}-${letter.number}`,
    issuedOn: longDay(letter.issuedOn),
    corrected: prior ? `This letter replaces our letter of ${longDay(prior.issuedOn)}${letter.reason ? ` (${letter.reason.replace(/\.$/, "")})` : ""}.` : undefined,
    to: who ? [who.name, who.company, who.email].filter((line): line is string => Boolean(line)) : [request.by, deal.entityName],
    loan: [["Loan", deal.loanNumber], ["Borrower", deal.entityName || deal.borrowerName], ["Property", `${deal.address}, ${deal.city} ${deal.zip}`], ["Matures", longDay(maturityOf(deal))]],
    rows,
    total: { label: `To pay off the loan if received by ${good}`, amount: letter.total },
    perDiem: `For each day after ${good}, add ${money(letter.perDiem)}.`,
    paragraphs: [
      `This letter states the unpaid balance of the loan above as of ${good}, in answer to the request received ${longDay(receivedOf(request))}.`,
      "Pay by wire only. This letter has no wire instructions, and we never send them by email. Call us at a number you find yourself, from our website or the loan documents and not from an email, and we'll give you the instructions and confirm them on that call.",
      `Once the payoff arrives, we'll sign the release of the mortgage and send it to be recorded within ${currentPricing().lienReleaseDays} days.`,
      "Questions about this letter: reply to the email it came with, or call our servicing team.",
    ],
  };
}

/** What the team hears each morning: letters due within two days or already late, and letters whose figures have moved. */
export function payoffReminders(book: { deals: Deal[]; payoffs: PayoffRequest[] }, today: string) {
  const lines: string[] = [];
  for (const request of book.payoffs) {
    const deal = book.deals.find((item) => item.id === request.dealId);
    if (!deal) continue;
    if (request.status === "requested") {
      const left = daysBetween(today, dueOf(request));
      if (left <= 2) lines.push(`${deal.loanNumber}: the payoff letter for ${requesterLine(request)} is ${left < 0 ? `${-left} day${left === -1 ? "" : "s"} late` : left === 0 ? "due today" : `due ${longDay(dueOf(request))}`}.`);
    }
    const stale = staleLetter(deal, request, today);
    if (stale) lines.push(`${deal.loanNumber}: letter ${stale.letter.number} to ${requesterLine(request)} says ${money(stale.letter.total)}; it's now ${money(stale.now.total)}. Send a corrected letter.`);
  }
  return lines;
}

/** The loan a public request is about: its number and the property's ZIP code must both match. */
export function matchLoan(deals: Deal[], loanNumber: string, zip: string) {
  const number = loanNumber.replace(/\s/g, "").toUpperCase();
  return deals.find((deal) => deal.loanNumber.toUpperCase() === number && deal.zip.slice(0, 5) === zip.trim().slice(0, 5));
}

const text = (max: number) => z.string().trim().max(max);
export const publicRequestSchema = z.object({
  loanNumber: text(40).min(3), zip: z.string().trim().regex(/^\d{5}$/), kind: z.enum(["borrower", "title", "other"]),
  name: text(120).min(1), company: text(160), email: text(200).email(), phone: text(40), fileNumber: text(80), goodThrough: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: text(1000),
});
export type PublicRequest = z.infer<typeof publicRequestSchema>;

/** The public form's fields, checked, or what to fix. The same check runs in the browser and on the server. */
export function publicRequestProblem(raw: unknown, today: string): { request: PublicRequest } | { error: string } {
  const parsed = publicRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    const said: Record<string, string> = { loanNumber: "Add the loan number from the borrower's statement or loan documents.", zip: "Add the property's 5-digit ZIP code.", name: "Add your name.", email: "Add an email address for the letter.", goodThrough: "Choose the date the payoff should be good through." };
    return { error: said[field] ?? "Check the form and try again." };
  }
  const request = parsed.data;
  if (request.kind === "title" && !request.company) return { error: "Add the title company or law firm." };
  const date = goodThroughProblem(request.goodThrough, today);
  return date ? { error: date } : { request };
}
