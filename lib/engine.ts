/**
 * Lendhous pricing & underwriting engine (Spec v3, Sections 5, 6.2, 6.3, 7.4, 7.7, 8.5).
 * Pure functions only. Same code would run on server and client in the real build.
 * Money in dollars (number) in this prototype; round2() mirrors the "round half up at posting" rule.
 */
import { pricingConfig as defaultConfig, type PricingConfig, type Tier, type Range } from "./pricing-config";

export const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/* ---------------- core ratios ---------------- */
export const ltv = (loan: number, asIsValue: number) => loan / asIsValue;
export const initialLtv = (initialAdvance: number, asIsValue: number) => initialAdvance / asIsValue;
export const ltc = (loan: number, costBasis: number) => loan / costBasis;
export const ltarv = (loan: number, arv: number) => loan / arv;

/** As-is value for a purchase = lesser of price and appraised as-is (configurable). */
export const asIsValue = (purchasePrice: number, appraisedAsIs?: number) =>
  appraisedAsIs ? Math.min(purchasePrice, appraisedAsIs) : purchasePrice;

export function costBasis(i: { purpose: "purchase" | "refi_rt" | "refi_co"; purchasePrice: number; rehab: number; originalPurchasePrice?: number; rehabSpent?: number }) {
  if (i.purpose === "purchase") return i.purchasePrice + i.rehab;
  return (i.originalPurchasePrice ?? i.purchasePrice) + (i.rehabSpent ?? 0) + i.rehab;
}

/* ---------------- payments & interest ---------------- */
export function amortizingPayment(loan: number, annualRatePct: number, months: number) {
  const i = annualRatePct / 100 / 12;
  if (i === 0) return loan / months;
  return (loan * i) / (1 - Math.pow(1 + i, -months));
}
export const ioPayment = (loan: number, annualRatePct: number) => (loan * annualRatePct) / 100 / 12;

export function dscr(i: { monthlyRent: number; payment: number; taxesAnnual: number; insuranceAnnual: number; hoaMonthly?: number; floodAnnual?: number }) {
  const pitia = i.payment + i.taxesAnnual / 12 + i.insuranceAnnual / 12 + (i.hoaMonthly ?? 0) + (i.floodAnnual ?? 0) / 12;
  return { pitia, dscr: i.monthlyRent / pitia };
}

/** Full-boat: interest on the whole note amount every month. */
export const fullBoatReserve = (noteAmount: number, ratePct: number, months: number) => (noteAmount * ratePct) / 100 / 12 * months;
/** Dutch: interest only on disbursed balance. draws[k] = amount funded at END of month k+1 (affects month k+2 onward). */
export function dutchReserve(initialAdvance: number, draws: { month: number; amount: number }[], ratePct: number, months: number) {
  let total = 0;
  for (let m = 1; m <= months; m++) {
    const bal = initialAdvance + draws.filter((d) => d.month < m).reduce((a, d) => a + d.amount, 0);
    total += (bal * ratePct) / 100 / 12;
  }
  return total;
}
/** Reserve added ON TOP of a full-boat loan accrues on itself: R = L0*k/(1-k), k = rate*m/12 */
export function addOnReserve(baseLoan: number, ratePct: number, months: number) {
  const k = (ratePct / 100) * months / 12;
  return (baseLoan * k) / (1 - k);
}

/* ---------------- sizing ---------------- */
export interface FlipLimits { maxLTC: number; maxLTARV: number; maxInitialLTV: number; rehabFinanced: number }
export function sizeFixFlip(i: { purchasePrice: number; rehab: number; arv: number; asIs: number; costBasis: number; limits: FlipLimits; requested?: number; financedReserve?: number; cap?: number }) {
  const candidates = {
    LTC: i.limits.maxLTC * i.costBasis,
    LTARV: i.limits.maxLTARV * i.arv,
    "Initial LTV + rehab": i.limits.maxInitialLTV * i.asIs + i.limits.rehabFinanced * i.rehab + (i.financedReserve ?? 0),
  };
  let binding = "LTC" as keyof typeof candidates | "Max loan size" | "Requested amount";
  let max = Infinity;
  (Object.keys(candidates) as (keyof typeof candidates)[]).forEach((k) => { if (candidates[k] < max - 1e-9) { max = candidates[k]; binding = k; } });
  if (i.cap !== undefined && i.cap < max) { max = i.cap; binding = "Max loan size"; }
  let loan = max;
  if (i.requested && i.requested < loan) { loan = i.requested; binding = "Requested amount"; }
  loan = Math.floor(loan);
  const holdback = Math.min(i.rehab * i.limits.rehabFinanced, loan);
  const reserve = i.financedReserve ?? 0;
  const initialAdvance = Math.max(0, loan - holdback - reserve);
  return { loan, maxLoan: Math.floor(max), binding, candidates, holdback, initialAdvance };
}

