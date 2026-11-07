// The public site's loan quote request (Spec 12.3: no-login estimate, then a lead). A borrower or a broker sends the deal;
// the team gets a lead with everything a first call needs, and the visitor sees indicative terms worked out by the same
// engine and pricing the loan would use. It is not an application: no credit is pulled and nothing is promised.
import { z } from "zod";
import { evaluate, type Application, type Estimate, type Product } from "./engine";
import { optionAt, quoteBuyDowns } from "./buy-down";
import type { PricingConfig } from "./pricing-config";

export const LOAN_TYPES = {
  fix_flip: "Fix & flip",
  bridge: "Stabilized bridge",
  dscr: "DSCR rental (1–4 units)",
  ground_up: "New construction",
  dscr_5plus: "DSCR 5+ unit multifamily",
  second: "DSCR 2nd position",
  transactional: "Transactional funding (1-day)",
} as const;
export type LoanType = keyof typeof LOAN_TYPES;
/** The loan types the pricing engine prices. The rest go to the team for a manual look. */
export const PRICED: Partial<Record<LoanType, Product>> = { fix_flip: "fix_flip", bridge: "bridge", dscr: "dscr", ground_up: "ground_up" };

export const CREDIT_BANDS = { "760+": 770, "720-759": 740, "680-719": 700, "640-679": 660, "600-639": 620, "under-600": 580 } as const;
export const CREDIT_LABEL: Record<keyof typeof CREDIT_BANDS, string> = { "760+": "760 or higher", "720-759": "720–759", "680-719": "680–719", "640-679": "640–679", "600-639": "600–639", "under-600": "Below 600" };
export const EXPERIENCE_BANDS = { "0": 0, "1-2": 1, "3-4": 3, "5-9": 5, "10+": 10 } as const;
export const EXPERIENCE_LABEL: Record<keyof typeof EXPERIENCE_BANDS, string> = { "0": "None yet", "1-2": "1–2 projects", "3-4": "3–4 projects", "5-9": "5–9 projects", "10+": "10 or more" };
export const CITIZENSHIP_LABEL = { us: "U.S. citizen", resident: "Permanent resident", foreign: "Foreign national" } as const;
export const PROPERTY_TYPES = { sfr: "Single-family", "2_4": "2–4 units", condo: "Condo", townhome: "Townhome", "5plus": "5+ unit multifamily", mixed: "Mixed-use", land: "Land" } as const;
export const PURPOSES = { purchase: "Purchase", refinance: "Rate/term refinance", cash_out: "Cash-out refinance" } as const;
export const EXITS = { sell: "Sell", refinance: "Refinance", hold: "Hold as a rental", cash: "Pay off in cash" } as const;

// Whole dollars, up to what a lead row's 32-bit cents column holds.
const MAX = 21_000_000;
const name = z.string().trim().min(1).max(80);
const email = z.string().trim().toLowerCase().email().max(200);
const phone = z.string().trim().max(40);
const dollars = z.number().finite().min(0).max(MAX);
const optionalDollars = dollars.optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// The deal on its own, without the people: enough for indicative terms, which the visitor sees before giving any
// contact details. Nothing about it is stored until they save the terms.
const dealShape = {
  citizenship: z.enum(["us", "resident", "foreign"]),
  creditBand: z.enum(Object.keys(CREDIT_BANDS) as [keyof typeof CREDIT_BANDS]),
  experience: z.enum(Object.keys(EXPERIENCE_BANDS) as [keyof typeof EXPERIENCE_BANDS]),
  address: z.object({ street: z.string().trim().min(3).max(200), city: z.string().trim().min(1).max(100), state: z.string().trim().length(2).toUpperCase(), zip: z.string().trim().regex(/^\d{5}(-\d{4})?$/), county: z.string().trim().max(60) }),
  propertyType: z.enum(Object.keys(PROPERTY_TYPES) as [keyof typeof PROPERTY_TYPES]),
  beds: z.number().int().min(0).max(100).optional(),
  baths: z.number().min(0).max(100).optional(),
  sqft: z.number().int().min(0).max(1_000_000).optional(),
  loanType: z.enum(Object.keys(LOAN_TYPES) as [LoanType]),
  purpose: z.enum(["purchase", "refinance", "cash_out"]),
  purchasePrice: dollars.min(1),
  rehab: dollars,
  arv: optionalDollars,
  requestedAmount: optionalDollars,
  monthlyRent: optionalDollars,
  // A rental let by the night: its yearly income, from 12 months of payouts or a projection (lib/engine.ts qualifyingRent).
  rentalType: z.enum(["long_term", "short_term"]).optional(),
  strAnnualIncome: optionalDollars,
  strIncomeSource: z.enum(["payouts", "projection"]).optional(),
  // The points they'd pay for the rate they picked on the indicative terms (lib/buy-down.ts). Only a preference.
  buyDownPoints: z.number().finite().min(0).max(10).optional(),
  fundingDate: day,
  comps: z.array(z.object({ address: z.string().trim().min(3).max(200), price: dollars.min(1), soldOn: z.string().regex(/^\d{4}-\d{2}$/) })).max(3),
  exit: z.enum(["sell", "refinance", "hold", "cash"]),
  notes: z.string().trim().max(1500),
};
const dealChecks = (quote: { loanType: LoanType; arv?: number; monthlyRent?: number; rentalType?: "long_term" | "short_term"; strAnnualIncome?: number }, context: z.RefinementCtx) => {
  if ((quote.loanType === "fix_flip" || quote.loanType === "ground_up") && !quote.arv) context.addIssue({ code: "custom", path: ["arv"], message: "Add the after-repair value (ARV)." });
  if (quote.loanType.startsWith("dscr") && quote.rentalType === "short_term" && !quote.strAnnualIncome) context.addIssue({ code: "custom", path: ["strAnnualIncome"], message: "Add the yearly income from short-term stays." });
  else if (quote.loanType.startsWith("dscr") && quote.rentalType !== "short_term" && !quote.monthlyRent) context.addIssue({ code: "custom", path: ["monthlyRent"], message: "Add the monthly rent." });
};
export const dealSchema = z.object(dealShape).superRefine(dealChecks);
export type QuoteDeal = z.infer<typeof dealSchema>;

