/**
 * SEEDED MOCK DATA — 100% FAKE. Every person, company, address and number below is invented for the demo.
 * Names are tagged "(FAKE)" / "Sample" / "Demo" on purpose so nobody mistakes them for real records.
 */
import type { Application, BuyBox, Product } from "./engine";

export type LoanStatus =
  | "submitted" | "initial_review" | "underwriting" | "term_sheet_issued" | "term_sheet_accepted" | "conditions"
  | "clear_to_close" | "closing" | "funded" | "servicing_current" | "servicing_delinquent" | "matured" | "default" | "paid_off"
  // An application that ended before funding: turned down by the team, or called off by the borrower.
  | "declined" | "withdrawn";
export type CapitalStatus = "not_started" | "recommended" | "teaser_out" | "bids_in" | "reserved" | "committed" | "funded";
export type DocStatus = "requested" | "uploaded" | "in_review" | "accepted" | "rejected" | "waived";

/** stage: when a document has to be in. Unset means before clear to close; "funding" before the money goes out; "post_close" after. */
export interface Doc { id: string; name: string; category: string; status: DocStatus; fileName?: string; note?: string; documentId?: string; stage?: "funding" | "post_close" }
/** Someone who personally guarantees the loan. Everyone owning 20% or more of the borrowing entity should be one. */
export interface Guarantor { name: string; ownershipPct: number; fico: number; citizenship: "us" | "resident" | "foreign" }
/** A deal the borrower says they've done. Staff check it against its settlement statement before it counts for pricing. */
export interface TrackDeal { id: string; address: string; kind: "flip" | "rental" | "build"; completed: string; purchasePrice: number; salePrice?: number; verified?: boolean }
export interface Declarations { bankruptcy: boolean; foreclosure: boolean; delinquent: boolean; judgments: boolean; lawsuit: boolean; felony: boolean; borrowedDownPayment: boolean; explanation: string }
/** Who stands behind a loan and their history (lib/credit.ts). */
export interface Sponsor { entityState: string; guarantors: Guarantor[]; trackRecord: TrackDeal[]; declarations: Declarations }
/** A credit officer's sign-off. Pricing then uses only the experience they verified. */
export interface CreditReview { by: string; at: string; note: string; verifiedDeals: number }
export interface Allocation { sourceId: string; amount: number }
/** When a loan moved into a stage. */
export interface StageEntry { status: LoanStatus; at: string }
export interface Deal {
  id: string; loanNumber: string; borrowerId: string; borrowerName: string; entityName: string;
  address: string; city: string; zip: string; app: Application; status: LoanStatus; daysInStage: number;
  capitalStatus: CapitalStatus; route?: "in_house" | "partner" | "split"; allocations: Allocation[];
  teaserSentTo: string[]; docs: Doc[]; source: string; contractorIsGtAffiliate?: boolean;
  disbursedDraws?: number; nextPaymentDue?: string; paymentsLate?: number; exitStrategy: string; closingDate: string;
  scope?: ScopeLine[]; scopeSummary?: string; brokerId?: string; brokerPoints?: number; termSheetSignedBy?: string; termSheetSignedAt?: string;
  /** Every term sheet sent, oldest first (Spec A9, B16). The borrower sees only the newest. */
  termSheets?: TermSheet[];
  /** What has to happen before the loan documents, before funding, and after closing (Spec A10, B17). */
  conditions?: LoanCondition[];
  /** Florida construction lien protections for draws (Fla. Stat. ch. 713): the contractor, the Notice of Commencement, notices to owner, insurance. */
  lienFile?: LienFile;
  /** When the application became complete, which starts Reg B's 30 days (12 CFR 1002.9(a)(1)). */
  completed?: { at: string; on: string; by: string };
  /** The borrowing business's gross revenue in its last fiscal year, which decides which notice rule applies (1002.9(a)(3)). */
  revenue?: { amount: number; year: number; by: string; at: string };
  /** The notice of a decline (Reg B adverse action), its deadline, and any written request for the reasons. */
  adverseAction?: AdverseAction;
  /** Keep this loan's records past the retention period: an investigation, enforcement or lawsuit is pending (1002.12(b)(4)). */
  legalHold?: { reason: string; by: string; at: string };
  /** Photos of the property sent with the quote, the application or from the portal. The files are encrypted Documents. */
  propertyPhotos?: { id: string; name: string; at: string; by: string }[];
  /** Pricing outside the matrix asked for by an underwriter, and an owner's answer (Spec A9). */
  pricingException?: PricingException;
  /** People who approved funding this loan. It always takes two different people (Spec 6, dual control). */
  fundingApprovers?: string[];
  sponsor?: Sponsor; creditReview?: CreditReview;
  /** Money received, in the order it was recorded. A reversed payment stays listed but no longer counts. */
  payments?: LoanPayment[];
  /** Each monthly payment's amount, fixed once it falls due, so a later draw doesn't change what an earlier month owed. */
  bills?: Bill[];
  waivedFees?: FeeWaiver[];
  /** Payments due before this date were paid before payments were recorded here. */
  boardedThrough?: string;
  /** The day lateness and maturity were last checked. The nightly job moves it forward. */
  servicedThrough?: string;
  /** Which maturity notices (days before) have gone out. */
  maturityNotices?: number[];
  /** Why an application was declined or withdrawn, and the stage it was in. Cleared if it's reopened. */
  closure?: Closure;
  /** Every default declared on the loan, oldest first. The last one is open until it's cured. */
  defaults?: DefaultCase[];
  extensions?: LoanExtension[];
  /** The money that paid the loan off, and the release of the mortgage after it. */
  paidOff?: Payoff;
  /** Who's closing the loan: the title company or closing attorney. */
  closing?: ClosingAgent;
  titleLink?: TitleLink;
  /** Wire instructions for funding, oldest first. Only the newest is live; a change replaces it and has to be verified again. */
  wires?: WireInstruction[];
  /** The verified wire the funding approvals were given on. A new wire clears them. */
  fundingWireId?: string;
  /** Sanctions (OFAC) screenings of the people and company on the loan, oldest first. */
  screenings?: Screening[];
  /** Each stage the loan moved into and when, oldest first. Loans started before this was kept begin partway through. */
  stages?: StageEntry[];
}
export interface ClosingAgent {
  company: string; contact: string; phone: string; email: string; fileNumber: string;
  /** The title company's word that the loan money reached its escrow account (Spec T3). */
  fundsReceived?: { amount: number; on: string; by: string; at: string };
  /** Where the mortgage was recorded, once it was. */
  recording?: { on: string; reference: string; by: string; at: string };
}
/** The title company's secure link (Spec T1–T3): who it went to and until when. The token itself is never kept. */
export interface TitleLink { sentTo: string; email: string; sentBy: string; sentAt: string; expiresAt: string; status: "open" | "off" }
export interface WireInstruction {
  id: string; bankName: string; routing: string; account: string; beneficiary: string; reference: string;
  /** How the instructions arrived. Never by email. */
  source: string;
  enteredBy: string; enteredAt: string;
  /** The call-back: a number found independently, not one printed on the instructions. */
  verification?: { by: string; at: string; phone: string; phoneSource: string; spokeWith: string };
  replaced?: { by: string; at: string };
}
export type ScreeningRole = "entity" | "borrower" | "guarantor";
export interface ScreeningHit { uid: number; name: string; type: string; program: string; score: number }
export interface Screening {
  id: string; at: string; by: string;
  /** When the same result was last confirmed, by a later check that found nothing new. */
  checkedAt: string;
  /** The sanctions list it was checked against: when it was downloaded, and how many names it had. */
  list: { fetchedAt: string; names: number };
  subjects: { name: string; role: ScreeningRole; hits: ScreeningHit[] }[];
  status: "clear" | "review" | "cleared" | "match";
  decided?: { by: string; at: string; reason: string };
}
/** A sent notice or statement: when, how, to whom, and how sending went. */
export interface NoticeSent { sentOn: string; sentAt: string; by: string; method: "email" | "mail"; to: string[]; result?: "sent" | "logged" | "failed" }
export interface AdverseAction {
  decidedAt: string; decidedOn: string;
  /** The principal reasons, specific (1002.9(b)(2)), at most four. */
  reasons: string[];
  /** Over $1 million in revenue: notice in a reasonable time, and the reasons only on a written request (1002.9(a)(3)(ii)). */
  large: boolean;
  dueOn: string;
  notice?: NoticeSent;
  /** The applicant's written request for the reasons, and when the statement is due. */
  request?: { receivedOn: string; by: string; at: string; dueOn: string };
  statement?: NoticeSent;
}
export interface Closure { outcome: "declined" | "withdrawn"; reason: string; note: string; by: string; at: string; from: LoanStatus }
export type DefaultKind = "monetary" | "maturity" | "covenant" | "insurance_lapse" | "tax_delinquency";
export interface DefaultCase { kind: DefaultKind; effectiveOn: string; note: string; by: string; at: string; cured?: { by: string; at: string; note: string } }
/** More time on a loan (Spec 8.4): asked for, approved by two people, then signed and paid for before the maturity moves. */
export interface LoanExtension {
  id: string; months: number; reason: string; requestedBy: string; requestedAt: string; fee: number;
  /** The maturity it extends from, fixed when it's asked for. */
  fromMaturity: string;
  status: "requested" | "approved" | "declined" | "executed"; approvers: string[];
  declined?: { by: string; at: string; reason: string };
  executed?: { by: string; at: string; on: string; method: PaymentMethod; reference: string };
}
export interface Payoff {
  amount: number; receivedOn: string; method: PaymentMethod; reference: string; by: string; at: string;
  /** What the payoff came to on the day it arrived. Anything over it is owed back to the borrower. */
  owed: number;
  /** Paid on a payoff letter that came to less than the payoff: the mortgage is released, and the rest is still owed. */
  letter?: { payoffId: string; number: number; total: number; shortfall: number };
  release?: { sentOn?: string; recordedOn?: string; reference: string; by: string };
}
export type PaymentMethod = "wire" | "ach" | "check" | "other";
export interface LoanPayment { id: string; amount: number; receivedOn: string; method: PaymentMethod; reference: string; by: string; at: string; reversed?: { by: string; at: string; reason: string } }
export interface Bill { due: string; amount: number }
export interface FeeWaiver { due: string; by: string; at: string; reason: string }
/** One division of a project's rehab or construction budget. Draws are requested against these. */
export interface ScopeLine { id: string; division: string; budget: number; released: number }
export interface DrawRequestLine { scopeId: string; requested: number; observedPct?: number }
export interface DrawRequest {
  id: string; dealId: string; requestedAt: string; by: string; note: string; contact: string; photos: string[]; lines: DrawRequestLine[];
  status: "submitted" | "inspecting" | "inspected" | "approved" | "funded" | "rejected"; approved?: number; approvers: string[]; reason?: string; fundedAt?: string; photoIds?: string[];
  /** Lien waivers sent for this draw (Fla. Stat. 713.20), and for the last draw the contractor's final payment affidavit (713.06(3)(d)). */
  waivers?: LienWaiver[]; affidavit?: FinalAffidavit;
  /** Marked as the last draw, which takes final waivers and the affidavit. A draw that uses up the holdback is the last anyway. */
  final?: boolean;
  /** An owner's release past the lien-law holds listed, with why. */
  override?: { by: string; at: string; reason: string; holds: string[] };
}
export interface LienFile {
  contractor?: string;
  noc?: { recordedOn: string; reference: string; expiresOn: string; commencedOn?: string; lenderNamed: boolean; mortgageFirst?: boolean; by: string; at: string };
  /** When the mortgage was recorded, if the title company's link didn't record it. */
  mortgageRecordedOn?: string;
  notices: NoticeToOwner[];
  insurance?: { kind: "builders_risk" | "hazard"; carrier: string; policy: string; expiresOn: string; by: string; at: string; remindedOn?: string; lapseNoticeOn?: string };
}
/** A notice to owner from a lienor not hired by the borrower directly (713.06(2)). Each one needs a waiver for every draw after it. */
export interface NoticeToOwner { id: string; lienor: string; role: "subcontractor" | "supplier" | "sub_subcontractor" | "other"; servedOn: string; by: string; at: string }
export interface LienWaiver {
  id: string; partyKey: string; party: string; kind: "progress" | "final"; fileName: string; documentId?: string; sentBy: string; sentAt: string;
  /** Checked against the statutory form: through what date and for how much, and whether it's conditional on the check clearing (713.20(7)). */
  checked?: { by: string; at: string; throughOn?: string; amount: number; conditional: boolean };
  rejected?: { by: string; at: string; reason: string };
}
export interface FinalAffidavit { fileName: string; documentId?: string; sentBy: string; sentAt: string; checked?: { by: string; at: string; unpaidLienors: boolean } }
export interface RequestPhoto { id: string; scopeId: string; shot: string; name: string; at: string; takenAt?: string; lat?: number; lng?: number }
export interface PhotoRequest { id: string; dealId: string; drawId?: string; to: string; email?: string; who: "contractor" | "borrower"; scopeIds: string[]; sentBy: string; byTeam?: boolean; sentAt: string; expiresAt: string; status: "open" | "received" | "off"; finishedAt?: string; finishedBy?: string; note?: string; photos: RequestPhoto[] }
export type ConditionCategory = "prior_to_docs" | "prior_to_funding" | "post_closing";
export type ConditionOwner = "borrower" | "processor" | "underwriter" | "title";
/** A standard condition in the library (Spec A23). Loans get the ones for their product when they start clearing conditions. */
export interface ConditionTemplate {
  id: string; title: string; detail: string; category: ConditionCategory; owner: ConditionOwner; needsUpload: boolean;
  /** The products it applies to; empty means all. */
  products: Product[];
  /** Days from being added to when it's due. */
  dueDays: number; active: boolean; version: number; updatedBy: string; updatedAt: string;
}
export interface LoanCondition {
  id: string; templateId?: string; title: string; detail: string; category: ConditionCategory; owner: ConditionOwner; needsUpload: boolean;
  dueOn?: string; status: "open" | "submitted" | "cleared" | "waived"; addedBy: string; addedAt: string;
  files: { documentId?: string; fileName: string; at: string; by: string }[];
  /** Sent back to open, with what was wrong. */
  returned?: { by: string; at: string; reason: string };
  cleared?: { by: string; at: string; note: string };
  waived?: { by: string; at: string; reason: string };
}
/** What a term sheet offers, fixed when it's sent. */
export interface TermSheetTerms {
  noteAmount: number; initialAdvance: number; holdback: number; financedReserve: number;
  rate: number; pointsPct: number; points: number; lenderFees: number; termMonths: number; monthlyPayment: number; cashToClose: number;
  interestReserve: "none" | "financed"; accrual: "full_boat" | "dutch"; prepay: string;
}
/** An exception to the pricing matrix: the rate and points asked for, why they're outside it, and who approved them. */
export interface PricingException {
  rate: number; points: number; termMonths: number; reasons: string[]; note: string; requestedBy: string; requestedAt: string;
  status: "pending" | "approved" | "declined"; decidedBy?: string; decidedAt?: string; decision?: string;
}
export interface TermSheet {
  version: number; issuedAt: string; issuedOn: string; issuedBy: string;
  /** The last day it can be accepted. */
  expiresOn: string;
  status: "sent" | "accepted" | "changes_requested" | "declined" | "expired" | "superseded";
  pricingVersion: string; terms: TermSheetTerms;
  /** The matrix's room for this loan when it was sent, and the approved exception if it went outside it. */
  matrix: { rate: [number, number]; points: [number, number] };
  exception?: PricingException;
  /** What was still needed from the borrower when it was sent. */
  conditions: string[];
  /** The day the borrower was reminded it's about to expire. */
  remindedOn?: string;
  response?: { at: string; by: string; signedName?: string; note?: string };
}
/** How a payoff request arrived, which decides the day it counts as received (Fla. Stat. 701.04(1)(f)). */
export type PayoffChannel = "portal" | "web_form" | "email" | "fax" | "mail" | "courier";
/** One payoff letter (an estoppel letter in the statute's words): the figures as of the day it was issued, good through a date. */
export interface PayoffLetter {
  number: number; issuedAt: string; issuedOn: string; issuedBy: string; goodThrough: string;
  principal: number; accrued: number; defaultAccrued: number; fees: number; credit: number; perDiem: number; total: number;
  rate: number; interestFrom: string; interestDays: number; defaultRate?: number; defaultFrom?: string; defaultDays?: number;
  /** The letter this one corrects or brings forward, and why. */
  replaces?: number; reason?: string;
  delivery?: { to: string[]; result: "sent" | "logged" | "failed"; at: string };
}
export interface PayoffRequest {
  id: string; dealId: string; goodThrough: string;
  /** The estimate when it was asked for. The letters hold the figures that count. */
  principal: number; accrued: number; defaultAccrued?: number; fees?: number; credit?: number; perDiem: number; total: number;
  requestedAt: string; by: string; status: "requested" | "sent" | "paid" | "refused";
  /** The day it counts as received, which starts the 10 days. Requests from before this was kept use requestedAt. */
  receivedOn?: string; channel?: PayoffChannel;
  /** Who asked and where the letter goes. A request from the borrower's portal has no email: it goes to their sign-in. */
  requester?: { kind: "borrower" | "title" | "other"; name: string; company?: string; email?: string; phone?: string; fileNumber?: string };
  /** What has to be checked before a letter goes out: someone else's written authority, or that it's really the borrower. */
  check?: { status: "pending" | "accepted"; note: string; documentId?: string; fileName?: string; by?: string; at?: string };
  loggedBy?: string; note?: string;
  letters?: PayoffLetter[];
  refused?: { by: string; at: string; reason: string };
}
export interface LoanMessage { id: string; dealId: string; from: string; side: "team" | "borrower" | "broker" | "internal"; text: string; at: string }
export interface Broker { id: string; name: string }
export interface CapitalSource { id: string; name: string; type: "gt_balance_sheet" | "gt_credit_line" | "partner_lender"; commitment: number; baseDeployed: number; baseUnfunded: number; lineUndrawn?: number; orgId?: string }
export interface Partner { id: string; name: string; ndaSigned: boolean; buyBox: BuyBox }
export interface Bid { id: string; dealId: string; partnerId: string; pct: number; lenderRate: number; lenderPoints: number; conditions: string; status: "submitted" | "accepted" | "declined" | "withdrawn"; type: "bid" | "accept_as_offered"; at: string }
/** A firm that buys funded loans from LendHous. Partner lenders fund deals before closing; these buy them after. */
export interface LoanBuyer { id: string; name: string; ndaSigned: boolean; buyBox: BuyBox }
/** A funded loan LendHous has put up for sale. Prices are a percent of the unpaid balance (100 = par). */
export interface LoanSale { id: string; dealId: string; askPct: number; listedAt: string; status: "listed" | "sold" | "withdrawn"; soldTo?: string; soldPct?: number; soldAt?: string }
export interface LoanOffer { id: string; saleId: string; buyerId: string; pricePct: number; note: string; atAsk: boolean; status: "submitted" | "accepted" | "declined"; at: string }

