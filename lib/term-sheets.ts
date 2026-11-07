// Term sheets (Spec A9, B16, 4.3): the underwriter prices the loan within the matrix's range, an owner approves anything
// outside it, and each term sheet goes out as a numbered version that expires. The borrower accepts it, asks for changes
// (back to underwriting) or declines it (withdrawn), and acceptance locks the rate and points. The reducer, the access
// rules, the screens and the PDF all ask these, so the button a screen offers and the rule the server applies can't
// disagree.
import { evaluate, type Application, round2 } from "./engine";
import type { Deal, PricingException, TermSheet, TermSheetTerms } from "./mockData";
import { BASE_VERSION, pricingFor } from "./pricing-versions";
import { addDays, daysBetween, defaultRate, servicingTermsOf } from "./servicing";
import { buyDownOptions } from "./buy-down";
import { usuryCheck, USURY } from "./usury";
import { ratePercent } from "./format";

/** PLACEHOLDER until GT sets it (Spec B16): the days a term sheet stays open. */
export const TERM_SHEET_DAYS = 7;
/** PLACEHOLDER wording until the attorney and GT set the prepayment terms they offer. */
export const PREPAY = { none: "None: the loan can be paid off at any time", min3: "3 months' minimum interest", min6: "6 months' minimum interest" } as const;
export type Prepay = keyof typeof PREPAY;
/** Criminal usury in Florida, whatever the loan size (Fla. Stat. 687.071). Nothing goes above it. */
export const RATE_CEILING = 25;
/** Florida's civil usury cap on loans of $500,000 or less (Fla. Stat. 687.02, 687.03): above it takes an owner and the attorney. */
export const CIVIL_CAP = { rate: 18, upTo: 500_000 };
export const PRODUCT_NAMES: Record<Application["product"], string> = { fix_flip: "Fix and flip", bridge: "Bridge", ground_up: "Ground-up construction", dscr: "DSCR rental" };

export type TermsInput = { rate: number; points: number; termMonths: number; prepay: Prepay };

const near = (a: number, b: number) => Math.abs(a - b) < 0.0005;
const percent = ratePercent;

/** The application priced the way these terms would price it. A rental's term is its 30-year amortization, so it stays. */
export const pricedApp = (app: Application, input: Pick<TermsInput, "rate" | "points" | "termMonths">): Application => ({ ...app, termRate: input.rate, termPoints: input.points, ...(app.product === "dscr" ? {} : { termMonths: input.termMonths }) });

/** What the matrix says for this loan on its own pricing version, ignoring anything a term sheet set. */
export function matrixOf(app: Application) {
  const e = evaluate({ ...app, termRate: undefined, termPoints: undefined });
  return { rate: e.rateLimits, points: e.pointsRange, matrixRate: e.matrixRate, matrixPoints: e.pointsPct, termMonths: e.termMonths };
}

/** The terms an underwriter starts from: the last term sheet's, or the matrix's. */
export function startingTerms(deal: Deal): TermsInput {
  const last = latestSheet(deal);
  const m = matrixOf(deal.app);
  const prepay = (Object.keys(PREPAY) as Prepay[]).find((key) => PREPAY[key] === last?.terms.prepay) ?? "none";
  return { rate: deal.app.termRate ?? m.matrixRate, points: deal.app.termPoints ?? m.matrixPoints, termMonths: last?.terms.termMonths ?? m.termMonths, prepay };
}

/** Why these terms can't go out at all, whoever approves them, or null. */
export function termsProblem(app: Application, input: TermsInput) {
  if (!Number.isFinite(input.rate) || input.rate <= 0) return "Enter the rate.";
  if (input.rate > RATE_CEILING) return `No rate can go above ${RATE_CEILING}% a year: that's criminal usury in Florida (Fla. Stat. 687.071).`;
  if (!Number.isFinite(input.points) || input.points < 0 || input.points > 10) return "Points are 0 to 10.";
  if (app.product !== "dscr" && (!Number.isInteger(input.termMonths) || input.termMonths < 3 || input.termMonths > 36)) return "The term is 3 to 36 months.";
  if (!(input.prepay in PREPAY)) return "Choose the prepayment terms.";
  return null;
}

