// The site's Florida county pages (docs/competitor-gaps.md, 1.10): what LendHous lends there from today's pricing, what's
// worth knowing locally, and LendHous's own funded loans in the county once there are enough to say without pointing at
// any one borrower. Pure, so the pages and the tests agree.
import { evaluate, locationClass } from "./engine";
import type { Deal } from "./mockData";
import type { PricingConfig } from "./pricing-config";

export type County = { slug: string; name: string; cities: string[]; coastal: boolean; note: string };

/** The counties competitors rank pages for, with notes that hold whatever the market does. */
export const COUNTIES: County[] = [
  { slug: "miami-dade", name: "Miami-Dade", cities: ["Miami", "Hialeah", "Miami Beach", "Homestead"], coastal: true, note: "Some cities, Miami Beach among them, restrict short-term rentals in many neighborhoods, so check the zoning before you underwrite nightly income. Much of the county is in a FEMA flood zone." },
  { slug: "broward", name: "Broward", cities: ["Fort Lauderdale", "Hollywood", "Pembroke Pines", "Coral Springs"], coastal: true, note: "Much of eastern Broward is low-lying and close to the water, so the flood zone and the windstorm quote often decide the deal. Get both before you sign the contract." },
  { slug: "palm-beach", name: "Palm Beach", cities: ["West Palm Beach", "Boca Raton", "Boynton Beach", "Delray Beach"], coastal: true, note: "Florida carriers often won't insure an older roof, so when the house needs one, put the new roof in the scope of work and the budget from the start." },
  { slug: "hillsborough", name: "Hillsborough", cities: ["Tampa", "Brandon", "Plant City"], coastal: true, note: "Tampa's older neighborhoods are full of bungalows that suit a fix and flip; budget for the electrical and plumbing an older house hides." },
  { slug: "orange", name: "Orange", cities: ["Orlando", "Winter Park", "Apopka"], coastal: false, note: "Inland, so flood and wind cover usually cost less than on the coasts. Near the parks, check the city's and the association's short-term rental rules first." },
  { slug: "duval", name: "Duval", cities: ["Jacksonville", "Jacksonville Beach"], coastal: true, note: "One of the largest cities by area in the country, so check the property's flood zone and the permit office for its part of Jacksonville early." },
  { slug: "pinellas", name: "Pinellas", cities: ["St. Petersburg", "Clearwater", "Largo"], coastal: true, note: "A peninsula with low-lying neighborhoods: the flood zone, and whether the building sits above base flood elevation, shape both the insurance and the resale." },
  { slug: "lee", name: "Lee", cities: ["Fort Myers", "Cape Coral", "Bonita Springs"], coastal: true, note: "Parts of the coast are still rebuilding after Hurricane Ian in 2022: check permits, the flood zone and the insurance quote before you commit." },
];

export const countyBySlug = (slug: string) => COUNTIES.find((county) => county.slug === slug);

/** How LendHous prices the county: its core markets lend the most; elsewhere in Florida a little less. */
export function countyTerms(county: County, config: PricingConfig) {
  const where = locationClass(county.name, "FL", config);
  return { core: where === "core", leverageCut: where === "core" ? 0 : config.adjusters.expansionCountyLeverageCut };
}

/** Only shown from this many loans, so no figure points at one borrower's loan. */
export const MIN_SHOWN = 3;
const FUNDED = new Set(["funded", "servicing_current", "servicing_delinquent", "matured", "default", "paid_off", "reo"]);

/** LendHous's funded loans in a county: how many and how much, or null below MIN_SHOWN. */
export function fundedIn(deals: Deal[], county: County) {
  const theirs = deals.filter((deal) => FUNDED.has(deal.status) && deal.app.state === "FL" && deal.app.county === county.name);
  if (theirs.length < MIN_SHOWN) return null;
  const total = theirs.reduce((sum, deal) => sum + evaluate(deal.app).noteAmount, 0);
  return { loans: theirs.length, total: Math.round(total / 10_000) * 10_000 };
}
