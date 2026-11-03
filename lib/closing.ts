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

/** What the title company has to send before the loan can clear to close. */
export const CLOSING_ITEMS: { id: string; name: string }[] = [
  { id: "closing-title", name: "Title commitment" },
  { id: "closing-cpl", name: "Closing protection letter (CPL)" },
  { id: "closing-settlement", name: "Settlement statement, approved by both sides" },
];
/** The checklist items a loan doesn't have yet. */
export const missingClosingItems = (deal: Pick<Deal, "docs">): Doc[] => CLOSING_ITEMS.filter((item) => !deal.docs.some((doc) => doc.id === item.id)).map((item) => ({ ...item, category: "Closing", status: "requested" }));
