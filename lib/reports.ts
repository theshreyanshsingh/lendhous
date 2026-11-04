// The business at a glance (Spec 11): the pipeline over a period, and capital and the funded portfolio as they stand
// today. Pure, so the reports page and the owner's morning email come from the same numbers.
import type { Book } from "./book";
import { capitalSummary, est } from "./capital";
import { closureReason, PRE_FUNDING } from "./loan-exits";
import type { Deal, LoanStatus } from "./mockData";
import { addDays, balanceOf, ledger, SERVICED, servicingDate } from "./servicing";
import { feeOf } from "./brokers";

/** Both days included, as YYYY-MM-DD. */
export type Period = { from: string; to: string };

/** A loan that has sat in one stage this many days, before funding, is stuck. */
export const STUCK_DAYS = 7;

export const SOURCE_LABEL: Record<string, string> = {
  web_quote: "Portal application", website_lead: "Website quote request", staff: "Started by the team", broker: "Broker",
  referral: "Referral", wholesale: "Wholesale", realty: "Realty", ad: "Advertising",
};
export const sourceLabel = (source: string) => SOURCE_LABEL[source] ?? (source ? source.replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase()) : "Not recorded");

const FUNDED: LoanStatus[] = [...(SERVICED as LoanStatus[]), "paid_off"];
const dayOf = (at: string) => servicingDate(new Date(at));
export const daysFrom = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
export const inPeriod = (day: string | undefined, period: Period) => Boolean(day && day >= period.from && day <= period.to);

/** The day a loan reached each step. Unknown for steps taken before the loan's history was kept. */
export function milestones(deal: Deal) {
  const entered = (status: LoanStatus) => deal.stages?.find((item) => item.status === status)?.at;
  const at = (stamp: string | undefined) => (stamp ? dayOf(stamp) : undefined);
  const fundedAt = entered("funded");
  const acceptedAt = deal.termSheets?.find((sheet) => sheet.status === "accepted")?.response?.at ?? deal.termSheetSignedAt;
  return {
    submitted: at(entered("submitted")),
    termSheet: deal.termSheets?.[0]?.issuedOn ?? at(entered("term_sheet_issued")),
    accepted: at(acceptedAt ?? entered("term_sheet_accepted")),
    // A loan funded before its history was kept still has its funding day as its closing date.
    funded: FUNDED.includes(deal.status) ? (at(fundedAt) ?? deal.closingDate) : undefined,
    closed: at(deal.closure?.at),
    paidOff: deal.paidOff?.receivedOn,
  };
}
type Step = keyof ReturnType<typeof milestones>;

/** How long a loan has been in its stage: from its history, or the count saved with loans from before it was kept. */
export function daysInStage(deal: Deal, today: string) {
  const last = deal.stages?.at(-1);
  return last && last.status === deal.status ? Math.max(0, daysFrom(dayOf(last.at), today)) : deal.daysInStage;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

type Row = { deal: Deal; at: ReturnType<typeof milestones>; amount: number };
const total = (rows: Row[]) => rows.reduce((sum, row) => sum + row.amount, 0);
const tally = (rows: Row[]) => ({ count: rows.length, amount: total(rows) });
/** Days between two steps, for the rows that have both, and how many that was. */
function cycle(rows: Row[], from: Step, to: Step) {
  const days = rows.flatMap((row) => (row.at[from] && row.at[to] ? [daysFrom(row.at[from]!, row.at[to]!)] : []));
  return { days: median(days), loans: days.length };
}
function groupBy<T>(items: T[], keyOf: (item: T) => string, amountOf: (item: T) => number) {
  const groups = new Map<string, { key: string; count: number; amount: number }>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key) ?? { key, count: 0, amount: 0 };
    group.count++;
    group.amount += amountOf(item);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.amount - a.amount || b.count - a.count);
}

export const BUCKETS = [
  { key: "current", label: "Current", min: 0, max: 0 },
  { key: "1-30", label: "1–30 days late", min: 1, max: 30 },
  { key: "31-60", label: "31–60 days late", min: 31, max: 60 },
  { key: "61-90", label: "61–90 days late", min: 61, max: 90 },
  { key: "90+", label: "Over 90 days late", min: 91, max: Infinity },
] as const;

export type Report = ReturnType<typeof businessReport>;