export const BORROWER_ID = "b-alex";
/** The partner organization the demo partner seat (pia.partner@lendhous.test) acts for. */
export const DEMO_PARTNER_ID = "p-a";
/** The firm the demo buyer seat (bella.buyer@lendhous.test) acts for. */
export const DEMO_BUYER_ID = "buy-a";
/** The brokerage the demo broker seat (bea.broker@lendhous.test) acts for. */
export const DEMO_BROKER_ID = "brk-a";

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
    app: flip({ county: "Miami-Dade", purchasePrice: 1_150_000, rehab: 450_000, arv: 2_300_000, fico: 770, verifiedDeals: 14, liquidity: 600_000, valuationSource: "appraisal" }), status: "conditions", daysInStage: 5, capitalStatus: "teaser_out", allocations: [], teaserSentTo: ["p-a", "p-b"], docs: stdDocs({ bank: "accepted" }), exitStrategy: "Sell", closingDate: "2026-11-06", brokerId: DEMO_BROKER_ID, brokerPoints: 1 },
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
    app: { ...flip({}), product: "dscr", purchasePrice: 420_000, rehab: 0, arv: 420_000, monthlyRent: 3_900, taxesAnnual: 7_200, insuranceAnnual: 5_400, fico: 758, verifiedDeals: 6, liquidity: 180_000, occupancy: "tenant", valuationSource: "appraisal" }, status: "servicing_current", daysInStage: 240, capitalStatus: "funded", route: "in_house", allocations: [{ sourceId: "gt-main", amount: 0 }], teaserSentTo: [], docs: fundedDocs, nextPaymentDue: "2026-11-01", exitStrategy: "Hold", closingDate: "2026-02-20", brokerId: DEMO_BROKER_ID, brokerPoints: 1 },
  { id: "d11", loanNumber: "LH-DEMO-1011", borrowerId: "b-avery", borrowerName: "Avery Mock (FAKE)", entityName: "Mock Bridge Partners LLC (FAKE)", address: "1200 Pretend Ave", city: "Miami", zip: "33130", source: "referral",
    app: { ...flip({}), product: "bridge", county: "Miami-Dade", purchasePrice: 620_000, rehab: 0, arv: 620_000, fico: 731, verifiedDeals: 5, liquidity: 260_000, valuationSource: "appraisal" }, status: "servicing_current", daysInStage: 120, capitalStatus: "funded", route: "in_house", allocations: [{ sourceId: "gt-main", amount: 0 }], teaserSentTo: [], docs: fundedDocs, nextPaymentDue: "2026-11-01", exitStrategy: "Refi", closingDate: "2026-06-30" },
  { id: "d12", loanNumber: "LH-DEMO-1012", borrowerId: "b-blake", borrowerName: "Blake Notreal (FAKE)", entityName: "Notreal Builders LLC (FAKE)", address: "8 Fiction Pt", city: "Delray Beach", zip: "33444", source: "referral",
    app: { ...flip({}), product: "ground_up", county: "Palm Beach", purchasePrice: 300_000, landValue: 300_000, hardCosts: 640_000, softCosts: 70_000, rehab: 710_000, arv: 1_450_000, groundUpBuilds: 3, verifiedDeals: 10, fico: 724, liquidity: 320_000, valuationSource: "appraisal" }, status: "servicing_current", daysInStage: 200, capitalStatus: "funded", route: "in_house", allocations: [{ sourceId: "gt-main", amount: 0 }], teaserSentTo: [], docs: fundedDocs, disbursedDraws: 290_000, nextPaymentDue: "2026-11-01", exitStrategy: "Sell", closingDate: "2026-04-08" },
  { id: "d13", loanNumber: "LH-DEMO-1013", borrowerId: "b-kai", borrowerName: "Kai Placeholder (FAKE)", entityName: "Placeholder Homes LLC (FAKE)", address: "39 Invented Ter", city: "Lauderhill", zip: "33313", source: "web_quote",
    app: flip({ purchasePrice: 230_000, rehab: 70_000, arv: 400_000, fico: 684, verifiedDeals: 2, liquidity: 70_000, valuationSource: "appraisal" }), status: "servicing_delinquent", daysInStage: 33, capitalStatus: "funded", route: "in_house", allocations: [{ sourceId: "gt-main", amount: 0 }], teaserSentTo: [], docs: fundedDocs, disbursedDraws: 55_000, nextPaymentDue: "2026-10-01", paymentsLate: 2, exitStrategy: "Sell", closingDate: "2026-03-17" },
  { id: "d14", loanNumber: "LH-DEMO-1014", borrowerId: "b-rowan", borrowerName: "Rowan Demo (FAKE)", entityName: "Rowan Renovations LLC (FAKE)", address: "250 Sample Shore Dr", city: "Deerfield Beach", zip: "33441", source: "wholesale",
    app: flip({ purchasePrice: 290_000, rehab: 85_000, arv: 520_000, fico: 736, verifiedDeals: 5, liquidity: 130_000, valuationSource: "appraisal" }), status: "servicing_current", daysInStage: 280, capitalStatus: "funded", route: "in_house", allocations: [{ sourceId: `buyer:${DEMO_BUYER_ID}`, amount: 0 }], teaserSentTo: [], docs: fundedDocs, disbursedDraws: 85_000, nextPaymentDue: "2026-11-01", exitStrategy: "Sell", closingDate: "2026-01-15" },
  { id: "d15", loanNumber: "LH-DEMO-1015", borrowerId: "b-emery", borrowerName: "Emery Testcase (FAKE)", entityName: "Testcase Holdings LLC (FAKE)", address: "16 Mock Canal Rd", city: "Fort Lauderdale", zip: "33301", source: "broker",
    app: { ...flip({}), product: "bridge", purchasePrice: 395_000, rehab: 0, arv: 395_000, fico: 718, verifiedDeals: 4, liquidity: 140_000, valuationSource: "appraisal" }, status: "closing", daysInStage: 1, capitalStatus: "committed", route: "in_house", allocations: [{ sourceId: "gt-main", amount: 0 }], teaserSentTo: [], docs: stdDocs({ ein: "accepted", sow: "waived", bank: "accepted", insurance: "accepted", track: "accepted" }), exitStrategy: "Refi", closingDate: "2026-11-03", brokerId: DEMO_BROKER_ID, brokerPoints: 0.75 },
  { id: "d16", loanNumber: "LH-DEMO-1016", borrowerId: "b-harper", borrowerName: "Harper Mockup (FAKE)", entityName: "Mockup Homes LLC (FAKE)", address: "904 Nowhere Pl", city: "Sunrise", zip: "33322", source: "web_quote",
    app: flip({ purchasePrice: 275_000, rehab: 60_000, arv: 470_000, fico: 712, verifiedDeals: 3, liquidity: 90_000 }), status: "submitted", daysInStage: 0, capitalStatus: "not_started", allocations: [], teaserSentTo: [], docs: stdDocs({ id: "requested", entity: "requested", contract: "uploaded", sow: "requested" }), exitStrategy: "Sell", closingDate: "2026-12-05" },
  { id: "d17", loanNumber: "LH-DEMO-1017", borrowerId: "b-logan", borrowerName: "Logan Fakename (FAKE)", entityName: "Fakename Flips LLC (FAKE)", address: "51 Sample Bay Dr", city: "Margate", zip: "33063", source: "wholesale",
    app: flip({ purchasePrice: 245_000, rehab: 65_000, arv: 440_000, fico: 727, verifiedDeals: 4, liquidity: 110_000, valuationSource: "appraisal" }), status: "funded", daysInStage: 8, capitalStatus: "funded", route: "in_house", allocations: [{ sourceId: "gt-main", amount: 0 }], teaserSentTo: [], docs: fundedDocs, nextPaymentDue: "2026-11-01", exitStrategy: "Sell", closingDate: "2026-10-20" },
  { id: "d18", loanNumber: "LH-DEMO-1018", borrowerId: BORROWER_ID, borrowerName: "Alex Sample (FAKE)", entityName: "Sample Flips LLC (FAKE)", address: "18 Sample Loop", city: "Davie", zip: "33314", source: "web_quote",
    app: { ...flip({}), product: "bridge", purchasePrice: 350_000, rehab: 0, arv: 350_000, fico: 735, verifiedDeals: 4, liquidity: 120_000, valuationSource: "appraisal" }, status: "term_sheet_issued", daysInStage: 1, capitalStatus: "not_started", allocations: [], teaserSentTo: [], docs: stdDocs({ sow: "waived" }), exitStrategy: "Refi", closingDate: "2026-11-21" },
];

