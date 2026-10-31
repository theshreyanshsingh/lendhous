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
  disbursedDraws?: number; nextPaymentDue?: string; paymentsLate?: number; exitStrategy: string; closingDate: string;
}
export interface CapitalSource { id: string; name: string; type: "gt_balance_sheet" | "gt_credit_line" | "partner_lender"; commitment: number; baseDeployed: number; baseUnfunded: number; lineUndrawn?: number; orgId?: string }
export interface Partner { id: string; name: string; ndaSigned: boolean; buyBox: BuyBox }
export interface Bid { id: string; dealId: string; partnerId: string; pct: number; lenderRate: number; lenderPoints: number; conditions: string; status: "submitted" | "accepted" | "declined" | "withdrawn"; type: "bid" | "accept_as_offered"; at: string }
/** A firm that buys funded loans from LendHous. Partner lenders fund deals before closing; these buy them after. */
export interface LoanBuyer { id: string; name: string; ndaSigned: boolean; buyBox: BuyBox }
/** A funded loan LendHous has put up for sale. Prices are a percent of the unpaid balance (100 = par). */
export interface LoanSale { id: string; dealId: string; askPct: number; paymentsMade: number; listedAt: string; status: "listed" | "sold" | "withdrawn"; soldTo?: string; soldPct?: number; soldAt?: string }
export interface LoanOffer { id: string; saleId: string; buyerId: string; pricePct: number; note: string; atAsk: boolean; status: "submitted" | "accepted" | "declined"; at: string }

export const BORROWER_ID = "b-alex";
/** The partner organization the demo partner seat (pia.partner@lendhous.test) acts for. */
export const DEMO_PARTNER_ID = "p-a";
/** The firm the demo buyer seat (bella.buyer@lendhous.test) acts for. */
export const DEMO_BUYER_ID = "buy-a";

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

const fundedDocs = stdDocs({ ein: "accepted", sow: "accepted", bank: "accepted", insurance: "accepted", track: "accepted" });

const flip = (o: Partial<Application>): Application => ({
  product: "fix_flip", purpose: "purchase", county: "Broward", state: "FL", propertyType: "sfr", occupancy: "vacant",
  purchasePrice: 300_000, rehab: 100_000, arv: 550_000, interestReserve: "none", accrual: "full_boat",
  fico: 720, verifiedDeals: 3, liquidity: 150_000, valuationSource: "borrower_estimate", ...o,
});