export function businessReport(book: Book, period: Period, today: string) {
  const rows: Row[] = book.deals.map((deal) => ({ deal, at: milestones(deal), amount: est(deal.app).noteAmount }));
  const during = (step: Step) => rows.filter((row) => inPeriod(row.at[step], period));
  const applied = during("submitted");
  const sheets = during("termSheet");
  const accepted = during("accepted");
  const funded = during("funded");
  const closed = during("closed");
  const paidOff = during("paidOff");

  const bySource = [...new Set(rows.map((row) => row.deal.source))]
    .map((source) => {
      const of = (list: Row[]) => list.filter((row) => row.deal.source === source);
      return { source, label: sourceLabel(source), applications: of(applied).length, termSheets: of(sheets).length, funded: of(funded).length, fundedAmount: total(of(funded)) };
    })
    .filter((row) => row.applications || row.termSheets || row.funded)
    .sort((a, b) => b.fundedAmount - a.fundedAmount || b.applications - a.applications);

  const officerOf = (row: Row) => row.deal.team?.officer?.name ?? "";
  const byOfficer = [...new Set(rows.map(officerOf))]
    .map((name) => {
      const of = (list: Row[]) => list.filter((row) => officerOf(row) === name);
      return { name: name || "No loan officer", applications: of(applied).length, termSheets: of(sheets).length, funded: of(funded).length, fundedAmount: total(of(funded)) };
    })
    .filter((row) => row.applications || row.termSheets || row.funded)
    .sort((a, b) => b.fundedAmount - a.fundedAmount || b.applications - a.applications);

  // Brokered loans by brokerage, with how many came by its referral link and its fees on the loans funded.
  const byBroker = [...new Set(rows.flatMap((row) => (row.deal.brokerId ? [row.deal.brokerId] : [])))]
    .map((id) => {
      const of = (list: Row[]) => list.filter((row) => row.deal.brokerId === id);
      return { name: book.brokers.find((item) => item.id === id)?.name ?? "Broker (no firm record)", applications: of(applied).length, referred: of(applied).filter((row) => row.deal.referredBy).length, funded: of(funded).length, fundedAmount: total(of(funded)), fees: of(funded).reduce((sum, row) => sum + feeOf(row.deal).amount, 0) };
    })
    .filter((row) => row.applications || row.funded)
    .sort((a, b) => b.fundedAmount - a.fundedAmount || b.applications - a.applications);

  const open = rows.filter((row) => PRE_FUNDING.includes(row.deal.status));
  const stuck = open
    .map((row) => ({ deal: row.deal, amount: row.amount, days: daysInStage(row.deal, today) }))
    .filter((row) => row.days > STUCK_DAYS)
    .sort((a, b) => b.days - a.days);

  const capital = capitalSummary(book.deals, book.sources);
  const sum = (pick: (row: (typeof capital)[number]) => number) => capital.reduce((acc, row) => acc + pick(row), 0);

  const serviced = book.deals.filter((deal) => SERVICED.includes(deal.status)).map((deal) => ({ deal, balance: balanceOf(deal), rate: est(deal.app).rate, ledger: ledger(deal) }));
  const outstanding = serviced.reduce((acc, loan) => acc + loan.balance, 0);
  const everFunded = rows.filter((row) => FUNDED.includes(row.deal.status));
  const extended = everFunded.filter((row) => row.deal.extensions?.some((item) => item.status === "executed"));
  const within = (days: number) => serviced.filter((loan) => !loan.ledger.matured && loan.ledger.daysToMaturity <= days);

  return {
    period, today,
    pipeline: {
      applications: tally(applied), termSheets: tally(sheets), accepted: tally(accepted), funded: tally(funded), paidOff: tally(paidOff),
      declined: tally(closed.filter((row) => row.deal.closure!.outcome === "declined")),
      withdrawn: tally(closed.filter((row) => row.deal.closure!.outcome === "withdrawn")),
      bySource,
      byOfficer,
      byBroker,
      // Of the applications that came in during the period, how far each has got.
      pullThrough: {
        applied: applied.length,
        termSheet: applied.filter((row) => row.at.termSheet).length,
        funded: applied.filter((row) => row.at.funded).length,
        lost: applied.filter((row) => row.deal.status === "declined" || row.deal.status === "withdrawn").length,
        open: applied.filter((row) => PRE_FUNDING.includes(row.deal.status)).length,
      },
      cycleTimes: {
        toTermSheet: cycle(sheets, "submitted", "termSheet"),
        termSheetToFunding: cycle(funded, "termSheet", "funded"),
        toFunding: cycle(funded, "submitted", "funded"),
      },
      closures: groupBy(closed, (row) => `${row.deal.closure!.outcome}: ${closureReason(row.deal.closure!)}`, (row) => row.amount),
      // Loans whose start was before history was kept can't be placed in a period.
      undated: rows.filter((row) => !row.at.submitted).length,
      open: tally(open),
      stuck,
    },
    capital: {
      commitment: sum((row) => row.source.commitment), deployed: sum((row) => row.deployed), unfunded: sum((row) => row.unfunded),
      reserved: sum((row) => row.reserved), committed: sum((row) => row.committed), available: sum((row) => row.available),
      sources: capital.map((row) => ({ name: row.source.name, commitment: row.source.commitment, deployed: row.deployed, available: row.available })),
      // How the loans funded in the period were funded.
      routing: groupBy(funded, (row) => row.deal.route ?? "not_routed", (row) => row.amount),
    },
    portfolio: {
      loans: serviced.length, outstanding,
      averageRate: outstanding ? serviced.reduce((acc, loan) => acc + loan.balance * loan.rate, 0) / outstanding : 0,
      buckets: BUCKETS.map((bucket) => {
        const inBucket = serviced.filter((loan) => loan.ledger.daysPastDue >= bucket.min && loan.ledger.daysPastDue <= bucket.max);
        return { ...bucket, count: inBucket.length, balance: inBucket.reduce((acc, loan) => acc + loan.balance, 0) };
      }),
      pastMaturity: serviced.filter((loan) => loan.ledger.matured).length,
      maturing: [30, 60, 90].map((days) => ({ days, count: within(days).length, balance: within(days).reduce((acc, loan) => acc + loan.balance, 0) })),
      extensions: { extended: extended.length, funded: everFunded.length },
      byBorrower: groupBy(serviced, (loan) => loan.deal.borrowerName, (loan) => loan.balance).slice(0, 5),
      byCounty: groupBy(serviced, (loan) => loan.deal.app.county || "Not recorded", (loan) => loan.balance).slice(0, 5),
      byProduct: groupBy(serviced, (loan) => loan.deal.app.product, (loan) => loan.balance),
    },
  };
}

