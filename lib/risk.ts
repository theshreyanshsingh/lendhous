// Fraud and concentration checks (docs/next-features-prompt.md, S): the same property, company or person on other loans,
// a quick resale at a much higher price, and how much of the book one borrower, county, product or flood zone holds.
// Cheap checks that catch most of the trouble in this business. Pure, so the loan page, the term sheet and the reports agree.
import { evaluate } from "./engine";
import type { Deal } from "./mockData";
import { balanceOf, SERVICED } from "./servicing";

/** PLACEHOLDER limits until GT sets them: the most of the funded book any one of these may hold. */
export const CONCENTRATION_LIMITS = { borrower: 0.15, county: 0.5, product: 0.7, floodZone: 0.35 };
/** A resale this much above the last recorded sale within this many months is flagged (PLACEHOLDER). */
export const PRICE_JUMP = { rise: 0.3, months: 12 };

const words = (text: string) => text.toLowerCase().replace(/\(fake\)/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\b(llc|inc|corp|co|ltd|lp|the)\b/g, " ").replace(/\s+/g, " ").trim();
/** An address compared by its street number, name and ZIP, so "123 Main St." and "123 MAIN STREET" match. */
export const addressKey = (address: string, zip: string) => `${words(address).replace(/\b(street|st)\b/g, "st").replace(/\b(avenue|ave)\b/g, "ave").replace(/\b(road|rd)\b/g, "rd").replace(/\b(drive|dr)\b/g, "dr").replace(/\b(boulevard|blvd)\b/g, "blvd").replace(/\b(court|ct)\b/g, "ct").replace(/\b(lane|ln)\b/g, "ln")}|${zip.slice(0, 5)}`;
const people = (deal: Deal) => [deal.borrowerName, ...(deal.sponsor?.guarantors ?? []).map((item) => item.name)].map(words).filter(Boolean);

export type Match = { dealId: string; loanNumber: string; status: string; why: string[] };

/**
 * Other loans that share this one's property, company or people. A borrower's own earlier loans count only when they're
 * on the same property; a different account with the same company or guarantor stands out.
 */
export function duplicateMatches(deals: Deal[], deal: Deal): Match[] {
  const property = addressKey(deal.address, deal.zip);
  const entity = words(deal.entityName);
  const mine = new Set(people(deal));
  return deals.filter((other) => other.id !== deal.id).flatMap((other): Match[] => {
    const why: string[] = [];
    const theirs = other.borrowerId === deal.borrowerId;
    if (addressKey(other.address, other.zip) === property) why.push(theirs ? "the same property, their own earlier loan" : "the same property");
    // The same borrower's other loans under their company and name are their history, not a flag.
    if (!theirs && entity && words(other.entityName) === entity) why.push("the same company");
    const shared = people(other).filter((name) => mine.has(name));
    if (!theirs && shared.length) why.push(`the same person under another account (${shared[0]})`);
    return why.length ? [{ dealId: other.id, loanNumber: other.loanNumber, status: other.status, why }] : [];
  });
}

/** A purchase well above the last recorded sale not long before: a possible flip between related parties. */
export function priceJump(deal: Pick<Deal, "app" | "lastSale">, today: string) {
  const sale = deal.lastSale;
  if (!sale || deal.app.purpose !== "purchase" || sale.price <= 0) return null;
  const rise = deal.app.purchasePrice / sale.price - 1;
  const [y, m, d] = sale.on.split("-").map(Number);
  const recent = new Date(Date.UTC(y, m - 1 + PRICE_JUMP.months, d)).toISOString().slice(0, 10) >= today;
  return { rise, flagged: recent && rise >= PRICE_JUMP.rise };
}

export type Dimension = keyof typeof CONCENTRATION_LIMITS;
export const DIMENSION: Record<Dimension, string> = { borrower: "Borrower", county: "County", product: "Loan type", floodZone: "Flood zone" };
const PRODUCT: Record<string, string> = { fix_flip: "Fix and flip", bridge: "Bridge", ground_up: "New construction", dscr: "DSCR rental" };

const keyOf = (deal: Deal, dimension: Dimension) =>
  dimension === "borrower" ? deal.borrowerName.replace(/\s*\(FAKE\)/, "")
  : dimension === "county" ? (deal.app.state === "FL" ? deal.app.county : `Outside Florida`)
  : dimension === "product" ? PRODUCT[deal.app.product] ?? deal.app.product
  : deal.insurance?.flood ? (deal.insurance.flood.sfha ? "Special flood hazard area" : "Outside the flood hazard area") : "Not recorded";

const exposure = (deal: Deal) => (SERVICED.includes(deal.status) ? balanceOf(deal) : evaluate(deal.app).noteAmount);

/** The funded book's balances by one dimension, largest first, with each one's share and whether it's over its limit. */
export function concentration(deals: Deal[], dimension: Dimension, adding?: Deal) {
  const book = [...deals.filter((deal) => SERVICED.includes(deal.status) && deal.id !== adding?.id), ...(adding ? [adding] : [])];
  const total = book.reduce((sum, deal) => sum + exposure(deal), 0);
  const groups = new Map<string, number>();
  for (const deal of book) groups.set(keyOf(deal, dimension), (groups.get(keyOf(deal, dimension)) ?? 0) + exposure(deal));
  return [...groups.entries()].map(([name, amount]) => ({ name, amount, share: total ? amount / total : 0, over: total > 0 && amount / total > CONCENTRATION_LIMITS[dimension] })).sort((a, b) => b.amount - a.amount);
}

/** What funding this loan would push over a limit, for the term sheet and the loan's flags. Only the buckets it adds to. */
export function concentrationWarnings(deals: Deal[], deal: Deal) {
  // A loan alone is all of an empty book, which says nothing.
  if (deals.filter((item) => SERVICED.includes(item.status) && item.id !== deal.id).length < 5) return [];
  return (Object.keys(CONCENTRATION_LIMITS) as Dimension[]).flatMap((dimension) => {
    const row = concentration(deals, dimension, deal).find((item) => item.name === keyOf(deal, dimension));
    return row?.over ? [`${DIMENSION[dimension]} "${row.name}" would be ${Math.round(row.share * 100)}% of the funded book, over the ${Math.round(CONCENTRATION_LIMITS[dimension] * 100)}% limit`] : [];
  });
}