/** Why these terms are outside what an underwriter can set alone. Each needs an owner's approval (Spec A9, 4.4). */
export function exceptionReasons(app: Application, input: TermsInput) {
  const m = matrixOf(app);
  const e = evaluate(pricedApp(app, input));
  const ceiling = pricingFor(app.pricingVersion).allInCostFlagCeiling;
  const reasons: string[] = [];
  if (input.rate < m.rate[0] - 1e-9 || input.rate > m.rate[1] + 1e-9) reasons.push(`Rate ${percent(input.rate)} is outside the matrix's ${percent(m.rate[0])} to ${percent(m.rate[1])}`);
  if (input.points < m.points[0] - 1e-9 || input.points > m.points[1] + 1e-9) reasons.push(`${input.points} points is outside the matrix's ${m.points[0]} to ${m.points[1]}`);
  if (app.product !== "dscr" && e.allIn >= ceiling) reasons.push(`The all-in cost of ${(e.allIn * 100).toFixed(2)}% a year is at or over the ${(ceiling * 100).toFixed(0)}% ceiling`);
  if (input.rate > CIVIL_CAP.rate && e.noteAmount <= CIVIL_CAP.upTo) reasons.push(`A rate over ${CIVIL_CAP.rate}% on a loan of $500,000 or less is over Florida's usury cap (Fla. Stat. 687.02): ask the attorney first`);
  // Points count as interest spread over the term, so a short loan with points can go over the cap with the rate under it.
  else {
    const usury = usuryCheck({ amount: e.noteAmount, rate: input.rate, points: input.points, termMonths: e.termMonths });
    if (usury.overLender) reasons.push(`Rate plus points comes to ${usury.lender.toFixed(2)}% a year spread over the ${e.termMonths}-month term, over Florida's ${usury.limit}% cap (Fla. Stat. 687.03): ask the attorney first`);
  }
  return reasons;
}

/** An approved exception for exactly these rate, points and term (the term moves the all-in cost). */
export const exceptionCovers = (exception: PricingException | undefined, input: Pick<TermsInput, "rate" | "points" | "termMonths">) => exception?.status === "approved" && near(exception.rate, input.rate) && near(exception.points, input.points) && exception.termMonths === input.termMonths;

/** Why an underwriter can't ask for this exception, or null. */
export function exceptionRequestProblem(deal: Deal, input: TermsInput, note: string) {
  if (deal.status !== "underwriting") return "Exceptions are asked for while the loan is in underwriting.";
  const hard = termsProblem(deal.app, input);
  if (hard) return hard;
  if (!exceptionReasons(deal.app, input).length) return "These terms are inside the matrix, so they need no exception.";
  if (deal.pricingException?.status === "pending") return "An exception is already waiting for an owner.";
  if (!note.trim()) return "Say why this loan should be priced outside the matrix.";
  return null;
}

/** Why this person can't decide the exception, or null. Whoever asked for it can't be the one who approves it. */
export function exceptionDecisionProblem(deal: Deal, by: string) {
  const exception = deal.pricingException;
  if (!exception || exception.status !== "pending") return "There's no exception waiting.";
  if (exception.requestedBy === by) return "Someone other than whoever asked for it has to decide it.";
  return null;
}

/** What was still needed when the term sheet went out: the documents, and any conditions set before closing. */
export const conditionsOf = (deal: Deal) => [
  ...deal.docs.filter((doc) => !doc.stage && doc.status !== "accepted" && doc.status !== "waived").map((doc) => doc.name),
  ...(deal.conditions ?? []).filter((item) => item.category !== "post_closing" && (item.status === "open" || item.status === "submitted")).map((item) => item.title),
].slice(0, 15);

/** Why a term sheet can't go out on these terms today, or null. */
export function issueProblem(deal: Deal, input: TermsInput) {
  if (deal.status !== "underwriting") return "A term sheet goes out from underwriting.";
  const hard = termsProblem(deal.app, input);
  if (hard) return hard;
  const e = evaluate(pricedApp(deal.app, input));
  if (e.hardStops.length) return e.hardStops[0];
  if (usuryCheck({ amount: e.noteAmount, rate: input.rate, points: input.points, termMonths: e.termMonths }).criminal) return `Rate plus points spread over the term is over ${USURY.criminal}% a year: that's criminal usury in Florida (Fla. Stat. 687.071).`;
  if (!deal.creditReview) return "Sign off the credit review first (Credit review tab).";
  const reasons = exceptionReasons(deal.app, input);
  if (reasons.length && !exceptionCovers(deal.pricingException, input)) return deal.pricingException?.status === "pending" ? "Waiting for an owner to approve the exception." : `${reasons[0]}. That needs an owner's approval first.`;
  return null;
}

