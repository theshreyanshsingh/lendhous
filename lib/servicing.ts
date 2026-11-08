// A funded loan's payments, lateness, maturity and payoff (Spec 8). Dates are YYYY-MM-DD and interest is paid in arrears
// on the 1st, so a loan's first payment falls on the 1st of the month after it closes and the last on the 1st before it
// matures. Everything here is worked out again from what's stored (the payments received, the amount each month owed,
// the fees waived), so recording, reversing or waiving anything gives the same answer as if it had happened in order.
import { evaluate, fundedBalances, ioPayment, maturityDate, payoffQuote, round2 } from "./engine";
import type { Deal, LoanModification, LoanPayment, PaymentMethod } from "./mockData";
import { currentPricing, pricingFor } from "./pricing-versions";

/** A loan's servicing terms (grace days, late fee, default rate). They're in its note, so they come from the pricing it was priced on. */
export const servicingTermsOf = (deal: Pick<Deal, "app">) => pricingFor(deal.app.pricingVersion).servicing;
type ServicingTerms = ReturnType<typeof servicingTermsOf>;

/** The statuses a loan is serviced in: it has money out and payments coming due. */
export const SERVICED = ["funded", "servicing_current", "servicing_delinquent", "matured", "default"];
/** PLACEHOLDER: the days before maturity a short-term loan's borrower is asked how they'll pay it off (lib/exit-plans.ts). */
export const EXIT_OUTREACH_DAYS = [120, 90, 60, 30];

export const METHODS: Record<PaymentMethod, string> = { wire: "Wire", ach: "ACH", check: "Check", other: "Other", reserve: "From the interest reserve" };

/** The same day a number of months later. Only used with due dates, which are always the 1st. */
export function addMonths(date: string, months: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + months, day)).toISOString().slice(0, 10);
}

export const addDays = (date: string, days: number) => new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
export const firstDueDate = (closingDate: string) => addMonths(`${closingDate.slice(0, 7)}-01`, 1);

/** Today where the loans are: the properties and borrowers are in Florida, so a payment is late by Eastern time. */
export const servicingDate = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** The demo book is a snapshot, so its loans stay as they were on this day instead of falling further behind each month. */
export const DEMO_SERVICING_DAY = "2026-10-31";

type Signed = LoanModification & { executed: NonNullable<LoanModification["executed"]> };
/** The modifications signed on a loan, in the order they were signed (lib/modifications.ts). */
export const signedModifications = (deal: Pick<Deal, "modifications">): Signed[] => (deal.modifications ?? []).filter((item): item is Signed => item.status === "executed" && Boolean(item.executed)).sort((a, b) => a.executed.on.localeCompare(b.executed.on) || a.executed.at.localeCompare(b.executed.at));

/** The months extensions and modifications have added, counting only the ones signed. */
export const extendedMonths = (deal: Pick<Deal, "extensions" | "modifications">) => (deal.extensions ?? []).reduce((sum, item) => sum + (item.status === "executed" ? item.months : 0), 0) + signedModifications(deal).reduce((sum, item) => sum + (item.months ?? 0), 0);

/** The note rate interest runs at on a day: as priced, or as the last modification in effect by then set it. With no day, today's. */
export function noteRateOn(deal: Pick<Deal, "app" | "modifications">, day?: string) {
  let rate = evaluate(deal.app).rate;
  for (const item of signedModifications(deal)) if (!day || item.executed.effectiveOn <= day) rate = item.executed.toRate;
  return rate;
}

/** The payments behind and late fees that modifications in effect by a day (or any day) added to principal. */
export const capitalizedOf = (deal: Pick<Deal, "modifications">, day?: string) => round2(signedModifications(deal).reduce((sum, item) => sum + (!day || item.executed.effectiveOn <= day ? item.executed.capitalizedPayments + item.executed.capitalizedFees : 0), 0));