/* ---------------- deal economics ---------------- */
export function flipAnalysis(i: { purchasePrice: number; rehab: number; arv: number; initialAdvance: number; closingCosts: number; points: number; lenderFees: number; totalInterest: number; otherHolding: number; sellingCostPct: number; rehabNotFinanced?: number; interestFromFinancedReserve?: number; borrowerFundedReserves?: number }) {
  const sellingCosts = i.arv * i.sellingCostPct;
  const tpc = i.purchasePrice + i.rehab + i.closingCosts + i.points + i.lenderFees + i.totalInterest + i.otherHolding + sellingCosts;
  const profit = i.arv - tpc;
  const interestOutOfPocket = i.totalInterest - (i.interestFromFinancedReserve ?? 0);
  const cashInvested = (i.purchasePrice - i.initialAdvance) + i.closingCosts + i.points + i.lenderFees + (i.borrowerFundedReserves ?? 0) + (i.rehabNotFinanced ?? 0) + interestOutOfPocket + i.otherHolding;
  return { sellingCosts, tpc, profit, margin: profit / i.arv, cashInvested, roi: profit / cashInvested };
}

export function cashToClosePurchase(i: { purchasePrice: number; closingCosts: number; points: number; lenderFees: number; borrowerFundedReserves?: number; initialAdvance: number; earnestMoneyPaid?: number; sellerCredits?: number }) {
  return i.purchasePrice + i.closingCosts + i.points + i.lenderFees + (i.borrowerFundedReserves ?? 0) - i.initialAdvance - (i.earnestMoneyPaid ?? 0) - (i.sellerCredits ?? 0);
}
export function cashToCloseRefi(i: { lienPayoffs: number; closingCosts: number; points: number; lenderFees: number; borrowerFundedReserves?: number; initialAdvance: number }) {
  return i.lienPayoffs + i.closingCosts + i.points + i.lenderFees + (i.borrowerFundedReserves ?? 0) - i.initialAdvance;
}

/** Annualized all-in cost = rate + (points + lender-retained fees)/loan * 12/term */
export const allInCost = (ratePct: number, pointsDollars: number, fees: number, loan: number, termMonths: number) =>
  ratePct / 100 + ((pointsDollars + fees) / loan) * (12 / termMonths);

/* ---------------- payoff (Spec 8.5) ---------------- */
export function payoffQuote(i: { disbursedPrincipal: number; ratePct: number; daysAccrued: number; dayBasis?: 360 | 365; accrualBasisAmount?: number; unpaidCharges?: number; protectiveAdvances?: number; exitFee?: number; payoffFees?: number; borrowerEscrowCredit?: number }) {
  const basisDays = i.dayBasis ?? 360;
  const accrualBase = i.accrualBasisAmount ?? i.disbursedPrincipal; // full-boat: pass note amount
  const perDiem = (accrualBase * i.ratePct) / 100 / basisDays;
  const accrued = perDiem * i.daysAccrued;
  const total = i.disbursedPrincipal + accrued + (i.unpaidCharges ?? 0) + (i.protectiveAdvances ?? 0) + (i.exitFee ?? 0) + (i.payoffFees ?? 0) - (i.borrowerEscrowCredit ?? 0);
  return { perDiem: round2(perDiem), accrued: round2(accrued), total: round2(total) };
}

/* ---------------- draws (Spec 7.4 / 7.7) ---------------- */
export interface DrawLine { budget: number; observedPct: number; retainagePct: number; releasedToDate: number; requested: number }
export function drawLineApproved(l: DrawLine) {
  const earned = clamp(l.observedPct, 0, 1) * l.budget;
  const cap = earned * (1 - l.retainagePct);
  return { earned, cap, approved: Math.max(0, Math.min(l.requested, cap - l.releasedToDate)) };
}
/** v2 formula, kept only so tests can show the difference */
export function drawLineApprovedV2(l: DrawLine) {
  const gross = Math.min(l.requested, l.observedPct * l.budget - l.releasedToDate);
  return gross - gross * l.retainagePct;
}
export function inBalanceTest(i: { remainingHoldback: number; balancingDeposits: number; costToComplete: number }) {
  const available = i.remainingHoldback + i.balancingDeposits;
  return { inBalance: available >= i.costToComplete, shortfall: Math.max(0, i.costToComplete - available) };
}
export function approveDraw(lines: DrawLine[], ctx: { holdbackRemaining: number; inBalance: boolean; loanCurrent: boolean; fees?: number }) {
  const per = lines.map(drawLineApproved);
  const gross = Math.min(per.reduce((a, p) => a + p.approved, 0), ctx.holdbackRemaining);
  const blocked = !ctx.inBalance ? "Loan out of balance" : !ctx.loanCurrent ? "Loan not current" : null;
  return { lines: per, approved: blocked ? 0 : round2(gross), net: blocked ? 0 : round2(gross - (ctx.fees ?? 0)), blocked };
}