/** The term sheet these terms make: the numbers fixed as they are today, the matrix's room, and any approved exception. */
export function draftSheet(deal: Deal, input: TermsInput, by: string, today: string, at: string): TermSheet {
  const app = pricedApp(deal.app, input);
  const e = evaluate(app);
  const m = matrixOf(deal.app);
  const exception = exceptionReasons(deal.app, input).length && exceptionCovers(deal.pricingException, input) ? deal.pricingException : undefined;
  const choices = exception ? [] : buyDownOptions(app, { rate: e.rate, points: e.pointsPct }, { rate: m.rate, points: m.points });
  return {
    version: (deal.termSheets?.length ?? 0) + 1, issuedAt: at, issuedOn: today, issuedBy: by, expiresOn: addDays(today, TERM_SHEET_DAYS), status: "sent",
    pricingVersion: deal.app.pricingVersion ?? BASE_VERSION,
    terms: { noteAmount: e.noteAmount, initialAdvance: e.initialAdvance, holdback: e.holdback, financedReserve: e.financedReserve, rate: e.rate, pointsPct: e.pointsPct, points: e.points, lenderFees: e.lenderFees, termMonths: e.termMonths, monthlyPayment: e.monthlyPayment, cashToClose: e.cashToClose, interestReserve: app.interestReserve, accrual: app.accrual, prepay: PREPAY[input.prepay], ...(deal.brokerPoints ? { brokerPoints: deal.brokerPoints, brokerFee: round2((e.noteAmount * deal.brokerPoints) / 100) } : {}) },
    matrix: { rate: m.rate, points: m.points },
    ...(exception ? { exception } : {}),
    // Inside the matrix, the borrower can trade points for rate when they accept; an exception's terms stand as approved.
    ...(!exception && choices.length > 1 ? { buyDowns: choices } : {}),
    conditions: conditionsOf(deal),
  };
}

/**
 * The term sheet's terms at one of its rate-and-points choices: the loan priced at that pair, everything else as sent. The
 * same terms if it's the pair it was sent with.
 */
export function chosenTerms(deal: Deal, sheet: TermSheet, choice: { rate: number; points: number }): TermSheetTerms {
  if (near(choice.rate, sheet.terms.rate) && near(choice.points, sheet.terms.pointsPct)) return sheet.terms;
  const e = evaluate({ ...deal.app, termRate: choice.rate, termPoints: choice.points, ...(deal.app.product === "dscr" ? {} : { termMonths: sheet.terms.termMonths }) }, pricingFor(sheet.pricingVersion));
  const brokerFee = sheet.terms.brokerPoints ? { brokerFee: round2((e.noteAmount * sheet.terms.brokerPoints) / 100) } : {};
  return { ...sheet.terms, noteAmount: e.noteAmount, initialAdvance: e.initialAdvance, holdback: e.holdback, financedReserve: e.financedReserve, rate: e.rate, pointsPct: e.pointsPct, points: e.points, lenderFees: e.lenderFees, monthlyPayment: e.monthlyPayment, cashToClose: e.cashToClose, ...brokerFee };
}

export const latestSheet = (deal: Pick<Deal, "termSheets">) => deal.termSheets?.[deal.termSheets.length - 1];

/** Why the borrower can't accept, ask for changes to, or decline the term sheet today, or null. */
export function respondProblem(deal: Deal, today: string) {
  if (deal.status !== "term_sheet_issued") return "There's no term sheet waiting on this loan.";
  const sheet = latestSheet(deal);
  // A loan whose term sheet went out before they were kept as versions can still be accepted.
  if (!sheet) return null;
  if (sheet.status !== "sent") return "This term sheet has already been answered.";
  if (today > sheet.expiresOn) return `This term sheet expired on ${sheet.expiresOn}. Ask your loan officer for a new one.`;
  return null;
}

/** Tonight's check: term sheets to remind the borrower about (two days or less left) and ones past their last day. */
export function termSheetChecks(deals: Deal[], today: string) {
  const remind: string[] = []; const expire: string[] = [];
  for (const deal of deals) {
    const sheet = latestSheet(deal);
    if (deal.status !== "term_sheet_issued" || sheet?.status !== "sent") continue;
    if (today > sheet.expiresOn) expire.push(deal.id);
    else if (!sheet.remindedOn && daysBetween(today, sheet.expiresOn) <= 2) remind.push(deal.id);
  }
  return { remind, expire };
}

export const SHEET_STATUS: Record<TermSheet["status"], string> = { sent: "Waiting for the borrower", accepted: "Accepted", changes_requested: "Changes asked for", declined: "Declined", expired: "Expired", superseded: "Replaced" };

const money = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export type SheetContent = {
  lender: string; title: string; subtitle: string; banner?: string; sample?: boolean;
  facts: [string, string][]; terms: [string, string][]; conditions: string[]; paragraphs: string[]; signature: string;
};

/**
 * The term sheet itself, for the page and the PDF alike. PLACEHOLDER wording until the attorney approves it.
 * Everything in it comes from the version as it was sent, so a PDF opened later says what the borrower was offered.
 */