/**
 * The interest a modification's rate change adds to (or takes off) interest worked out at today's rate, for days between
 * two dates that ran at an earlier rate. None without a change in between.
 */
function earlierRateInterest(deal: Pick<Deal, "app" | "modifications">, amount: number, from: string, to: string, rate: number) {
  let extra = 0;
  let start = from;
  for (const item of signedModifications(deal)) {
    const on = item.executed.effectiveOn;
    if (on <= start || on >= to) continue;
    extra += ((amount * (noteRateOn(deal, start) - rate)) / 100 / 360) * daysBetween(start, on);
    start = on;
  }
  return extra;
}

/**
 * Costs advanced to protect the loan and not yet repaid (lib/collections.ts): attorney's fees, court costs, taxes and the
 * like. They're owed back at payoff. Once the property is LendHous's, what it pays out is a carrying cost instead.
 */
export const advancesOwed = (deal: Pick<Deal, "advances" | "advancesRepaid" | "reo">) => round2((deal.advances ?? []).reduce((sum, item) => sum + (!deal.reo || item.on < deal.reo.since ? item.amount : 0), 0) - (deal.advancesRepaid ?? []).reduce((sum, item) => sum + item.amount, 0));

export const maturityOf = (deal: Deal) => maturityDate(deal.closingDate, evaluate(deal.app).termMonths + extendedMonths(deal));

/** The default declared on the loan and not yet cured, if there is one. */
export const openDefault = (deal: Pick<Deal, "defaults">) => (deal.defaults ?? []).find((item) => !item.cured);

/** The rate after maturity or a default: the note rate plus the default margin, capped. */
export const defaultRate = (ratePct: number, terms: ServicingTerms = currentPricing().servicing) => Math.max(ratePct, Math.min(terms.defaultRateMax, ratePct + terms.defaultRateAdd));
/** This loan's default rate. */
export const defaultRateOf = (deal: Deal) => defaultRate(noteRateOn(deal), servicingTermsOf(deal));

export const lateFeeOn = (amount: number, terms: ServicingTerms = currentPricing().servicing) => round2(amount * terms.lateFeePct);

/** The balance after some payments on an amortizing loan. */
export function amortizedBalance(amount: number, ratePct: number, monthlyPayment: number, payments: number) {
  let left = amount;
  for (let month = 0; month < payments; month++) left -= monthlyPayment - (left * ratePct) / 100 / 12;
  return Math.max(0, left);
}

/**
 * The first payment tracked here. A loan funded before payments were recorded only kept a due date and a count of missed
 * payments, so everything before the oldest missed one counts as paid.
 */
function boardedFrom(deal: Deal) {
  const first = firstDueDate(deal.closingDate);
  const from = deal.boardedThrough ?? (deal.nextPaymentDue ? (deal.paymentsLate ? addMonths(deal.nextPaymentDue, -(deal.paymentsLate - 1)) : deal.nextPaymentDue) : first);
  return from > first ? from : first;
}

export type BillStatus = "boarded" | "paid" | "paid_late" | "paid_ahead" | "due" | "late" | "upcoming" | "capitalized";
export type BillRow = { due: string; amount: number; status: BillStatus; paidOn?: string; lateOn: string; late: boolean; fee: number; feePaid: number; waived: boolean };

export type Ledger = {
  asOf: string; maturity: string; rows: BillRow[]; payments: LoanPayment[];
  /** The oldest payment not yet paid, or none once every payment to maturity is in. */
  nextDue?: string;
  paymentsLate: number; pastDue: number; feesOwed: number; credit: number;
  /** What brings the loan current today: past-due payments and fees, less any credit held. */
  amountDue: number;
  daysPastDue: number; paymentsMade: number; paidThrough: string; matured: boolean; daysToMaturity: number;
};

