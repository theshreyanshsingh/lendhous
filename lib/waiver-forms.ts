// Florida's statutory lien waiver forms, filled in (docs/competitor-gaps-2026-11-09.md, rank 21). Fla. Stat. 713.20(4) and
// (5) give the waiver and release of lien upon progress payment and upon final payment, and 713.20(6) says no one may make
// a lienor sign a different one. So LendHous fills in the statute's own words with what the loan already knows: the
// lienor, the customer and owner (the borrowing company), the property, the date the work runs through and, for the
// contractor, the draw's amount. A subcontractor's or supplier's share isn't known, so its amount is left to write in.
// The lienor signs and dates it; it comes back on the draw like any waiver, and the team checks it. Pure.
import type { Deal, DrawRequest } from "./mockData";

export type WaiverFields = { kind: "progress" | "final"; lienor: string; customer: string; owner: string; property: string; amount?: number; throughOn?: string };

const money = (amount: number) => amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const BLANK = "________________";

/** The fields for one lienor on one draw. */
export function waiverFields(deal: Pick<Deal, "entityName" | "borrowerName" | "address" | "city" | "zip" | "app">, draw: Pick<DrawRequest, "approved" | "lines" | "fee">, party: { key: string; name: string }, kind: "progress" | "final", throughOn: string): WaiverFields {
  const company = deal.entityName || deal.borrowerName;
  const requested = draw.lines.reduce((sum, line) => sum + line.requested, 0);
  return {
    kind, lienor: party.name, customer: company, owner: company,
    property: `${deal.address}, ${deal.city}, Florida ${deal.zip}, in ${deal.app.county} County`,
    // Only the contractor's payment is the draw itself; anyone else's share is between them and the contractor.
    ...(party.key === "contractor" ? { amount: draw.approved ?? requested } : {}),
    ...(kind === "progress" ? { throughOn } : {}),
  };
}

/** The form's words, as the statute gives them, with the blanks filled where they're known. */
export function waiverText(fields: WaiverFields): { title: string; body: string; cite: string } {
  const amount = fields.amount !== undefined ? money(fields.amount) : BLANK;
  if (fields.kind === "progress") {
    return {
      title: "WAIVER AND RELEASE OF LIEN UPON PROGRESS PAYMENT",
      body: `The undersigned lienor, in consideration of the sum of $${amount}, hereby waives and releases its lien and right to claim a lien for labor, services, or materials furnished through ${fields.throughOn ? longDay(fields.throughOn) : BLANK} to ${fields.customer} on the job of ${fields.owner} to the following property:\n\n${fields.property}\n\nThis waiver and release does not cover any retention or labor, services, or materials furnished after the date specified.`,
      cite: "Fla. Stat. 713.20(4)",
    };
  }
  return {
    title: "WAIVER AND RELEASE OF LIEN UPON FINAL PAYMENT",
    body: `The undersigned lienor, in consideration of the final payment in the amount of $${amount}, hereby waives and releases its lien and right to claim a lien for labor, services, or materials furnished to ${fields.customer} on the job of ${fields.owner} to the following described property:\n\n${fields.property}`,
    cite: "Fla. Stat. 713.20(5)",
  };
}
