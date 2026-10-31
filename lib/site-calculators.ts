// The public site's educational calculators. The starting numbers are examples, not LendHous rates or terms.
// Pricing and underwriting for real loans live in lib/engine.ts; nothing here feeds them.

export const CALCULATOR_DEFAULTS = {
  rental: { loan: 250000, rate: 8, years: 30, rent: 3000, tax: 3600, insurance: 1800, hoa: 0 },
  flip: { purchase: 250000, rehab: 50000, contingency: 7500, arv: 400000, loan: 250000, rate: 10, months: 6, points: 2, closing: 6000, holding: 700, selling: 6 },
  leverage: { cost: 300000, value: 350000, ltc: 95, ltv: 75 },
};

export type CalculatorKey = keyof typeof CALCULATOR_DEFAULTS;
export type RentalInputs = typeof CALCULATOR_DEFAULTS.rental;
export type FlipInputs = typeof CALCULATOR_DEFAULTS.flip;
export type LeverageInputs = typeof CALCULATOR_DEFAULTS.leverage;

export const FIELD_LABELS: Record<string, string> = {
  loan: "Loan amount ($)",
  rate: "Annual interest rate (%)",
  years: "Amortization (years)",
  rent: "Monthly gross rent ($)",
  tax: "Annual property taxes ($)",
  insurance: "Annual insurance ($)",
  hoa: "Monthly HOA dues ($)",
  purchase: "Purchase price ($)",
  rehab: "Renovation budget ($)",
  contingency: "Contingency reserve ($)",
  arv: "Expected sale price / ARV ($)",
  months: "Hold period (months)",
  points: "Origination points (%)",
  closing: "Other acquisition / closing costs ($)",
  holding: "Monthly non-financing holding costs ($)",
  selling: "Selling costs (%)",
  cost: "Eligible project cost ($)",
  value: "Accepted property value ($)",
  ltc: "Maximum LTC (%)",
  ltv: "Maximum LTV (%)",
};

const PERCENT_FIELDS = new Set(["rate", "points", "selling", "ltc", "ltv"]);
const ABOVE_ZERO_FIELDS = new Set(["years", "months", "cost", "value"]);

export function fieldMin(field: string) {
  return ABOVE_ZERO_FIELDS.has(field) ? 1 : 0;
}

export function fieldMax(field: string) {
  if (PERCENT_FIELDS.has(field)) return 100;
  if (field === "years") return 50;
  if (field === "months") return 120;
  return 1e9;
}

export function validInputs(inputs: Record<string, number>) {
  return Object.entries(inputs).every(
    ([field, value]) => Number.isFinite(value) && value >= 0 && value <= fieldMax(field) && (!ABOVE_ZERO_FIELDS.has(field) || value > 0),
  );
}

export const usd = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

/** Monthly rent over monthly principal, interest, taxes, insurance and dues, on a fixed-rate amortizing payment. */
export function rentalCoverage(input: RentalInputs) {
  const payments = input.years * 12;
  const monthlyRate = input.rate / 1200;
  const pi = monthlyRate === 0 ? input.loan / payments : (input.loan * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -payments));
  const pitia = pi + input.tax / 12 + input.insurance / 12 + input.hoa;
  return { pi, pitia, dscr: pitia > 0 ? input.rent / pitia : null, spread: input.rent - pitia };
}

/** Project margin with the full loan balance accruing simple interest for the whole hold. */
export function flipMargin(input: FlipInputs) {
  const interest = (input.loan * input.rate * input.months) / 1200;
  const fees = (input.loan * input.points) / 100;
  const total = input.purchase + input.rehab + input.contingency + input.closing + input.holding * input.months + interest + fees + (input.arv * input.selling) / 100;
  const basis = input.purchase + input.rehab;
  return { interest, fees, total, profit: input.arv - total, ltc: basis > 0 ? (input.loan / basis) * 100 : null };
}

/** The lower of a cost-based cap and a value-based cap. */
export function leverageCap(input: LeverageInputs) {
  const costCap = (input.cost * input.ltc) / 100;
  const valueCap = (input.value * input.ltv) / 100;
  const loan = Math.min(costCap, valueCap);
  return { costCap, valueCap, loan, equity: Math.max(0, input.cost - loan) };
}