/** Every loan with its steps and where it stands, for the spreadsheet. */
export function reportRows(book: Book, today: string) {
  return book.deals.map((deal) => {
    const at = milestones(deal);
    const funded = SERVICED.includes(deal.status);
    const l = funded ? ledger(deal) : null;
    const days = (from: Step, to: Step) => (at[from] && at[to] ? daysFrom(at[from]!, at[to]!) : "");
    return {
      Loan: deal.loanNumber, Borrower: deal.borrowerName, Source: sourceLabel(deal.source), Product: deal.app.product, County: deal.app.county, Status: deal.status.replace(/_/g, " "),
      "Loan amount": Math.round(est(deal.app).noteAmount), Rate: est(deal.app).rate,
      Applied: at.submitted ?? "", "Term sheet": at.termSheet ?? "", Accepted: at.accepted ?? "", Funded: at.funded ?? "", "Paid off": at.paidOff ?? "",
      "Declined or withdrawn": at.closed ?? "", Reason: deal.closure ? closureReason(deal.closure) : "",
      "Days to term sheet": days("submitted", "termSheet"), "Days to funding": days("submitted", "funded"),
      "Days in stage": PRE_FUNDING.includes(deal.status) ? daysInStage(deal, today) : "",
      Balance: funded ? balanceOf(deal) : "", "Days past due": l ? l.daysPastDue : "", Maturity: l ? l.maturity : "",
    };
  });
}

const money = (amount: number) => (!Math.round(amount) ? "$0" : Math.abs(amount) >= 1e6 ? `$${(amount / 1e6).toFixed(2)}M` : `$${Math.round(amount / 1000).toLocaleString("en-US")}k`);
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The owner's morning email: what happened yesterday, what's waiting on the team, what's stuck, and where the
 * portfolio and capital stand. Numbers and loan numbers only: no borrower names or addresses.
 */