// Borrower profiles for two of the demo loans waiting on credit review: what a full application leaves behind.
const demoTrack = (count: number, builds: number, verified: number) => Array.from({ length: count }, (_, index) => ({ id: `t${index + 1}`, address: `${100 + index * 7} Demo Track Rd (FAKE)`, kind: (index < builds ? "build" : "flip") as "build" | "flip", completed: `202${5 + Math.floor(index / 6)}-${String((index % 6) * 2 + 1).padStart(2, "0")}`, purchasePrice: 220_000 + index * 15_000, salePrice: 330_000 + index * 20_000, verified: index < verified }));
export const DEMO_SPONSORS: Record<string, Sponsor> = {
  d5: { entityState: "FL", guarantors: [{ name: "Riley Placeholder (FAKE)", ownershipPct: 60, fico: 705, citizenship: "us" }, { name: "Sky Sample (FAKE)", ownershipPct: 40, fico: 742, citizenship: "us" }], trackRecord: demoTrack(8, 2, 5), declarations: { bankruptcy: false, foreclosure: false, delinquent: false, judgments: false, lawsuit: false, felony: false, borrowedDownPayment: false, explanation: "" } },
  d6: { entityState: "FL", guarantors: [{ name: "Morgan Mockup (FAKE)", ownershipPct: 100, fico: 668, citizenship: "us" }], trackRecord: demoTrack(1, 0, 0), declarations: { bankruptcy: false, foreclosure: false, delinquent: false, judgments: false, lawsuit: true, felony: false, borrowedDownPayment: false, explanation: "A dispute with a former contractor over a 2025 job. Settled in August; the agreement is uploaded. (FAKE)" } },
};

