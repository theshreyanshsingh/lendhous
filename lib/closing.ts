// Closing and funding (Spec 4.3, 4.4, 10.4): who's closing the loan, the closing checklist, and the wire instructions the
// money goes to. Wire fraud is the biggest single loss a lender like this can take, so instructions are only entered in
// the portal, a second person confirms them by calling a number found independently, any change has to be confirmed
// again, and a loan can't fund until that's done.
import type { Deal, Doc, WireInstruction } from "./mockData";

/** The bank routing number's own check digit (ABA): catches a mistyped or made-up number before anyone calls about it. */
export function routingValid(routing: string) {
  if (!/^\d{9}$/.test(routing)) return false;
  const d = routing.split("").map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

export type WireInput = Pick<WireInstruction, "bankName" | "routing" | "account" | "beneficiary" | "reference" | "source">;

/** Why these instructions can't be saved, or null. */
export function wireProblem(input: WireInput) {
  if (!input.bankName.trim() || !input.beneficiary.trim()) return "Add the bank and who the account belongs to.";
  if (!routingValid(input.routing)) return "That routing number isn't valid. It's 9 digits, and the last one is a check digit.";
  if (!/^\d{4,17}$/.test(input.account)) return "The account number is 4 to 17 digits.";
  if (!WIRE_SOURCES.includes(input.source)) return "Say how the instructions arrived.";
  return null;
}

/** How instructions may arrive. Email isn't one of them. */
export const WIRE_SOURCES = ["Title company's secure portal", "Encrypted upload from the title company", "Handed over in person", "Read to us on a call we placed"];
/** Where a call-back number may come from: anywhere but the instructions themselves. */
export const PHONE_SOURCES = ["Title company's website", "Our records from an earlier closing", "Florida Bar or license lookup", "The underwriter's or agent's directory"];

/** The live instructions: the newest one not replaced. */
export const activeWire = (deal: Pick<Deal, "wires">) => [...(deal.wires ?? [])].reverse().find((wire) => !wire.replaced);
export const wireVerified = (deal: Pick<Deal, "wires">) => Boolean(activeWire(deal)?.verification);
export const maskAccount = (account: string) => `•••• ${account.slice(-4)}`;

/** Why this person can't confirm these instructions, or null. Whoever entered them can't be the one who checks them. */
export function verifyProblem(wire: WireInstruction | undefined, by: string, phone: string, phoneSource: string, spokeWith: string) {
  if (!wire || wire.replaced) return "Those instructions have been replaced.";
  if (wire.verification) return "They're already verified.";
  if (wire.enteredBy === by) return "Someone other than the person who entered them has to call to confirm them.";
  if (phone.replace(/\D/g, "").length < 10) return "Add the full number you called.";
  if (!PHONE_SOURCES.includes(phoneSource)) return "Say where the number came from. It can't be from the instructions.";
  if (!spokeWith.trim()) return "Add who you spoke to.";
  return null;
}

/**
 * What the title company sends (Spec T2): the commitment, the closing protection letter and the approved settlement
 * statement before clear to close; the signed loan documents before funding; the recorded mortgage after.
 */
export const CLOSING_ITEMS: { id: string; name: string; stage?: Doc["stage"] }[] = [
  { id: "closing-title", name: "Title commitment" },
  { id: "closing-cpl", name: "Closing protection letter (CPL)" },
  { id: "closing-settlement", name: "Settlement statement, approved by both sides" },
  { id: "closing-loan-docs", name: "Signed loan documents", stage: "funding" },
  { id: "closing-recorded", name: "Recorded mortgage", stage: "post_close" },
];
/** The checklist items a loan doesn't have yet. */
export const missingClosingItems = (deal: Pick<Deal, "docs">): Doc[] => CLOSING_ITEMS.filter((item) => !deal.docs.some((doc) => doc.id === item.id)).map((item) => ({ ...item, category: "Closing", status: "requested" }));
/** The documents the title company may upload through its link: the closing checklist, nothing else on the loan. */
export const isTitleDoc = (docId: string) => CLOSING_ITEMS.some((item) => item.id === docId);

/** How long a title link works. A new one can be sent at any time, which turns the old one off. */
export const TITLE_LINK_DAYS = 30;
// The link is about getting a loan closed and recorded, so it stops once the loan has ended.
const ENDED = ["declined", "withdrawn", "paid_off", "reo"];

/** Whether a title link can be used today. */
export function titleLinkState(deal: Pick<Deal, "titleLink" | "status"> | undefined, now = new Date()): "open" | "expired" | "off" | "closed" {
  if (!deal?.titleLink) return "off";
  if (ENDED.includes(deal.status)) return "closed";
  if (deal.titleLink.status === "off") return "off";
  return Date.parse(deal.titleLink.expiresAt) < now.getTime() ? "expired" : "open";
}

/**
 * What the title company sees: only what closing one loan needs. Names for vesting, the property, the amount and date,
 * the checklist, whether wire instructions are on file (never the numbers back), and funding and recording. Nothing
 * about credit, the borrower's profile, payments or other documents.
 */
export function titleView(deal: Deal, noteAmount: number) {
  const wire = activeWire(deal);
  return {
    loanNumber: deal.loanNumber, borrower: deal.borrowerName, entity: deal.entityName, address: `${deal.address}, ${deal.city} ${deal.zip}`,
    noteAmount, closingDate: deal.closingDate, status: deal.status, sentBy: deal.titleLink?.sentBy ?? "LendHous", company: deal.closing?.company ?? "", fileNumber: deal.closing?.fileNumber ?? "",
    items: deal.docs.filter((doc) => isTitleDoc(doc.id)).map((doc) => ({ id: doc.id, name: doc.name, status: doc.status, stage: doc.stage ?? null, fileName: doc.fileName ?? null })),
    wire: wire ? { bankName: wire.bankName, beneficiary: wire.beneficiary, account: maskAccount(wire.account), verified: Boolean(wire.verification), enteredAt: wire.enteredAt } : null,
    fundsReceived: deal.closing?.fundsReceived ?? null, recording: deal.closing?.recording ?? null,
    funded: !["submitted", "initial_review", "underwriting", "term_sheet_issued", "term_sheet_accepted", "conditions", "clear_to_close", "closing"].includes(deal.status),
  };
}
export type TitleView = ReturnType<typeof titleView>;

/** Why title can't confirm funds received, or null. Only once the loan is at closing or later. */
export function fundsProblem(deal: Pick<Deal, "status">, amount: number, on: string, today: string) {
  if (!["closing", "funded", "servicing_current", "servicing_delinquent", "matured", "default"].includes(deal.status)) return "The loan isn't at closing yet.";
  if (!(amount > 0)) return "Enter the amount received.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || on > today) return "Enter the date it arrived, today or earlier.";
  return null;
}

/** Why title can't record the mortgage's recording, or null. Only after funding. */
export function recordingProblem(deal: Pick<Deal, "status">, on: string, reference: string, today: string) {
  if (["submitted", "initial_review", "underwriting", "term_sheet_issued", "term_sheet_accepted", "conditions", "clear_to_close", "closing"].includes(deal.status)) return "The mortgage is recorded after the loan funds.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || on > today) return "Enter the recording date, today or earlier.";
  if (!reference.trim()) return "Enter the book and page, or the instrument number.";
  return null;
}