/**
 * Every payment to maturity and where each dollar received went, as of a day. Money pays the oldest payment due first,
 * then late fees, then the next payments ahead of time. A payment too small to cover a whole one is held as a credit
 * until more arrives. A payment still unpaid once its grace days have passed is late and owes one late fee.
 */
export function ledgerOf(deal: Deal, asOf: string): Ledger {
  const e = evaluate(deal.app);
  const rules = servicingTermsOf(deal);
  const maturity = maturityOf(deal);
  // A portfolio loan's release, or a modification, changes what each payment due after it is; one due before keeps what it
  // was. A short-term loan's interest after a modification is on what's lent now plus what it added, at the new rate.
  const funded = fundedBalances(e, deal.app, deal.disbursedDraws);
  const original = funded.nextPayment;
  const mods = signedModifications(deal);
  const ioBasis = deal.app.accrual === "dutch" ? funded.disbursed : e.noteAmount;
  const changes = [
    ...(deal.releases ?? []).map((release) => ({ when: release.on, at: release.at, from: release.on, payment: () => release.newPayment })),
    ...mods.map((item) => ({ when: item.executed.on, at: item.executed.at, from: item.executed.effectiveOn, payment: () => (deal.app.product === "dscr" ? item.executed.newPayment : round2(ioPayment(ioBasis + capitalizedOf(deal, item.executed.effectiveOn), item.executed.toRate))) })),
  ].sort((a, b) => a.when.localeCompare(b.when) || a.at.localeCompare(b.at));
  const paymentFor = (due: string) => changes.reduce((payment, change) => (change.from < due ? change.payment() : payment), original);
  // Payments a modification added to principal are settled by it; fees it added or waived come off the fee they were on.
  const capitalized = new Set(mods.flatMap((item) => item.executed.capitalizedDues));
  const feeCut = new Map<string, number>();
  for (const item of mods) for (const fee of item.executed.fees) feeCut.set(fee.due, round2((feeCut.get(fee.due) ?? 0) + fee.amount));
  const boarded = boardedFrom(deal);
  const billed = new Map((deal.bills ?? []).map((bill) => [bill.due, bill.amount]));
  const waived = new Set((deal.waivedFees ?? []).map((item) => item.due));
  // A payment an extension added for a month already gone wasn't owed until the extension was signed, so its grace days
  // run from then.
  const signed = [...(deal.extensions ?? []).flatMap((item) => (item.executed ? [{ from: item.fromMaturity, on: item.executed.on }] : [])), ...mods.filter((item) => item.months).map((item) => ({ from: item.executed.fromMaturity, on: item.executed.on }))];
  const billedOn = (due: string) => signed.find((item) => item.from < due && item.on > due)?.on ?? due;
  type Working = Omit<BillRow, "status"> & { boarded: boolean; capitalized: boolean };
  const rows: Working[] = [];
  for (let due = firstDueDate(deal.closingDate); due <= maturity; due = addMonths(due, 1)) {
    rows.push({ due, amount: billed.get(due) ?? paymentFor(due), lateOn: addDays(billedOn(due), rules.graceDays + 1), late: false, fee: 0, feePaid: 0, waived: waived.has(due), boarded: due < boarded, capitalized: capitalized.has(due) });
  }
  const payments = (deal.payments ?? []).filter((payment) => !payment.reversed && payment.receivedOn <= asOf).sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.at.localeCompare(b.at));

  let credit = 0;
  const assess = (day: string) => {
    for (const row of rows) {
      if (row.boarded || row.capitalized || row.late || row.lateOn > day || (row.paidOn && row.paidOn < row.lateOn)) continue;
      row.late = true;
      row.fee = row.waived ? 0 : Math.max(0, round2(lateFeeOn(row.amount, rules) - (feeCut.get(row.due) ?? 0)));
    }
  };
  // Pays whole payments, oldest first, while the money covers them. Returns false when it stopped on one it couldn't cover.
  const payRows = (day: string, dueOnly: boolean) => {
    for (const row of rows) {
      if (row.boarded || row.capitalized || row.paidOn) continue;
      if (dueOnly && row.due > day) return true;
      if (credit + 0.005 < row.amount) return false;
      credit = round2(credit - row.amount);
      row.paidOn = day;
    }
    return true;
  };
  const apply = (day: string) => {
    if (!payRows(day, true)) return;
    for (const row of rows) {
      const owed = round2(row.fee - row.feePaid);
      if (owed <= 0 || credit <= 0) continue;
      const paid = Math.min(owed, credit);
      row.feePaid = round2(row.feePaid + paid);
      credit = round2(credit - paid);
    }
    payRows(day, false);
  };
  // Due dates as well as payments, so a credit held from before pays a payment the day it falls due.
  const events = [...rows.filter((row) => !row.boarded && !row.capitalized && row.due <= asOf).map((row) => ({ day: row.due, amount: 0, order: 0 })), ...payments.map((payment) => ({ day: payment.receivedOn, amount: payment.amount, order: 1 }))]
    .sort((a, b) => a.day.localeCompare(b.day) || a.order - b.order);
  for (const event of events) {
    assess(event.day);
    credit = round2(credit + event.amount);
    apply(event.day);
  }
  assess(asOf);

  const done: BillRow[] = rows.map(({ boarded: isBoarded, capitalized: isCapitalized, ...row }) => ({
    ...row,
    status: isBoarded ? "boarded" : isCapitalized ? "capitalized" : row.paidOn ? (row.due > asOf ? "paid_ahead" : row.late ? "paid_late" : "paid") : row.due > asOf ? "upcoming" : row.late ? "late" : "due",
  }));
  const unpaid = done.filter((row) => row.status === "due" || row.status === "late");
  const pastDue = round2(unpaid.reduce((sum, row) => sum + row.amount, 0));
  const feesOwed = round2(done.reduce((sum, row) => sum + row.fee - row.feePaid, 0));
  const paid = done.filter((row) => row.status === "boarded" || row.status === "capitalized" || row.paidOn);
  return {
    asOf, maturity, rows: done, payments,
    nextDue: done.find((row) => row.status !== "boarded" && row.status !== "capitalized" && !row.paidOn)?.due,
    paymentsLate: done.filter((row) => row.status === "late").length,
    pastDue, feesOwed, credit,
    amountDue: Math.max(0, round2(pastDue + feesOwed - credit)),
    daysPastDue: unpaid.length ? daysBetween(unpaid[0].due, asOf) : 0,
    paymentsMade: paid.length,
    paidThrough: paid.length ? paid[paid.length - 1].due : deal.closingDate,
    matured: asOf > maturity,
    daysToMaturity: daysBetween(asOf, maturity),
  };
}

