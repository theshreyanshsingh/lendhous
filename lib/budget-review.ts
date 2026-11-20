// The budget and the builder, before closing (docs/competitor-gaps-2026-11-09.md, rank 20). The vendors have moved from
// checking draws to checking the budget before the loan closes, and LendHous's own funded loans already say what each
// line of a Florida rehab usually costs as a share of the budget, county by county. So each line is set against that
// range, lines too vague to inspect are flagged, the lines add up to the rehab the loan was sized on, and the deal still
// leaves room against the after-repair value: "feasible", "tight" or "short". The contractor's record across LendHous's
// loans shows alongside. The thresholds are PLACEHOLDER until GT sets them. Pure.
import { CONTINGENCY_ID, CONTINGENCY_SUGGESTED, projectHealth } from "./budget";
import { costBasis } from "./engine";
import type { Deal, DrawRequest } from "./mockData";
import { SERVICED } from "./servicing";

/** PLACEHOLDER: how many funded loans make a range, the spread that counts as tight or short, and what's too big or vague. */
export const BUDGET_RULES = { minPeers: 5, tightSpread: 0.15, shortSpread: 0.05, bigLine: 0.4, sizedOff: 0.01 };
const FUNDED = [...SERVICED, "paid_off", "reo"];
const VAGUE = /\b(misc|miscellaneous|other|general|tbd|allowance|various|sundr\w*|etc|as needed)\b/i;

export type BudgetVerdict = "feasible" | "tight" | "short";
export type BudgetFinding = { level: "bad" | "warn" | "note"; text: string; lineId?: string };
export type LineRange = { low: number; high: number; count: number };