/* ---------------- capital availability (Spec 6.2) ---------------- */
export function capitalAvailable(s: { commitment: number; reserved: number; committed: number; deployed: number; unfunded: number; lineUndrawn?: number }) {
  const avail = s.commitment - s.reserved - s.committed - s.deployed - s.unfunded;
  return s.lineUndrawn !== undefined ? Math.min(avail, s.lineUndrawn) : avail;
}

/* ---------------- tiers, colors, score ---------------- */
export function experienceTier(verifiedDeals: number, cfg: PricingConfig = defaultConfig): Tier {
  let t: Tier = 1;
  for (const e of cfg.experienceTiers) if (verifiedDeals >= e.min) t = e.tier;
  return t;
}
export type Color = "green" | "yellow" | "red";
export function ratioColor(actual: number, limit: number, kind: "max" | "min" = "max", cfg: PricingConfig = defaultConfig): Color {
  if (kind === "max") {
    if (actual > limit + 1e-9) return "red";
    return limit - actual > cfg.colorBands.yellowWithin + 1e-9 ? "green" : "yellow";
  }
  if (actual < limit - 1e-9) return "red";
  return actual >= limit + cfg.colorBands.dscrYellowWithin - 1e-9 ? "green" : "yellow";
}

export interface ScoreInput { product: Product; leverageActual: number; leverageLimit: number; fico: number; majorDerogs?: number; tier: Tier; profitMargin?: number; dscr?: number; exitDocumented?: boolean; reserveMonths: number; location: "core" | "expansion" | "partner_only"; valuationSource: "appraisal" | "bpo" | "avm" | "borrower_estimate" }
export function dealScore(i: ScoreInput, cfg: PricingConfig = defaultConfig) {
  const w = cfg.score.weights;
  // leverage: over limit 0; at limit 10/25 of weight; linear to full at headroom >= 20% of limit
  let lev = 0;
  if (i.leverageActual <= i.leverageLimit + 1e-9) {
    const head = (i.leverageLimit - i.leverageActual) / i.leverageLimit;
    lev = (w.leverage * 0.4) + (w.leverage * 0.6) * clamp(head / 0.2, 0, 1);
  }
  const f = i.fico;
  let credit = f >= 760 ? 15 : f >= 720 ? 12 : f >= 680 ? 9 : f >= 660 ? 6 : f >= 620 ? 3 : 0;
  credit = Math.max(0, credit - 3 * (i.majorDerogs ?? 0)) * (w.credit / 15);
  const experience = ({ 1: 4, 2: 8, 3: 12, 4: 15 } as const)[i.tier] * (w.experience / 15);
  let econ: number;
  if (i.product === "dscr") { const d = i.dscr ?? 0; econ = d >= 1.25 ? 20 : d >= 1.1 ? 14 : d >= 1.0 ? 8 : 3; }
  else if (i.product === "bridge") econ = 10 + (i.exitDocumented ? 5 : 0);
  else { const m = i.profitMargin ?? 0; econ = m < 0.1 ? 0 : 5 + 15 * clamp((m - 0.1) / 0.15, 0, 1); }
  econ *= w.economics / 20;
  const r = i.reserveMonths;
  let liq = r >= 6 ? 10 : r >= 3 ? 5 + 5 * ((r - 3) / 3) : 5 * clamp(r / 3, 0, 1);
  liq *= w.liquidity / 10;
  const loc = (i.location === "core" ? 10 : i.location === "expansion" ? 5 : 0) * (w.location / 10);
  const dq = ({ appraisal: 5, bpo: 3, avm: 1, borrower_estimate: 1 } as const)[i.valuationSource] * (w.dataQuality / 5);
  const factors = { leverage: lev, credit, experience, economics: econ, liquidity: liq, location: loc, dataQuality: dq };
  const score = Math.round(Object.values(factors).reduce((a, b) => a + b, 0));
  const grade = cfg.score.grades.find((g) => score >= g.min)!.grade as Grade;
  return { score, grade, factors };
}
export type Grade = "A" | "B" | "C" | "D" | "E";

