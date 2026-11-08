// Collecting on a late or defaulted loan (Spec 8.3, 8.10, A26): each call, text, letter and visit, the borrower's promises
// to pay and whether they were kept, the notices sent and the proof they arrived, a bankruptcy's automatic stay, the
// foreclosure case in court, and the property once it's LendHous's: carrying costs, the sale, and who takes the loss.
// Pure, so the reducer, the access rules, the alerts, the work queue and the screens all give the same answer. The notices
// themselves and the case are the attorney's; this keeps the record and the clock.
import type { Book } from "./book";
import type { AdvanceKind, Bankruptcy, ContactChannel, ContactOutcome, Deal, DeliveryMethod, ForeclosureStep, NoticeKind, PromiseToPay, Reo } from "./mockData";
import { shortDay } from "./format";
import { addDays, advancesOwed, balanceOf, ledgerOf, openDefault, payoffFor, SERVICED } from "./servicing";

const round2 = (amount: number) => Math.round(amount * 100) / 100;
const sum = <T>(items: T[], pick: (item: T) => number) => round2(items.reduce((total, item) => total + pick(item), 0));

export const CONTACT_CHANNELS: Record<ContactChannel, string> = { call: "Call", text: "Text", email: "Email", letter: "Letter", visit: "Visit" };
export const CONTACT_OUTCOMES: Record<ContactOutcome, string> = { reached: "Reached them", left_message: "Left a message", no_answer: "No answer", wrong_number: "Wrong number", refused: "Wouldn't talk" };
export const NOTICE_KINDS: Record<NoticeKind, string> = { late: "Late payment notice", default: "Notice of default and right to cure", acceleration: "Notice of acceleration", maturity_demand: "Demand for payoff at maturity" };
export const DELIVERY_METHODS: Record<DeliveryMethod, string> = { certified_mail: "Certified mail, return receipt", first_class: "First-class mail", overnight: "Overnight courier", hand: "Hand delivery", email: "Email" };
export const ADVANCE_KINDS: Record<AdvanceKind, string> = { attorney: "Attorney's fees", court: "Court and filing costs", title: "Title search", service: "Service of process", taxes: "Property taxes", insurance: "Insurance", hoa: "HOA dues", utilities: "Utilities", repairs: "Repairs", preservation: "Securing and upkeep", commission: "Sales commission", other: "Other" };
export const BANKRUPTCY_ENDS: Record<NonNullable<Bankruptcy["ended"]>["how"], string> = { dismissed: "Case dismissed", discharged: "Debtor discharged", relief_from_stay: "Relief from the stay granted", closed: "Case closed" };
export const STOP_REASONS = { reinstated: "Brought current", paid_off: "Paid off", modified: "Modified", dismissed: "Case dismissed", deed_in_lieu: "Deed in lieu taken" } as const;

/**
 * PLACEHOLDER until the attorney sets them from the loan documents and the rules: the days a notice of default gives the
 * borrower to cure, the days after a filing to file a proof of claim (Fed. R. Bankr. P. 3002(c): 70 days in chapters 7
 * and 13), how long without a call before the queue asks for one, and how far out a promise to pay can be.
 */
export const COLLECTIONS = { cureDays: 30, claimDays: 70, quietDays: 7, promiseDays: 45 };

/** The steps of a Florida foreclosure, in order, with what each means. The attorney runs the case; the team records it. */
export const FORECLOSURE_STEPS: { step: ForeclosureStep; label: string; hint: string }[] = [
  { step: "complaint_filed", label: "Complaint filed and lis pendens recorded", hint: "Filed in the county's circuit court, with the notice of the suit recorded on the property." },
  { step: "served", label: "Borrower and guarantors served", hint: "They have 20 days to answer (Fla. R. Civ. P. 1.140)." },
  { step: "default_entered", label: "Default entered or answer filed", hint: "No answer lets the clerk enter a default; an answer means the case is contested." },
  { step: "judgment", label: "Final judgment", hint: "The court sets what's owed and a sale date 20 to 35 days out (Fla. Stat. 45.031)." },
  { step: "sale_held", label: "Sale held", hint: "The clerk's auction. LendHous bids its judgment; the right to redeem ends when the certificate of sale is filed (Fla. Stat. 45.0315)." },
  { step: "certificate_of_title", label: "Certificate of title", hint: "Issued about 10 days after the sale if no one objects. Then the property is LendHous's." },
];
export const stepLabel = (step: ForeclosureStep) => FORECLOSURE_STEPS.find((item) => item.step === step)!.label;