const pct = (share: number) => `${Math.round(share * 100)}%`;
/** A range in words: "about 16%" when its ends round the same. */
const span = (range: LineRange) => (pct(range.low) === pct(range.high) ? `about ${pct(range.low)}` : `${pct(range.low)} to ${pct(range.high)}`);
const money = (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`;
const quantile = (sorted: number[], q: number) => { const at = (sorted.length - 1) * q; const low = Math.floor(at); return sorted[low] + (sorted[Math.min(sorted.length - 1, low + 1)] - sorted[low]) * (at - low); };

const shares = (deal: Pick<Deal, "scope">) => {
  const lines = (deal.scope ?? []).filter((line) => line.id !== CONTINGENCY_ID && line.budget > 0);
  const total = lines.reduce((sum, line) => sum + line.budget, 0);
  return total > 0 ? new Map(lines.map((line) => [line.id, line.budget / total])) : new Map<string, number>();
};

/** The funded loans to compare with: the same program in the same county, or across Florida when the county has too few. */
export function peersOf(deal: Pick<Deal, "id" | "app">, deals: Deal[]) {
  const funded = deals.filter((item) => item.id !== deal.id && FUNDED.includes(item.status) && item.app.product === deal.app.product && (item.scope?.length ?? 0) > 0);
  const county = funded.filter((item) => item.app.county === deal.app.county);
  if (county.length >= BUDGET_RULES.minPeers) return { where: `${deal.app.county} County`, loans: county };
  if (funded.length >= BUDGET_RULES.minPeers) return { where: "Florida", loans: funded };
  return { where: null, loans: [] as Deal[] };
}

/** Each line's usual share of the budget on those loans: from the 10th to the 90th percentile. */
export function lineRanges(peers: Deal[]): Map<string, LineRange> {
  const byLine = new Map<string, number[]>();
  for (const peer of peers) for (const [id, share] of shares(peer)) byLine.set(id, [...(byLine.get(id) ?? []), share]);
  const ranges = new Map<string, LineRange>();
  for (const [id, values] of byLine) {
    if (values.length < BUDGET_RULES.minPeers) continue;
    const sorted = [...values].sort((a, b) => a - b);
    ranges.set(id, { low: quantile(sorted, 0.1), high: quantile(sorted, 0.9), count: values.length });
  }
  return ranges;
}

export type BudgetReview = { verdict: BudgetVerdict; spread: number; findings: BudgetFinding[]; where: string | null; peers: number; ranges: Map<string, LineRange>; overrunRate: number | null };

/** The budget checked against the deal and against LendHous's own loans. */
export function budgetReview(deal: Deal, deals: Deal[]): BudgetReview {
  const findings: BudgetFinding[] = [];
  const scope = deal.scope ?? [];
  const total = scope.reduce((sum, line) => sum + line.budget, 0);
  const cost = costBasis(deal.app);
  const spread = deal.app.arv > 0 ? (deal.app.arv - cost) / deal.app.arv : 0;
  const { where, loans } = peersOf(deal, deals);
  const ranges = lineRanges(loans);
  // How far budgets ran over on those loans, from the overruns found at inspections.
  const peerBudget = loans.reduce((sum, item) => sum + (item.scope ?? []).reduce((lines, line) => lines + line.budget, 0), 0);
  const overrunRate = loans.length && peerBudget > 0 ? loans.reduce((sum, item) => sum + (item.overruns ?? []).reduce((all, overrun) => all + overrun.amount, 0), 0) / peerBudget : null;
  const verdict: BudgetVerdict = spread < BUDGET_RULES.shortSpread ? "short" : spread < BUDGET_RULES.tightSpread || (overrunRate !== null && overrunRate > 0 && spread - overrunRate * (deal.app.rehab / Math.max(1, deal.app.arv)) < BUDGET_RULES.tightSpread) ? "tight" : "feasible";
  if (verdict !== "feasible") findings.push({ level: verdict === "short" ? "bad" : "warn", text: `The purchase and the work come to ${money(cost)}, leaving ${pct(spread)} of the ${money(deal.app.arv)} after-repair value${overrunRate ? `, and budgets here have run ${pct(overrunRate)} over` : ""}. Under ${pct(BUDGET_RULES.tightSpread)} is tight; under ${pct(BUDGET_RULES.shortSpread)}, short.` });
  if (total > 0 && Math.abs(total - deal.app.rehab) > deal.app.rehab * BUDGET_RULES.sizedOff) findings.push({ level: "warn", text: `The budget lines add up to ${money(total)}, not the ${money(deal.app.rehab)} rehab the loan was sized on.` });
  const lineShares = shares(deal);
  for (const line of scope) {
    if (line.budget <= 0 || line.id === CONTINGENCY_ID) continue;
    const share = lineShares.get(line.id) ?? 0;
    if (VAGUE.test(line.division)) findings.push({ level: "warn", lineId: line.id, text: `"${line.division}" (${money(line.budget)}) is too vague to inspect: ask what it covers, line by line.` });
    if (deal.app.product === "fix_flip" && share > BUDGET_RULES.bigLine) findings.push({ level: "note", lineId: line.id, text: `${line.division} is ${pct(share)} of the budget: ask for the contractor's bid behind it.` });
    const range = ranges.get(line.id);
    if (!range) continue;
    if (share < range.low * 0.8) findings.push({ level: "warn", lineId: line.id, text: `${line.division} is ${pct(share)} of the budget; on LendHous's funded loans in ${where} it's usually ${span(range)}. It may be short.` });
    else if (share > range.high * 1.2) findings.push({ level: "note", lineId: line.id, text: `${line.division} is ${pct(share)} of the budget; in ${where} it's usually ${span(range)}.` });
  }
  if (total > 0 && !scope.some((line) => line.id === CONTINGENCY_ID)) findings.push({ level: "note", text: `No contingency line: LendHous suggests about ${pct(CONTINGENCY_SUGGESTED)} of the budget held back for surprises.` });
  if (!where) findings.push({ level: "note", text: `Fewer than ${BUDGET_RULES.minPeers} funded loans of this kind to compare lines with yet.` });
  const order = { bad: 0, warn: 1, note: 2 };
  return { verdict, spread, findings: findings.sort((a, b) => order[a.level] - order[b.level]), where, peers: loans.length, ranges, overrunRate };
}

/** A contractor's name, the way two loans' spellings of it would match. */
export const contractorKey = (name: string) => name.toLowerCase().replace(/\(.*?\)/g, "").replace(/\b(llc|inc|corp|co|company|l\.l\.c|ltd)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export type ContractorRecord = { loans: number; funded: number; withOverruns: number; ahead: number; troubled: number; loanNumbers: string[] };

/** The contractor's other loans with LendHous: how many, and how many ran over, got ahead of the work or went bad. */
export function contractorRecord(deal: Pick<Deal, "id" | "lienFile">, deals: Deal[], draws: DrawRequest[]): ContractorRecord | null {
  const name = deal.lienFile?.contractor;
  if (!name?.trim()) return null;
  const key = contractorKey(name);
  const others = deals.filter((item) => item.id !== deal.id && item.lienFile?.contractor && contractorKey(item.lienFile.contractor) === key);
  return {
    loans: others.length, funded: others.filter((item) => FUNDED.includes(item.status)).length,
    withOverruns: others.filter((item) => (item.overruns ?? []).length > 0).length,
    ahead: others.filter((item) => projectHealth(item, draws)?.ahead).length,
    troubled: others.filter((item) => ["servicing_delinquent", "default", "reo"].includes(item.status) || Boolean(item.foreclosure)).length,
    loanNumbers: others.map((item) => item.loanNumber),
  };
}

export const VERDICT_WORDS: Record<BudgetVerdict, string> = { feasible: "Feasible", tight: "Tight", short: "Short" };