export const capitalSources: CapitalSource[] = [
  { id: "gt-main", name: "LendHous Balance Sheet: Fund A (FAKE)", type: "gt_balance_sheet", commitment: 7_500_000, baseDeployed: 900_000, baseUnfunded: 120_000 },
  { id: "gt-line", name: "LendHous Credit Line (FAKE)", type: "gt_credit_line", commitment: 1_500_000, baseDeployed: 600_000, baseUnfunded: 0, lineUndrawn: 900_000 },
];

export const loanBuyers: LoanBuyer[] = [
  { id: DEMO_BUYER_ID, name: "Harbor Note Fund (FAKE)", ndaSigned: true, buyBox: { products: ["fix_flip", "bridge", "dscr", "ground_up"], states: ["FL", "GA"], minLoan: 150_000, maxLoan: 1_500_000, maxLTARV: 0.72, minFico: 680, minTier: 1, targetYield: 9 } },
  { id: "buy-b", name: "Sample Whole Loan Capital (FAKE)", ndaSigned: true, buyBox: { products: ["bridge", "dscr"], states: ["FL"], minLoan: 200_000, maxLoan: 2_000_000, maxLTV: 0.75, minFico: 700, minTier: 1, targetYield: 8 } },
];

export const seedLoanSales: LoanSale[] = [
  { id: "s-d9", dealId: "d9", askPct: 99.5, status: "listed", listedAt: "2026-10-12" },
  { id: "s-d10", dealId: "d10", askPct: 101, status: "listed", listedAt: "2026-10-05" },
  { id: "s-d11", dealId: "d11", askPct: 99, status: "listed", listedAt: "2026-10-14" },
  { id: "s-d12", dealId: "d12", askPct: 98.5, status: "listed", listedAt: "2026-10-09" },
  { id: "s-d13", dealId: "d13", askPct: 93, status: "listed", listedAt: "2026-10-16" },
  { id: "s-d14", dealId: "d14", askPct: 99.5, status: "sold", soldTo: DEMO_BUYER_ID, soldPct: 99.25, soldAt: "2026-08-18", listedAt: "2026-08-03" },
];