/* ---------------- routing (Spec 6.3) ---------------- */
export type Route = "IN_HOUSE" | "PARTNER" | "SPLIT" | "MANUAL" | "PARTNER_OR_DECLINE";
export function recommendRoute(i: { product: Product; noteAmount: number; grade: Grade; location: "core" | "expansion" | "partner_only"; inHouseAvailable: number; concentrationBreach?: boolean; gtIsBorrower?: boolean }, cfg: PricingConfig = defaultConfig): { route: Route; reasons: string[] } {
  const split = (r: string): { route: Route; reasons: string[] } =>
    cfg.routing.splitEnabled ? { route: "SPLIT", reasons: [r] } : { route: "PARTNER", reasons: [r, "Split not enabled yet (M8) → PARTNER"] };
  if (i.gtIsBorrower) return { route: "MANUAL", reasons: ["GT is the borrower/guarantor: separate documented approval required (Spec 7.6)"] };
  if (i.product === "dscr") return { route: "PARTNER", reasons: ["product = DSCR"] };
  if (i.noteAmount > cfg.loanSize.maxInHouse) return split(`loan $${Math.round(i.noteAmount).toLocaleString()} > in-house max $${cfg.loanSize.maxInHouse.toLocaleString()}`);
  if (i.grade === "D" || i.grade === "E") return { route: "PARTNER_OR_DECLINE", reasons: [`grade = ${i.grade}`] };
  if (i.location !== "core") return { route: "PARTNER", reasons: [`county is ${i.location.replace("_", " ")}, not core`] };
  if (i.inHouseAvailable < i.noteAmount) return split(`in-house available $${Math.round(i.inHouseAvailable).toLocaleString()} < note amount $${Math.round(i.noteAmount).toLocaleString()}`);
  if (i.concentrationBreach) return split("concentration limit breach");
  if ((i.grade === "A" || i.grade === "B") && ["fix_flip", "bridge", "ground_up"].includes(i.product)) return { route: "IN_HOUSE", reasons: [`grade ${i.grade}, core county, capital available`] };
  return { route: "MANUAL", reasons: ["no rule matched (grade C)"] };
}

/* ---------------- full evaluation (instant estimate / underwriting) ---------------- */
export type Product = "fix_flip" | "bridge" | "ground_up" | "dscr";
export interface Application {
  product: Product;
  purpose: "purchase" | "refi_rt" | "refi_co";
  county: string; state: string;
  propertyType: "sfr" | "2_4" | "condo" | "townhome";
  occupancy: "vacant" | "tenant" | "owner_occupied";
  purchasePrice: number; appraisedAsIs?: number; rehab: number; arv: number;
  originalPurchasePrice?: number; rehabSpent?: number; existingLiens?: number;
  // ground-up
  landValue?: number; hardCosts?: number; softCosts?: number; groundUpBuilds?: number;
  // dscr
  monthlyRent?: number; taxesAnnual?: number; insuranceAnnual?: number; hoaMonthly?: number;
  requestedAmount?: number; termMonths?: number;
  interestReserve: "none" | "financed";
  accrual: "full_boat" | "dutch";
  fico: number; verifiedDeals: number; foreignNational?: boolean; repeatBorrower?: boolean;
  liquidity: number; earnestMoney?: number;
  valuationSource?: "appraisal" | "bpo" | "avm" | "borrower_estimate";
}

const pick = (r: Range, p: "low" | "mid" | "high") => (p === "low" ? r[0] : p === "high" ? r[1] : (r[0] + r[1]) / 2);

export function locationClass(county: string, state: string, cfg: PricingConfig = defaultConfig): "core" | "expansion" | "partner_only" {
  if (state !== "FL") return "partner_only";
  if (cfg.geography.core.includes(county)) return "core";
  return "expansion";
}

export interface Ratio { key: string; label: string; actual: number; limit: number; kind: "max" | "min"; color: Color }
export interface Estimate {
  eligible: boolean; hardStops: string[]; flags: string[];
  tier: Tier; location: "core" | "expansion" | "partner_only";
  rateRange: Range; pointsRange: Range; rate: number; pointsPct: number;
  noteAmount: number; maxLoan: number; binding: string; initialAdvance: number; holdback: number; financedReserve: number;
  points: number; lenderFees: number; cashToClose: number; monthlyPayment: number; termMonths: number;
  ratios: Ratio[]; allIn: number;
  flip?: ReturnType<typeof flipAnalysis>; dscr?: number;
  score: ReturnType<typeof dealScore>; reserveMonths: number;
  sizingCandidates?: Record<string, number>;
}