export const seedDeals: Deal[] = [
  { id: "d1", loanNumber: "LH-DEMO-1001", borrowerId: BORROWER_ID, borrowerName: "Alex Sample (FAKE)", entityName: "Sample Flips LLC (FAKE)", address: "123 Example St", city: "Hollywood", zip: "33020", source: "wholesale",
    app: flip({ valuationSource: "bpo" }), status: "underwriting", daysInStage: 2, capitalStatus: "recommended", allocations: [], teaserSentTo: [], docs: stdDocs(), exitStrategy: "Sell", closingDate: "2026-11-13" },
  { id: "d2", loanNumber: "LH-DEMO-1002", borrowerId: BORROWER_ID, borrowerName: "Alex Sample (FAKE)", entityName: "Sample Flips LLC (FAKE)", address: "456 Placeholder Ave", city: "Fort Lauderdale", zip: "33311", source: "web_quote",
    app: flip({ purchasePrice: 410_000, rehab: 140_000, arv: 760_000, fico: 745, verifiedDeals: 6, valuationSource: "appraisal", accrual: "dutch", liquidity: 210_000 }), status: "servicing_current", daysInStage: 41, capitalStatus: "funded", route: "in_house", allocations: [{ sourceId: "gt-main", amount: 0 }], teaserSentTo: [], docs: stdDocs({ ein: "accepted", sow: "accepted", bank: "accepted", insurance: "accepted", track: "accepted" }), disbursedDraws: 70_000, nextPaymentDue: "2026-11-01", exitStrategy: "Sell", closingDate: "2026-09-04" },
  { id: "d3", loanNumber: "LH-DEMO-1003", borrowerId: "b-jordan", borrowerName: "Jordan Demo (FAKE)", entityName: "Demo Holdings LLC (FAKE)", address: "789 Mockingbird Ln", city: "Miami", zip: "33147", source: "broker",
    app: flip({ county: "Miami-Dade", purchasePrice: 1_150_000, rehab: 450_000, arv: 2_300_000, fico: 770, verifiedDeals: 14, liquidity: 600_000, valuationSource: "appraisal" }), status: "conditions", daysInStage: 5, capitalStatus: "teaser_out", allocations: [], teaserSentTo: ["p-a", "p-b"], docs: stdDocs({ bank: "accepted" }), exitStrategy: "Sell", closingDate: "2026-11-06" },
  { id: "d4", loanNumber: "LH-DEMO-1004", borrowerId: "b-casey", borrowerName: "Casey Testcase (FAKE)", entityName: "Testcase Rentals LLC (FAKE)", address: "22 Sample Ct", city: "Pembroke Pines", zip: "33024", source: "realty",
    app: { ...flip({}), product: "dscr", purchasePrice: 350_000, rehab: 0, arv: 350_000, monthlyRent: 3_200, taxesAnnual: 6_000, insuranceAnnual: 4_800, fico: 735, verifiedDeals: 4, liquidity: 120_000, occupancy: "tenant", valuationSource: "appraisal" }, status: "term_sheet_issued", daysInStage: 3, capitalStatus: "teaser_out", allocations: [], teaserSentTo: ["p-c"], docs: stdDocs({ sow: "waived" }), exitStrategy: "Hold", closingDate: "2026-11-20" },
  { id: "d5", loanNumber: "LH-DEMO-1005", borrowerId: "b-riley", borrowerName: "Riley Placeholder (FAKE)", entityName: "Placeholder Builders LLC (FAKE)", address: "5 Fictional Way", city: "Boca Raton", zip: "33432", source: "referral",
    app: { ...flip({}), product: "ground_up", county: "Palm Beach", purchasePrice: 260_000, landValue: 260_000, hardCosts: 520_000, softCosts: 60_000, rehab: 580_000, arv: 1_250_000, groundUpBuilds: 2, verifiedDeals: 8, fico: 705, liquidity: 260_000, valuationSource: "appraisal" }, status: "underwriting", daysInStage: 9, capitalStatus: "teaser_out", allocations: [], teaserSentTo: ["p-a"], docs: stdDocs({ sow: "rejected" }), exitStrategy: "Sell", closingDate: "2026-12-01", contractorIsGtAffiliate: true },
  { id: "d6", loanNumber: "LH-DEMO-1006", borrowerId: "b-morgan", borrowerName: "Morgan Mockup (FAKE)", entityName: "Mockup Ventures LLC (FAKE)", address: "901 Notreal Blvd", city: "Cape Coral", zip: "33904", source: "ad",
    app: flip({ county: "Lee", purchasePrice: 210_000, rehab: 90_000, arv: 360_000, fico: 668, verifiedDeals: 1, liquidity: 45_000 }), status: "initial_review", daysInStage: 1, capitalStatus: "not_started", allocations: [], teaserSentTo: [], docs: stdDocs({ entity: "uploaded", contract: "uploaded" }), exitStrategy: "Sell", closingDate: "2026-11-25" },
  { id: "d7", loanNumber: "LH-DEMO-1007", borrowerId: "b-taylor", borrowerName: "Taylor Fakename (FAKE)", entityName: "Fakename Capital LLC (FAKE)", address: "64 Imaginary Rd", city: "Pompano Beach", zip: "33060", source: "wholesale",
    app: { ...flip({}), product: "bridge", purchasePrice: 480_000, rehab: 0, arv: 480_000, fico: 752, verifiedDeals: 7, liquidity: 220_000, valuationSource: "appraisal" }, status: "clear_to_close", daysInStage: 2, capitalStatus: "committed", route: "in_house", allocations: [{ sourceId: "gt-main", amount: 0 }], teaserSentTo: [], docs: stdDocs({ ein: "accepted", sow: "waived", bank: "accepted", insurance: "accepted", track: "accepted" }), exitStrategy: "Refi", closingDate: "2026-10-23" },
  { id: "d8", loanNumber: "LH-DEMO-1008", borrowerId: "b-sam", borrowerName: "Sam Example (FAKE)", entityName: "Example Homes LLC (FAKE)", address: "3 Dummy Dr", city: "West Palm Beach", zip: "33407", source: "web_quote",
    app: flip({ county: "Palm Beach", purchasePrice: 255_000, rehab: 75_000, arv: 430_000, fico: 698, verifiedDeals: 2, liquidity: 95_000 }), status: "term_sheet_accepted", daysInStage: 4, capitalStatus: "reserved", route: "in_house", allocations: [{ sourceId: "gt-main", amount: 0 }], teaserSentTo: [], docs: stdDocs(), exitStrategy: "Sell", closingDate: "2026-11-10" },
  { id: "d9", loanNumber: "LH-DEMO-1009", borrowerId: "b-quinn", borrowerName: "Quinn Sample (FAKE)", entityName: "Quinn Flips LLC (FAKE)", address: "410 Test Harbor Way", city: "Hollywood", zip: "33019", source: "web_quote",
    app: flip({ purchasePrice: 340_000, rehab: 110_000, arv: 640_000, fico: 742, verifiedDeals: 9, liquidity: 190_000, valuationSource: "appraisal", accrual: "dutch" }), status: "servicing_current", daysInStage: 150, capitalStatus: "funded", route: "in_house", allocations: [{ sourceId: "gt-main", amount: 0 }], teaserSentTo: [], docs: fundedDocs, disbursedDraws: 65_000, nextPaymentDue: "2026-11-01", exitStrategy: "Sell", closingDate: "2026-05-12" },
  { id: "d10", loanNumber: "LH-DEMO-1010", borrowerId: "b-drew", borrowerName: "Drew Example (FAKE)", entityName: "Example Rentals LLC (FAKE)", address: "77 Sample Palm Ct", city: "Coral Springs", zip: "33065", source: "broker",
    app: { ...flip({}), product: "dscr", purchasePrice: 420_000, rehab: 0, arv: 420_000, monthlyRent: 3_900, taxesAnnual: 7_200, insuranceAnnual: 5_400, fico: 758, verifiedDeals: 6, liquidity: 180_000, occupancy: "tenant", valuationSource: "appraisal" }, status: "servicing_current", daysInStage: 240, capitalStatus: "funded", route: "in_house", allocations: [{ sourceId: "gt-main", amount: 0 }], teaserSentTo: [], docs: fundedDocs, nextPaymentDue: "2026-11-01", exitStrategy: "Hold", closingDate: "2026-02-20" },
  { id: "d11", loanNumber: "LH-DEMO-1011", borrowerId: "b-avery", borrowerName: "Avery Mock (FAKE)", entityName: "Mock Bridge Partners LLC (FAKE)", address: "1200 Pretend Ave", city: "Miami", zip: "33130", source: "referral",
    app: { ...flip({}), product: "bridge", county: "Miami-Dade", purchasePrice: 620_000, rehab: 0, arv: 620_000, fico: 731, verifiedDeals: 5, liquidity: 260_000, valuationSource: "appraisal" }, status: "servicing_current", daysInStage: 120, capitalStatus: "funded", route: "in_house", allocations: [{ sourceId: "gt-main", amount: 0 }], teaserSentTo: [], docs: fundedDocs, nextPaymentDue: "2026-11-01", exitStrategy: "Refi", closingDate: "2026-06-30" },
  { id: "d12", loanNumber: "LH-DEMO-1012", borrowerId: "b-blake", borrowerName: "Blake Notreal (FAKE)", entityName: "Notreal Builders LLC (FAKE)", address: "8 Fiction Pt", city: "Delray Beach", zip: "33444", source: "referral",
    app: { ...flip({}), product: "ground_up", county: "Palm Beach", purchasePrice: 300_000, landValue: 300_000, hardCosts: 640_000, softCosts: 70_000, rehab: 710_000, arv: 1_450_000, groundUpBuilds: 3, verifiedDeals: 10, fico: 724, liquidity: 320_000, valuationSource: "appraisal" }, status: "servicing_current", daysInStage: 200, capitalStatus: "funded", route: "in_house", allocations: [{ sourceId: "gt-main", amount: 0 }], teaserSentTo: [], docs: fundedDocs, disbursedDraws: 290_000, nextPaymentDue: "2026-11-01", exitStrategy: "Sell", closingDate: "2026-04-08" },
  { id: "d13", loanNumber: "LH-DEMO-1013", borrowerId: "b-kai", borrowerName: "Kai Placeholder (FAKE)", entityName: "Placeholder Homes LLC (FAKE)", address: "39 Invented Ter", city: "Lauderhill", zip: "33313", source: "web_quote",
    app: flip({ purchasePrice: 230_000, rehab: 70_000, arv: 400_000, fico: 684, verifiedDeals: 2, liquidity: 70_000, valuationSource: "appraisal" }), status: "servicing_delinquent", daysInStage: 33, capitalStatus: "funded", route: "in_house", allocations: [{ sourceId: "gt-main", amount: 0 }], teaserSentTo: [], docs: fundedDocs, disbursedDraws: 55_000, nextPaymentDue: "2026-10-01", paymentsLate: 2, exitStrategy: "Sell", closingDate: "2026-03-17" },
  { id: "d14", loanNumber: "LH-DEMO-1014", borrowerId: "b-rowan", borrowerName: "Rowan Demo (FAKE)", entityName: "Rowan Renovations LLC (FAKE)", address: "250 Sample Shore Dr", city: "Deerfield Beach", zip: "33441", source: "wholesale",
    app: flip({ purchasePrice: 290_000, rehab: 85_000, arv: 520_000, fico: 736, verifiedDeals: 5, liquidity: 130_000, valuationSource: "appraisal" }), status: "servicing_current", daysInStage: 280, capitalStatus: "funded", route: "in_house", allocations: [{ sourceId: `buyer:${DEMO_BUYER_ID}`, amount: 0 }], teaserSentTo: [], docs: fundedDocs, disbursedDraws: 85_000, nextPaymentDue: "2026-11-01", exitStrategy: "Sell", closingDate: "2026-01-15" },
  { id: "d15", loanNumber: "LH-DEMO-1015", borrowerId: "b-emery", borrowerName: "Emery Testcase (FAKE)", entityName: "Testcase Holdings LLC (FAKE)", address: "16 Mock Canal Rd", city: "Fort Lauderdale", zip: "33301", source: "broker",
    app: { ...flip({}), product: "bridge", purchasePrice: 395_000, rehab: 0, arv: 395_000, fico: 718, verifiedDeals: 4, liquidity: 140_000, valuationSource: "appraisal" }, status: "closing", daysInStage: 1, capitalStatus: "committed", route: "in_house", allocations: [{ sourceId: "gt-main", amount: 0 }], teaserSentTo: [], docs: stdDocs({ ein: "accepted", sow: "waived", bank: "accepted", insurance: "accepted", track: "accepted" }), exitStrategy: "Refi", closingDate: "2026-11-03" },
  { id: "d16", loanNumber: "LH-DEMO-1016", borrowerId: "b-harper", borrowerName: "Harper Mockup (FAKE)", entityName: "Mockup Homes LLC (FAKE)", address: "904 Nowhere Pl", city: "Sunrise", zip: "33322", source: "web_quote",
    app: flip({ purchasePrice: 275_000, rehab: 60_000, arv: 470_000, fico: 712, verifiedDeals: 3, liquidity: 90_000 }), status: "submitted", daysInStage: 0, capitalStatus: "not_started", allocations: [], teaserSentTo: [], docs: stdDocs({ id: "requested", entity: "requested", contract: "uploaded", sow: "requested" }), exitStrategy: "Sell", closingDate: "2026-12-05" },
  { id: "d17", loanNumber: "LH-DEMO-1017", borrowerId: "b-logan", borrowerName: "Logan Fakename (FAKE)", entityName: "Fakename Flips LLC (FAKE)", address: "51 Sample Bay Dr", city: "Margate", zip: "33063", source: "wholesale",
    app: flip({ purchasePrice: 245_000, rehab: 65_000, arv: 440_000, fico: 727, verifiedDeals: 4, liquidity: 110_000, valuationSource: "appraisal" }), status: "funded", daysInStage: 8, capitalStatus: "funded", route: "in_house", allocations: [{ sourceId: "gt-main", amount: 0 }], teaserSentTo: [], docs: fundedDocs, nextPaymentDue: "2026-12-01", exitStrategy: "Sell", closingDate: "2026-10-20" },
];