export const brokers: Broker[] = [{ id: DEMO_BROKER_ID, name: "Demo Brokerage (FAKE)" }];

// What a finished photo link looks like. The demo keeps no files, so these show as placeholders.
export const seedPhotoRequests: PhotoRequest[] = [
  { id: "photos-1", dealId: "d2", drawId: "draw-1", to: "Mo Mock Builders (FAKE)", who: "contractor", scopeIds: ["kitchen", "flooring"], sentBy: "Olivia Owner at LendHous", byTeam: true, sentAt: "2026-10-20T10:00:00-07:00", expiresAt: "2030-01-01T10:00:00-07:00", status: "received", finishedAt: "2026-10-20T15:40:00-07:00", finishedBy: "Mo Mock (FAKE)", note: "Appliances arrive next week.", photos: [
    { id: "demo-front", scopeId: "property", shot: "front", name: "front.jpg", at: "2026-10-20T15:31:00-07:00" },
    { id: "demo-kitchen", scopeId: "kitchen", shot: "room", name: "kitchen.jpg", at: "2026-10-20T15:34:00-07:00" },
    { id: "demo-cabinets", scopeId: "kitchen", shot: "cabinets", name: "cabinets.jpg", at: "2026-10-20T15:35:00-07:00" },
    { id: "demo-floors", scopeId: "flooring", shot: "rooms", name: "floors.jpg", at: "2026-10-20T15:38:00-07:00" },
  ] },
];

