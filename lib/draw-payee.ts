// Who a draw is paid to (docs/competitor-gaps-2026-11-09.md, rank 21). Paying the contractor directly, or by a check made
// out to the borrower and the contractor together, keeps the money with the work it's for. The contractor's lien waiver
// for each draw is already a hold (lib/lien-law.ts); this records who the release went to, tells a contractor it's paid,
// and lets the contractor's photo link say where the draw it photographed stands, without amounts. Pure.
import type { Deal, DrawPayee, DrawRequest } from "./mockData";

export const PAYEES: Record<DrawPayee, string> = { borrower: "The borrower", contractor: "The contractor", joint: "Borrower and contractor jointly" };

/** The payee in words, naming the contractor where it's known. */
export const payeeWords = (payee: DrawPayee, contractor?: string) => (payee === "borrower" ? "the borrower" : payee === "contractor" ? contractor || "the contractor" : `the borrower and ${contractor || "the contractor"} jointly`);

/** Why the money can't go to this payee, or null. Paying a contractor needs it named on the lien file. */
export function payeeProblem(deal: Pick<Deal, "lienFile">, payee: DrawPayee | undefined) {
  if (!payee || payee === "borrower") return null;
  return deal.lienFile?.contractor?.trim() ? null : "Add the contractor on the Closing tab first, so the payment is made out to the right name.";
}

const longDay = (stamp: string) => new Date(stamp).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });
const money = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The email to a contractor paid directly or jointly when the draw goes out. */
export function payeeEmail(draw: Pick<DrawRequest, "approved" | "fundedAt" | "payee" | "fee">, deal: Pick<Deal, "address" | "city">, name: string) {
  const sent = Math.max(0, (draw.approved ?? 0) - (draw.fee ?? 0));
  return `Hello ${name},\n\nLendHous released the draw for the work at ${deal.address}, ${deal.city} on ${longDay(draw.fundedAt ?? new Date().toISOString())}: ${money(sent)}, made out to ${draw.payee === "joint" ? "you and the borrower jointly" : "you"}.\n\nYour lien waiver for this payment is part of the next draw. Questions about the payment go to the borrower or LendHous.`;
}

/** What the contractor's link says about the draw its photos were for: where it stands, and who it went to. No amounts. */
export function drawStatusForContractor(draw: Pick<DrawRequest, "status" | "fundedAt" | "payee">) {
  switch (draw.status) {
    case "funded": return `The draw your photos were for was released on ${longDay(draw.fundedAt ?? "")}, paid to ${draw.payee === "contractor" ? "you" : draw.payee === "joint" ? "you and the borrower jointly" : "the borrower"}.`;
    case "approved": return "The draw your photos were for is approved and waiting to be released.";
    case "rejected": return "The draw your photos were for wasn't approved. The borrower has the reason.";
    default: return "The draw your photos were for is being reviewed.";
  }
}
