// Scheduled reports (docs/competitor-gaps-2026-11-09.md, rank 23): delinquency, maturities and aged receivables as
// spreadsheets, on a weekly or monthly schedule, to named people. Partners, buyers and a future warehouse lender expect
// regular files. The email carries a link, never the file: the spreadsheet is made when the person signs in and opens it,
// for what they may see, so a forwarded email gives nothing away. The team gets the whole book; a partner or buyer gets the
// loans its firm holds, with no borrower names. Pure, given the book.
import type { Book } from "./book";
import { holdingsOf, type Investor } from "./investor-statements";
import type { Deal } from "./mockData";
import { advancesOwed, balanceOf, daysBetween, ledger, SERVICED } from "./servicing";

export type ReportKind = "delinquency" | "maturities" | "receivables";
export const REPORT_KINDS: Record<ReportKind, { label: string; hint: string }> = {
  delinquency: { label: "Delinquency", hint: "Funded loans behind on payments: days past due, what's owed and what brings each current." },
  maturities: { label: "Maturities", hint: "Short-term loans maturing in the next 120 days or already past it, with extensions and payoff letters." },
  receivables: { label: "Aged receivables", hint: "What borrowers owe and haven't paid, by how long it's been owed, with late fees and costs advanced." },
};
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export type ReportSchedule = {
  id: string; kind: ReportKind;
  /** Weekly on a weekday (1 Monday to 7 Sunday), or monthly on a day from 1 to 28. */
  every: "week" | "month"; day: number;
  /** The people it goes to, by account: their email and what they may see are looked up when it's sent. */
  to: { id: string; name: string }[];
  by: string; at: string; lastSent?: string;
};

/** The day of the week, 1 Monday to 7 Sunday. */
const weekday = (day: string) => ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** Whether a schedule goes out on this day and hasn't yet. */
export const dueOn = (schedule: Pick<ReportSchedule, "every" | "day" | "lastSent">, today: string) => schedule.lastSent !== today && (schedule.every === "week" ? weekday(today) === schedule.day : Number(today.slice(8, 10)) === schedule.day);

/** When it goes out, in words. */
export const scheduleWords = (schedule: Pick<ReportSchedule, "every" | "day">) => (schedule.every === "week" ? `Every ${WEEKDAYS[schedule.day - 1]}` : `Monthly on the ${schedule.day}${[1, 21].includes(schedule.day) ? "st" : [2, 22].includes(schedule.day) ? "nd" : [3, 23].includes(schedule.day) ? "rd" : "th"}`);

/** Why a schedule can't be saved as entered, or null. */
export function scheduleProblem(input: Pick<ReportSchedule, "kind" | "every" | "day" | "to">) {
  if (!(input.kind in REPORT_KINDS)) return "Choose a report.";
  if (input.every === "week" ? !(input.day >= 1 && input.day <= 7) : !(input.day >= 1 && input.day <= 28)) return input.every === "week" ? "Choose a weekday." : "Choose a day from 1 to 28, so every month has it.";
  if (!input.to.length) return "Choose who it goes to.";
  if (input.to.length > 25) return "Send it to 25 people at most.";
  return null;
}

type Row = Record<string, string | number>;
const round2 = (amount: number) => Math.round(amount * 100) / 100;
/** For a holder: its share of the loan, and no borrower named. */
type Scope = { names: boolean; share: (deal: Deal) => number | null };

const head = (deal: Deal, scope: Scope): Row => ({ Loan: deal.loanNumber, ...(scope.names ? { Borrower: deal.entityName || deal.borrowerName } : {}), Program: deal.app.product, County: deal.app.county, ...(scope.share(deal) !== null ? { "Your share": `${Math.round(scope.share(deal)! * 1000) / 10}%` } : {}) });

function delinquency(deals: Deal[], scope: Scope): Row[] {
  return deals.flatMap((deal) => {
    const l = ledger(deal);
    if (!l.daysPastDue && deal.status !== "default") return [];
    return [{ ...head(deal, scope), Status: deal.status.replace(/_/g, " "), "Days past due": l.daysPastDue, "Payments late": l.paymentsLate, "Past due": l.pastDue, "Late fees owed": l.feesOwed, "To bring current": l.amountDue, Balance: round2(balanceOf(deal)), "Last paid through": l.paidThrough }];
  }).sort((a, b) => Number(b["Days past due"]) - Number(a["Days past due"]));
}