export function sheetContent(deal: Deal, sheet: TermSheet, lender = "LendHous"): SheetContent {
  const t = sheet.terms;
  const cfg = pricingFor(sheet.pricingVersion);
  const servicing = servicingTermsOf({ app: { ...deal.app, pricingVersion: sheet.pricingVersion } });
  const later = deal.termSheets?.find((item) => item.version > sheet.version);
  const banner = sheet.status === "superseded" || later ? `Replaced by version ${later?.version ?? sheet.version + 1}.`
    : sheet.status === "expired" ? `Expired on ${longDay(sheet.expiresOn)}.`
    : sheet.status === "declined" ? "Declined by the borrower."
    : sheet.status === "changes_requested" ? "The borrower asked for changes." : undefined;
  const rental = deal.app.product === "dscr";
  const terms: [string, string][] = [["Loan amount", money(t.noteAmount)]];
  if (!rental && t.initialAdvance !== t.noteAmount) terms.push(["Advanced at closing", money(t.initialAdvance)]);
  if (t.holdback > 0) terms.push(["Rehab or construction holdback", `${money(t.holdback)}, released in draws as the work is done`]);
  if (t.financedReserve > 0) terms.push(["Interest reserve", `${money(t.financedReserve)}, held from the loan to pay interest`]);
  terms.push(["Interest rate", `${percent(t.rate)} a year, ${rental ? "30-year amortizing" : t.accrual === "full_boat" ? "interest only, on the full loan amount" : "interest only, on the money advanced"}`]);
  terms.push(["Origination points", `${t.pointsPct}% (${money(t.points)})`], ["Lender fees", money(t.lenderFees)]);
  if (sheet.boughtDown) terms.push(["Rate and points chosen", `Sent at ${percent(sheet.boughtDown.rate)} with ${sheet.boughtDown.pointsPct}% in points; the borrower chose ${percent(t.rate)} with ${t.pointsPct}% when accepting`]);
  else if (sheet.buyDowns && sheet.status === "sent") {
    const [fewest, most] = [sheet.buyDowns[0], sheet.buyDowns[sheet.buyDowns.length - 1]];
    terms.push(["Other rate choices", `From ${percent(fewest.rate)} with ${fewest.points}% in points to ${percent(most.rate)} with ${most.points}%, in quarter-point steps: choose one when accepting`]);
  }
  if (t.brokerFee) terms.push(["Broker's fee", `${t.brokerPoints}% (${money(t.brokerFee)}), paid by the borrower to the broker at closing`]);
  terms.push(["Term", rental ? "30 years" : `${t.termMonths} months from closing`]);
  terms.push([rental ? "Monthly payment" : "First monthly payment (estimated)", money(t.monthlyPayment)], ["Cash to close (estimated)", money(t.cashToClose)]);
  terms.push(["Prepayment", t.prepay]);
  if (!rental) terms.push(["Extensions", `Up to ${cfg.extensions.maxCount}, of up to ${cfg.extensions.monthsEach} months each, at ${cfg.extensions.feePoints}% of the loan amount each`]);
  terms.push(["Late charge", `${servicing.lateFeePct * 100}% of a payment more than ${servicing.graceDays} days late`], ["Default rate", `${percent(defaultRate(t.rate, servicing))} a year`]);
  return {
    lender, title: "Term sheet", subtitle: `Version ${sheet.version} · issued ${longDay(sheet.issuedOn)} · open until ${longDay(sheet.expiresOn)}`, banner,
    facts: [["Borrower", deal.entityName || deal.borrowerName], ["Guarantor", deal.borrowerName], ["Property", `${deal.address}, ${deal.city} ${deal.zip}`], ["Loan", `${PRODUCT_NAMES[deal.app.product]}, ${deal.app.purpose === "purchase" ? "purchase" : "refinance"} (${deal.loanNumber})`]],
    terms,
    conditions: sheet.conditions,
    paragraphs: [
      "This term sheet sets out the terms on which we would make this loan. It isn't a commitment to lend. The loan depends on underwriting, the appraisal, title, insurance and the conditions listed, and the signed loan documents govern where they differ from it.",
      "It's for a business-purpose loan to the borrowing company, secured by a first mortgage on the property, and not for personal, family or household purposes.",
      `Accept it in the LendHous portal by ${longDay(sheet.expiresOn)}. After that it expires, and a new one would be needed.`,
    ],
    signature: sheet.response?.signedName ? `Accepted by ${sheet.response.signedName} on ${longDay(sheet.response.at.slice(0, 10))}.` : "Not accepted yet.",
  };
}