export const openBankruptcy = (deal: Pick<Deal, "bankruptcies">) => (deal.bankruptcies ?? []).find((item) => !item.ended);
/** The automatic stay (11 U.S.C. 362): no collection, no notices, no foreclosure steps, while a case is open. */
export const inBankruptcy = (deal: Pick<Deal, "bankruptcies">) => Boolean(openBankruptcy(deal));
/** The day the proof of claim is due in an open case, until it's filed. */
export const claimDueOn = (bankruptcy: Bankruptcy) => addDays(bankruptcy.filedOn, COLLECTIONS.claimDays);

/** What a statement says while the borrower is in bankruptcy. PLACEHOLDER wording until counsel approves it. */
export const BANKRUPTCY_NOTE = "You're in a bankruptcy case. This statement is for your information only. It isn't an attempt to collect a debt or a demand for payment.";

/** The borrower-facing emails the stay pauses. Statements and payoff letters still go: they ask for nothing. */
export const PAUSED_IN_BANKRUPTCY = new Set(["payment.late", "loan.delinquent", "loan.maturity_notice", "loan.matured", "exit.asked", "loan.default"]);

export type PromiseState = "open" | "kept" | "broken" | "cancelled";
/** Whether a promise was kept: as much as promised arrived from the day it was made through the day it was due. */
export function promiseState(deal: Pick<Deal, "payments">, promise: PromiseToPay, today: string): { state: PromiseState; received: number } {
  const received = sum((deal.payments ?? []).filter((payment) => !payment.reversed && payment.receivedOn >= promise.madeOn && payment.receivedOn <= promise.dueBy && payment.receivedOn <= today), (payment) => payment.amount);
  if (promise.cancelled) return { state: "cancelled", received };
  if (received + 0.005 >= promise.amount) return { state: "kept", received };
  return { state: today > promise.dueBy ? "broken" : "open", received };
}
export const latestPromise = (deal: Pick<Deal, "promises">) => (deal.promises ?? []).filter((item) => !item.cancelled).at(-1);

/** The notice of default most recently sent, and the day its cure period ends once it's arrived. */
export function defaultNotice(deal: Pick<Deal, "notices">) {
  const notice = (deal.notices ?? []).filter((item) => item.kind === "default").at(-1);
  return notice ? { notice, cureEnds: notice.cureBy ?? addDays(notice.delivered?.on ?? notice.sentOn, COLLECTIONS.cureDays) } : undefined;
}

export const lastContact = (deal: Pick<Deal, "contacts">) => (deal.contacts ?? []).at(-1);
const openForeclosure = (deal: Pick<Deal, "foreclosure">) => (deal.foreclosure && !deal.foreclosure.stopped ? deal.foreclosure : undefined);
export const inForeclosure = (deal: Pick<Deal, "foreclosure">) => Boolean(openForeclosure(deal));
/** The next step of an open foreclosure, or none once the certificate of title is in. */
export function nextStep(deal: Pick<Deal, "foreclosure">) {
  const done = new Set(openForeclosure(deal)?.steps.map((item) => item.step));
  return openForeclosure(deal) ? FORECLOSURE_STEPS.find((item) => !done.has(item.step)) : undefined;
}