function maturities(deals: Deal[], scope: Scope, today: string): Row[] {
  return deals.flatMap((deal) => {
    if (deal.app.product === "dscr") return [];
    const l = ledger(deal);
    const days = daysBetween(today, l.maturity);
    if (days > 120) return [];
    const asked = (deal.extensions ?? []).find((item) => item.status === "requested" || item.status === "approved");
    return [{ ...head(deal, scope), Maturity: l.maturity, "Days to maturity": days, Balance: round2(balanceOf(deal)), "Extensions used": (deal.extensions ?? []).filter((item) => item.status === "executed").length, "Extension asked": asked ? `${asked.months} months, ${asked.status}` : "", ...(scope.names ? { "Borrower's exit": deal.exitPlan ? `${deal.exitPlan.choice.replace(/_/g, " ")} (${deal.exitPlan.confidence})` : "Not asked yet" } : {}) }];
  }).sort((a, b) => Number(a["Days to maturity"]) - Number(b["Days to maturity"]));
}

const BUCKETS: [string, number, number][] = [["Within grace", 0, 0], ["1-30 days", 1, 30], ["31-60 days", 31, 60], ["61-90 days", 61, 90], ["Over 90 days", 91, Infinity]];

function receivables(deals: Deal[], scope: Scope, today: string): Row[] {
  return deals.flatMap((deal) => {
    const l = ledger(deal);
    const owed = l.rows.filter((row) => row.status === "due" || row.status === "late").map((row) => ({ amount: row.amount, age: Math.max(0, daysBetween(row.due, today)) }));
    // Past maturity, the whole balance is owed from that day.
    if (l.matured) owed.push({ amount: balanceOf(deal), age: Math.max(0, daysBetween(l.maturity, today)) });
    const advances = advancesOwed(deal);
    if (!owed.length && !l.feesOwed && !advances) return [];
    const buckets = Object.fromEntries(BUCKETS.map(([label, min, max]) => [label, round2(owed.filter((item) => item.age >= min && item.age <= max).reduce((sum, item) => sum + item.amount, 0))]));
    const total = round2(Object.values(buckets).reduce((sum, amount) => sum + amount, 0) + l.feesOwed + advances);
    return [{ ...head(deal, scope), ...buckets, "Late fees": l.feesOwed, "Costs advanced": advances, "Credit held": l.credit, Total: total }];
  }).sort((a, b) => Number(b.Total) - Number(a.Total));
}

/** The report's rows: the team's whole book, or a partner's or buyer's own loans. */
export function scheduledRows(kind: ReportKind, book: Book, today: string, holder?: Investor): Row[] {
  const funded = book.deals.filter((deal) => SERVICED.includes(deal.status));
  let deals = funded;
  let scope: Scope = { names: true, share: () => null };
  if (holder) {
    const held = new Map(holdingsOf(book, holder).filter((item) => !item.until).map((item) => [item.deal.id, item.share]));
    deals = funded.filter((deal) => held.has(deal.id));
    scope = { names: false, share: (deal) => held.get(deal.id) ?? null };
  }
  if (kind === "delinquency") return delinquency(deals, scope);
  if (kind === "maturities") return maturities(deals, scope, today);
  return receivables(deals, scope, today);
}

/** The email that says it's ready: a link, and how many loans are in it, nothing more. */
export function readyEmail(schedule: Pick<ReportSchedule, "kind" | "every" | "day">, rows: number, origin: string, today: string) {
  const label = REPORT_KINDS[schedule.kind].label;
  return {
    subject: `Your ${label.toLowerCase()} report for ${today}`,
    body: `Your ${scheduleWords(schedule).toLowerCase()} ${label.toLowerCase()} report is ready: ${rows === 0 ? "no loans are on it today." : `${rows} loan${rows === 1 ? "" : "s"} on it.`}\n\nSign in to download it: ${origin}/api/reports/scheduled/${schedule.kind}\n\nThe file is made when you open it, so it's current then, and only for what your account may see.`,
  };
}

