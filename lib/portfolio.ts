// Several rental properties on one loan (docs/competitor-gaps.md, 1.4; Spec 8.9). The site has long advertised a rental
// portfolio program; this makes one loan hold a schedule of properties. The loan is sized on their values, rents and costs
// added up, with the rental grid the single-property loans use, and each property carries its share of the loan by value,
// its own coverage of its share of the payment, and a release price. A property is let go by paying its release price to
// principal: at least its share of the loan times a premium, and more if the rest wouldn't stay within the loan's
// leverage and coverage limits. The payment is worked out again on what's left. Pure, so the screens, the reducer and the
// access rules agree.
import { evaluate, type Application } from "./engine";
import type { Deal, PortfolioProperty } from "./mockData";
import { addressKey } from "./risk";
import { balanceOf, daysBetween, ledger, noteRateOn, paymentsMade, recastPayment, SERVICED } from "./servicing";

/** PLACEHOLDER program limits until GT sets them: how many properties, the least each is worth, and the release premium. */
export const PORTFOLIO = { minProperties: 2, maxProperties: 20, minValue: 75_000, releasePremium: 1.15 };

const round2 = (amount: number) => Math.round(amount * 100) / 100;
const sum = (properties: PortfolioProperty[], pick: (property: PortfolioProperty) => number) => properties.reduce((total, property) => total + pick(property), 0);
const monthlyCosts = (property: PortfolioProperty) => property.taxesAnnual / 12 + property.insuranceAnnual / 12 + (property.hoaMonthly ?? 0);

export const isPortfolio = (deal: Pick<Deal, "properties">) => (deal.properties?.length ?? 0) > 0;
/** The properties still on the loan. */
export const heldProperties = (deal: Pick<Deal, "properties">) => (deal.properties ?? []).filter((property) => !property.released);

/** The loan's numbers from its properties: values, rents and costs added up. Only before it's funded: a funded loan keeps the numbers it was made on. */
export function portfolioApp(app: Application, properties: PortfolioProperty[]): Application {
  const value = sum(properties, (property) => property.value);
  const types = new Set(properties.map((property) => property.propertyType));
  return {
    ...app, product: "dscr", rentalType: undefined, strAnnualIncome: undefined, strIncomeSource: undefined, rehab: 0,
    purchasePrice: value, arv: value, monthlyRent: sum(properties, (property) => property.monthlyRent),
    taxesAnnual: sum(properties, (property) => property.taxesAnnual), insuranceAnnual: sum(properties, (property) => property.insuranceAnnual),
    hoaMonthly: sum(properties, (property) => property.hoaMonthly ?? 0),
    county: properties[0]?.county ?? app.county, state: "FL", propertyType: types.size === 1 ? properties[0].propertyType : app.propertyType,
  };
}

/** Why this schedule can't be saved, or null. An empty one takes the loan back to a single property. */
export function scheduleProblem(properties: Omit<PortfolioProperty, "geo" | "floodMap" | "released">[]) {
  if (!properties.length) return null;
  if (properties.length < PORTFOLIO.minProperties) return `A portfolio loan has at least ${PORTFOLIO.minProperties} properties.`;
  if (properties.length > PORTFOLIO.maxProperties) return `A portfolio loan has at most ${PORTFOLIO.maxProperties} properties.`;
  for (const [index, property] of properties.entries()) {
    const which = property.address.trim() || `Property ${index + 1}`;
    if (!property.address.trim() || !property.city.trim() || !/^\d{5}$/.test(property.zip.trim()) || !property.county.trim()) return `${which}: add the street, city, county and 5-digit ZIP.`;
    if (property.value < PORTFOLIO.minValue) return `${which}: each property has to be worth at least $${PORTFOLIO.minValue.toLocaleString("en-US")}.`;
    if (!(property.monthlyRent > 0)) return `${which}: add the monthly rent.`;
    if (property.taxesAnnual < 0 || property.insuranceAnnual < 0 || (property.hoaMonthly ?? 0) < 0) return `${which}: taxes, insurance and HOA can't be negative.`;
  }
  const keys = properties.map((property) => addressKey(property.address, property.zip));
  if (new Set(keys).size !== keys.length) return "The same property is on the schedule twice.";
  return null;
}

export type PropertyLine = { property: PortfolioProperty; share: number; allocated: number; payment: number; dscr: number; releasePrice: number };

/**
 * Each property's part of the loan, by its value against the whole schedule as the loan was made: its share of the note,
 * of the payment, its own coverage of that share, and its release price.
 */
