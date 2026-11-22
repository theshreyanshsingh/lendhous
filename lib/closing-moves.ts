// The target closing date's history (borrowers' complaint: closing dates that move four times with no reason given).
// Every move keeps the old date, the new one, why, and who or what it waits on. The borrower, their broker and the
// title company see the same record, and hear when it moves.
import { shortDay } from "./format";
import type { ClosingMove, Deal, LoanStatus } from "./mockData";

export const DELAY_PARTIES = {
  borrower: "the borrower", seller: "the seller", title: "the title company", appraiser: "the appraisal",
  insurance: "insurance", lendhous: "LendHous", other: "something else",
} as const;
export type DelayParty = keyof typeof DELAY_PARTIES;
/** How the party reads as the cause: "Waiting on the appraisal". */
export const partyLabel = (party: DelayParty) => DELAY_PARTIES[party] ?? DELAY_PARTIES.other;

/** The date moves only before the loan funds. */
export const MOVABLE: LoanStatus[] = ["submitted", "initial_review", "underwriting", "term_sheet_issued", "term_sheet_accepted", "conditions", "clear_to_close", "closing"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Why the closing date can't move this way, or null. */
export function moveProblem(deal: Pick<Deal, "status" | "closingDate">, to: string, party: string, reason: string, today: string) {
  if (!MOVABLE.includes(deal.status)) return "The closing date moves only before the loan funds.";
  if (!DAY.test(to) || Number.isNaN(Date.parse(to))) return "Choose the new date.";
  if (to < today) return "The new date can't be in the past.";
  if (to === deal.closingDate) return "That's the date it's already set for.";
  if (!(party in DELAY_PARTIES)) return "Say who or what it's waiting on.";
  if (!reason.trim()) return "Say why it's moving. The borrower, their broker and the title company see it.";
  return null;
}

export const movesOf = (deal: Pick<Deal, "closingMoves">) => deal.closingMoves ?? [];
/** The latest move, while the loan hasn't funded: what the closing waits on now. */
export const waitingOn = (deal: Pick<Deal, "status" | "closingMoves">) => (MOVABLE.includes(deal.status) ? movesOf(deal).at(-1) : undefined);

/** One move in words: "Nov 20 → Dec 2, waiting on the appraisal: the appraiser's visit moved to Friday." */
export function moveLine(move: ClosingMove) {
  const later = move.to > move.from;
  return `${shortDay(move.from)} → ${shortDay(move.to)}, ${later ? `waiting on ${partyLabel(move.party)}` : `sooner, thanks to ${partyLabel(move.party)}`}: ${move.reason}`;
}

/** "once", "twice", "3 times". */
export const timesWord = (count: number) => (count === 1 ? "once" : count === 2 ? "twice" : `${count} times`);

/** How many times a loan's date has slipped later, for a short count on lists. */
export const slips = (deal: Pick<Deal, "closingMoves">) => movesOf(deal).filter((move) => move.to > move.from).length;
