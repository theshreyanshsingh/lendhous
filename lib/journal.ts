// The monthly accounting journal (docs/competitor-gaps.md, 1.11): the servicing book's money for a month as journal entries
// a bookkeeper imports into QuickBooks Online, each entry balanced, one loan at a time. The account names are PLACEHOLDER
// until LendHous's CPA maps them to the chart of accounts. Pure.
import type { Book } from "./book";
import { evaluate, round2 } from "./engine";
import { splitOf } from "./investor-statements";
import type { Deal } from "./mockData";
import { SERVICED } from "./servicing";

/** PLACEHOLDER account names, to be matched to LendHous's chart of accounts by the CPA. */
export const ACCOUNTS = {
  loans: "Loans receivable",
  cash: "Operating cash",
  interest: "Interest income",
  lateFees: "Late fee income",
  origination: "Origination fee income",
  drawFees: "Draw inspection fee income",
  referrals: "Referral bonus expense",
};

/** QuickBooks Online's journal import columns. */
export type JournalRow = { "Journal No.": string; "Journal Date": string; "Account Name": string; Debits: number | string; Credits: number | string; Description: string; Name: string };

const FUNDED = new Set([...SERVICED, "paid_off", "reo"]);
const lastDay = (month: string) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

/** LendHous's own share of a loan: what isn't allocated to partner lenders or sold to buyers. */
export function ownShare(deal: Deal) {
  const note = evaluate(deal.app).noteAmount;
  if (!note || !deal.allocations.length) return 1;
  const others = deal.allocations.filter((item) => item.sourceId.startsWith("partner:") || item.sourceId.startsWith("buyer:")).reduce((sum, item) => sum + item.amount, 0);
  return Math.max(0, Math.min(1, 1 - others / note));
}

/** Every journal entry for a month ("2026-10"), oldest first, with debits equal to credits in each. */
export function monthJournal(book: Book, month: string): JournalRow[] {
  const rows: JournalRow[] = [];
  let count = 0;
  const entry = (date: string, deal: Deal, memo: string, lines: [string, number, number][]) => {
    const kept = lines.map(([account, debit, credit]) => [account, round2(debit), round2(credit)] as const).filter(([, debit, credit]) => debit > 0 || credit > 0);
    if (!kept.length) return;
    count++;
    const share = ownShare(deal);
    const description = `${deal.loanNumber}: ${memo}${share < 1 ? ` (LendHous's share ${Math.round(share * 100)}%; the whole loan shown)` : ""}`;
    for (const [account, debit, credit] of kept) rows.push({ "Journal No.": `LH-${month}-${String(count).padStart(3, "0")}`, "Journal Date": date, "Account Name": account, Debits: debit || "", Credits: credit || "", Description: description, Name: deal.entityName || deal.borrowerName });
  };
  const inMonth = (day: string | undefined) => Boolean(day && day.startsWith(`${month}-`));
  const deals = [...book.deals].filter((deal) => FUNDED.has(deal.status)).sort((a, b) => a.closingDate.localeCompare(b.closingDate));
  for (const deal of deals) {
    const e = evaluate(deal.app);
    if (inMonth(deal.closingDate)) {
      entry(deal.closingDate, deal, "advanced at closing", [[ACCOUNTS.loans, e.initialAdvance, 0], [ACCOUNTS.cash, 0, e.initialAdvance]]);
      entry(deal.closingDate, deal, "points and lender fees at closing", [[ACCOUNTS.cash, e.points + e.lenderFees, 0], [ACCOUNTS.origination, 0, e.points + e.lenderFees]]);
    }
    for (const draw of book.draws.filter((item) => item.dealId === deal.id && item.status === "funded" && inMonth(item.fundedAt?.slice(0, 10)))) {
      // The fee for checking the work is kept from what's sent: the loan grows by the whole draw (lib/draw-review.ts).
      const fee = Math.min(draw.fee ?? 0, draw.approved ?? 0);
      entry(draw.fundedAt!.slice(0, 10), deal, "draw released", [[ACCOUNTS.loans, draw.approved ?? 0, 0], [ACCOUNTS.cash, 0, (draw.approved ?? 0) - fee], ...(fee ? [[ACCOUNTS.drawFees, 0, fee] as [string, number, number]] : [])]);
    }
    const split = splitOf({ deal, share: 1, investorRate: e.rate, noteRate: e.rate }, (day) => inMonth(day));
    const received = round2(split.interest + split.principal + split.lateFees);
    if (received > 0) {
      const reserve = round2((deal.payments ?? []).filter((item) => item.method === "reserve" && !item.reversed && inMonth(item.receivedOn)).reduce((sum, item) => sum + item.amount, 0));
      entry(lastDay(month), deal, `payments received${deal.paidOff && inMonth(deal.paidOff.receivedOn) ? ", with the payoff" : ""}${reserve ? `, $${reserve.toLocaleString("en-US", { minimumFractionDigits: 2 })} of it from the interest reserve` : ""}`, [[ACCOUNTS.cash, received, 0], [ACCOUNTS.interest, 0, split.interest], [ACCOUNTS.loans, 0, split.principal], [ACCOUNTS.lateFees, 0, split.lateFees]]);
    }
    const bonus = deal.friendReferral?.paid;
    if (bonus && inMonth(bonus.on)) entry(bonus.on, deal, `referral bonus paid to ${deal.friendReferral!.referrerName}`, [[ACCOUNTS.referrals, bonus.amount, 0], [ACCOUNTS.cash, 0, bonus.amount]]);
  }
  return rows.sort((a, b) => a["Journal Date"].localeCompare(b["Journal Date"]) || a["Journal No."].localeCompare(b["Journal No."]));
}