export function propertyLines(deal: Pick<Deal, "app" | "properties">): PropertyLine[] {
  const properties = deal.properties ?? [];
  const total = sum(properties, (property) => property.value);
  const e = evaluate(deal.app);
  return properties.map((property) => {
    const share = total ? property.value / total : 0;
    const allocated = round2(e.noteAmount * share);
    const payment = round2(e.monthlyPayment * share);
    const costs = payment + monthlyCosts(property);
    return { property, share, allocated, payment, dscr: costs ? property.monthlyRent / costs : 0, releasePrice: Math.ceil((allocated * PORTFOLIO.releasePremium) / 100) * 100 };
  });
}

/** The loan's leverage and coverage limits from its own pricing: the grid cell it was sized in, and the program's minimum. */
export function limitsOf(deal: Pick<Deal, "app">) {
  const ratios = evaluate(deal.app).ratios;
  return { maxLtv: ratios.find((ratio) => ratio.key === "ltv")?.limit ?? 0.75, minDscr: ratios.find((ratio) => ratio.key === "dscr")?.limit ?? 1 };
}

/** The most that could be owed on these properties and stay within the limits at this payment's terms. */
function supported(deal: Deal, properties: PortfolioProperty[], made: number) {
  const { maxLtv, minDscr } = limitsOf(deal);
  const byLtv = maxLtv * sum(properties, (property) => property.value);
  // The payment the rest could carry at the minimum coverage, turned back into a balance over the months left.
  const room = sum(properties, (property) => property.monthlyRent) / minDscr - sum(properties, monthlyCosts);
  const perDollar = recastPayment(deal, 1_000_000, made) / 1_000_000;
  const byDscr = room > 0 && perDollar > 0 ? room / perDollar : 0;
  return Math.max(0, Math.min(byLtv, byDscr));
}

export type ReleaseQuote = {
  property: PortfolioProperty; allocated: number; premiumPrice: number; minimum: number; price: number; interest: number; total: number;
  after: { balance: number; payment: number; value: number; ltv: number; dscr: number };
};

/**
 * What it takes to let one property go on a day: the release price (its premium price, or more if that keeps the rest
 * within the limits), interest on that much since the last payment, and the loan after. Null with why when it can't be.
 */
export function releaseQuote(deal: Deal, propertyId: string, on: string): ReleaseQuote | { problem: string } {
  if (!SERVICED.includes(deal.status)) return { problem: "Properties are released from a funded loan." };
  const line = propertyLines(deal).find((item) => item.property.id === propertyId);
  if (!line) return { problem: "That property isn't on this loan." };
  if (line.property.released) return { problem: "That property has already been released." };
  const rest = heldProperties(deal).filter((property) => property.id !== propertyId);
  if (!rest.length) return { problem: "That's the last property on the loan: pay the loan off instead." };
  const l = ledger(deal);
  if (on < l.paidThrough) return { problem: "A release is dated after the last payment it follows." };
  const balance = balanceOf(deal);
  const made = paymentsMade(deal);
  const minimum = round2(Math.max(0, balance - supported(deal, rest, made)));
  const price = Math.min(balance, Math.max(line.releasePrice, Math.ceil(minimum / 100) * 100));
  if (price >= balance) return { problem: "Releasing it would take the whole balance: pay the loan off instead." };
  const interest = round2(((price * noteRateOn(deal)) / 100 / 360) * Math.max(0, daysBetween(l.paidThrough, on)));
  const left = round2(balance - price);
  const payment = recastPayment(deal, left, made);
  const value = sum(rest, (property) => property.value);
  const costs = payment + sum(rest, monthlyCosts);
  return { property: line.property, allocated: line.allocated, premiumPrice: line.releasePrice, minimum, price, interest, total: round2(price + interest), after: { balance: left, payment, value, ltv: value ? left / value : 0, dscr: costs ? sum(rest, (property) => property.monthlyRent) / costs : 0 } };
}

/** The portfolio as it stands: what's owed against what's still held, and how the rents cover the payment. */
export function portfolioNow(deal: Deal) {
  const held = heldProperties(deal);
  const funded = SERVICED.includes(deal.status);
  const balance = funded ? balanceOf(deal) : evaluate(deal.app).noteAmount;
  const payment = evaluate(deal.app).monthlyPayment;
  const value = sum(held, (property) => property.value);
  const now = funded && deal.releases?.length ? deal.releases[deal.releases.length - 1].newPayment : payment;
  const costs = now + sum(held, monthlyCosts);
  return { held: held.length, released: (deal.properties?.length ?? 0) - held.length, balance, value, ltv: value ? balance / value : 0, dscr: costs ? sum(held, (property) => property.monthlyRent) / costs : 0, payment: now };
}

/** A schedule's numbers typed in a form, as a property. */
export const newPropertyId = (index: number) => `prop${Date.now().toString(36)}${index}`;