export const quoteSchema = z.object({
  submitter: z.enum(["borrower", "broker"]),
  broker: z.object({ name, company: z.string().trim().max(120), email, phone: phone.min(7) }).optional(),
  borrower: z.object({ firstName: name, lastName: name, email, phone }),
  ...dealShape,
}).superRefine((quote, context) => {
  if (quote.submitter === "broker" && !quote.broker) context.addIssue({ code: "custom", path: ["broker"], message: "Add your broker details." });
  if (quote.submitter === "borrower" && quote.borrower.phone.replace(/\D/g, "").length < 10) context.addIssue({ code: "custom", path: ["borrower", "phone"], message: "Add a phone number we can reach you on." });
  dealChecks(quote, context);
});
export type Quote = z.infer<typeof quoteSchema>;

/** What a quote fails on, said for a person: the first problem only. */
export function quoteProblem(raw: unknown): { quote: Quote } | { error: string } {
  const parsed = quoteSchema.safeParse(raw);
  return parsed.success ? { quote: parsed.data } : { error: problemWords(parsed.error.issues[0]) };
}

/** What the deal alone fails on, before the visitor's terms can be shown. */
export function dealProblem(raw: unknown): { deal: QuoteDeal } | { error: string } {
  const parsed = dealSchema.safeParse(raw);
  return parsed.success ? { deal: parsed.data } : { error: problemWords(parsed.error.issues[0]) };
}

function problemWords(issue: z.ZodIssue) {
  const where = issue.path.join(".");
  const said: Record<string, string> = {
    "borrower.firstName": "Add the borrower's first name.", "borrower.lastName": "Add the borrower's last name.", "borrower.email": "Add an email address we can reach.",
    "broker.email": "Add your email address.", "broker.phone": "Add a phone number we can reach you on.", "broker.name": "Add your name.",
    "address.street": "Add the property's street address.", "address.city": "Add the property's city.", "address.state": "Add the property's state as two letters.", "address.zip": "Add the property's 5-digit ZIP.",
    purchasePrice: "Add the purchase price or current value.", fundingDate: "Pick the date you'd like to fund.",
  };
  return said[where] ?? issue.message ?? "Check the highlighted details.";
}

/** The quote as the engine sees it, or null for a loan type it doesn't price. */
export function quoteApplication(quote: QuoteDeal): Application | null {
  const product = PRICED[quote.loanType];
  if (!product) return null;
  const florida = quote.address.state === "FL";
  const shortTerm = quote.rentalType === "short_term";
  // Taxes and insurance are estimated for a rental until the application has the real ones.
  const rented = shortTerm ? Boolean(quote.strAnnualIncome) : Boolean(quote.monthlyRent);
  return {
    product, purpose: quote.purpose === "purchase" ? "purchase" : quote.purpose === "refinance" ? "refi_rt" : "refi_co",
    county: florida ? quote.address.county || "Other FL" : quote.address.county || "Out of state", state: quote.address.state,
    propertyType: quote.propertyType === "2_4" || quote.propertyType === "condo" || quote.propertyType === "townhome" ? quote.propertyType : "sfr",
    occupancy: "vacant", purchasePrice: quote.purchasePrice, rehab: product === "fix_flip" || product === "ground_up" ? quote.rehab : 0,
    arv: product === "fix_flip" || product === "ground_up" ? quote.arv ?? quote.purchasePrice : quote.purchasePrice,
    landValue: product === "ground_up" ? quote.purchasePrice : undefined, hardCosts: product === "ground_up" ? quote.rehab : undefined,
    requestedAmount: quote.requestedAmount || undefined, monthlyRent: quote.monthlyRent, taxesAnnual: rented ? Math.round(quote.purchasePrice * 0.018) : undefined, insuranceAnnual: rented ? Math.round(quote.purchasePrice * 0.012) : undefined,
    ...(product === "dscr" && shortTerm ? { rentalType: "short_term" as const, strAnnualIncome: quote.strAnnualIncome, strIncomeSource: quote.strIncomeSource ?? "payouts" } : {}),
    interestReserve: "none", accrual: "full_boat", fico: CREDIT_BANDS[quote.creditBand], verifiedDeals: EXPERIENCE_BANDS[quote.experience], groundUpBuilds: 0,
    foreignNational: quote.citizenship === "foreign", liquidity: 0, valuationSource: "borrower_estimate",
  };
}

