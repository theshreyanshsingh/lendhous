/**
 * SEEDED MOCK DATA — 100% FAKE. Every person, company, address and number below is invented for the demo.
 * Names are tagged "(FAKE)" / "Sample" / "Demo" on purpose so nobody mistakes them for real records.
 */
import type { Application, BuyBox } from "./engine";

export type LoanStatus =
  | "submitted" | "initial_review" | "underwriting" | "term_sheet_issued" | "term_sheet_accepted" | "conditions"
  | "clear_to_close" | "closing" | "funded" | "servicing_current" | "servicing_delinquent" | "matured" | "default" | "paid_off";
export type CapitalStatus = "not_started" | "recommended" | "teaser_out" | "bids_in" | "reserved" | "committed" | "funded";
export type DocStatus = "requested" | "uploaded" | "in_review" | "accepted" | "rejected" | "waived";

export interface Doc { id: string; name: string; category: string; status: DocStatus; fileName?: string; note?: string }
export interface Allocation { sourceId: string; amount: number }
export interface Deal {
  id: string; loanNumber: string; borrowerId: string; borrowerName: string; entityName: string;
  address: string; city: string; zip: string; app: Application; status: LoanStatus; daysInStage: number;
  capitalStatus: CapitalStatus; route?: "in_house" | "partner" | "split"; allocations: Allocation[];
  teaserSentTo: string[]; docs: Doc[]; source: string; contractorIsGtAffiliate?: boolean;
  disbursedDraws?: number; nextPaymentDue?: string; exitStrategy: string; closingDate: string;
}
export interface CapitalSource { id: string; name: string; type: "gt_balance_sheet" | "gt_credit_line" | "partner_lender"; commitment: number; baseDeployed: number; baseUnfunded: number; lineUndrawn?: number; orgId?: string }
export interface Partner { id: string; name: string; ndaSigned: boolean; buyBox: BuyBox }
export interface Bid { id: string; dealId: string; partnerId: string; pct: number; lenderRate: number; lenderPoints: number; conditions: string; status: "submitted" | "accepted" | "declined" | "withdrawn"; type: "bid" | "accept_as_offered"; at: string }

export const BORROWER_ID = "b-alex";
/** The partner organization the demo partner seat (pia.partner@lendhous.test) acts for. */
export const DEMO_PARTNER_ID = "p-a";

const stdDocs = (overrides: Partial<Record<string, DocStatus>> = {}): Doc[] => [
  { id: "id", name: "Government ID (each guarantor)", category: "Identity", status: overrides.id ?? "accepted" },
  { id: "entity", name: "LLC Articles + Operating Agreement", category: "Entity", status: overrides.entity ?? "accepted" },
  { id: "ein", name: "EIN letter (IRS CP-575)", category: "Entity", status: overrides.ein ?? "uploaded" },
  { id: "contract", name: "Purchase contract (fully executed)", category: "Property", status: overrides.contract ?? "accepted" },
  { id: "sow", name: "Scope of work / rehab budget", category: "Property", status: overrides.sow ?? "in_review" },
  { id: "bank", name: "Bank statements (2 most recent months)", category: "Liquidity", status: overrides.bank ?? "requested" },
  { id: "insurance", name: "Insurance binder (lender as mortgagee)", category: "Closing", status: overrides.insurance ?? "requested" },
  { id: "track", name: "Track record proof (HUD / closing statements)", category: "Experience", status: overrides.track ?? "requested" },
];

const flip = (o: Partial<Application>): Application => ({
  product: "fix_flip", purpose: "purchase", county: "Broward", state: "FL", propertyType: "sfr", occupancy: "vacant",
  purchasePrice: 300_000, rehab: 100_000, arv: 550_000, interestReserve: "none", accrual: "full_boat",
  fico: 720, verifiedDeals: 3, liquidity: 150_000, valuationSource: "borrower_estimate", ...o,
});