export function evaluate(app: Application, cfg: PricingConfig = defaultConfig): Estimate {
  const hardStops: string[] = []; const flags: string[] = [];
  const pp = cfg.estimatePricePoint; const A = cfg.adjusters; const as = cfg.assumptions;
  const cap = cfg.loanSize.maxOverall;
  // depends only on the sized loan, so each product applies it before payments, reserves and DSCR are computed
  const smallLoanAdd = (loan: number) => (loan > 0 && loan < A.smallLoanThreshold ? A.smallLoanRateAdd : 0);
  const tier = experienceTier(app.verifiedDeals, cfg);
  const location = locationClass(app.county, app.state, cfg);
  if (app.occupancy === "owner_occupied") hardStops.push("Owner-occupied: business-purpose loans only (refer to a licensed consumer lender)");
  if (location === "partner_only") flags.push("Outside Florida: partner route only");

  // leverage cuts & rate adds
  let levCut = 0, rateAdd = 0;
  if (app.propertyType === "2_4") { levCut += A.twoToFourUnitsLeverageCut; flags.push("2–4 units: −5% leverage"); }
  if (app.propertyType === "condo") { levCut += A.condoLeverageCut; rateAdd += A.condoRateAdd; flags.push("Condo: −5% leverage, +0.25%"); }
  if (location === "expansion") { levCut += A.expansionCountyLeverageCut; flags.push("Expansion county: −5% leverage"); }
  if (app.foreignNational) { levCut += A.foreignNationalLeverageCut; rateAdd += A.foreignNationalRateAdd; flags.push("Foreign national: −10% leverage, +1.0%"); }
  if (app.repeatBorrower) { rateAdd -= A.repeatBorrowerRateCut; flags.push("Repeat borrower: −0.25%"); }
  const heavy = app.purchasePrice > 0 && app.rehab / app.purchasePrice > A.heavyRehabRatio;
  if (heavy) flags.push("Heavy rehab (>100% of purchase): −5% LTC, extra inspection");

  const V = app.purpose === "purchase" ? asIsValue(app.purchasePrice, app.appraisedAsIs) : (app.appraisedAsIs ?? app.purchasePrice);
  let rateRange: Range, pointsRange: Range, minFico: number, termMonths: number;
  let noteAmount = 0, maxLoan = 0, binding = "", initialAdvance = 0, holdback = 0, financedReserve = 0;
  let ratios: Ratio[] = []; let sizingCandidates: Record<string, number> | undefined; let dscrVal: number | undefined;
  let monthlyPayment = 0;
  let rate = 0, pointsPct = 0;

  if (app.product === "fix_flip" || app.product === "ground_up") {
    let lim: { maxLTC: number; maxLTARV: number; maxInitialLTV: number; rehabFinanced: number };
    let C: number;
    if (app.product === "fix_flip") {
      const t = cfg.fixFlip.tiers[tier];
      rateRange = t.rate; pointsRange = t.points; minFico = t.minFico; termMonths = app.termMonths ?? cfg.fixFlip.termMonths;
      lim = { maxLTC: t.maxLTC - levCut - (heavy ? A.heavyRehabLtcCut : 0), maxLTARV: t.maxLTARV - levCut, maxInitialLTV: t.maxInitialLTV - levCut, rehabFinanced: t.rehabFinanced };
      C = costBasis({ purpose: app.purpose, purchasePrice: app.purchasePrice, rehab: app.rehab, originalPurchasePrice: app.originalPurchasePrice, rehabSpent: app.rehabSpent });
    } else {
      const b = app.groundUpBuilds ?? 0;
      const key = b >= 4 ? "4plus" : b >= 1 ? "1to3" : "none";
      const t = cfg.groundUp.tiers[key];
      if (key === "none" && app.verifiedDeals < cfg.groundUp.minFlipsIfNoBuilds) hardStops.push(`Ground-up with no builds requires ≥ ${cfg.groundUp.minFlipsIfNoBuilds} completed flips`);
      rateRange = t.rate; pointsRange = t.points; minFico = t.minFico; termMonths = app.termMonths ?? cfg.groundUp.termMonths;
      const land = app.landValue ?? app.purchasePrice;
      const hard = app.hardCosts ?? app.rehab, soft = app.softCosts ?? 0;
      C = land + hard + soft;
      // ground-up "initial" = land advance at MaxLandLTV; construction 100% financed
      lim = { maxLTC: t.maxLTC - levCut, maxLTARV: t.maxLTARV - levCut, maxInitialLTV: t.maxLandLTV - levCut, rehabFinanced: 1 };
      app = { ...app, rehab: hard + soft, purchasePrice: land };
    }
    const s = sizeFixFlip({ purchasePrice: app.purchasePrice, rehab: app.rehab, arv: app.arv, asIs: app.product === "ground_up" ? app.purchasePrice : V, costBasis: C, limits: lim, requested: app.requestedAmount, cap });
    rate = pick(rateRange, pp) + rateAdd + smallLoanAdd(s.loan); pointsPct = pick(pointsRange, pp);
    if (app.interestReserve === "financed") {
      // reserve is CARVED OUT of the note (Spec 5.1 ex. B), so sizing limits still hold
      financedReserve = round2(app.accrual === "full_boat" ? fullBoatReserve(s.loan, rate, termMonths) :
        dutchReserve(Math.max(0, s.loan - s.holdback - 0), evenDraws(s.holdback, 4), rate, termMonths));
      if (financedReserve > s.loan - s.holdback) { flags.push("Reserve larger than initial advance; reduce term or pay reserve in cash"); financedReserve = Math.max(0, s.loan - s.holdback); }
    }
    noteAmount = s.loan; maxLoan = s.maxLoan; binding = s.binding; holdback = s.holdback; sizingCandidates = s.candidates;
    initialAdvance = noteAmount - holdback - financedReserve;
    if (initialAdvance < 0) initialAdvance = 0;
    ratios = [
      { key: "ltc", label: "LTC", actual: ltc(noteAmount, C), limit: lim.maxLTC, kind: "max", color: "green" },
      { key: "ltarv", label: "LTARV", actual: ltarv(noteAmount, app.arv), limit: lim.maxLTARV, kind: "max", color: "green" },
      { key: "iltv", label: app.product === "ground_up" ? "Land LTV" : "Initial LTV", actual: initialLtv(initialAdvance, app.product === "ground_up" ? app.purchasePrice : V), limit: lim.maxInitialLTV, kind: "max", color: "green" },
    ];
    monthlyPayment = app.accrual === "full_boat" ? ioPayment(noteAmount, rate) : ioPayment(initialAdvance, rate);
  } else if (app.product === "bridge") {
    const t = cfg.bridge.tiers[tier];
    rateRange = t.rate; pointsRange = t.points; minFico = t.minFico; termMonths = app.termMonths ?? cfg.bridge.termMonths;
    const maxL = t.maxLTV - levCut;
    maxLoan = Math.floor(maxL * V); binding = "LTV";
    if (maxLoan > cap) { maxLoan = cap; binding = "Max loan size"; }
    noteAmount = maxLoan;
    if (app.requestedAmount && app.requestedAmount < noteAmount) { noteAmount = app.requestedAmount; binding = "Requested amount"; }
    rate = pick(rateRange, pp) + rateAdd + smallLoanAdd(noteAmount); pointsPct = pick(pointsRange, pp);
    holdback = 0; initialAdvance = noteAmount;
    ratios = [{ key: "ltv", label: "LTV", actual: ltv(noteAmount, V), limit: maxL, kind: "max", color: "green" }];
    monthlyPayment = ioPayment(noteAmount, rate);
  } else {
    // DSCR
    const d = cfg.dscr; termMonths = 360;
    rateRange = d.baseRate; pointsRange = d.points; minFico = d.ficoBands[d.ficoBands.length - 1];
    pointsPct = pick(pointsRange, pp);
    const row = d.ficoBands.findIndex((b) => app.fico >= b);
    const cashOutCut = app.purpose === "refi_co" ? d.cashOutLtvReduction : 0;
    let chosen: { col: number; loan: number; rate: number; dscr: number; maxLTV: number } | null = null;
    if (row >= 0) {
      for (let col = 0; col < d.dscrBands.length; col++) {
        const cell = d.grid[row][col]; if (!cell) continue;
        const maxL = cell.maxLTV - levCut - cashOutCut;
        let loan = Math.min(Math.floor(maxL * V), cap);
        if (app.requestedAmount && app.requestedAmount < loan) loan = app.requestedAmount;
        const r = pick(d.baseRate, pp) + cell.rateAdd + rateAdd + smallLoanAdd(loan);
        const pay = d.qualifyOn === "io" ? ioPayment(loan, r) : amortizingPayment(loan, r, d.amortizationMonths);
        const x = dscr({ monthlyRent: app.monthlyRent ?? 0, payment: pay, taxesAnnual: app.taxesAnnual ?? 0, insuranceAnnual: app.insuranceAnnual ?? 0, hoaMonthly: app.hoaMonthly }).dscr;
        if (x >= d.dscrBands[col] - 1e-9) { chosen = { col, loan, rate: r, dscr: x, maxLTV: maxL }; break; }
      }
    }
    if (!chosen) { hardStops.push("Not eligible on the DSCR grid (FICO/DSCR)"); chosen = { col: 0, loan: 0, rate: pick(d.baseRate, pp), dscr: 0, maxLTV: 0 }; }
    rate = chosen.rate; noteAmount = chosen.loan; maxLoan = Math.min(Math.floor(chosen.maxLTV * V), cap); binding = `DSCR column ≥ ${d.dscrBands[chosen.col]}`;
    initialAdvance = noteAmount; dscrVal = chosen.dscr;
    monthlyPayment = d.qualifyOn === "io" ? ioPayment(noteAmount, rate) : amortizingPayment(noteAmount, rate, d.amortizationMonths);
    ratios = [
      { key: "ltv", label: "LTV", actual: V ? noteAmount / V : 0, limit: chosen.maxLTV, kind: "max", color: "green" },
      { key: "dscr", label: "DSCR", actual: chosen.dscr, limit: cfg.minDscr, kind: "min", color: "green" },
    ];
  }

  if (noteAmount < cfg.loanSize.min && hardStops.length === 0) hardStops.push(`Loan below minimum $${cfg.loanSize.min.toLocaleString()}`);
  if (noteAmount >= cap) flags.push(`Above max overall $${cap.toLocaleString()}: capped`);
  if (noteAmount > A.largeLoanManualReview) flags.push("Loan > $1.5M: manual review / partner or split route");
  if (smallLoanAdd(noteAmount)) flags.push("Loan < $100k: +0.5% rate");
  if (app.fico < minFico!) hardStops.push(`FICO ${app.fico} below product minimum ${minFico!}`);

  ratios = ratios.map((r) => ({ ...r, color: ratioColor(r.actual, r.limit, r.kind, cfg) }));
  const points = round2((noteAmount * pointsPct) / 100);
  const lenderFees = as.lenderFees;
  const closingCosts = app.purchasePrice * as.buyClosingCostPct;
  const cashToClose = app.purpose === "purchase"
    ? cashToClosePurchase({ purchasePrice: app.purchasePrice, closingCosts, points, lenderFees, initialAdvance, earnestMoneyPaid: app.earnestMoney })
    : cashToCloseRefi({ lienPayoffs: app.existingLiens ?? 0, closingCosts, points, lenderFees, initialAdvance });

  let flip: ReturnType<typeof flipAnalysis> | undefined;
  if (app.product === "fix_flip" || app.product === "ground_up") {
    const hm = as.holdMonths;
    const totalInterest = app.accrual === "full_boat" ? fullBoatReserve(noteAmount, rate, hm) : dutchReserve(initialAdvance, evenDraws(holdback, 4), rate, hm);
    const fromReserve = Math.min(financedReserve, totalInterest);
    flip = flipAnalysis({ purchasePrice: app.purchasePrice, rehab: app.rehab, arv: app.arv, initialAdvance, closingCosts, points, lenderFees, totalInterest, otherHolding: as.holdingCostMonthly * hm, sellingCostPct: as.sellingCostPct, rehabNotFinanced: Math.max(0, app.rehab - holdback), interestFromFinancedReserve: fromReserve });
    if (flip.margin < cfg.minProfitMargin) flags.push(`Profit margin ${(flip.margin * 100).toFixed(1)}% below ${(cfg.minProfitMargin * 100).toFixed(0)}% minimum`);
  }
  // spread over the actual term per Spec 5.1, not capped at 12 months (decided 2026-10-25; revisit after attorney flag 10.8 #17)
  const allIn = noteAmount ? allInCost(rate, points, lenderFees, noteAmount, termMonths!) : 0;
  if (app.product !== "dscr" && allIn >= cfg.allInCostFlagCeiling) flags.push(`All-in annualized cost ${(allIn * 100).toFixed(2)}% ≥ ${(cfg.allInCostFlagCeiling * 100).toFixed(0)}% placeholder ceiling: attorney-set exception needed`);

  const liquidityNeed = Math.max(0, cashToClose) + monthlyPayment * cfg.liquidity.monthsOfPaymentsRequired + app.rehab * cfg.liquidity.rehabPctRequired;
  if (app.liquidity < liquidityNeed) flags.push(`Liquidity $${Math.round(app.liquidity).toLocaleString()} below requirement $${Math.round(liquidityNeed).toLocaleString()}`);
  const reserveMonths = monthlyPayment > 0 ? Math.max(0, app.liquidity - Math.max(0, cashToClose)) / monthlyPayment : 0;
  const lev = ratios.find((r) => r.key === (app.product === "fix_flip" || app.product === "ground_up" ? "ltarv" : "ltv"))!;
  const score = dealScore({ product: app.product, leverageActual: lev.actual, leverageLimit: lev.limit, fico: app.fico, tier, profitMargin: flip?.margin, dscr: dscrVal, reserveMonths, location, valuationSource: app.valuationSource ?? "borrower_estimate" }, cfg);
  if (ratios.some((r) => r.color === "red")) flags.push("A ratio is over its limit");

  return { eligible: hardStops.length === 0, hardStops, flags, tier, location, rateRange: rateRange!, pointsRange: pointsRange!, rate, pointsPct, noteAmount, maxLoan, binding, initialAdvance, holdback, financedReserve, points, lenderFees, cashToClose: round2(cashToClose), monthlyPayment: round2(monthlyPayment), termMonths: termMonths!, ratios, allIn, flip, dscr: dscrVal, score, reserveMonths, sizingCandidates };
}

