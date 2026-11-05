// The website's "Recently funded" list: loans whose borrower chose to show them. Only the city, the program, the
// amount, the month it funded and the first property photo go out; never a name, a company or a street address.
import { evaluate } from "./engine";
import type { Deal, LoanStatus } from "./mockData";

const SHOWN: LoanStatus[] = ["funded", "servicing_current", "servicing_delinquent", "matured", "paid_off"];
/** How many the home page shows. */
export const SHOWCASE_LIMIT = 6;

/** A loan its borrower can put on the website: one that funded. A loan in default never shows. */
export const showcaseable = (deal: Deal) => SHOWN.includes(deal.status);

export type ShowcaseItem = { dealId: string; city: string; product: Deal["app"]["product"]; amount: number; fundedMonth: string; photoId?: string };

/** When it funded: its funded stage, or its closing date for a loan from before stages were kept. */
const fundedOn = (deal: Deal) => (deal.stages?.find((stage) => stage.status === "funded")?.at ?? deal.closingDate).slice(0, 10);

/** The newest funded loans whose borrower said yes, newest first. */
export function showcaseOf(deals: Deal[], limit = SHOWCASE_LIMIT): ShowcaseItem[] {
  return deals
    .filter((deal) => deal.showcase?.on && showcaseable(deal))
    .map((deal) => ({ deal, on: fundedOn(deal) }))
    .sort((a, b) => b.on.localeCompare(a.on))
    .slice(0, limit)
    .map(({ deal, on }) => ({ dealId: deal.id, city: deal.city, product: deal.app.product, amount: Math.round(evaluate(deal.app).noteAmount / 1000) * 1000, fundedMonth: on.slice(0, 7), photoId: deal.propertyPhotos?.find((photo) => !photo.id.startsWith("demo-"))?.id }));
}

/** The photo a showcased loan may show publicly, or null. */
export function showcasePhoto(deal: Deal | undefined) {
  if (!deal?.showcase?.on || !showcaseable(deal)) return null;
  return deal.propertyPhotos?.find((photo) => !photo.id.startsWith("demo-"))?.id ?? null;
}