export const seedDeals: Deal[] = [
  { id: "d1", loanNumber: "LH-DEMO-1001", borrowerId: BORROWER_ID, borrowerName: "Alex Sample (FAKE)", entityName: "Sample Flips LLC (FAKE)", address: "123 Example St", city: "Hollywood", zip: "33020", source: "gt_wholesale",
    app: flip({ valuationSource: "bpo" }), status: "underwriting", daysInStage: 2, capitalStatus: "recommended", allocations: [], teaserSentTo: [], docs: stdDocs(), exitStrategy: "Sell", closingDate: "2026-11-13" },
  { id: "d2", loanNumber: "LH-DEMO-1002", borrowerId: BORROWER_ID, borrowerName: "Alex Sample (FAKE)", entityName: "Sample Flips LLC (FAKE)", address: "456 Placeholder Ave", city: "Fort Lauderdale", zip: "33311", source: "web_quote",
    app: flip({ purchasePrice: 410_000, rehab: 140_000, arv: 760_000, fico: 745, verifiedDeals: 6, valuationSource: "appraisal", accrual: "dutch", liquidity: 210_000 }), status: "servicing_current", daysInStage: 41, capitalStatus: "funded", route: "in_house", allocations: [{ sourceId: "gt-main", amount: 0 }], teaserSentTo: [], docs: stdDocs({ ein: "accepted", sow: "accepted", bank: "accepted", insurance: "accepted", track: "accepted" }), disbursedDraws: 70_000, nextPaymentDue: "2026-11-01", exitStrategy: "Sell", closingDate: "2026-09-04" },
  { id: "d3", loanNumber: "LH-DEMO-1003", borrowerId: "b-jordan", borrowerName: "Jordan Demo (FAKE)", entityName: "Demo Holdings LLC (FAKE)", address: "789 Mockingbird Ln", city: "Miami", zip: "33147", source: "broker",
    app: flip({ county: "Miami-Dade", purchasePrice: 1_150_000, rehab: 450_000, arv: 2_300_000, fico: 770, verifiedDeals: 14, liquidity: 600_000, valuationSource: "appraisal" }), status: "conditions", daysInStage: 5, capitalStatus: "teaser_out", allocations: [], teaserSentTo: ["p-a", "p-b"], docs: stdDocs({ bank: "accepted" }), exitStrategy: "Sell", closingDate: "2026-11-06" },
  { id: "d4", loanNumber: "LH-DEMO-1004", borrowerId: "b-casey", borrowerName: "Casey Testcase (FAKE)", entityName: "Testcase Rentals LLC (FAKE)", address: "22 Sample Ct", city: "Pembroke Pines", zip: "33024", source: "gt_realty",
    app: { ...flip({}), product: "dscr", purchasePrice: 350_000, rehab: 0, arv: 350_000, monthlyRent: 3_200, taxesAnnual: 6_000, insuranceAnnual: 4_800, fico: 735, verifiedDeals: 4, liquidity: 120_000, occupancy: "tenant", valuationSource: "appraisal" }, status: "term_sheet_issued", daysInStage: 3, capitalStatus: "teaser_out", allocations: [], teaserSentTo: ["p-c"], docs: stdDocs({ sow: "waived" }), exitStrategy: "Hold", closingDate: "2026-11-20" },
  { id: "d5", loanNumber: "LH-DEMO-1005", borrowerId: "b-riley", borrowerName: "Riley Placeholder (FAKE)", entityName: "Placeholder Builders LLC (FAKE)", address: "5 Fictional Way", city: "Boca Raton", zip: "33432", source: "referral",
    app: { ...flip({}), product: "ground_up", county: "Palm Beach", purchasePrice: 260_000, landValue: 260_000, hardCosts: 520_000, softCosts: 60_000, rehab: 580_000, arv: 1_250_000, groundUpBuilds: 2, verifiedDeals: 8, fico: 705, liquidity: 260_000, valuationSource: "appraisal" }, status: "underwriting", daysInStage: 9, capitalStatus: "not_started", allocations: [], teaserSentTo: [], docs: stdDocs({ sow: "rejected" }), exitStrategy: "Sell", closingDate: "2026-12-01", contractorIsGtAffiliate: true },
  { id: "d6", loanNumber: "LH-DEMO-1006", borrowerId: "b-morgan", borrowerName: "Morgan Mockup (FAKE)", entityName: "Mockup Ventures LLC (FAKE)", address: "901 Notreal Blvd", city: "Cape Coral", zip: "33904", source: "ad",
    app: flip({ county: "Lee", purchasePrice: 210_000, rehab: 90_000, arv: 360_000, fico: 668, verifiedDeals: 1, liquidity: 45_000 }), status: "initial_review", daysInStage: 1, capitalStatus: "not_started", allocations: [], teaserSentTo: [], docs: stdDocs({ entity: "uploaded", contract: "uploaded" }), exitStrategy: "Sell", closingDate: "2026-11-25" },
  { id: "d7", loanNumber: "LH-DEMO-1007", borrowerId: "b-taylor", borrowerName: "Taylor Fakename (FAKE)", entityName: "Fakename Capital LLC (FAKE)", address: "64 Imaginary Rd", city: "Pompano Beach", zip: "33060", source: "gt_wholesale",
    app: { ...flip({}), product: "bridge", purchasePrice: 480_000, rehab: 0, arv: 480_000, fico: 752, verifiedDeals: 7, liquidity: 220_000, valuationSource: "appraisal" }, status: "clear_to_close", daysInStage: 2, capitalStatus: "committed", route: "in_house", allocations: [{ sourceId: "gt-main", amount: 0 }], teaserSentTo: [], docs: stdDocs({ ein: "accepted", sow: "waived", bank: "accepted", insurance: "accepted", track: "accepted" }), exitStrategy: "Refi", closingDate: "2026-10-23" },
  { id: "d8", loanNumber: "LH-DEMO-1008", borrowerId: "b-sam", borrowerName: "Sam Example (FAKE)", entityName: "Example Homes LLC (FAKE)", address: "3 Dummy Dr", city: "West Palm Beach", zip: "33407", source: "web_quote",
    app: flip({ county: "Palm Beach", purchasePrice: 255_000, rehab: 75_000, arv: 430_000, fico: 698, verifiedDeals: 2, liquidity: 95_000 }), status: "term_sheet_accepted", daysInStage: 4, capitalStatus: "reserved", route: "in_house", allocations: [{ sourceId: "gt-main", amount: 0 }], teaserSentTo: [], docs: stdDocs(), exitStrategy: "Sell", closingDate: "2026-11-10" },
];