/** Balances on a funded loan (Spec 5.1): Dutch interest accrues on disbursed principal, full-boat on the note amount. */
export function fundedBalances(e: Estimate, app: Pick<Application, "product" | "accrual">, drawsFunded = 0) {
  const disbursed = e.initialAdvance + drawsFunded;
  const nextPayment = app.product === "dscr" ? e.monthlyPayment : ioPayment(app.accrual === "dutch" ? disbursed : e.noteAmount, e.rate);
  return { disbursed, holdbackRemaining: Math.max(0, e.holdback - drawsFunded), nextPayment: round2(nextPayment) };
}

/** Maturity = closing date + term, clamped to month end (Jan 31 + 1 month = Feb 28/29). Dates are YYYY-MM-DD. */
export function maturityDate(closingDate: string, termMonths: number) {
  const [y, m, d] = closingDate.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + termMonths, 1));
  t.setUTCDate(Math.min(d, new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()));
  return t.toISOString().slice(0, 10);
}

/** Spread a holdback into n equal draws at the end of months 1..n (used for Dutch projections). */
export function evenDraws(holdback: number, n: number) {
  if (holdback <= 0) return [];
  return Array.from({ length: n }, (_, k) => ({ month: k + 1, amount: holdback / n }));
}

/* ---------------- partner matching (Spec 6.4) ---------------- */
export interface BuyBox { products: Product[]; states: string[]; minLoan: number; maxLoan: number; maxLTARV?: number; maxLTV?: number; minFico: number; minTier: Tier; targetYield: number }
export function matchPartner(bb: BuyBox, deal: { product: Product; state: string; noteAmount: number; ltarv?: number; ltv?: number; fico: number; tier: Tier; rate: number }) {
  const reasons: string[] = [];
  if (!bb.products.includes(deal.product)) return { match: 0, reasons: ["product not in buy box"] };
  if (!bb.states.includes(deal.state)) return { match: 0, reasons: ["state not in buy box"] };
  if (deal.noteAmount < bb.minLoan || deal.noteAmount > bb.maxLoan) return { match: 0, reasons: ["loan size outside buy box"] };
  let pts = 40; reasons.push("product, state and size fit");
  if (bb.maxLTARV && deal.ltarv !== undefined) { if (deal.ltarv <= bb.maxLTARV) { pts += 20; reasons.push("LTARV within max"); } else reasons.push("LTARV above their max"); }
  else if (bb.maxLTV && deal.ltv !== undefined) { if (deal.ltv <= bb.maxLTV) { pts += 20; reasons.push("LTV within max"); } else reasons.push("LTV above their max"); }
  else pts += 20;
  if (deal.fico >= bb.minFico) { pts += 15; reasons.push("FICO meets min"); } else reasons.push("FICO below their min");
  if (deal.tier >= bb.minTier) { pts += 10; reasons.push("experience tier ok"); } else reasons.push("experience below their min");
  if (deal.rate - 1 >= bb.targetYield) { pts += 15; reasons.push("yield after 1% servicing strip meets target"); } else reasons.push("yield below target");
  return { match: pts, reasons };
}