export function dailyDigest(book: Book, today: string, waiting: { label: string; count: number }[], link: string, errors = 0) {
  const yesterday = addDays(today, -1);
  const report = businessReport(book, { from: yesterday, to: yesterday }, today);
  const { pipeline, portfolio, capital } = report;
  const done = [
    `${plural(pipeline.applications.count, "new application")}${pipeline.applications.count ? ` (${money(pipeline.applications.amount)})` : ""}`,
    `${plural(pipeline.termSheets.count, "term sheet")} sent${pipeline.termSheets.count ? ` (${money(pipeline.termSheets.amount)})` : ""}`,
    `${plural(pipeline.funded.count, "loan")} funded${pipeline.funded.count ? ` (${money(pipeline.funded.amount)})` : ""}`,
    ...(pipeline.paidOff.count ? [`${plural(pipeline.paidOff.count, "loan")} paid off`] : []),
    ...(pipeline.declined.count + pipeline.withdrawn.count ? [`${pipeline.declined.count + pipeline.withdrawn.count} declined or withdrawn`] : []),
  ];
  const late = portfolio.buckets.filter((bucket) => bucket.key !== "current");
  const lateCount = late.reduce((acc, bucket) => acc + bucket.count, 0);
  const lines = [
    `Yesterday (${longDay(yesterday)}): ${done.join(", ")}.`,
    "",
    waiting.length ? `Waiting on the team:\n${waiting.map((item) => `- ${item.label}: ${item.count}`).join("\n")}` : "Nothing is waiting on the team.",
    ...(pipeline.stuck.length ? ["", `In the same stage for over ${STUCK_DAYS} days:\n${pipeline.stuck.slice(0, 5).map((row) => `- ${row.deal.loanNumber}: ${row.deal.status.replace(/_/g, " ")}, ${row.days} days`).join("\n")}${pipeline.stuck.length > 5 ? `\n- and ${pipeline.stuck.length - 5} more` : ""}`] : []),
    "",
    `Portfolio: ${money(portfolio.outstanding)} outstanding across ${plural(portfolio.loans, "loan")}${portfolio.loans ? ` at ${portfolio.averageRate.toFixed(2)}% on average` : ""}. ${lateCount ? `${plural(lateCount, "loan")} past due.` : "None past due."} ${plural(portfolio.maturing[0].count, "loan")} maturing in the next 30 days${portfolio.pastMaturity ? `, ${portfolio.pastMaturity} past maturity` : ""}.`,
    `Capital: ${money(capital.available)} available, ${money(capital.deployed)} deployed.`,
    ...(errors ? [`Server errors in the last day: ${errors}. See them at ${link.replace(/\/reports$/, "/errors")}.`] : []),
    "",
    `Open the reports: ${link}`,
  ];
  const waitingCount = waiting.reduce((acc, item) => acc + item.count, 0);
  return {
    subject: `LendHous today: ${plural(pipeline.applications.count, "new application")}, ${pipeline.funded.count} funded, ${waitingCount} waiting`,
    body: lines.join("\n"),
  };
}

/** The report's figures as rows, for the summary spreadsheet. */
export function summaryRows(report: Report) {
  const { pipeline, capital, portfolio, period } = report;
  const rows: { Section: string; Measure: string; Value: string | number }[] = [];
  const add = (section: string, measure: string, value: string | number | null) => rows.push({ Section: section, Measure: measure, Value: value ?? "" });
  const p = `Pipeline ${period.from} to ${period.to}`;
  for (const [label, item] of [["Applications", pipeline.applications], ["Term sheets sent", pipeline.termSheets], ["Term sheets accepted", pipeline.accepted], ["Loans funded", pipeline.funded], ["Declined", pipeline.declined], ["Withdrawn", pipeline.withdrawn], ["Paid off", pipeline.paidOff]] as const) {
    add(p, `${label} (count)`, item.count);
    add(p, `${label} (amount)`, Math.round(item.amount));
  }
  add(p, "Applications that got a term sheet", pipeline.pullThrough.termSheet);
  add(p, "Applications that funded", pipeline.pullThrough.funded);
  add(p, "Median days, application to term sheet", pipeline.cycleTimes.toTermSheet.days);
  add(p, "Median days, term sheet to funding", pipeline.cycleTimes.termSheetToFunding.days);
  add(p, "Median days, application to funding", pipeline.cycleTimes.toFunding.days);
  for (const source of pipeline.bySource) add(p, `Funded from ${source.label}`, Math.round(source.fundedAmount));
  for (const officer of pipeline.byOfficer) add(p, `Funded by ${officer.name}`, Math.round(officer.fundedAmount));
  for (const broker of pipeline.byBroker) add(p, `Funded through ${broker.name}`, Math.round(broker.fundedAmount));
  for (const closure of pipeline.closures) add(p, closure.key, closure.count);
  add(`Today ${report.today}`, `Open applications over ${STUCK_DAYS} days in one stage`, pipeline.stuck.length);
  const c = `Capital ${report.today}`;
  for (const [label, value] of [["Commitment", capital.commitment], ["Deployed", capital.deployed], ["Unfunded holdbacks", capital.unfunded], ["Reserved", capital.reserved], ["Committed", capital.committed], ["Available", capital.available]] as const) add(c, label, Math.round(value));
  const f = `Portfolio ${report.today}`;
  add(f, "Loans", portfolio.loans);
  add(f, "Outstanding", Math.round(portfolio.outstanding));
  add(f, "Weighted average rate (%)", Number(portfolio.averageRate.toFixed(3)));
  for (const bucket of portfolio.buckets) add(f, `${bucket.label} (balance)`, Math.round(bucket.balance));
  for (const maturing of portfolio.maturing) add(f, `Maturing within ${maturing.days} days`, maturing.count);
  add(f, "Past maturity", portfolio.pastMaturity);
  add(f, "Funded loans ever extended", portfolio.extensions.extended);
  return rows;
}