export const capitalSources: CapitalSource[] = [
  { id: "gt-main", name: "LendHous Balance Sheet: Fund A (FAKE)", type: "gt_balance_sheet", commitment: 7_500_000, baseDeployed: 900_000, baseUnfunded: 120_000 },
  { id: "gt-line", name: "LendHous Credit Line (FAKE)", type: "gt_credit_line", commitment: 1_500_000, baseDeployed: 600_000, baseUnfunded: 0, lineUndrawn: 900_000 },
];

export const loanBuyers: LoanBuyer[] = [
  { id: DEMO_BUYER_ID, name: "Harbor Note Fund (FAKE)", ndaSigned: true, buyBox: { products: ["fix_flip", "bridge", "dscr", "ground_up"], states: ["FL", "GA"], minLoan: 150_000, maxLoan: 1_500_000, maxLTARV: 0.72, minFico: 680, minTier: 1, targetYield: 9 } },
  { id: "buy-b", name: "Sample Whole Loan Capital (FAKE)", ndaSigned: true, buyBox: { products: ["bridge", "dscr"], states: ["FL"], minLoan: 200_000, maxLoan: 2_000_000, maxLTV: 0.75, minFico: 700, minTier: 1, targetYield: 8 } },
];

export const seedLoanSales: LoanSale[] = [
  { id: "s-d9", dealId: "d9", askPct: 99.5, paymentsMade: 5, status: "listed", listedAt: "2026-10-12" },
  { id: "s-d10", dealId: "d10", askPct: 101, paymentsMade: 8, status: "listed", listedAt: "2026-10-05" },
  { id: "s-d11", dealId: "d11", askPct: 99, paymentsMade: 4, status: "listed", listedAt: "2026-10-14" },
  { id: "s-d12", dealId: "d12", askPct: 98.5, paymentsMade: 6, status: "listed", listedAt: "2026-10-09" },
  { id: "s-d13", dealId: "d13", askPct: 93, paymentsMade: 5, status: "listed", listedAt: "2026-10-16" },
  { id: "s-d14", dealId: "d14", askPct: 99.5, paymentsMade: 9, status: "sold", soldTo: DEMO_BUYER_ID, soldPct: 99.25, soldAt: "2026-08-18", listedAt: "2026-08-03" },
];