export const seedDraws: DrawRequest[] = [
  { id: "draw-1", dealId: "d2", requestedAt: "2026-10-20T09:15:00-07:00", by: "Alex Sample (FAKE)", note: "Cabinets are in and the flooring is down.", contact: "Alex Sample, (555) 010-0100", photos: ["kitchen-cabinets.jpg", "new-flooring.jpg"], lines: [{ scopeId: "kitchen", requested: 12_000 }, { scopeId: "flooring", requested: 8_000 }], status: "submitted", approvers: [] },
  { id: "draw-2", dealId: "d9", requestedAt: "2026-10-18T11:30:00-07:00", by: "Quinn Sample (FAKE)", note: "Rough plumbing and electrical passed city inspection.", contact: "Quinn Sample, (555) 010-0109", photos: ["rough-plumbing.jpg", "panel.jpg"], lines: [{ scopeId: "plumbing", requested: 5_000 }, { scopeId: "electrical", requested: 5_000 }], status: "inspecting", approvers: [] },
  { id: "draw-3", dealId: "d12", requestedAt: "2026-10-15T08:45:00-07:00", by: "Blake Notreal (FAKE)", note: "Framing is finished and mechanicals are mostly roughed in.", contact: "Blake Notreal, (555) 010-0112", photos: ["framing-north.jpg", "framing-south.jpg", "ductwork.jpg"], lines: [{ scopeId: "framing", requested: 80_000, observedPct: 0.9 }, { scopeId: "mechanical", requested: 40_000, observedPct: 0.7 }], status: "inspected", approvers: ["Cam Capital (FAKE)"] },
  { id: "draw-4", dealId: "d13", requestedAt: "2026-10-21T14:10:00-07:00", by: "Kai Placeholder (FAKE)", note: "Bathrooms are done.", contact: "Kai Placeholder, (555) 010-0113", photos: ["bathroom.jpg"], lines: [{ scopeId: "bathrooms", requested: 2_500 }], status: "submitted", approvers: [] },
];