export const capitalSources: CapitalSource[] = [
  { id: "gt-main", name: "GT Balance Sheet: Fund A (FAKE)", type: "gt_balance_sheet", commitment: 5_000_000, baseDeployed: 2_150_000, baseUnfunded: 230_000 },
  { id: "gt-line", name: "GT Credit Line (FAKE)", type: "gt_credit_line", commitment: 1_500_000, baseDeployed: 600_000, baseUnfunded: 0, lineUndrawn: 900_000 },
];

export const partners: Partner[] = [
  { id: "p-a", name: "Demo Partner Capital A (FAKE)", ndaSigned: true, buyBox: { products: ["fix_flip", "bridge", "ground_up"], states: ["FL", "GA"], minLoan: 250_000, maxLoan: 3_000_000, maxLTARV: 0.72, minFico: 680, minTier: 2, targetYield: 9.5 } },
  { id: "p-b", name: "Sample Bridge Fund B (FAKE)", ndaSigned: true, buyBox: { products: ["fix_flip", "bridge"], states: ["FL"], minLoan: 100_000, maxLoan: 2_000_000, maxLTARV: 0.7, minFico: 660, minTier: 1, targetYield: 10 } },
  { id: "p-c", name: "Placeholder DSCR Lender C (FAKE)", ndaSigned: true, buyBox: { products: ["dscr"], states: ["FL", "TX", "NC"], minLoan: 100_000, maxLoan: 1_500_000, maxLTV: 0.8, minFico: 680, minTier: 1, targetYield: 6.5 } },
  { id: "p-d", name: "Unsigned Prospect D (FAKE)", ndaSigned: false, buyBox: { products: ["fix_flip"], states: ["FL"], minLoan: 75_000, maxLoan: 1_000_000, maxLTARV: 0.7, minFico: 660, minTier: 1, targetYield: 10 } },
];

export const seedBids: Bid[] = [
  { id: "bid1", dealId: "d3", partnerId: "p-a", pct: 100, lenderRate: 9.75, lenderPoints: 0.5, conditions: "Appraisal review by our desk", status: "submitted", type: "bid", at: "2026-10-16T14:05:00-07:00" },
];

export const pipelineStages: { code: LoanStatus; label: string }[] = [
  { code: "submitted", label: "Submitted" }, { code: "initial_review", label: "Initial review" }, { code: "underwriting", label: "Underwriting" },
  { code: "term_sheet_issued", label: "Term sheet issued" }, { code: "term_sheet_accepted", label: "Term sheet accepted" }, { code: "conditions", label: "Conditions" },
  { code: "clear_to_close", label: "Clear to close" }, { code: "closing", label: "Closing" }, { code: "funded", label: "Funded" },
  { code: "servicing_current", label: "Servicing: current" }, { code: "servicing_delinquent", label: "Servicing: delinquent" }, { code: "matured", label: "Matured" }, { code: "default", label: "Default" }, { code: "paid_off", label: "Paid off" },
];
export const borrowerTimeline = ["Submitted", "Underwriting", "Term Sheet", "Conditions", "Clear to Close", "Funded"];
export function timelineIndex(s: LoanStatus) {
  const m: Record<string, number> = { submitted: 0, initial_review: 1, underwriting: 1, term_sheet_issued: 2, term_sheet_accepted: 3, conditions: 3, clear_to_close: 4, closing: 4 };
  return m[s] ?? 5;
}