/** The day a loan's figures are as of: when it was last checked, or, for one never checked, the day its saved state describes. */
export function asOfFor(deal: Deal) {
  if (deal.servicedThrough) return deal.servicedThrough;
  const next = deal.nextPaymentDue ?? firstDueDate(deal.closingDate);
  return addDays(deal.paymentsLate ? addMonths(next, 1) : next, -1);
}

export const ledger = (deal: Deal) => ledgerOf(deal, asOfFor(deal));

/**
 * The loan brought up to a day: each payment that has fallen due keeps the amount it owed, and the due date, the count of
 * late payments and the status follow from the ledger. A declared default stays until someone lifts it.
 */
export function settle(deal: Deal, asOf: string): Deal {
  if (!SERVICED.includes(deal.status)) return deal;
  const day = deal.servicedThrough && deal.servicedThrough > asOf ? deal.servicedThrough : asOf;
  const l = ledgerOf(deal, day);
  const rules = servicingTermsOf(deal);
  const bills = l.rows.filter((row) => row.status !== "boarded" && row.status !== "capitalized" && (row.due <= day || row.paidOn)).map((row) => ({ due: row.due, amount: row.amount }));
  const status: Deal["status"] = deal.status === "default" ? "default" : l.matured ? "matured" : l.daysPastDue >= rules.delinquentDays ? "servicing_delinquent" : deal.status === "funded" ? "funded" : "servicing_current";
  const notices = [...new Set([...(deal.maturityNotices ?? []), ...rules.maturityNoticeDays.filter((days) => l.daysToMaturity <= days)])].sort((a, b) => b - a);
  // A short-term loan with no exit plan yet is asked for one at each outreach day it reaches.
  const asking = deal.app.product !== "dscr" && !deal.exitPlan && status !== "default";
  const asked = asking ? [...new Set([...(deal.exitAsked ?? []), ...EXIT_OUTREACH_DAYS.filter((days) => l.daysToMaturity <= days)])].sort((a, b) => b - a) : deal.exitAsked ?? [];
  return { ...deal, bills, boardedThrough: boardedFrom(deal), servicedThrough: day, nextPaymentDue: l.nextDue, paymentsLate: l.paymentsLate, status, daysInStage: status === deal.status ? deal.daysInStage : 0, exitAsked: asked.length ? asked : undefined, maturityNotices: notices.length ? notices : undefined };
}