export const seedLoanOffers: LoanOffer[] = [
  { id: "offer-1", saleId: "s-d10", buyerId: DEMO_BUYER_ID, pricePct: 100.25, note: "Subject to pay history and title review", atAsk: false, status: "submitted", at: "2026-10-17T10:20:00-07:00" },
  { id: "offer-2", saleId: "s-d11", buyerId: "buy-b", pricePct: 98.75, note: "", atAsk: false, status: "submitted", at: "2026-10-16T15:40:00-07:00" },
  { id: "offer-3", saleId: "s-d14", buyerId: DEMO_BUYER_ID, pricePct: 99.25, note: "", atAsk: false, status: "accepted", at: "2026-08-11T09:05:00-07:00" },
];

export const partners: Partner[] = [
  { id: "p-a", name: "Demo Partner Capital A (FAKE)", ndaSigned: true, buyBox: { products: ["fix_flip", "bridge", "ground_up"], states: ["FL", "GA"], minLoan: 250_000, maxLoan: 3_000_000, maxLTARV: 0.72, minFico: 680, minTier: 2, targetYield: 9.5 } },
  { id: "p-b", name: "Sample Bridge Fund B (FAKE)", ndaSigned: true, buyBox: { products: ["fix_flip", "bridge"], states: ["FL"], minLoan: 100_000, maxLoan: 2_000_000, maxLTARV: 0.7, minFico: 660, minTier: 1, targetYield: 10 } },
  { id: "p-c", name: "Placeholder DSCR Lender C (FAKE)", ndaSigned: true, buyBox: { products: ["dscr"], states: ["FL", "TX", "NC"], minLoan: 100_000, maxLoan: 1_500_000, maxLTV: 0.8, minFico: 680, minTier: 1, targetYield: 6.5 } },
  { id: "p-d", name: "Unsigned Prospect D (FAKE)", ndaSigned: false, buyBox: { products: ["fix_flip"], states: ["FL"], minLoan: 75_000, maxLoan: 1_000_000, maxLTARV: 0.7, minFico: 660, minTier: 1, targetYield: 10 } },
];

export const seedBids: Bid[] = [
  { id: "bid1", dealId: "d3", partnerId: "p-a", pct: 100, lenderRate: 9.75, lenderPoints: 0.5, conditions: "Appraisal review by our desk", status: "submitted", type: "bid", at: "2026-10-16T14:05:00-07:00" },
  { id: "bid2", dealId: "d3", partnerId: "p-b", pct: 50, lenderRate: 10, lenderPoints: 0.75, conditions: "", status: "submitted", type: "bid", at: "2026-10-17T08:30:00-07:00" },
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