export const seedMessages: LoanMessage[] = [
  { id: "msg-1", dealId: "d1", from: "Pat Processor (FAKE)", side: "team", text: "Thanks for the purchase contract. We still need your two most recent bank statements.", at: "2026-10-16T10:02:00-07:00" },
  { id: "msg-2", dealId: "d1", from: "Alex Sample (FAKE)", side: "borrower", text: "I'll upload them today.", at: "2026-10-16T10:40:00-07:00" },
  { id: "msg-3", dealId: "d3", from: "Bea Broker (FAKE)", side: "broker", text: "My client can close as early as November 6 if the appraisal review comes back clean.", at: "2026-10-15T16:20:00-07:00" },
  { id: "msg-4", dealId: "d3", from: "Uma Underwriter (FAKE)", side: "team", text: "Understood. The review is with the desk now.", at: "2026-10-16T09:05:00-07:00" },
  { id: "msg-5", dealId: "d18", from: "Uma Underwriter (FAKE)", side: "team", text: "Your term sheet is ready. Please review it and accept it here.", at: "2026-10-17T13:30:00-07:00" },
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
  { code: "declined", label: "Declined" }, { code: "withdrawn", label: "Withdrawn" },
];
export const borrowerTimeline = ["Submitted", "Underwriting", "Term Sheet", "Conditions", "Clear to Close", "Funded"];
export function timelineIndex(s: LoanStatus) {
  const m: Record<string, number> = { submitted: 0, initial_review: 1, underwriting: 1, term_sheet_issued: 2, term_sheet_accepted: 3, conditions: 3, clear_to_close: 4, closing: 4 };
  return m[s] ?? 5;
}