export type Stage = "reo" | "bankruptcy" | "foreclosure" | "default" | "matured" | "delinquent" | "late";
export const STAGE_LABEL: Record<Stage, string> = { reo: "Bank-owned", bankruptcy: "Bankruptcy", foreclosure: "Foreclosure", default: "Default", matured: "Past maturity", delinquent: "Delinquent", late: "Late" };
/** Where a loan is in collections, worst first, or null for one paid as agreed. */
export function stageOf(deal: Deal, today: string): Stage | null {
  if (deal.status === "reo") return deal.reo?.sold ? null : "reo";
  if (!SERVICED.includes(deal.status)) return null;
  if (inBankruptcy(deal)) return "bankruptcy";
  if (inForeclosure(deal)) return "foreclosure";
  if (deal.status === "default" || openDefault(deal)) return "default";
  const l = ledgerOf(deal, today);
  if (l.matured) return "matured";
  if (deal.status === "servicing_delinquent") return "delinquent";
  return l.paymentsLate > 0 || l.feesOwed > 0.005 ? "late" : null;
}
/** The stages that put Collections in the staff menu: past the point of a reminder call. */
export const SERIOUS: Stage[] = ["reo", "bankruptcy", "foreclosure", "default"];

/** What the team should do next on a loan in collections, in a few words. */
export function nextAction(deal: Deal, today: string): string {
  const stage = stageOf(deal, today);
  if (!stage) return "Nothing: paid as agreed";
  if (stage === "reo") return deal.reo?.listed ? "Record the sale when it closes" : "List the property for sale";
  const bankruptcy = openBankruptcy(deal);
  if (bankruptcy) return bankruptcy.claimFiledOn ? "Automatic stay: no collection. Watch the case for dismissal or relief from the stay" : `File the proof of claim by ${shortDay(claimDueOn(bankruptcy))}`;
  if (stage === "foreclosure") {
    const step = nextStep(deal);
    const sale = deal.foreclosure?.sale;
    if (sale?.winner === "third_party" && !deal.paidOff) return "Record the sale money from the clerk";
    return step ? `Foreclosure: ${step.label.toLowerCase()}` : "Foreclosure: record the certificate of title";
  }
  if (stage === "default") {
    const sent = defaultNotice(deal);
    if (!sent) return "Send the notice of default";
    if (sent.notice.returned) return "The notice of default came back: send it another way";
    if (!sent.notice.delivered) return "Confirm the notice of default arrived";
    return today > sent.cureEnds ? "Cure period over: refer it to the foreclosure attorney" : `Cure period runs to ${shortDay(sent.cureEnds)}`;
  }
  const promise = latestPromise(deal);
  if (promise) {
    const { state } = promiseState(deal, promise, today);
    if (state === "open") return `Promised ${money(promise.amount)} by ${shortDay(promise.dueBy)}`;
    if (state === "broken") return "Promise broken: call again";
  }
  const contact = lastContact(deal);
  if (!contact || contact.on < addDays(today, -COLLECTIONS.quietDays)) return "Call the borrower";
  return stage === "matured" ? "Get the payoff or an extension" : "Follow up";
}
const money = (amount: number) => `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** Why a collection step can't happen while the automatic stay is on, or null. Ending the case and the claim are always allowed. */
export const stayProblem = (deal: Pick<Deal, "bankruptcies">, what: string) => (inBankruptcy(deal) ? `${what} has to wait: the borrower is in bankruptcy, and the automatic stay stops collection until the case ends or the court lifts it.` : null);

/** Why a foreclosure step can't be recorded, or null. Steps go in order and on or after the one before. */
export function stepProblem(deal: Deal, step: ForeclosureStep, on: string, today: string, extra: { judgment?: { amount: number; saleOn: string }; sale?: { winner: "lendhous" | "third_party"; amount: number } }) {
  const open = openForeclosure(deal);
  if (!open) return "Refer the loan to the foreclosure attorney first.";
  const stayed = stayProblem(deal, "The foreclosure");
  if (stayed) return stayed;
  if (on > today) return "The date can't be in the future.";
  const next = nextStep(deal);
  if (!next || next.step !== step) return next ? `The next step is: ${next.label.toLowerCase()}.` : "The foreclosure is done.";
  const before = open.steps.at(-1)?.on ?? open.referredOn;
  if (on < before) return "That's before the step before it.";
  if (step === "judgment" && (!extra.judgment || !(extra.judgment.amount > 0) || extra.judgment.saleOn <= on)) return "Enter the judgment amount and a sale date after it.";
  if (step === "sale_held" && (!extra.sale || !(extra.sale.amount > 0))) return "Enter who won the sale and the winning bid.";
  if (step === "certificate_of_title" && open.sale?.winner !== "lendhous") return "A third party won the sale: record the money from the clerk instead.";
  return null;
}

/** What the loan came to when LendHous took the property: what it's owed, which the sale is measured against. */
export function owedAtTitle(deal: Deal, on: string): Reo["owed"] {
  const quote = payoffFor(deal, on, ledgerOf(deal, on));
  return { principal: balanceOf(deal), interest: round2(quote.accrued + quote.defaultAccrued), fees: quote.fees, advances: advancesOwed(deal) };
}

/** Carrying costs: what LendHous paid out on the property once it owned it. */
export const carryingCosts = (deal: Pick<Deal, "advances" | "reo">) => (deal.reo ? sum((deal.advances ?? []).filter((item) => item.on >= deal.reo!.since), (item) => item.amount) : 0);

/**
 * Where a bank-owned property's sale money went. The sale's own costs come off first, then LendHous takes back the costs it
 * advanced and carried (PLACEHOLDER until the participation and sale agreements say otherwise), then principal, then the
 * interest and fees the loan was owed; anything over that is a gain. What's short of principal is the loss.
 */
export function reoProceeds(deal: Pick<Deal, "reo" | "advances">) {
  const reo = deal.reo;
  if (!reo?.sold) return { net: 0, costs: 0, costsBack: 0, principal: 0, interest: 0, principalLoss: 0, costShortfall: 0, interestLost: 0 };
  const net = round2(reo.sold.price - reo.sold.closingCosts);
  const costs = round2(reo.owed.advances + carryingCosts(deal));
  const costsBack = Math.min(Math.max(0, net), costs);
  const left = Math.max(0, net - costs);
  const principal = Math.min(reo.owed.principal, left);
  const interest = round2(left - principal);
  return { net, costs, costsBack: round2(costsBack), principal: round2(principal), interest, principalLoss: round2(reo.owed.principal - principal), costShortfall: round2(costs - costsBack), interestLost: round2(Math.max(0, reo.owed.interest + reo.owed.fees - interest)) };
}

export type LossLine = { who: string; share: number; principal: number; recovered: number; loss: number; income: number };
/**
 * Who holds what of a loan, and so who takes what of a loss: each partner's current share, a buyer that bought it whole,
 * and LendHous for the rest. LendHous also bears costs the sale didn't cover (PLACEHOLDER, with reoProceeds).
 */
export function lossSplit(book: Pick<Book, "bids" | "sales" | "partners" | "buyers">, deal: Deal): LossLine[] {
  const paid = reoProceeds(deal);
  const owed = deal.reo?.owed.principal ?? balanceOf(deal);
  const sale = book.sales.find((item) => item.dealId === deal.id && item.status === "sold");
  const holders = sale
    ? [{ who: book.buyers.find((item) => item.id === sale.soldTo)?.name ?? "The buyer", share: 1 }]
    : book.bids.filter((bid) => bid.dealId === deal.id && bid.status === "accepted" && !bid.until).map((bid) => ({ who: book.partners.find((item) => item.id === bid.partnerId)?.name ?? "A partner", share: bid.pct / 100 }));
  const own = Math.max(0, round2(1 - holders.reduce((total, item) => total + item.share, 0)));
  const lines = [...holders, ...(own > 0.0001 ? [{ who: "LendHous", share: own }] : [])].map((item) => ({ ...item, principal: round2(owed * item.share), recovered: round2(paid.principal * item.share), loss: round2(paid.principalLoss * item.share), income: round2(paid.interest * item.share) }));
  if (paid.costShortfall > 0) {
    const lendhous = lines.find((line) => line.who === "LendHous");
    if (lendhous) lendhous.loss = round2(lendhous.loss + paid.costShortfall);
    else lines.push({ who: "LendHous", share: 0, principal: 0, recovered: 0, loss: paid.costShortfall, income: 0 });
  }
  return lines;
}