/**
 * Indicative terms for a quote on the current pricing, or null when the loan type needs a person to look at it. With the
 * points they picked to buy the rate down (or up), the terms at that choice when it's one the pricing allows.
 */
export function indicativeTerms(quote: QuoteDeal, pricing: PricingConfig): Estimate | null {
  const app = quoteApplication(quote);
  if (!app) return null;
  const choice = quote.buyDownPoints === undefined ? undefined : optionAt(quoteBuyDowns(app, pricing), quote.buyDownPoints);
  return evaluate(choice ? { ...app, termRate: choice.rate, termPoints: choice.points } : app, pricing);
}

export type CashLine = { label: string; amount: number };

/**
 * Where the cash to close goes, so the visitor sees why: the price less what the loan pays at closing, the points, the
 * lender's fees and the estimated closing costs. They add up to the estimate's cash to close.
 */
export function cashToCloseParts(quote: QuoteDeal, terms: Estimate, pricing: PricingConfig): CashLine[] {
  const closingCosts = quote.purchasePrice * pricing.assumptions.buyClosingCostPct;
  const costs: CashLine[] = [
    { label: `Points (${terms.pointsPct}%)`, amount: terms.points },
    { label: "Lender fees (processing and underwriting)", amount: terms.lenderFees },
    { label: `Closing costs, about ${Math.round(pricing.assumptions.buyClosingCostPct * 1000) / 10}% (title, recording, taxes)`, amount: closingCosts },
  ];
  return quote.purpose === "purchase"
    ? [{ label: "Down payment (the price less what the loan pays at closing)", amount: quote.purchasePrice - terms.initialAdvance }, ...costs]
    : [{ label: "Loan money at closing", amount: -terms.initialAdvance }, ...costs];
}

const money = (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`;

/** The request as plain text: the team's alert, and the copy the visitor can download. */
export function quoteSummary(quote: Quote) {
  const who = quote.submitter === "broker" && quote.broker ? [`Broker: ${quote.broker.name}${quote.broker.company ? `, ${quote.broker.company}` : ""} · ${quote.broker.email} · ${quote.broker.phone}`, `Borrower: ${quote.borrower.firstName} ${quote.borrower.lastName} · ${quote.borrower.email}`] : [`Borrower: ${quote.borrower.firstName} ${quote.borrower.lastName} · ${quote.borrower.email}${quote.borrower.phone ? ` · ${quote.borrower.phone}` : ""}`];
  return [
    ...who,
    `${CITIZENSHIP_LABEL[quote.citizenship]} · credit ${CREDIT_LABEL[quote.creditBand]} · ${EXPERIENCE_LABEL[quote.experience]} in the last 3 years`,
    `Property: ${quote.address.street}, ${quote.address.city}, ${quote.address.state} ${quote.address.zip}${quote.address.county ? ` (${quote.address.county})` : ""}`,
    `${PROPERTY_TYPES[quote.propertyType]}${quote.beds ? ` · ${quote.beds} bd` : ""}${quote.baths ? ` · ${quote.baths} ba` : ""}${quote.sqft ? ` · ${quote.sqft.toLocaleString("en-US")} sq ft` : ""}`,
    `Loan: ${LOAN_TYPES[quote.loanType]} · ${PURPOSES[quote.purpose]} · exit: ${EXITS[quote.exit]}`,
    `Price or value ${money(quote.purchasePrice)} · rehab ${money(quote.rehab)}${quote.arv ? ` · ARV ${money(quote.arv)}` : ""}${quote.rentalType === "short_term" && quote.strAnnualIncome ? ` · short-term rental, ${money(quote.strAnnualIncome)}/yr ${quote.strIncomeSource === "projection" ? "projected" : "from the last 12 months' payouts"}` : quote.monthlyRent ? ` · rent ${money(quote.monthlyRent)}/mo` : ""}`,
    `Requested: ${quote.requestedAmount ? money(quote.requestedAmount) : "the most it qualifies for"} · fund by ${quote.fundingDate}`,
    ...(quote.buyDownPoints !== undefined ? [`Picked ${quote.buyDownPoints} points on the quote to set the rate (indicative)`] : []),
    ...(quote.comps.length ? ["Comps for the ARV:", ...quote.comps.map((comp) => `  ${comp.address}: ${money(comp.price)} sold ${comp.soldOn}`)] : []),
    ...(quote.notes ? ["", quote.notes] : []),
  ].join("\n");
}
