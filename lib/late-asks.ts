// Asks that come late (borrowers' second commonest complaint: a new batch of requests the day before closing). Once a
// loan has cleared to close, or its closing is a few days off, a new condition or document needs a reason the borrower
// sees, and a manager's yes: someone with approve_late_conditions adds it straight away, anyone else's waits for one.
// Asking again for a paper the borrower already sent needs a reason too. Conditions for after closing don't count.
import { suggestDoc } from "./doc-sorting";
import { shortDay } from "./format";
import type { AskedWhy, Deal, Doc, LateAsk, LoanCondition } from "./mockData";
import { daysBetween } from "./servicing";

/** PLACEHOLDER until GT sets it: within this many days of the target closing, an ask is late. */
export const LATE_DAYS = 5;
const BEFORE_CLEARING = ["underwriting", "term_sheet_issued", "term_sheet_accepted", "conditions"];

/** Why an ask on this loan today is late, in words, or null. */
export function lateReason(deal: Pick<Deal, "status" | "closingDate">, today: string) {
  if (deal.status === "clear_to_close") return "The loan has cleared to close";
  if (deal.status === "closing") return "The loan is at closing";
  if (!BEFORE_CLEARING.includes(deal.status) || !deal.closingDate) return null;
  const left = daysBetween(today, deal.closingDate);
  return left <= LATE_DAYS ? (left <= 0 ? "Closing is due today" : `Closing is ${left} day${left === 1 ? "" : "s"} away`) : null;
}

const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// Words that say nothing about which paper it is.
const FILLER = new Set(["the", "and", "for", "new", "updated", "update", "copy", "most", "recent", "current", "latest", "signed", "final", "another", "your", "from", "with"]);
const wordsOf = (text: string) => new Set(plain(text).split(" ").filter((word) => word.length > 2 && !FILLER.has(word)).map((word) => word.replace(/s$/, "")));
const shared = (a: string, b: string) => { const theirs = wordsOf(b); return [...wordsOf(a)].filter((word) => theirs.has(word)).length; };
const ON_FILE = new Set<Doc["status"]>(["uploaded", "in_review", "accepted"]);

/**
 * A paper the borrower already sent that this ask looks like, on this loan: the same name, two words in common ("bank
 * statement"), or the kind of paper its name points to with a word in common. A title policy isn't an insurance policy.
 */
export function alreadyOnFile(deal: Pick<Deal, "docs"> & Partial<Pick<Deal, "conditions">>, title: string): { name: string; on?: string } | null {
  const wanted = plain(title);
  if (!wanted) return null;
  const onFile = deal.docs.filter((doc) => ON_FILE.has(doc.status));
  const byKind = suggestDoc(title, onFile);
  const doc = onFile.find((item) => plain(item.name) === wanted) ?? onFile.find((item) => shared(title, item.name) >= 2) ?? onFile.find((item) => item.id === byKind && shared(title, item.name) >= 1 && !/\btitle\b/.test(wanted));
  if (doc) return { name: doc.name, on: doc.acceptedOn ?? doc.uploadedAt?.slice(0, 10) };
  const condition = (deal.conditions ?? []).find((item) => item.files.length > 0 && item.status !== "open" && plain(item.title) === wanted);
  return condition ? { name: condition.title, on: condition.files[condition.files.length - 1].at.slice(0, 10) } : null;
}

/** Does this ask need a reason, and why. A condition for after closing is never late. */
export function askNeeds(deal: Deal, title: string, today: string, afterClosing = false) {
  const late = afterClosing ? null : lateReason(deal, today);
  const again = alreadyOnFile(deal, title);
  return { late, again };
}

/** Why this ask can't be made without more, or null. */
export function askProblem(deal: Deal, title: string, reason: string | undefined, today: string, afterClosing = false) {
  const { late, again } = askNeeds(deal, title, today, afterClosing);
  if (reason?.trim()) return null;
  if (late) return `${late}, so say why this is needed now. The borrower sees it.`;
  if (again) return `The borrower already sent ${again.name}${again.on ? ` on ${shortDay(again.on)}` : ""}. Say why it's needed again. The borrower sees it.`;
  return null;
}

/** The reason as it's kept on the condition or document, or nothing when the ask needed none. */
export function askedWhy(deal: Deal, title: string, reason: string | undefined, today: string, at: string, approvedBy?: string, afterClosing = false): AskedWhy | undefined {
  const { late, again } = askNeeds(deal, title, today, afterClosing);
  if (!late && !again) return undefined;
  return { reason: (reason ?? "").trim(), late: Boolean(late), ...(again ? { again: again.name } : {}), ...(late && approvedBy ? { approvedBy } : {}), at };
}

/** Whether this ask waits for a manager: it's late and whoever asked can't approve late asks. */
export const waitsForManager = (deal: Deal, today: string, approved: boolean | undefined, afterClosing = false) => !approved && !afterClosing && Boolean(lateReason(deal, today));

export const pendingAsks = (deal: Pick<Deal, "lateAsks">) => (deal.lateAsks ?? []).filter((item) => item.status === "pending");
export const askTitle = (ask: LateAsk) => ask.condition?.title || ask.doc?.name || "Something new";

/** Why a manager can't decide this ask, or null. */
export function decideProblem(deal: Deal, askId: string, approve: boolean, note: string) {
  const ask = deal.lateAsks?.find((item) => item.id === askId);
  if (!ask || ask.status !== "pending") return "That ask isn't waiting for a decision.";
  if (!["underwriting", "term_sheet_issued", "term_sheet_accepted", "conditions", "clear_to_close", "closing"].includes(deal.status)) return "The loan has funded, so it can't be asked for now.";
  if (!approve && !note.trim()) return "Say why not, for whoever asked.";
  return null;
}

/** How the borrower is told why it's asked for: "Asked for close to closing because …". */
export function askedLine(asked: AskedWhy | undefined) {
  if (!asked?.reason) return null;
  return `${asked.late ? "Asked for close to closing" : "Asked for again"}: ${asked.reason}`;
}

/** A condition or document that came in with a reason, for the team's view: who approved it and why. */
export const teamAskedLine = (item: Pick<LoanCondition, "asked"> | Pick<Doc, "asked">) => {
  const asked = item.asked;
  if (!asked) return null;
  return `${asked.late ? "Asked late" : `Asked again (already sent: ${asked.again})`}${asked.approvedBy ? `, approved by ${asked.approvedBy}` : ""}: ${asked.reason}`;
};