export const paymentsMade = (deal: Deal) => ledger(deal).paymentsMade;

/**
 * A rental loan's principal after a number of monthly payments. A portfolio loan's release (lib/portfolio.ts) pays principal
 * down between payments, a modification adds the payments behind to it and can change the rate, and the payment after
 * either is worked out again on what's left over the months left.
 */
export function rentalBalance(deal: Pick<Deal, "app" | "releases" | "modifications">, payments: number) {
  const e = evaluate(deal.app);
  const changes = [
    ...(deal.releases ?? []).map((release) => ({ afterPayments: release.afterPayments, on: release.on, less: release.principal, more: 0, payment: release.newPayment, rate: undefined as number | undefined })),
    ...signedModifications(deal).map((item) => ({ afterPayments: item.executed.afterPayments, on: item.executed.on, less: 0, more: item.executed.capitalizedPayments + item.executed.capitalizedFees, payment: item.executed.newPayment, rate: item.executed.toRate as number | undefined })),
  ].sort((a, b) => a.afterPayments - b.afterPayments || a.on.localeCompare(b.on));
  let balance = e.noteAmount; let payment = e.monthlyPayment; let rate = e.rate; let done = 0;
  for (const change of changes) {
    if (change.afterPayments > payments) break;
    balance = Math.max(0, amortizedBalance(balance, rate, payment, change.afterPayments - done) - change.less + change.more);
    done = change.afterPayments; payment = change.payment; rate = change.rate ?? rate;
  }
  return amortizedBalance(balance, rate, payment, payments - done);
}

/** A rental loan's monthly payment on what's owed over the months left, at a rate (today's unless given): after a release or a modification, or as quoted. */
export function recastPayment(deal: Pick<Deal, "app" | "modifications">, balance: number, paymentsMade: number, rate = noteRateOn(deal)) {
  const dscr = pricingFor(deal.app.pricingVersion).dscr;
  const months = Math.max(1, dscr.amortizationMonths - paymentsMade);
  const r = rate / 100 / 12;
  const payment = dscr.qualifyOn === "io" || r === 0 ? (dscr.qualifyOn === "io" ? (balance * rate) / 100 / 12 : balance / months) : (balance * r) / (1 - Math.pow(1 + r, -months));
  return round2(payment);
}

/** The principal owed today: what has been lent out and what modifications added, less what a rental loan's payments and releases have paid down. */
export function balanceOf(deal: Deal) {
  const e = evaluate(deal.app);
  const amount = deal.app.product === "dscr" ? rentalBalance(deal, paymentsMade(deal)) : fundedBalances(e, deal.app, deal.disbursedDraws).disbursed + capitalizedOf(deal);
  return Math.round(amount * 100) / 100;
}

/** The day interest starts running at the default rate: maturity, or an earlier default's effective date. */
export function defaultInterestFrom(deal: Deal, maturity = maturityOf(deal)) {
  const open = openDefault(deal);
  return open && open.effectiveOn < maturity ? open.effectiveOn : maturity;
}

/**
 * What it takes to pay the loan off on a date: principal, interest since the last payment (at the default rate for days
 * after maturity or a declared default, and at an earlier rate for days before a modification changed it), unpaid late
 * fees and costs advanced, less any credit held.
 */
export function payoffFor(deal: Deal, goodThrough: string, l: Ledger = ledger(deal)) {
  const e = evaluate(deal.app);
  const rate = noteRateOn(deal);
  const principal = balanceOf(deal);
  const advances = advancesOwed(deal);
  // The last payment covers interest up to its own due date. A loan with none yet accrues from closing.
  const basis = deal.app.product !== "dscr" && deal.app.accrual === "full_boat" ? e.noteAmount + capitalizedOf(deal) : undefined;
  const from = defaultInterestFrom(deal, l.maturity);
  const regularEnd = goodThrough < from ? goodThrough : from;
  const regular = payoffQuote({ disbursedPrincipal: principal, ratePct: rate, daysAccrued: Math.max(0, daysBetween(l.paidThrough, regularEnd)), accrualBasisAmount: basis, unpaidCharges: l.feesOwed, protectiveAdvances: advances, borrowerEscrowCredit: l.credit });
  const earlier = earlierRateInterest(deal, basis ?? principal, l.paidThrough, regularEnd, rate);
  const atDefault = payoffQuote({ disbursedPrincipal: 0, ratePct: defaultRate(rate, servicingTermsOf(deal)), daysAccrued: Math.max(0, daysBetween(l.paidThrough > from ? l.paidThrough : from, goodThrough)), accrualBasisAmount: basis ?? principal });
  return {
    principal,
    accrued: earlier ? round2(regular.accrued + earlier) : regular.accrued,
    defaultAccrued: atDefault.accrued,
    fees: l.feesOwed,
    advances,
    credit: l.credit,
    perDiem: goodThrough > from ? atDefault.perDiem : regular.perDiem,
    total: round2(regular.total + earlier + atDefault.accrued),
  };
}

/** Where a payment would go before it's recorded: which payments it covers, how much of the late fees, and what's left over. */
export function previewPayment(deal: Deal, amount: number, receivedOn: string, asOf: string) {
  const day = receivedOn > asOf ? receivedOn : asOf;
  const before = ledgerOf(deal, day);
  const draft: LoanPayment = { id: "preview", amount, receivedOn, method: "other", reference: "", by: "", at: "9999" };
  const after = ledgerOf({ ...deal, payments: [...(deal.payments ?? []), draft] }, day);
  return {
    pays: after.rows.filter((row, index) => row.paidOn && !before.rows[index].paidOn),
    fees: round2(after.rows.reduce((sum, row, index) => sum + row.feePaid - before.rows[index].feePaid, 0)),
    credit: after.credit,
    after,
  };
}

export const BILL_LABEL: Record<BillStatus, string> = { boarded: "Paid", paid: "Paid", paid_late: "Paid late", paid_ahead: "Paid ahead", due: "Due", late: "Late", upcoming: "Upcoming", capitalized: "Added to principal" };
export const billTone = (status: BillStatus) => (status === "late" ? "rose" : status === "due" || status === "paid_late" ? "amber" : status === "upcoming" || status === "capitalized" ? "slate" : "green") as "green";

/** The rows worth showing: every payment that has fallen due or been paid, and the next one coming. */
export const shownRows = (l: Ledger) => {
  const next = l.rows.findIndex((row) => row.status === "upcoming");
  return l.rows.filter((row, index) => row.status !== "upcoming" || index === next);
};
