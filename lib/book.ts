// The loan book's rules: one set of records and one reducer, with no React and no database. Demo seats and sample data
// run it in the browser; real accounts run it on the server (lib/book-store.ts), after lib/book-access.ts checks them.
import { AGENT_LABEL, type AgentInput, type AgentRole } from "./borrower-docs";
import { CONFIDENCE, EXIT_CHOICES, exitPlanProblem, type ExitPlan } from "./exit-plans";
import { evaluate, fundedBalances, round2, type Application, type BuyBox } from "./engine";
import { countedDeals, missingDocs, needsList, withSponsor } from "./credit";
import { approversNeeded, approvalError, defaultScope, drawRequestError, releaseToScope, reviewDraw } from "./draws";
import { applyChange, changeOrderProblem } from "./budget";
import { activeWire, fundsProblem, missingClosingItems, recordingProblem, verifyProblem, wireProblem } from "./closing";
import { latestScreening, ofacBlocker, sameResult, screeningSubjects } from "./ofac";
import { carryOverDocs, carryOverTrackRecord, earlierLoans, repeatHistory, trackDocCarried } from "./repeat-borrower";
import { referralCodeFor, referralHolds } from "./brokers";
import { DEMO_BONUS, type MyReferral } from "./referrals";
import { surveyProblem } from "./surveys";
import { cureError, defaultError, executeError, extensionFee, extensionRequestError, payoffError, payoffOn, PRE_FUNDING, reopenTo, closureReason, DEFAULT_KINDS } from "./loan-exits";
import { canAdvance, nextStage } from "./loan-stages";
import { modificationPreview, modificationWords, proposalProblem, signProblem } from "./modifications";
import { reuseProblem } from "./doc-sorting";
import { deskProblem, deskReviewProblem, drawFees, toSend, type DrawPath } from "./draw-review";
import { ADVANCE_KINDS, BANKRUPTCY_ENDS, COLLECTIONS, DELIVERY_METHODS, inBankruptcy, NOTICE_KINDS, owedAtTitle, stepLabel, stepProblem } from "./collections";
import { issueProblem, latestLetter, letterFigures, receivedOnFor } from "./payoffs";
import { isLarge, noticeDueOn, noticeOwed, reasonsProblem, requestProblem, startAdverseAction, STATEMENT_DAYS } from "./adverse-action";
import { defaultNocExpiry, drawHolds, lienFileProblem, partiesFor, unreleasedHolds, waiverCheckProblem } from "./lien-law";
import { insuranceChecks, insuranceFileOf, policiesOf, policyProblem, policyWord, putPolicy, renewalProblem, withInsurance } from "./insurance";
import { addProblem, changeProblem, DEFAULT_LIBRARY, fromTemplate, libraryOf, missingStandard, templateProblem, templatesFor, type ConditionInput } from "./conditions";
import { chosenTerms, draftSheet, exceptionDecisionProblem, exceptionReasons, exceptionRequestProblem, issueProblem as sheetProblem, latestSheet, matrixOf, pricedApp, respondProblem, startingTerms, termSheetChecks, type Prepay } from "./term-sheets";
import { optionAt } from "./buy-down";
import { DEMO_TEAM, seedDeals, seedBids, seedDraws, seedLoanSales, seedLoanOffers, seedMessages, seedPhotoRequests, DEMO_SPONSORS, capitalSources, partners as seedPartners, brokers as seedBrokers, loanBuyers, BORROWER_ID, DEMO_PARTNER_ID, DEMO_BUYER_ID, DEMO_BROKER_ID, type Broker, type ClosingAgent, type Closure, type Deal, type DefaultKind, type Bid, type DrawRequest, type DrawRequestLine, type DrawPhoto, type DrawCall, type FloodMap, type PortfolioProperty, type PropertyRelease, type RolloverChoice, type ShareTransfer, type LoanExtension, type LoanMessage, type Screening, type WireInstruction, type Partner, type PayoffChannel, type PayoffLetter, type PayoffRequest, type NoticeToOwner, type LienWaiver, type ConditionTemplate, type LoanCondition, type DocStatus, type CapitalSource, type LoanBuyer, type LoanOffer, type LoanSale, type LoanPayment, type LoanStatus, type TeamMember, type PaymentMethod, type PhotoRequest, type RequestPhoto, type ScopeLine, type Sponsor, type StageEntry, type PolicyKind, type InsurancePolicy, type InsuranceRenewal, type ChangeOrder, type AdvanceKind, type Bankruptcy, type ContactChannel, type ContactOutcome, type DeliveryMethod, type ForeclosureStep, type LoanModification, type NoticeKind, type Payoff } from "./mockData";
import { closingShare, creditOf, currentBids, drawCallsFor, moveShare, payoffProceeds, ROLLOVER, transferProblem, transferQuote } from "./capital-moves";
import { portfolioApp, releaseQuote, scheduleProblem } from "./portfolio";
import { applyFloodMap, withFloodFollowUps } from "./flood-zones";
import { afterCheck, freshInspectionNeeded, type StormCheck, type StormWatch } from "./storms";
import { BASE_VERSION, currentPricing, type PricingPayload } from "./pricing-versions";
import { TEAM_ROLE_LABEL, type TeamRole } from "./loan-team";
import { addDays, balanceOf, DEMO_SERVICING_DAY, firstDueDate, ledger, maturityOf, openDefault, paymentsMade, payoffFor, recastPayment, SERVICED, servicingDate, settle } from "./servicing";

export interface Book { partnerId: string; buyerId: string; brokerId: string; borrowerId: string; loanPrefix: string; deals: Deal[]; bids: Bid[]; partners: Partner[]; buyers: LoanBuyer[]; brokers: Broker[]; sales: LoanSale[]; offers: LoanOffer[]; draws: DrawRequest[]; photoRequests: PhotoRequest[]; payoffs: PayoffRequest[]; messages: LoanMessage[]; sources: CapitalSource[]; conditionLibrary: ConditionTemplate[]; /** Storms whose forecast cone has covered funded loans (lib/storms.ts). Staff only. */ storms: StormWatch[]; audit: { at: string; text: string }[]; sample?: boolean; /** A borrower's own referrals, summed up for them: friends' loans are never in their book (lib/referrals.ts). */ myReferrals?: MyReferral[]; /** The pricing its loans use, as sent to a browser. Not part of the records. */ pricing?: PricingPayload }

export type BookAction =
  /** clientFills: a broker's client fills in their own guarantors, past deals and credit answers on an application link. */
  | { t: "submitApp"; app: Application; address: string; city: string; zip: string; entityName: string; exitStrategy: string; closingDate?: string; client?: { name: string; borrowerId?: string; brokerId?: string; brokerPoints?: number }; source?: string; sponsor?: Sponsor; refinances?: string; clientFills?: boolean }
  | { t: "setExitPlan"; dealId: string; plan: Omit<ExitPlan, "by" | "at">; by: string }
  | { t: "saveSponsor"; dealId: string; sponsor: Sponsor }
  /** A signed borrower application, applied to a loan already started. Only the server does it, from the signed link. */
  | { t: "applyBorrowerInfo"; dealId: string; app: Application; address: string; city: string; zip: string; entityName: string; exitStrategy: string; sponsor: Sponsor; signedBy: string }
  | { t: "verifyTrackDeal"; dealId: string; trackId: string; verified: boolean }
  | { t: "signOffCredit"; dealId: string; by: string; note: string }
  | { t: "reopenCreditReview"; dealId: string }
  | { t: "advanceLoan"; dealId: string }
  /** Moves an application not yet given a term sheet onto the pricing new quotes use. */
  | { t: "repriceLoan"; dealId: string; by: string }
  | { t: "approveFunding"; dealId: string; by: string }
  | { t: "saveClosing"; dealId: string; closing: ClosingAgent }
  | { t: "enterWire"; dealId: string; wireId: string; bankName: string; routing: string; account: string; beneficiary: string; reference: string; source: string; by: string }
  | { t: "addClosingChecklist"; dealId: string }
  /** The title company's link was made (by the server, which keeps only the token's hash) or turned off. */
  | { t: "openTitleLink"; dealId: string; sentTo: string; email: string; sentBy: string; expiresAt: string }
  | { t: "turnOffTitleLink"; dealId: string }
  /** From the title company's link: the money arrived in escrow, and where the mortgage was recorded. */
  | { t: "titleFundsReceived"; dealId: string; amount: number; on: string; by: string }
  | { t: "titleRecording"; dealId: string; on: string; reference: string; by: string }
  /** A screening against the sanctions list. Only the server makes one: it holds the list. */
  | { t: "recordScreening"; dealId: string; screening: Screening }
  | { t: "decideScreening"; dealId: string; screeningId: string; decision: "cleared" | "match"; reason: string; by: string }
  | { t: "verifyWire"; dealId: string; wireId: string; phone: string; phoneSource: string; spokeWith: string; by: string }
  | { t: "updateDealNumbers"; dealId: string; changes: Partial<Application> }
  | { t: "addDocRequest"; dealId: string; name: string; category: string }
  | { t: "linkBorrower"; dealId: string; borrowerId: string; borrowerName: string }
  /** The winning partner says it has wired its share; staff confirm it arrived in escrow (Spec P7). */
  | { t: "partnerFundsSent"; dealId: string; sentOn: string; reference: string; by: string }
  | { t: "partnerFundsReceived"; dealId: string; on: string; by: string }
  /** A brokerage signed the broker agreement (lib/brokers.ts). Only the server does it: it screens the firm and stores its files. */
  | { t: "brokerApplied"; brokerId: string; application: NonNullable<Broker["application"]>; screening?: Screening; docs: NonNullable<Broker["docs"]> }
  | { t: "brokerScreened"; brokerId: string; screening: Screening }
  | { t: "approveBroker"; brokerId: string; reason: string; by: string }
  | { t: "suspendBroker"; brokerId: string; reason: string; by: string }
  | { t: "brokerFeePaid"; dealId: string; amount: number; on: string; reference: string; by: string }
  /** A loan started from a lead that came by a broker's referral link. Only the server does it: it reads the lead. */
  | { t: "referLoan"; dealId: string; brokerId: string; on: string }
  /** How a brokerage shows on its quotes and term sheets, and the largest pre-qualification letter it may issue (lib/broker-program.ts). */
  | { t: "saveBrokerBrand"; brokerId: string; brand: { name: string; phone: string; email: string; website: string } }
  | { t: "setBrokerLetterLimit"; brokerId: string; limit: number; by: string }
  /** A loan started from a lead that came by a borrower's referral link, with the bonus Settings named that day. Server only. */
  | { t: "referFriend"; dealId: string; referrerId: string; on: string; bonus: number }
  | { t: "referralBonusPaid"; dealId: string; amount: number; on: string; reference: string; by: string }
  /** The borrower's 0 to 10 on how likely they are to recommend LendHous, at closing or payoff (lib/surveys.ts). */
  /** An update on a funded loan for its investors, and a workout declared or lifted (lib/investor-updates.ts). */
  /** The property's last recorded sale, for the price-jump check (lib/risk.ts). */
  /** The property's place on the map, found by the server (lib/geocode.ts). */
  | { t: "placeProperty"; dealId: string; lat: number; lng: number; propertyId?: string }
  /** A rental portfolio loan's properties (lib/portfolio.ts), and letting one go by paying its release price. */
  | { t: "saveProperties"; dealId: string; properties: Omit<PortfolioProperty, "geo" | "floodMap" | "released">[]; by: string }
  | { t: "releaseProperty"; dealId: string; propertyId: string; on: string; amount: number; reference: string; by: string }
  /** The capital side's moves (lib/capital-moves.ts): payoff money rolled or sent, a share moved mid-loan, draws funded as released. */
  | { t: "setRollover"; partnerId: string; choice: RolloverChoice; by: string }
  | { t: "sendProceeds"; partnerId: string; proceedsId: string; on: string; reference: string; by: string }
  | { t: "setFundsDraws"; partnerId: string; on: boolean }
  | { t: "transferShare"; dealId: string; from: string; to: string; on: string; rate?: number; by: string }
  | { t: "settleTransfer"; dealId: string; transferId: string; on: string; reference: string; by: string }
  | { t: "drawCallSent"; dealId: string; callId: string; on: string; reference: string; by: string }
  | { t: "drawCallReceived"; dealId: string; callId: string; on: string; by: string }
  /** FEMA's flood map at the property's point. Only the server asks FEMA (lib/property-facts.ts). */
  | { t: "recordFloodMap"; dealId: string; map: FloodMap; propertyId?: string }
  /** What NHC's latest forecast cones cover. Only the server reads NHC's files, or a demo seat its sample storm. */
  | { t: "recordStormCheck"; at: string; storms: StormCheck[] }
  | { t: "saveLastSale"; dealId: string; price: number; on: string; by: string }
  | { t: "postInvestorUpdate"; dealId: string; updateId: string; text: string; by: string }
  | { t: "setWorkout"; dealId: string; on: boolean; note: string; by: string }
  | { t: "answerSurvey"; dealId: string; stage: "funded" | "paid_off"; score: number; comment: string }
  | { t: "setBrokerPoints"; dealId: string; points: number }
  /** Puts someone on the loan as its officer or processor, or takes them off (null). Only the server does it: it looks the person up. */
  | { t: "assignLoanTeam"; dealId: string; role: TeamRole; member: TeamMember | null; by: string }
  | { t: "saveSource"; source: CapitalSource }
  | { t: "removeSource"; id: string }
  | { t: "saveFirm"; kind: "partner" | "buyer"; id: string; name: string; buyBox: BuyBox; principals?: string[] }
  /** A partner lender or loan buyer, its owners and its people, screened against the sanctions list. Only the server does it. */
  | { t: "firmScreened"; kind: "partner" | "buyer"; firmId: string; screening: Screening }
  /** Someone with clear_ofac decides a possible match on a partner, buyer or brokerage, with what they compared. */
  | { t: "decideFirmScreening"; kind: "partner" | "buyer" | "broker"; firmId: string; screeningId: string; decision: "cleared" | "match"; reason: string; by: string }
  /** points: one of the term sheet's rate-and-points choices (lib/buy-down.ts); without it, the terms as sent. */
  | { t: "acceptTermSheet"; dealId: string; signedName: string; points?: number }
  | { t: "addCondition"; dealId: string; condition: ConditionInput; by: string }
  | { t: "clearCondition"; dealId: string; conditionId: string; note: string; by: string }
  | { t: "returnCondition"; dealId: string; conditionId: string; reason: string; by: string }
  | { t: "waiveCondition"; dealId: string; conditionId: string; reason: string; by: string }
  /** A file sent in for a condition. The server records it once the file is stored; a demo browser keeps the name only. */
  | { t: "conditionFile"; dealId: string; conditionId: string; fileName: string; documentId?: string; by: string }
  /** A standard condition in the library, new or changed. Retiring one sets active to false; nothing is deleted. */
  | { t: "saveConditionTemplate"; template: Pick<ConditionTemplate, "title" | "detail" | "category" | "owner" | "needsUpload" | "products" | "dueDays" | "active" | "rental"> & { id?: string }; by: string }
  /** The underwriter's terms go out as the next version (Spec A9), setting the loan's rate and points. */
  | { t: "issueTermSheet"; dealId: string; rate: number; points: number; termMonths: number; prepay: Prepay; by: string }
  | { t: "requestPricingException"; dealId: string; rate: number; points: number; termMonths: number; prepay: Prepay; note: string; by: string }
  | { t: "decidePricingException"; dealId: string; approve: boolean; note: string; by: string }
  /** The borrower sends the term sheet back to underwriting with what they'd like changed. */
  | { t: "requestTermSheetChanges"; dealId: string; note: string; by: string }
  /** The nightly check: reminds borrowers of term sheets about to expire and expires the ones past their last day. */
  | { t: "checkTermSheets"; asOf: string }
  | { t: "saveScope"; dealId: string; scope: ScopeLine[]; summary: string }
  /** linePhotos: the photos taken line by line on the borrower's phone, with where and when (lib/draw-walk.ts). */
  | { t: "requestDraw"; dealId: string; by: string; note: string; contact: string; photos: string[]; photoIds?: string[]; lines: DrawRequestLine[]; linePhotos?: Omit<DrawPhoto, "id" | "at">[]; path?: DrawPath }
  /** The team's review of a photo-review draw from the borrower's photos (lib/draw-review.ts). */
  | { t: "deskReview"; drawId: string; observed: Record<string, number>; note: string; by: string }
  | { t: "askForPhotos"; requestId: string; dealId: string; drawId?: string; stormId?: string; to: string; email?: string; who: PhotoRequest["who"]; scopeIds: string[]; by: string; byTeam: boolean; expiresAt: string }
  | { t: "renewPhotoRequest"; requestId: string; expiresAt: string }
  | { t: "turnOffPhotoRequest"; requestId: string }
  | { t: "addRequestPhoto"; requestId: string; photo: RequestPhoto }
  | { t: "removeRequestPhoto"; requestId: string; photoId: string }
  /** signDraw: the contractor also signs off that the work on the draw's lines is done as the photos show. */
  | { t: "finishPhotoRequest"; requestId: string; by: string; note: string; signDraw?: boolean; observed?: Record<string, number> }
  | { t: "sendInspector"; drawId: string; reason?: string; by?: string }
  | { t: "recordInspection"; drawId: string; observed: Record<string, number> }
  | { t: "approveDrawRequest"; drawId: string; by: string }
  | { t: "rejectDraw"; drawId: string; reason: string }
  | { t: "releaseDraw"; drawId: string }
  /** Budget moved between a funded loan's lines (lib/budget.ts): asked for by the borrower or the team, decided by the team. */
  | { t: "requestChangeOrder"; dealId: string; orderId: string; from: string; to: string; newDivision?: string; amount: number; reason: string; arv?: number; by: string; byTeam: boolean }
  | { t: "decideChangeOrder"; dealId: string; orderId: string; approve: boolean; note: string; by: string }
  /** Work found at an inspection to cost more than its budget: the loan is out of balance until the borrower covers it. */
  | { t: "recordOverrun"; dealId: string; overrunId: string; amount: number; scopeId?: string; note: string; by: string }
  | { t: "coverOverrun"; dealId: string; overrunId: string; how: string; by: string }
  /** The loan's lien file: the contractor and the Notice of Commencement (Fla. Stat. 713.13). */
  | { t: "saveLienFile"; dealId: string; contractor: string; noc?: { recordedOn: string; reference: string; expiresOn: string; commencedOn?: string; lenderNamed: boolean; mortgageFirst?: boolean }; mortgageRecordedOn?: string; by: string }
  | { t: "addNoticeToOwner"; dealId: string; lienor: string; role: NoticeToOwner["role"]; servedOn: string; by: string }
  /** A policy on the property, put on file by the team (lib/insurance.ts). It replaces the one of its kind. */
  | { t: "saveInsurance"; dealId: string; kind: PolicyKind; carrier: string; policy: string; expiresOn: string; coverage?: number; windIncluded?: boolean; mortgagee?: boolean; citizens?: boolean; program?: "nfip" | "private"; by: string }
  /** Who insures a condo association's building (lib/florida-insurance.ts). */
  | { t: "saveAssociationPolicy"; dealId: string; carrier: string; citizens: boolean; by: string }
  /** Whether the property is in a special flood hazard area, which makes flood insurance required. */
  | { t: "setFloodZone"; dealId: string; sfha: boolean; zone: string; by: string }
  /** The borrower sent a renewed policy. The server records it once the file is stored; a demo browser keeps the name only. */
  | { t: "insuranceRenewal"; dealId: string; kind: PolicyKind; carrier: string; policy: string; expiresOn: string; fileName: string; documentId?: string; by: string }
  /** The team checked a renewal: accepted, it becomes the policy on file; sent back, the borrower sees why. */
  | { t: "decideRenewal"; dealId: string; renewalId: string; accept: boolean; mortgagee: boolean; windIncluded?: boolean; coverage?: number; note: string; by: string }
  /** A lien waiver or the final affidavit came in for a draw. The server records it once the file is stored; a demo browser keeps the name only. */
  | { t: "lienWaiverReceived"; drawId: string; partyKey: string; kind: "progress" | "final"; fileName: string; documentId?: string; by: string }
  | { t: "affidavitReceived"; drawId: string; fileName: string; documentId?: string; by: string }
  | { t: "checkLienWaiver"; drawId: string; waiverId: string; amount: number; throughOn?: string; conditional: boolean; by: string }
  | { t: "rejectLienWaiver"; drawId: string; waiverId: string; reason: string; by: string }
  | { t: "checkAffidavit"; drawId: string; unpaidLienors: boolean; by: string }
  | { t: "setFinalDraw"; drawId: string; final: boolean }
  /** An owner releases a draw past the lien-law holds standing now, with why. */
  | { t: "overrideDrawHolds"; drawId: string; reason: string; by: string }
  /** The nightly check: warns about policies lapsing within the notice period, and lapsed ones, once each. */
  | { t: "checkInsurance"; asOf: string }
  | { t: "recordPayment"; dealId: string; amount: number; receivedOn: string; method: PaymentMethod; reference: string; by: string }
  | { t: "reversePayment"; dealId: string; paymentId: string; reason: string; by: string }
  | { t: "waiveLateFee"; dealId: string; due: string; reason: string; by: string }
  /** The nightly check: brings every serviced loan up to a day. Only the server's job sends it. */
  | { t: "settleLoans"; asOf: string }
  | { t: "requestPayoff"; dealId: string; goodThrough: string; by: string }
  /** A written request that came by email, fax, mail or courier, logged by staff with the day it was sent. */
  | { t: "logPayoffRequest"; dealId: string; goodThrough: string; channel: "email" | "fax" | "mail" | "courier"; sentOn: string; requester: PayoffRequester; authorized: boolean; note: string; by: string }
  /** From the public payoff request form. Only the server makes one: it matched the loan and stored the authorization. */
  | { t: "submitPayoffRequest"; dealId: string; goodThrough: string; sentOn: string; requester: PayoffRequester; check?: NonNullable<PayoffRequest["check"]>; note: string }
  | { t: "acceptPayoffCheck"; payoffId: string; note: string; by: string }
  | { t: "refusePayoff"; payoffId: string; reason: string; by: string }
  | { t: "issuePayoffLetter"; payoffId: string; goodThrough: string; reason: string; by: string }
  /** How emailing a letter went. Only the server knows. */
  | { t: "payoffLetterDelivered"; payoffId: string; number: number; to: string[]; result: "sent" | "logged" | "failed" }
  /** onLetter: the payoff was paid on that letter, which may be less than the payoff that day (701.04(1)(c)3). */
  | { t: "recordPayoff"; dealId: string; amount: number; receivedOn: string; method: PaymentMethod; reference: string; by: string; onLetter?: { payoffId: string; number: number } }
  | { t: "recordLienRelease"; dealId: string; step: "sent" | "recorded"; on: string; reference: string; by: string }
  /** byTeam comes from the session, never the request: it decides who hears about it. */
  | { t: "closeApplication"; dealId: string; outcome: "declined" | "withdrawn"; reason: string; note: string; by: string; byTeam: boolean; revenue?: { amount: number; year: number } }
  /** Reg B (12 CFR 1002.9): the day the application became complete, the business's revenue, and the decline notice. */
  | { t: "markApplicationComplete"; dealId: string; on: string; by: string }
  | { t: "saveRevenue"; dealId: string; amount: number; year: number; by: string }
  | { t: "saveAdverseReasons"; dealId: string; reasons: string[]; by: string }
  /** The notice or statement went out. The server records it after emailing the PDF; a demo browser just marks it. */
  | { t: "recordAdverseNotice"; dealId: string; kind: "notice" | "statement"; method: "email" | "mail"; to: string[]; result?: "sent" | "logged" | "failed"; by: string }
  | { t: "recordReasonsRequest"; dealId: string; receivedOn: string; by: string }
  /** Photos of the property, listed on the loan once the server has stored them. Only the server adds them. */
  | { t: "addPropertyPhotos"; dealId: string; photos: { id: string; name: string; at: string }[]; by: string }
  | { t: "removePropertyPhoto"; dealId: string; photoId: string }
  | { t: "setShowcase"; dealId: string; on: boolean; by: string }
  /** Keeps the loan's records past retention while an investigation or lawsuit is pending. An empty reason lifts it. */
  | { t: "setLegalHold"; dealId: string; reason: string; by: string }
  | { t: "reopenApplication"; dealId: string; by: string }
  | { t: "declareDefault"; dealId: string; kind: DefaultKind; effectiveOn: string; note: string; by: string }
  | { t: "cureDefault"; dealId: string; note: string; by: string }
  | { t: "requestExtension"; dealId: string; months: number; reason: string; by: string; byTeam: boolean }
  | { t: "approveExtension"; dealId: string; extensionId: string; by: string }
  | { t: "declineExtension"; dealId: string; extensionId: string; reason: string; by: string }
  | { t: "executeExtension"; dealId: string; extensionId: string; on: string; method: PaymentMethod; reference: string; by: string }
  /** A workout's change to the loan's terms (lib/modifications.ts): proposed, approved by two people, then signed. */
  | { t: "proposeModification"; dealId: string; rate?: number; capitalize: boolean; waiveFees: boolean; months?: number; reason: string; by: string }
  | { t: "approveModification"; dealId: string; modificationId: string; by: string }
  | { t: "declineModification"; dealId: string; modificationId: string; reason: string; by: string }
  | { t: "signModification"; dealId: string; modificationId: string; on: string; reference: string; by: string }
  /** Collections (lib/collections.ts): calls and letters, promises to pay, notices and their delivery, bankruptcy, costs, foreclosure and REO. */
  | { t: "logContact"; dealId: string; on: string; channel: ContactChannel; with: string; outcome: ContactOutcome; note: string; by: string }
  | { t: "recordPromise"; dealId: string; amount: number; dueBy: string; note: string; by: string }
  | { t: "cancelPromise"; dealId: string; promiseId: string; reason: string; by: string }
  | { t: "logNotice"; dealId: string; kind: NoticeKind; sentOn: string; method: DeliveryMethod; to: string; tracking: string; amount: number; cureBy?: string; by: string }
  | { t: "noticeOutcome"; dealId: string; noticeId: string; outcome: "delivered" | "returned"; on: string; detail: string; by: string }
  | { t: "recordBankruptcy"; dealId: string; debtor: string; chapter: 7 | 11 | 13; caseNumber: string; court: string; filedOn: string; by: string }
  | { t: "bankruptcyClaimFiled"; dealId: string; bankruptcyId: string; on: string; by: string }
  | { t: "endBankruptcy"; dealId: string; bankruptcyId: string; on: string; how: NonNullable<Bankruptcy["ended"]>["how"]; by: string }
  | { t: "recordAdvance"; dealId: string; on: string; kind: AdvanceKind; amount: number; note: string; by: string }
  | { t: "advancesRepaid"; dealId: string; amount: number; on: string; reference: string; by: string }
  | { t: "referForeclosure"; dealId: string; attorney: string; on: string; by: string }
  | { t: "foreclosureStep"; dealId: string; step: ForeclosureStep; on: string; note: string; caseNumber?: string; county?: string; judgment?: { amount: number; saleOn: string }; sale?: { winner: "lendhous" | "third_party"; amount: number }; by: string }
  | { t: "stopForeclosure"; dealId: string; on: string; why: "dismissed" | "deed_in_lieu"; note: string; by: string }
  | { t: "saleProceeds"; dealId: string; amount: number; on: string; reference: string; by: string }
  | { t: "listReo"; dealId: string; on: string; price: number; value?: number; by: string }
  | { t: "sellReo"; dealId: string; on: string; price: number; closingCosts: number; reference: string; by: string }
  | { t: "sendMessage"; dealId: string; from: string; side: LoanMessage["side"]; text: string }
  | { t: "uploadDoc"; dealId: string; docId: string; fileName: string; documentId?: string }
  | { t: "docStatus"; dealId: string; docId: string; status: DocStatus; note?: string }
  | { t: "addOwnDoc"; dealId: string; docId: string; name: string; by: string }
  /** A document the borrower already sent on another of their loans, sent again for this one (lib/doc-sorting.ts). */
  | { t: "reuseDocument"; dealId: string; docId: string; fromDealId: string; by: string }
  | { t: "setAgent"; dealId: string; role: AgentRole; contact: AgentInput; by: string }
  | { t: "route"; dealId: string; route: "in_house" | "partner" | "split"; inHouseAmount: number }
  | { t: "sendTeaser"; dealId: string; partnerIds: string[] }
  | { t: "bid"; bid: Omit<Bid, "id" | "at" | "status"> }
  | { t: "acceptBid"; bidId: string }
  | { t: "commit"; dealId: string }
  | { t: "signNda"; partnerId: string }
  | { t: "signBuyerNda"; buyerId: string }
  | { t: "listLoan"; dealId: string; askPct: number }
  | { t: "unlistLoan"; saleId: string }
  | { t: "offerLoan"; saleId: string; buyerId: string; pricePct: number; note: string; atAsk: boolean }
  | { t: "decideOffer"; offerId: string; accept: boolean }
  | { t: "loadSample" }
  | { t: "clearSample" }
  | { t: "reset" };

export type PayoffRequester = NonNullable<PayoffRequest["requester"]>;

const now = () => new Date().toISOString();
// Two records made in the same millisecond must not share an id, or the second would overwrite the first once saved.
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
/** Fixed, not now(): /admin is prerendered, so a load-time stamp would not match the server HTML (hydration error). */
const SEED_AT = "2026-10-18T09:00:00-07:00";
const DEMO_PREFIX = "LH-DEMO-";
/** The FAKE demo book, whether a demo seat's or an account's sample data. */
export const isDemoBook = (s: Book) => s.loanPrefix === DEMO_PREFIX;
/** Today for servicing. The demo book keeps its own fixed day, so its loans don't fall further behind every month. */
export const serviceDay = (s: Book) => (isDemoBook(s) ? DEMO_SERVICING_DAY : servicingDate(new Date()));
const money = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The steps to funding, for the demo book's made-up history.
const PATH: LoanStatus[] = ["submitted", "initial_review", "underwriting", "term_sheet_issued", "term_sheet_accepted", "conditions", "clear_to_close", "closing", "funded"];

/** A demo loan's history: a few days a step, ending on the day it entered its stage, so the reports have something to show. */
function demoStages(deal: Deal): StageEntry[] {
  const stamp = (day: string) => `${day}T14:00:00.000Z`;
  const gap = 2 + (Number(deal.loanNumber.slice(-1)) % 3);
  const entered = addDays(DEMO_SERVICING_DAY, -deal.daysInStage);
  const walk = (steps: LoanStatus[], last: string) => steps.map((status, i) => ({ status, at: stamp(addDays(last, -gap * (steps.length - 1 - i))) }));
  if (SERVICED.includes(deal.status) || deal.status === "paid_off") {
    const history = walk(PATH, deal.closingDate);
    return deal.status === "funded" ? history : [...history, { status: deal.status, at: stamp(entered > deal.closingDate ? entered : deal.closingDate) }];
  }
  const index = PATH.indexOf(deal.status);
  return index >= 0 ? walk(PATH.slice(0, index + 1), entered) : [...walk(PATH.slice(0, 3), addDays(entered, -gap)), { status: deal.status, at: stamp(entered) }];
}

/** Demo loans split between two loan officers with one processor; new applications wait for an officer. */
function demoTeam(deal: Deal): Deal["team"] {
  if (deal.status === "submitted") return undefined;
  const [olivia, uma, pat] = DEMO_TEAM;
  return { officer: Number(deal.loanNumber.slice(-1)) % 2 ? uma : olivia, processor: pat };
}

const DEMO_SURVEYS: Record<string, { score: number; comment?: string; at: string }> = { d11: { score: 10, comment: "Closed in nine days and the draws came the day after each inspection (FAKE)", at: "2026-07-10T15:00:00Z" }, d17: { score: 9, at: "2026-10-24T15:00:00Z" }, d13: { score: 6, comment: "The appraisal took two weeks (FAKE)", at: "2026-04-02T15:00:00Z" } };
// Roughly the middle of each demo loan's city: the addresses are made up, the cities aren't.
const DEMO_PLACES: Record<string, { lat: number; lng: number }> = { d1: { lat: 26.0112, lng: -80.1495 }, d3: { lat: 25.8487, lng: -80.2389 }, d4: { lat: 26.0078, lng: -80.2963 }, d5: { lat: 26.3683, lng: -80.1289 }, d6: { lat: 26.5629, lng: -81.9495 }, d7: { lat: 26.2379, lng: -80.1248 }, d8: { lat: 26.7153, lng: -80.0534 }, d9: { lat: 26.023, lng: -80.119 }, d10: { lat: 26.2712, lng: -80.2706 }, d11: { lat: 25.767, lng: -80.204 }, d12: { lat: 26.4615, lng: -80.0728 }, d13: { lat: 26.1404, lng: -80.2134 }, d14: { lat: 26.3184, lng: -80.0998 }, d15: { lat: 26.1195, lng: -80.128 }, d16: { lat: 26.1669, lng: -80.2564 }, d17: { lat: 26.2445, lng: -80.2064 }, d18: { lat: 26.0765, lng: -80.2521 } };
const DEMO_REFERRALS: Record<string, { on: string; paidOn?: string }> = { d12: { on: "2026-03-10", paidOn: "2026-04-15" }, d17: { on: "2026-09-28" }, d16: { on: "2026-10-30" } };

/** The demo's firms were screened with its loans; the unsigned prospect has a possible match to review. */
function withDemoScreening<T extends Partner | LoanBuyer>(firm: T): T {
  const review = firm.id === "p-d";
  const hits = review ? [{ uid: 990_002, name: "UNSIGNED PROSPECT HOLDINGS (FAKE)", type: "entity", program: "SDGT", score: 0.93 }] : [];
  return { ...firm, screening: { id: `ofac-demo-${firm.id}`, at: "2026-10-30T12:00:00Z", by: "Nightly sanctions check", checkedAt: "2026-10-30T12:00:00Z", list: { fetchedAt: "2026-10-30T11:00:00Z", names: 18_240 }, status: review ? "review" : "clear", subjects: [{ name: firm.name, role: "entity", hits }] } };
}

export function demoBook(): Book {
  const deals = seedDeals.map((d) => {
    const e = evaluate(d.app);
    const deal: Deal = { ...d, stages: demoStages(d), team: demoTeam(d), app: { ...d.app, pricingVersion: BASE_VERSION }, sponsor: DEMO_SPONSORS[d.id], scope: defaultScope(d.app.product, e.holdback, d.disbursedDraws ?? 0), allocations: d.allocations.map((a) => ({ ...a, amount: a.amount || e.noteAmount })) };
    // Every demo loan was screened the day before the demo's day, and one has a possible match to review.
    deal.screenings = [{ id: `ofac-demo-${d.id}`, at: "2026-10-30T12:00:00Z", by: "Nightly sanctions check", checkedAt: "2026-10-30T12:00:00Z", list: { fetchedAt: "2026-10-30T11:00:00Z", names: 18_240 }, status: d.id === "d6" ? "review" : "clear",
      subjects: screeningSubjects(deal).map((subject) => ({ ...subject, hits: d.id === "d6" && subject.role === "borrower" ? [{ uid: 990_001, name: "MOCKUP, Morgan Alexei (FAKE)", type: "individual", program: "SDGT (FAKE)", score: 0.946 }] : [] })) }];
    // Two loans near closing: one with its wire confirmed by a call-back, one whose instructions still need the call.
    const agent = { company: "Sample Title & Escrow (FAKE)", contact: "Terry Title (FAKE)", phone: "(954) 555-0142", email: "closings@sample-title.test", fileNumber: `ST-${d.loanNumber.slice(-4)}` };
    const wire = (id: string, verified: boolean): WireInstruction => ({ id, bankName: "First Demo Bank (FAKE)", routing: "123456780", account: "000123456789", beneficiary: "Sample Title & Escrow Trust Account (FAKE)", reference: agent.fileNumber, source: "Title company's secure portal", enteredBy: "Pat Processor (FAKE)", enteredAt: "2026-10-27T10:00:00-07:00", verification: verified ? { by: "Olivia Owner (FAKE)", at: "2026-10-28T09:30:00-07:00", phone: "(954) 555-0100", phoneSource: "Title company's website", spokeWith: "Dana Escrow (FAKE)" } : undefined });
    if (d.id === "d15") return { ...deal, closing: agent, wires: [wire("wire-demo-15", true)], docs: [...deal.docs, ...missingClosingItems(deal).map((doc) => ({ ...doc, status: "accepted" as const }))] };
    if (d.id === "d7") return { ...deal, closing: agent, wires: [wire("wire-demo-7", false)], docs: [...deal.docs, ...missingClosingItems(deal).map((doc) => ({ ...doc, status: "accepted" as const }))] };
    // One funded loan half-owned by the demo partner, paid through October, so its portfolio and statements show money.
    if (d.id === "d11") {
      const half = Math.round(e.noteAmount / 2);
      const monthly = fundedBalances(e, deal.app, deal.disbursedDraws).nextPayment;
      const paid = (on: string): LoanPayment => ({ id: `pay-demo-11-${on}`, amount: monthly, receivedOn: on, method: "ach", reference: `ACH ${on}`, by: "Sam Servicer (FAKE)", at: `${on}T15:00:00Z` });
      return { ...deal, allocations: [{ sourceId: `partner:${DEMO_PARTNER_ID}`, amount: half }, { sourceId: "gt-main", amount: e.noteAmount - half }], route: "split" as const, teaserSentTo: [DEMO_PARTNER_ID], boardedThrough: "2026-09-01", payments: [paid("2026-09-01"), paid("2026-10-01")],
        partnerFunding: { partnerId: DEMO_PARTNER_ID, amount: half, sent: { on: "2026-06-29", reference: "FED REF 2026-0629-11 (FAKE)", by: "Pia Partner (FAKE)", at: "2026-06-29T14:00:00Z" }, received: { on: "2026-06-30", by: "Cam Capital (FAKE)", at: "2026-06-30T13:00:00Z" } } };
    }
    // The loan two payments behind has a collections file: the calls, a promise to pay that was broken, and a late notice.
    if (d.id === "d13") {
      const by = "Sam Servicer (FAKE)";
      return { ...deal,
        contacts: [
          { id: "ct-demo-13-1", on: "2026-10-08", channel: "call" as const, with: d.borrowerName, outcome: "reached" as const, note: "Waiting on a buyer's deposit to clear; will pay the October payment by the 20th. (FAKE)", by, at: "2026-10-08T15:10:00Z" },
          { id: "ct-demo-13-2", on: "2026-10-22", channel: "call" as const, with: d.borrowerName, outcome: "left_message" as const, note: "Nothing in by the 20th. Left a message. (FAKE)", by, at: "2026-10-22T14:00:00Z" },
          { id: "ct-demo-13-3", on: "2026-10-27", channel: "text" as const, with: d.borrowerName, outcome: "no_answer" as const, note: "", by, at: "2026-10-27T16:30:00Z" },
        ],
        promises: [{ id: "ptp-demo-13", amount: 2_443.75, madeOn: "2026-10-08", dueBy: "2026-10-20", note: "The October payment (FAKE)", by, at: "2026-10-08T15:12:00Z" }],
        notices: [{ id: "nt-demo-13", kind: "late" as const, sentOn: "2026-10-23", method: "first_class" as const, to: `${d.entityName}, ${d.address}, ${d.city} ${d.zip}`, tracking: "", amount: 5_131.88, by, at: "2026-10-23T13:00:00Z", delivered: { on: "2026-10-26", proof: "Borrower confirmed by text it arrived (FAKE)", by, at: "2026-10-26T13:00:00Z" } }] };
    }
    // One loan close to maturity whose borrower called to ask for more time, so the extension queue has something in it.
    if (d.id !== "d14") return deal;
    const extension: LoanExtension = { id: "ext-demo-1", months: 3, reason: "Kitchen cabinets are back-ordered; listing in February (FAKE)", requestedBy: "Pat Processor (FAKE)", requestedAt: "2026-10-28T10:00:00-07:00", fee: extensionFee(deal, 3), fromMaturity: maturityOf(deal), status: "requested", approvers: [] };
    // Paid through October since the demo buyer bought it, so the buyer's statement has payments in it.
    const monthly = fundedBalances(e, deal.app, deal.disbursedDraws).nextPayment;
    const paid = (on: string): LoanPayment => ({ id: `pay-demo-14-${on}`, amount: monthly, receivedOn: on, method: "ach", reference: `ACH ${on}`, by: "Sam Servicer (FAKE)", at: `${on}T15:00:00Z` });
    return { ...deal, extensions: [extension], boardedThrough: "2026-09-01", payments: [paid("2026-09-01"), paid("2026-10-01")] };
  });
  // Term sheets: two waiting for the borrower (one is the demo borrower's), one accepted, and an underwriter's request to
  // price below the matrix waiting for an owner.
  for (const [i, d] of deals.entries()) {
    if (d.status === "term_sheet_issued" || d.status === "term_sheet_accepted") {
      const sheet = draftSheet(d, startingTerms(d), "Uma Underwriter (FAKE)", "2026-10-28", "2026-10-28T10:00:00-07:00");
      const accepted = d.status === "term_sheet_accepted" ? { status: "accepted" as const, response: { at: "2026-10-29T09:00:00-07:00", by: d.borrowerName, signedName: d.termSheetSignedBy ?? d.borrowerName } } : {};
      deals[i] = { ...d, app: { ...d.app, termRate: sheet.terms.rate, termPoints: sheet.terms.pointsPct }, termSheets: [{ ...sheet, ...accepted }] };
    }
    // Conditions: d3 is working through them; d7 and d15 have cleared everything before closing.
    if (d.id === "d3" || d.id === "d7" || d.id === "d15") {
      const conditions = templatesFor(DEFAULT_LIBRARY, d.app).map((template, n): LoanCondition => {
        const made = fromTemplate(template, `cond-demo-${d.id}-${n}`, "Pat Processor (FAKE)", "2026-10-26", "2026-10-26T09:00:00-07:00");
        if (template.category === "post_closing") return made;
        if (d.id !== "d3") return { ...made, status: "cleared", cleared: { by: "Uma Underwriter (FAKE)", at: "2026-10-29T11:00:00-07:00", note: "" } };
        if (template.id === "std-entity") return { ...made, status: "cleared", files: [{ fileName: "Operating agreement (FAKE).pdf", at: "2026-10-27T10:00:00-07:00", by: d.borrowerName }], cleared: { by: "Pat Processor (FAKE)", at: "2026-10-28T09:00:00-07:00", note: "Good standing checked on Sunbiz" } };
        if (template.id === "std-insurance") return { ...made, status: "submitted", files: [{ fileName: "Insurance binder (FAKE).pdf", at: "2026-10-30T16:00:00-07:00", by: d.borrowerName }] };
        return made;
      });
      deals[i] = { ...deals[i], conditions };
    }
    // Lien files on the funded rehab and construction loans: the Notice of Commencement recorded the day after the
    // mortgage, naming LendHous. One supplier has served a notice to owner.
    if (SERVICED.includes(d.status) && (d.app.product === "fix_flip" || d.app.product === "ground_up")) {
      deals[i] = { ...deals[i], lienFile: {
        contractor: `${d.entityName.split(" ")[0]} Construction (FAKE)`, mortgageRecordedOn: d.closingDate,
        noc: { recordedOn: addDays(d.closingDate, 1), reference: `OR ${d.loanNumber.slice(-4)}/${d.closingDate.slice(5, 7)} (FAKE)`, expiresOn: "2027-09-30", commencedOn: addDays(d.closingDate, 7), lenderNamed: true, by: "Pat Processor (FAKE)", at: `${d.closingDate}T16:00:00-07:00` },
        notices: d.id === "d12" ? [{ id: "nto-demo-1", lienor: "Coastal Lumber Supply (FAKE)", role: "supplier", servedOn: "2026-06-10", by: "Pat Processor (FAKE)", at: "2026-06-12T10:00:00-07:00" }] : [],
      } };
    }
    // Insurance on every funded loan and the two about to close: wind in the property policy, except the Miami rental,
    // which is in flood zone AE with separate wind and flood policies. One policy ends soon and one has lapsed.
    if (SERVICED.includes(d.status) || d.id === "d7" || d.id === "d15") {
      const at = `${d.closingDate}T16:00:00-07:00`;
      const coverage = Math.round((evaluate(d.app).noteAmount * 1.1) / 1000) * 1000;
      const separate = d.id === "d10";
      const policies: InsurancePolicy[] = [{ kind: d.app.product === "ground_up" ? "builders_risk" : "hazard", carrier: "Sample Mutual (FAKE)", policy: `SM-${d.loanNumber.slice(-4)}`, expiresOn: d.id === "d9" ? "2026-11-20" : d.id === "d13" ? "2026-10-15" : "2027-06-30", coverage, ...(separate ? {} : { windIncluded: true }), mortgagee: true, by: "Pat Processor (FAKE)", at }];
      if (separate) policies.push({ kind: "windstorm", carrier: "Citizens Property Insurance (FAKE)", policy: `CW-${d.loanNumber.slice(-4)}`, expiresOn: "2027-05-31", mortgagee: true, by: "Pat Processor (FAKE)", at }, { kind: "flood", carrier: "Sample Flood (FAKE)", policy: `SF-${d.loanNumber.slice(-4)}`, expiresOn: "2027-03-01", coverage: 250_000, mortgagee: true, program: "nfip", by: "Pat Processor (FAKE)", at });
      deals[i] = { ...deals[i], insurance: { policies, flood: { sfha: separate, zone: separate ? "AE" : "X", by: "Pat Processor (FAKE)", at } } };
    }
    // The Coral Springs rental loan is a portfolio of two: its values, rents and costs add up to the loan's own numbers.
    if (d.id === "d10") deals[i] = { ...deals[i], properties: [
      { id: "prop-d10-1", address: d.address, city: d.city, zip: d.zip, county: "Broward", propertyType: "sfr", value: 240_000, monthlyRent: 2_200, taxesAnnual: 4_100, insuranceAnnual: 3_000, geo: { lat: 26.2712, lng: -80.2706, at: "2026-10-20T10:00:00Z" }, floodMap: { mapped: true, zone: "AE", sfha: true, at: "2026-10-20T10:00:00Z" } },
      { id: "prop-d10-2", address: "12 Sample Lake Dr", city: "Parkland", zip: "33067", county: "Broward", propertyType: "sfr", value: 180_000, monthlyRent: 1_700, taxesAnnual: 3_100, insuranceAnnual: 2_400, geo: { lat: 26.31, lng: -80.237, at: "2026-10-20T10:00:00Z" }, floodMap: { mapped: true, zone: "X", sfha: false, at: "2026-10-20T10:00:00Z" } },
    ] };
    // The newest application bought from a seller who paid far less five months ago: the price-jump check flags it.
    if (d.id === "d16") deals[i] = { ...deals[i], lastSale: { price: Math.round(d.app.purchasePrice / 1.45 / 1000) * 1000, on: "2026-06-02", by: "Pat Processor (FAKE)", at: "2026-10-31T15:00:00Z" } };
    // The loans the demo partner and buyer hold have an update from the team.
    if (d.id === "d11") deals[i] = { ...deals[i], investorUpdates: [{ id: "iu-demo-11", text: "Paying on time. The borrower expects to refinance into a rental loan in the spring (FAKE).", by: "Cam Capital (FAKE)", at: "2026-10-15T14:00:00Z" }] };
    if (d.id === "d14") deals[i] = { ...deals[i], investorUpdates: [{ id: "iu-demo-14", text: "Cabinets are back-ordered; the borrower asked for a 3-month extension, under review (FAKE).", by: "Sam Servicer (FAKE)", at: "2026-10-28T18:00:00Z" }] };
    // Three borrowers answered the closing survey; the demo borrower's own flip still has the question waiting.
    const answer = DEMO_SURVEYS[d.id];
    if (answer) deals[i] = { ...deals[i], surveys: [{ stage: "funded", comment: "", ...answer }] };
    // The demo borrower's flip is on the map, so its contractor's photos are checked against it. The others sit at their
    // cities, so the sample storm's cone covers some and not others.
    if (d.id === "d2") deals[i] = { ...deals[i], geo: { lat: 26.1224, lng: -80.1374, at: "2026-10-20T10:00:00Z" } };
    else if (DEMO_PLACES[d.id]) deals[i] = { ...deals[i], geo: { ...DEMO_PLACES[d.id], at: "2026-10-20T10:00:00Z" } };
    // FEMA's map on the funded loans agrees with the zone recorded from their determinations; one new application's
    // address isn't mapped.
    if (deals[i].insurance?.flood && SERVICED.includes(d.status)) deals[i] = { ...deals[i], floodMap: { mapped: true, zone: deals[i].insurance!.flood!.zone, sfha: deals[i].insurance!.flood!.sfha, at: "2026-10-20T10:00:00Z" } };
    if (d.id === "d16") deals[i] = { ...deals[i], floodMap: { mapped: false, zone: "", sfha: false, at: "2026-10-31T15:00:00Z" } };
    // The demo borrower's flip has a change order waiting: the kitchen grew and the floors came in under budget.
    if (d.id === "d2") deals[i] = { ...deals[i], changeOrders: [{ id: "co-demo-1", from: "flooring", to: "kitchen", amount: 3_000, reason: "Added an island to the kitchen; the flooring came in under its budget (FAKE)", by: "Alex Sample (FAKE)", byTeam: false, at: "2026-10-29T11:00:00-07:00", status: "requested" }] };
    // Three friends the demo borrower referred: one whose bonus was paid, one funded and owed, one still applying.
    const referred = DEMO_REFERRALS[d.id];
    if (referred) deals[i] = { ...deals[i], friendReferral: { referrerId: BORROWER_ID, referrerName: "Alex Sample (FAKE)", on: referred.on, bonus: DEMO_BONUS, ...(referred.paidOn ? { paid: { amount: DEMO_BONUS, on: referred.paidOn, reference: "ACH 2026-04-15 (FAKE)", by: "Cam Capital (FAKE)", at: `${referred.paidOn}T15:00:00Z` } } : {}) } };
    if (d.id === "d5") {
      const input = { ...startingTerms(d), rate: matrixOf(d.app).rate[0] - 0.5 };
      deals[i] = { ...d, pricingException: { rate: input.rate, points: input.points, termMonths: input.termMonths, reasons: exceptionReasons(d.app, input), note: "Fourth loan with us, all paid early; a competing offer at this rate (FAKE)", requestedBy: "Uma Underwriter (FAKE)", requestedAt: "2026-10-30T15:00:00-07:00", status: "pending" } };
    }
  }
  const quoted = payoffFor(deals.find((d) => d.id === "d11")!, "2026-11-15");
  // One from a borrower's portal, due in two days, and one from a title company whose authorization still needs a look.
  const payoffs: PayoffRequest[] = [
    { id: "payoff-1", dealId: "d11", goodThrough: "2026-11-15", requestedAt: "2026-10-22T10:00:00-07:00", by: "Avery Mock (FAKE)", status: "requested", receivedOn: "2026-10-22", channel: "portal", requester: { kind: "borrower", name: "Avery Mock (FAKE)" }, ...quoted },
    { id: "payoff-2", dealId: "d10", goodThrough: "2026-11-20", requestedAt: "2026-10-30T14:00:00-07:00", by: "Dana Escrow (FAKE)", status: "requested", receivedOn: "2026-10-30", channel: "web_form", requester: { kind: "title", name: "Dana Escrow (FAKE)", company: "Sample Title & Escrow (FAKE)", email: "closings@sample-title.test", phone: "(954) 555-0142", fileNumber: "ST-1010-B" }, check: { status: "pending", note: "Signed authorization uploaded with the request.", fileName: "borrower-authorization.pdf" }, ...payoffFor(deals.find((d) => d.id === "d10")!, "2026-11-20") },
  ];
  return { partnerId: DEMO_PARTNER_ID, buyerId: DEMO_BUYER_ID, brokerId: DEMO_BROKER_ID, borrowerId: BORROWER_ID, loanPrefix: DEMO_PREFIX, deals, bids: [...seedBids, { id: "bid-demo-11", dealId: "d11", partnerId: DEMO_PARTNER_ID, pct: 50, lenderRate: 9.25, lenderPoints: 0.5, conditions: "", status: "accepted", type: "bid", at: "2026-06-20T14:00:00Z" }], partners: seedPartners.map((firm) => withDemoScreening(firm)), buyers: loanBuyers.map((firm) => withDemoScreening(firm)), brokers: seedBrokers, sales: seedLoanSales, offers: seedLoanOffers, draws: seedDraws, photoRequests: seedPhotoRequests, payoffs, messages: seedMessages, sources: capitalSources, conditionLibrary: DEFAULT_LIBRARY, storms: [], audit: [{ at: SEED_AT, text: "Demo data loaded (all records are FAKE)" }] };
}

/** A book with no records: a new database, or an account with nothing to see yet. */
export const emptyBook = (): Book => ({ partnerId: "", buyerId: "", brokerId: "", borrowerId: "", loanPrefix: "LH-", deals: [], bids: [], partners: [], buyers: [], brokers: [], sales: [], offers: [], draws: [], photoRequests: [], payoffs: [], messages: [], sources: [], conditionLibrary: [], storms: [], audit: [] });

/**
 * Every change to the book goes through here. A loan that moves to another stage has the time noted, so reports can
 * tell how long each step took and how long a loan has sat where it is. Loading or clearing sample data keeps the
 * sample's own history.
 */
/** Adds each partner's new proceeds to what it's owed or has rolled. */
const withProceeds = (partners: Partner[], proceeds: ReturnType<typeof payoffProceeds>) => (proceeds.length ? partners.map((p) => { const mine = proceeds.filter((x) => x.partnerId === p.id).map((x) => x.proceeds); return mine.length ? { ...p, proceeds: [...(p.proceeds ?? []), ...mine] } : p; }) : partners);

/**
 * A loan's money back, from a payoff or a third party's foreclosure bid. It stops counting against capital, nothing else
 * can be drawn, sold, extended or modified on it, a foreclosure ends, and each partner's part is rolled or owed to it.
 */
function closeLoan(s: Book, deal: Deal, paidOff: Payoff, text: string): Book {
  const at = new Date().toISOString();
  const closing = new Set(s.sales.filter((x) => x.dealId === deal.id && x.status === "listed").map((x) => x.id));
  const proceeds = payoffProceeds(s, { ...deal, paidOff }, (n) => `pp${uid()}${n}`);
  const foreclosure = deal.foreclosure && !deal.foreclosure.stopped && !paidOff.foreclosureSale ? { ...deal.foreclosure, stopped: { on: paidOff.receivedOn, why: "paid_off" as const, note: "", by: paidOff.by, at } } : deal.foreclosure;
  const ended = { by: paidOff.by, at, reason: "The loan was paid off" };
  return { ...s,
    partners: withProceeds(s.partners, proceeds),
    deals: s.deals.map((d) => (d.id === deal.id ? { ...deal, status: "paid_off", daysInStage: 0, paidOff, foreclosure, allocations: [], nextPaymentDue: undefined, paymentsLate: 0, extensions: deal.extensions?.map((x) => (x.status === "requested" || x.status === "approved" ? { ...x, status: "declined" as const, declined: ended } : x)), modifications: deal.modifications?.map((x) => (x.status === "proposed" || x.status === "approved" ? { ...x, status: "declined" as const, declined: ended } : x)) } : d)),
    payoffs: s.payoffs.map((p) => (p.dealId === deal.id && p.status !== "paid" ? { ...p, status: "paid" } : p)),
    draws: s.draws.map((d) => (d.dealId === deal.id && d.status !== "funded" && d.status !== "rejected" ? { ...d, status: "rejected", reason: "The loan was paid off" } : d)),
    sales: s.sales.map((x) => (closing.has(x.id) ? { ...x, status: "withdrawn" } : x)),
    offers: s.offers.map((o) => (closing.has(o.saleId) && o.status === "submitted" ? { ...o, status: "declined" } : o)),
    audit: [{ at, text }, ...s.audit].slice(0, 50) };
}

/** The property becomes LendHous's (REO): what the loan came to is fixed, and nothing more is drawn, sold or changed on it. */
function takeTitle(s: Book, deal: Deal, on: string, how: "certificate_of_title" | "deed_in_lieu", by: string, text: string): Book {
  const at = new Date().toISOString();
  const ended = { by, at, reason: "The property was foreclosed" };
  const closing = new Set(s.sales.filter((x) => x.dealId === deal.id && x.status === "listed").map((x) => x.id));
  const reo = { since: on, how, by, at, owed: owedAtTitle(deal, on) };
  return { ...s,
    deals: s.deals.map((d) => (d.id === deal.id ? { ...deal, status: "reo", daysInStage: 0, reo, nextPaymentDue: undefined, extensions: deal.extensions?.map((x) => (x.status === "requested" || x.status === "approved" ? { ...x, status: "declined" as const, declined: ended } : x)), modifications: deal.modifications?.map((x) => (x.status === "proposed" || x.status === "approved" ? { ...x, status: "declined" as const, declined: ended } : x)), promises: deal.promises?.map((x) => (x.cancelled ? x : { ...x, cancelled: { by, at, reason: "The property was foreclosed" } })) } : d)),
    payoffs: s.payoffs.map((p) => (p.dealId === deal.id && (p.status === "requested" || p.status === "sent") ? { ...p, status: "refused", refused: { by, at, reason: "The property was foreclosed" } } : p)),
    draws: s.draws.map((d) => (d.dealId === deal.id && d.status !== "funded" && d.status !== "rejected" ? { ...d, status: "rejected", reason: "The property was foreclosed" } : d)),
    sales: s.sales.map((x) => (closing.has(x.id) ? { ...x, status: "withdrawn" } : x)),
    offers: s.offers.map((o) => (closing.has(o.saleId) && o.status === "submitted" ? { ...o, status: "declined" } : o)),
    audit: [{ at, text }, ...s.audit].slice(0, 50) };
}

export function reducer(s: Book, a: BookAction): Book {
  const next = apply(s, a);
  if (next.deals === s.deals || a.t === "reset" || a.t === "loadSample" || a.t === "clearSample") return next;
  const before = new Map(s.deals.map((deal) => [deal.id, deal.status]));
  const at = now();
  return { ...next, deals: next.deals.map((deal) => (before.get(deal.id) === deal.status ? deal : { ...deal, stages: [...(deal.stages ?? []), { status: deal.status, at }] })) };
}

function apply(s: Book, a: BookAction): Book {
  const log = (text: string) => [{ at: now(), text }, ...s.audit].slice(0, 50);
  const upd = (id: string, f: (d: Deal) => Deal) => s.deals.map((d) => (d.id === id ? f(d) : d));
  const photos = (id: string, f: (r: PhotoRequest) => PhotoRequest) => s.photoRequests.map((r) => (r.id === id ? f(r) : r));
  const requestOf = (id: string) => s.photoRequests.find((r) => r.id === id)!;
  switch (a.t) {
    case "reset": return demoBook();
    case "loadSample": return { ...demoBook(), sample: true };
    case "clearSample": return emptyBook();
    case "submitApp": {
      // Credit inputs come from the people and deals listed, and nothing arrives already verified.
      // Past deals staff confirmed on the borrower's earlier loans stay confirmed (lib/repeat-borrower.ts).
      const borrowerId = a.client?.borrowerId ?? (a.client ? `client-${uid()}` : s.borrowerId);
      const earlier = earlierLoans(s.deals, borrowerId);
      const sponsor = a.sponsor && carryOverTrackRecord({ ...a.sponsor, trackRecord: a.sponsor.trackRecord.map(({ verified: _verified, ...item }) => item) }, earlier);
      // Their loans paid as agreed count toward pricing, counted now and kept with the application.
      const history = earlier.length ? repeatHistory(s.deals, borrowerId, serviceDay(s)) : undefined;
      const repeat = history && (history.loans || history.pausedBy) ? { repeat: history } : {};
      // A borrower a broker referred stays the broker's for the agreement's protection window (lib/brokers.ts).
      const protectedBy = a.client?.brokerId ? undefined : s.deals.find((item) => item.borrowerId === borrowerId && item.referredBy && referralHolds(item.referredBy.on, serviceDay(s)))?.referredBy;
      // Priced on today's pricing, and kept on it: publishing new numbers later doesn't change this loan.
      const app = { ...(sponsor ? withSponsor(a.app, sponsor, new Date()) : a.app), pricingVersion: currentPricing().version, ...repeat };
      // The highest number so far, not a count: a count could repeat if a record ever went away.
      const n = Math.max(1000, ...s.deals.map((item) => Number(item.loanNumber.match(/(\d+)$/)?.[1]) || 0)) + 1;
      const d: Deal = { id: `d${uid()}`, loanNumber: `${s.loanPrefix}${n}`, borrowerId, borrowerName: a.client?.name || "Alex Sample (FAKE)", entityName: a.entityName || "Sample Flips LLC (FAKE)", address: a.address || "100 New Demo St", city: a.city || "Hollywood", zip: a.zip || "33020", app, status: "submitted", daysInStage: 0, capitalStatus: "not_started", allocations: [], teaserSentTo: [], source: a.source ?? (a.client?.brokerId ? "broker" : "web_quote"), brokerId: a.client?.brokerId ?? protectedBy?.brokerId, brokerPoints: a.client?.brokerPoints, ...(protectedBy ? { referredBy: protectedBy } : {}), scope: defaultScope(app.product, evaluate(app).holdback),
        // The day they asked to close, or a month out.
        docs: trackDocCarried(carryOverDocs(needsList(app, sponsor), earlier, { entityName: a.entityName, sponsor }, serviceDay(s)), sponsor), sponsor, exitStrategy: a.exitStrategy, closingDate: a.closingDate && /^\d{4}-\d{2}-\d{2}$/.test(a.closingDate) ? a.closingDate : addDays(serviceDay(s), 30) };
      // A refinance of the borrower's own funded LendHous loan: that loan is paid off from this one when it funds.
      const replaces = a.refinances ? s.deals.find((item) => item.id === a.refinances && item.borrowerId === borrowerId && SERVICED.includes(item.status)) : undefined;
      if (replaces) d.refinances = replaces.id;
      const carried = d.docs.filter((item) => item.carriedFrom).length;
      return { ...s, deals: [d, ...s.deals], audit: log(`Application ${d.loanNumber} submitted${replaces ? `, refinancing ${replaces.loanNumber}` : ""}${a.client?.brokerId ? " by broker" : a.client ? " by staff" : " by borrower"}${history?.loans ? `; repeat borrower, ${history.loans} loan${history.loans === 1 ? "" : "s"} paid as agreed` : ""}${carried ? `; ${carried} document${carried === 1 ? "" : "s"} carried over` : ""}`) };
    }
    case "approveFunding": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      // An approval is of a loan going to one verified wire, so there has to be one.
      const wire = activeWire(deal);
      if (deal.status !== "closing" || deal.fundingApprovers?.includes(a.by) || !wire?.verification) return s;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, fundingApprovers: [...(d.fundingApprovers ?? []), a.by], fundingWireId: wire.id })), audit: log(`${deal.loanNumber}: funding approved by ${a.by}`) };
    }
    case "recordScreening": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const latest = latestScreening(deal);
      // The same names and the same hits as last time: it's a re-check, and any review of those hits still stands.
      if (latest && sameResult(latest, a.screening)) return { ...s, deals: upd(a.dealId, (d) => ({ ...d, screenings: d.screenings!.map((x) => (x.id === latest.id ? { ...x, checkedAt: a.screening.at, list: a.screening.list } : x)) })) };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, screenings: [...(d.screenings ?? []), a.screening] })), audit: log(`${deal.loanNumber}: OFAC screening ${a.screening.status === "clear" ? "clear" : "found a possible match"}`) };
    }
    case "decideScreening": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const latest = latestScreening(deal);
      if (latest?.id !== a.screeningId || latest.status !== "review") return s;
      const decided = { by: a.by, at: now(), reason: a.reason };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, screenings: d.screenings!.map((x) => (x.id === a.screeningId ? { ...x, status: a.decision, decided } : x)) })), audit: log(`${deal.loanNumber}: possible OFAC match ${a.decision === "cleared" ? "cleared as a false positive" : "CONFIRMED"} by ${a.by}`) };
    }
    case "openTitleLink": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const titleLink = { sentTo: a.sentTo, email: a.email, sentBy: a.sentBy, sentAt: now(), expiresAt: a.expiresAt, status: "open" as const };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, titleLink, docs: [...d.docs, ...missingClosingItems(d)] })), audit: log(`${deal.loanNumber}: secure link sent to ${a.sentTo}`) };
    }
    case "turnOffTitleLink": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (!deal.titleLink || deal.titleLink.status === "off") return s;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, titleLink: { ...d.titleLink!, status: "off" } })), audit: log(`${deal.loanNumber}: title company's link turned off`) };
    }
    case "titleFundsReceived": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (!deal.closing || fundsProblem(deal, a.amount, a.on, serviceDay(s))) return s;
      const fundsReceived = { amount: Math.round(a.amount * 100) / 100, on: a.on, by: a.by, at: now() };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, closing: { ...d.closing!, fundsReceived } })), audit: log(`${deal.loanNumber}: ${a.by} confirmed ${money(fundsReceived.amount)} received ${a.on}`) };
    }
    case "titleRecording": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (!deal.closing || recordingProblem(deal, a.on, a.reference, serviceDay(s))) return s;
      const recording = { on: a.on, reference: a.reference.trim(), by: a.by, at: now() };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, closing: { ...d.closing!, recording } })), audit: log(`${deal.loanNumber}: mortgage recorded ${a.on} (${recording.reference})`) };
    }
    case "addClosingChecklist": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const missing = missingClosingItems(deal);
      if (!missing.length) return s;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, docs: [...d.docs, ...missing] })), audit: log(`${deal.loanNumber}: closing checklist added`) };
    }
    case "saveClosing": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      // What title has confirmed stays, whatever the form sends.
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, closing: { ...a.closing, fundsReceived: d.closing?.fundsReceived, recording: d.closing?.recording } })), audit: log(`${deal.loanNumber}: closing agent set to ${a.closing.company}`) };
    }
    case "enterWire": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (wireProblem(a) || deal.wires?.some((w) => w.id === a.wireId)) return s;
      const wire: WireInstruction = { id: a.wireId, bankName: a.bankName.trim(), routing: a.routing, account: a.account, beneficiary: a.beneficiary.trim(), reference: a.reference.trim(), source: a.source, enteredBy: a.by, enteredAt: now() };
      const replacing = Boolean(activeWire(deal));
      // New instructions replace the old ones and void any approval given on them: everyone looks again.
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, wires: [...(d.wires ?? []).map((w) => (w.replaced ? w : { ...w, replaced: { by: a.by, at: now() } })), wire], fundingApprovers: undefined, fundingWireId: undefined })), audit: log(`${deal.loanNumber}: wire instructions ${replacing ? "changed; funding approvals cleared" : "entered"} by ${a.by}`) };
    }
    case "verifyWire": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const wire = deal.wires?.find((w) => w.id === a.wireId);
      if (verifyProblem(wire, a.by, a.phone, a.phoneSource, a.spokeWith)) return s;
      const verification = { by: a.by, at: now(), phone: a.phone.trim(), phoneSource: a.phoneSource, spokeWith: a.spokeWith.trim() };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, wires: d.wires?.map((w) => (w.id === a.wireId ? { ...w, verification } : w)) })), audit: log(`${deal.loanNumber}: wire instructions verified by ${a.by} with a call to ${verification.phone}`) };
    }
    case "updateDealNumbers": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      // The pricing version and the term sheet's rate and points are set by their own steps, never as a number edit.
      const { pricingVersion: _version, termRate: _rate, termPoints: _points, repeat: _repeat, ...changes } = a.changes;
      const app = { ...deal.app, ...changes };
      const holdback = evaluate(app).holdback;
      // A new rehab budget starts its scope of work over, because the old split no longer adds up.
      const scope = holdback === evaluate(deal.app).holdback ? deal.scope : defaultScope(app.product, holdback);
      // A rental found to be let by the night (or the other way) asks for what its income now rests on: payout statements or
      // a projection in place of the lease. Anything already sent stays.
      const income = (item: Application) => (item.product === "dscr" ? `${item.rentalType ?? "long_term"}:${item.strIncomeSource ?? ""}` : "");
      const docs = income(app) === income(deal.app) ? deal.docs : [...deal.docs.filter((doc) => !["lease", "str-income"].includes(doc.id) || doc.status !== "requested"), ...needsList(app, deal.sponsor).filter((doc) => ["lease", "str-income"].includes(doc.id) && !deal.docs.some((have) => have.id === doc.id && have.status !== "requested"))];
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, app, scope, docs })), audit: log(`${deal.loanNumber}: underwriting numbers updated`) };
    }
    case "reuseDocument": {
      const deal = s.deals.find((d) => d.id === a.dealId);
      const from = s.deals.find((d) => d.id === a.fromDealId);
      const source = from?.docs.find((doc) => doc.id === a.docId);
      if (!deal || reuseProblem(deal, deal.docs.find((doc) => doc.id === a.docId), from, source)) return s;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, docs: d.docs.map((doc) => (doc.id === a.docId ? { ...doc, status: "uploaded" as const, fileName: source!.fileName, documentId: source!.documentId, uploadedAt: now(), reusedFrom: from!.loanNumber, teamNote: undefined } : doc)) })), audit: log(`${deal.loanNumber}: ${a.by} sent the ${source!.name.toLowerCase()} already on file for ${from!.loanNumber}`) };
    }
    case "addOwnDoc": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (deal.docs.some((doc) => doc.id === a.docId)) return s;
      const doc = { id: a.docId, name: a.name.trim(), category: "Other", status: "requested" as const, note: "Something you added", addedBy: "borrower" as const };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, docs: [...d.docs, doc] })), audit: log(`${deal.loanNumber}: ${a.by} added a document: ${doc.name}`) };
    }
    case "setAgent": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const contact = { name: a.contact.name.trim(), company: a.contact.company.trim(), email: a.contact.email.trim(), phone: a.contact.phone.trim(), by: a.by, at: now() };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, agents: { ...d.agents, [a.role]: contact } })), audit: log(`${deal.loanNumber}: ${AGENT_LABEL[a.role].toLowerCase()} saved by ${a.by}`) };
    }
    case "addDocRequest": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const doc = { id: `req-${uid()}`, name: a.name, category: a.category, status: "requested" as const };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, docs: [...d.docs, doc] })), audit: log(`${deal.loanNumber}: requested ${a.name}`) };
    }
    case "partnerFundsSent": case "partnerFundsReceived": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const funding = deal.partnerFunding!;
      const next = a.t === "partnerFundsSent" ? { ...funding, sent: { on: a.sentOn, reference: a.reference.trim(), by: a.by, at: now() } } : { ...funding, received: { on: a.on, by: a.by, at: now() } };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, partnerFunding: next })), audit: log(`${deal.loanNumber}: partner's share ${a.t === "partnerFundsSent" ? `sent ${a.sentOn}` : `received in escrow ${a.on}`} (${a.by})`) };
    }
    case "brokerApplied": {
      const had = s.brokers.find((item) => item.id === a.brokerId);
      // Signing again (a new version of the agreement) keeps an approved or suspended firm where it is.
      const broker: Broker = { ...had, id: a.brokerId, name: a.application.legalName, status: had?.status === "approved" || had?.status === "suspended" ? had.status : "applied", application: a.application, docs: a.docs.length ? a.docs : had?.docs ?? [], ...(a.screening ? { screening: a.screening } : {}) };
      return { ...s, brokers: had ? s.brokers.map((item) => (item.id === a.brokerId ? broker : item)) : [...s.brokers, broker], audit: log(`Broker ${broker.name} signed the broker agreement (${a.application.agreementVersion})`) };
    }
    case "brokerScreened": {
      const broker = s.brokers.find((item) => item.id === a.brokerId)!;
      // The nightly check finding the same names and hits only moves the date, so a match cleared at approval stays cleared.
      if (broker.screening && sameResult(broker.screening, a.screening)) return { ...s, brokers: s.brokers.map((item) => (item.id === a.brokerId ? { ...item, screening: { ...broker.screening!, checkedAt: a.screening.at, list: a.screening.list } } : item)) };
      return { ...s, brokers: s.brokers.map((item) => (item.id === a.brokerId ? { ...item, screening: a.screening } : item)), audit: log(`Broker ${broker.name}: OFAC screening ${a.screening.status === "clear" ? "clear" : "found a possible match"}`) };
    }
    case "approveBroker": {
      const broker = s.brokers.find((item) => item.id === a.brokerId)!;
      const approved = { by: a.by, at: now(), ...(a.reason.trim() ? { reason: a.reason.trim() } : {}) };
      return { ...s, brokers: s.brokers.map((item) => (item.id === a.brokerId ? { ...item, status: "approved" as const, approved, suspended: undefined, referralCode: item.referralCode ?? referralCodeFor(item.id), ...(item.screening?.status === "review" ? { screening: { ...item.screening, status: "cleared" as const, decided: { by: a.by, at: approved.at, reason: a.reason.trim() } } } : {}) } : item)), audit: log(`Broker ${broker.name} approved by ${a.by}`) };
    }
    case "suspendBroker": {
      const broker = s.brokers.find((item) => item.id === a.brokerId)!;
      return { ...s, brokers: s.brokers.map((item) => (item.id === a.brokerId ? { ...item, status: "suspended" as const, suspended: { by: a.by, at: now(), reason: a.reason.trim() } } : item)), audit: log(`Broker ${broker.name} suspended by ${a.by}: ${a.reason.trim()}`) };
    }
    case "saveBrokerBrand": {
      const broker = s.brokers.find((item) => item.id === a.brokerId)!;
      const brand = { name: a.brand.name.trim(), phone: a.brand.phone.trim(), email: a.brand.email.trim().toLowerCase(), website: a.brand.website.trim() };
      return { ...s, brokers: s.brokers.map((item) => (item.id === a.brokerId ? { ...item, brand } : item)), audit: log(`Broker ${broker.name}: brand on quotes and term sheets set to ${brand.name}`) };
    }
    case "setBrokerLetterLimit": {
      const broker = s.brokers.find((item) => item.id === a.brokerId)!;
      const limit = Math.max(0, Math.round(a.limit));
      return { ...s, brokers: s.brokers.map((item) => (item.id === a.brokerId ? { ...item, letterLimit: limit || undefined } : item)), audit: log(`Broker ${broker.name}: pre-qualification letters ${limit ? `up to $${limit.toLocaleString("en-US")}` : "turned off"} by ${a.by}`) };
    }
    case "referLoan": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const broker = s.brokers.find((item) => item.id === a.brokerId);
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, referredBy: { brokerId: a.brokerId, on: a.on }, brokerId: d.brokerId ?? a.brokerId })), audit: log(`${deal.loanNumber}: referred by ${broker?.name ?? "a broker"}`) };
    }
    case "referFriend": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const referrerName = s.deals.find((item) => item.borrowerId === a.referrerId)?.borrowerName ?? "A borrower";
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, friendReferral: { referrerId: a.referrerId, referrerName, on: a.on, bonus: round2(Math.max(0, a.bonus)) } })), audit: log(`${deal.loanNumber}: referred by ${referrerName}, a LendHous borrower`) };
    }
    case "placeProperty": {
      const geo = { lat: a.lat, lng: a.lng, at: now() };
      // On a portfolio loan each property has its own place; the first stands for the loan.
      return { ...s, deals: upd(a.dealId, (d) => (a.propertyId ? { ...d, properties: d.properties?.map((p) => (p.id === a.propertyId ? { ...p, geo } : p)), ...(d.properties?.[0]?.id === a.propertyId && !d.geo ? { geo } : {}) } : { ...d, geo })) };
    }
    case "saveProperties": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (scheduleProblem(a.properties)) return s;
      if (!a.properties.length) return { ...s, deals: upd(a.dealId, (d) => ({ ...d, properties: undefined })), audit: log(`${deal.loanNumber}: back to a single property`) };
      // A property kept on the schedule keeps where it is and its flood zone.
      const properties: PortfolioProperty[] = a.properties.map((p) => { const old = deal.properties?.find((x) => x.id === p.id); return { ...p, address: p.address.trim(), city: p.city.trim(), zip: p.zip.trim(), ...(old?.geo ? { geo: old.geo } : {}), ...(old?.floodMap ? { floodMap: old.floodMap } : {}) }; });
      const first = properties[0];
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, properties, app: portfolioApp(d.app, properties), address: first.address, city: first.city, zip: first.zip, ...(deal.properties?.[0]?.id === first.id ? {} : { geo: first.geo, floodMap: first.floodMap }) })), audit: log(`${deal.loanNumber}: portfolio of ${properties.length} properties saved`) };
    }
    case "releaseProperty": {
      const today = serviceDay(s);
      // Brought up to today first, so payments already due keep what they owed before the release.
      const deal = settle(s.deals.find((d) => d.id === a.dealId)!, a.on > today ? a.on : today);
      const quote = releaseQuote(deal, a.propertyId, a.on);
      if ("problem" in quote || a.amount + 0.005 < quote.total) return s;
      // Anything paid over the figure goes to principal too.
      const principal = round2(quote.price + (a.amount - quote.total));
      const made = paymentsMade(deal);
      const release: PropertyRelease = { id: `rel${uid()}`, propertyId: a.propertyId, on: a.on, principal, interest: quote.interest, afterPayments: made, newPayment: recastPayment(deal, Math.max(0, balanceOf(deal) - principal), made), reference: a.reference.trim(), by: a.by, at: now() };
      return { ...s, deals: upd(deal.id, () => ({ ...deal, releases: [...(deal.releases ?? []), release], properties: deal.properties!.map((p) => (p.id === a.propertyId ? { ...p, released: { on: a.on, releaseId: release.id } } : p)) })), audit: log(`${deal.loanNumber}: ${quote.property.address} released for ${money(a.amount)}`) };
    }
    case "setRollover": return { ...s, partners: s.partners.map((p) => (p.id === a.partnerId ? { ...p, rollover: { choice: a.choice, by: a.by, at: now() } } : p)), audit: log(`${s.partners.find((p) => p.id === a.partnerId)?.name ?? a.partnerId}: payoff money ${ROLLOVER[a.choice].label.toLowerCase()}`) };
    case "sendProceeds": {
      const partner = s.partners.find((p) => p.id === a.partnerId)!;
      const item = partner.proceeds?.find((x) => x.id === a.proceedsId);
      if (!item || item.sent) return s;
      return { ...s, partners: s.partners.map((p) => (p.id === a.partnerId ? { ...p, proceeds: p.proceeds!.map((x) => (x.id === a.proceedsId ? { ...x, sent: { on: a.on, reference: a.reference.trim(), by: a.by, at: now() } } : x)) } : p)), audit: log(`${item.loanNumber}: ${money(item.toSend)} of payoff money sent to ${partner.name}`) };
    }
    case "setFundsDraws": return { ...s, partners: s.partners.map((p) => (p.id === a.partnerId ? { ...p, fundsDraws: a.on } : p)), audit: log(`${s.partners.find((p) => p.id === a.partnerId)?.name ?? a.partnerId} ${a.on ? "sends its share of each draw as it's released" : "funds its whole share at closing"}`) };
    case "transferShare": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const old = currentBids(s, deal.id).find((bid) => bid.partnerId === a.from);
      if (!old || transferProblem(s, deal, a.from, a.to, a.on, serviceDay(s))) return s;
      const transfer: ShareTransfer = { id: `tr${uid()}`, from: a.from, to: a.to, pct: old.pct, on: a.on, ...transferQuote(deal, old, a.on), rate: a.rate ?? old.lenderRate, by: a.by, at: now() };
      const name = (id: string) => (id === "gt-main" ? "LendHous" : s.partners.find((p) => p.id === id)?.name ?? id);
      return { ...s, ...moveShare(s, deal, transfer, `bid${uid()}`), audit: log(`${deal.loanNumber}: ${name(a.from)}'s ${old.pct}% share moved to ${name(a.to)} on ${a.on} for ${money(transfer.price)}`) };
    }
    case "settleTransfer": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, transfers: d.transfers?.map((x) => (x.id === a.transferId && !x.settled ? { ...x, settled: { on: a.on, reference: a.reference.trim(), by: a.by, at: now() } } : x)) })), audit: log(`${deal.loanNumber}: share transfer settled ${a.on}`) };
    }
    case "drawCallSent": case "drawCallReceived": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const mark = (call: DrawCall): DrawCall => (call.id !== a.callId ? call : a.t === "drawCallSent" ? (call.sent ? call : { ...call, sent: { on: a.on, reference: a.reference.trim(), by: a.by, at: now() } }) : (call.received ? call : { ...call, received: { on: a.on, by: a.by, at: now() } }));
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, drawCalls: d.drawCalls?.map(mark) })), audit: log(`${deal.loanNumber}: partner's share of a draw ${a.t === "drawCallSent" ? "sent" : "received"} ${a.on}`) };
    }
    case "recordFloodMap": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      // A portfolio property's zone is its own; a special flood hazard area anywhere on the loan needs flood insurance.
      if (a.propertyId) return { ...s, deals: upd(a.dealId, (d) => withFloodFollowUps({ ...d, properties: d.properties?.map((p) => (p.id === a.propertyId ? { ...p, floodMap: a.map } : p)) }, a.map.mapped && a.map.sfha, serviceDay(s), a.map.at)), audit: log(`${deal.loanNumber}: FEMA flood map for ${deal.properties?.find((p) => p.id === a.propertyId)?.address ?? "a property"} ${a.map.mapped ? `shows zone ${a.map.zone}` : "has no flood zone (not mapped)"}`) };
      return { ...s, deals: upd(a.dealId, (d) => applyFloodMap(d, a.map, serviceDay(s))), audit: log(`${deal.loanNumber}: FEMA flood map ${a.map.mapped ? `shows zone ${a.map.zone}${a.map.sfha ? ", a special flood hazard area" : ""}` : "has no flood zone here (not mapped)"}`) };
    }
    case "recordStormCheck": {
      const result = afterCheck(s.storms ?? [], a.storms, a.at);
      // A storm that's passed: draws on its loans need an inspection from after it.
      const held = new Map(result.passed.flatMap((storm) => storm.dealIds.map((id) => [id, { stormId: storm.id, name: storm.label, passedAt: a.at }] as const)));
      const notes = [...result.added.map((storm) => `${storm.label}: forecast cone covers ${storm.dealIds.length} funded loan${storm.dealIds.length === 1 ? "" : "s"}`), ...result.passed.map((storm) => `${storm.label} has passed: photos and fresh inspections for ${storm.dealIds.length} loan${storm.dealIds.length === 1 ? "" : "s"}`)];
      return { ...s, storms: result.storms, deals: held.size ? s.deals.map((d) => (held.has(d.id) ? { ...d, stormHold: held.get(d.id) } : d)) : s.deals, audit: notes.reduce((list, text) => [{ at: now(), text }, ...list], s.audit).slice(0, 50) };
    }
    case "saveLastSale": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, lastSale: { price: Math.round(a.price), on: a.on, by: a.by, at: now() } })), audit: log(`${deal.loanNumber}: last recorded sale entered by ${a.by}`) };
    }
    case "postInvestorUpdate": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, investorUpdates: [...(d.investorUpdates ?? []), { id: a.updateId, text: a.text.trim(), by: a.by, at: now() }] })), audit: log(`${deal.loanNumber}: update posted for its investors by ${a.by}`) };
    }
    case "setWorkout": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const at = now();
      // Lifting it keeps the record of what was agreed as an update.
      return { ...s, deals: upd(a.dealId, (d) => (a.on ? { ...d, workout: { since: serviceDay(s), note: a.note.trim(), by: a.by, at } } : { ...d, workout: undefined, investorUpdates: [...(d.investorUpdates ?? []), { id: `wo${uid()}`, text: `Workout ended: ${a.note.trim()}`, by: a.by, at }] })), audit: log(`${deal.loanNumber}: workout ${a.on ? "declared" : "ended"} by ${a.by}`) };
    }
    case "answerSurvey": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (surveyProblem(deal, a.stage, a.score, serviceDay(s))) return s;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, surveys: [...(d.surveys ?? []), { stage: a.stage, score: a.score, comment: a.comment.trim(), at: now() }] })), audit: log(`${deal.loanNumber}: the borrower answered the ${a.stage === "funded" ? "closing" : "payoff"} survey`) };
    }
    case "referralBonusPaid": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, friendReferral: { ...d.friendReferral!, paid: { amount: round2(a.amount), on: a.on, reference: a.reference.trim(), by: a.by, at: now() } } })), audit: log(`${deal.loanNumber}: referral bonus of $${round2(a.amount).toLocaleString("en-US")} paid to ${deal.friendReferral?.referrerName ?? "the referrer"}`) };
    }
    case "setBrokerPoints": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, brokerPoints: round2(a.points) })), audit: log(`${deal.loanNumber}: broker's fee set to ${round2(a.points)} points`) };
    }
    case "brokerFeePaid": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, brokerFeePaid: { amount: round2(a.amount), on: a.on, reference: a.reference.trim(), by: a.by, at: now() } })), audit: log(`${deal.loanNumber}: broker's fee of $${round2(a.amount).toLocaleString("en-US")} paid`) };
    }
    case "assignLoanTeam": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const { [a.role]: _gone, ...rest } = deal.team ?? {};
      const team = a.member ? { ...rest, [a.role]: a.member } : rest;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, team: Object.keys(team).length ? team : undefined })), audit: log(`${deal.loanNumber}: ${a.member ? `${a.member.name} is the ${TEAM_ROLE_LABEL[a.role].toLowerCase()}` : `no ${TEAM_ROLE_LABEL[a.role].toLowerCase()}`} (${a.by})`) };
    }
    case "linkBorrower": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, borrowerId: a.borrowerId, borrowerName: a.borrowerName })), audit: log(`${deal.loanNumber}: borrower account linked`) };
    }
    case "saveSponsor": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      // Nothing listed is verified until staff check it, whatever the request says.
      const sponsor = { ...a.sponsor, trackRecord: a.sponsor.trackRecord.map((item) => ({ ...item, verified: deal.sponsor?.trackRecord.find((old) => old.id === item.id && old.address === item.address)?.verified })) };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, sponsor, app: withSponsor(d.app, sponsor, new Date()), docs: [...d.docs, ...missingDocs(d.docs, d.app, sponsor)] })), audit: log(`${deal.loanNumber}: borrower profile updated`) };
    }
    case "applyBorrowerInfo": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      // Once a term sheet is out or credit is signed off, the numbers are underwriting's: the team updates it by hand.
      if (!["submitted", "initial_review", "underwriting"].includes(deal.status) || deal.creditReview) return s;
      const sponsor = carryOverTrackRecord({ ...a.sponsor, trackRecord: a.sponsor.trackRecord.map(({ verified: _verified, ...item }) => item) }, earlierLoans(s.deals, deal.borrowerId).filter((item) => item.id !== deal.id));
      const app = withSponsor({ ...a.app, pricingVersion: deal.app.pricingVersion, repeat: deal.app.repeat, repeatBorrower: deal.app.repeatBorrower }, sponsor, new Date());
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, app, sponsor, address: a.address, city: a.city, zip: a.zip, entityName: a.entityName, exitStrategy: a.exitStrategy, docs: [...d.docs, ...missingDocs(d.docs, app, sponsor)] })), audit: log(`${deal.loanNumber}: borrower application signed by ${a.signedBy}`) };
    }
    case "verifyTrackDeal": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, sponsor: d.sponsor && { ...d.sponsor, trackRecord: d.sponsor.trackRecord.map((item) => (item.id === a.trackId ? { ...item, verified: a.verified } : item)) } })), audit: log(`${deal.loanNumber}: past deal ${a.verified ? "verified" : "unverified"}`) };
    }
    case "signOffCredit": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      // From here the loan is priced on what was checked, not on what was claimed.
      const app = deal.sponsor ? withSponsor(deal.app, deal.sponsor, new Date(), true) : deal.app;
      const verifiedDeals = deal.sponsor ? countedDeals(deal.sponsor.trackRecord, new Date(), true).deals : deal.app.verifiedDeals;
      // A signed-off credit review means the application had what a decision needs: it's complete by then at the latest.
      const completed = deal.completed ?? { at: now(), on: serviceDay(s), by: a.by };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, app, creditReview: { by: a.by, at: now(), note: a.note, verifiedDeals }, completed })), audit: log(`${deal.loanNumber}: credit review signed off by ${a.by}`) };
    }
    case "reopenCreditReview": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, creditReview: undefined })), audit: log(`${deal.loanNumber}: credit review reopened`) };
    }
    case "saveSource": return { ...s, sources: s.sources.some((x) => x.id === a.source.id) ? s.sources.map((x) => (x.id === a.source.id ? a.source : x)) : [...s.sources, a.source], audit: log(`Capital source saved: ${a.source.name}`) };
    case "removeSource": return { ...s, sources: s.sources.filter((x) => x.id !== a.id), audit: log("Capital source removed") };
    case "firmScreened": {
      const list = a.kind === "partner" ? s.partners : s.buyers;
      const firm = list.find((x) => x.id === a.firmId);
      if (!firm) return s;
      // The same names with the same hits only moves the date it was confirmed, so a reviewed result stays decided.
      const latest = firm.screening;
      const screening = latest && sameResult(latest, a.screening) ? { ...latest, checkedAt: a.screening.at, list: a.screening.list } : a.screening;
      const saved = list.map((x) => (x.id === a.firmId ? { ...x, screening } : x));
      return { ...s, ...(a.kind === "partner" ? { partners: saved } : { buyers: saved }), ...(screening === a.screening ? { audit: log(`${firm.name}: OFAC screening ${a.screening.status === "clear" ? "clear" : "found a possible match"}`) } : {}) };
    }
    case "decideFirmScreening": {
      const decide = <T extends { id: string; screening?: Screening }>(items: T[]) => items.map((x) => (x.id === a.firmId && x.screening?.id === a.screeningId && x.screening.status === "review" ? { ...x, screening: { ...x.screening, status: a.decision, decided: { by: a.by, at: now(), reason: a.reason.trim() } } } : x));
      const name = (a.kind === "partner" ? s.partners : a.kind === "buyer" ? s.buyers : s.brokers).find((x) => x.id === a.firmId)?.name ?? a.firmId;
      const changes = a.kind === "partner" ? { partners: decide(s.partners) } : a.kind === "buyer" ? { buyers: decide(s.buyers) } : { brokers: decide(s.brokers) };
      return { ...s, ...changes, audit: log(`${name}: possible OFAC match ${a.decision === "cleared" ? "cleared" : "confirmed"} by ${a.by}`) };
    }
    case "saveFirm": {
      const list = a.kind === "partner" ? s.partners : s.buyers;
      const had = list.find((x) => x.id === a.id);
      const principals = (a.principals ?? had?.principals ?? []).map((name) => name.trim()).filter(Boolean);
      const firm = { ...had, id: a.id, name: a.name, ndaSigned: had?.ndaSigned ?? false, buyBox: a.buyBox, ...(principals.length ? { principals } : { principals: undefined }) };
      const saved = list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? firm : x)) : [...list, firm];
      return { ...s, ...(a.kind === "partner" ? { partners: saved } : { buyers: saved }), audit: log(`${a.kind === "partner" ? "Partner lender" : "Loan buyer"} saved: ${a.name}`) };
    }
    case "advanceLoan": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const stage = nextStage(deal, evaluate(deal.app), serviceDay(s));
      // A term sheet goes out with its terms through issueTermSheet, never as a bare status change.
      if (!stage || !canAdvance(stage) || stage.to === "term_sheet_issued") return s;
      const funding = stage.to === "funded";
      const today = serviceDay(s);
      // Clearing conditions starts the title company's checklist and adds the library's standard conditions (Spec 4.3).
      const docs = stage.to === "conditions" ? [...deal.docs, ...missingClosingItems(deal)] : deal.docs;
      const conditions = stage.to === "conditions" ? [...(deal.conditions ?? []), ...missingStandard(deal, libraryOf(s)).map((template) => fromTemplate(template, `cond${uid()}`, "LendHous", today, now()))] : deal.conditions;
      const advanced: Book = { ...s, deals: upd(a.dealId, (d) => ({ ...d, status: stage.to, daysInStage: 0, docs, conditions, ...(funding ? { capitalStatus: "funded" as const, closingDate: today, nextPaymentDue: firstDueDate(today) } : {}) })), audit: log(`${deal.loanNumber}: moved to ${stage.to.replace(/_/g, " ")}`) };
      // A refinance's money pays off the LendHous loan it replaces, for what that loan owes on the day it funds.
      const replaced = funding && deal.refinances ? advanced.deals.find((d) => d.id === deal.refinances && SERVICED.includes(d.status)) : undefined;
      if (!replaced) return advanced;
      const owed = payoffOn(settle(replaced, today), today).quote.total;
      return apply(advanced, { t: "recordPayoff", dealId: replaced.id, amount: owed, receivedOn: today, method: "other", reference: `Refinanced by ${deal.loanNumber}`, by: "LendHous (refinance)" });
    }
    case "repriceLoan": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const to = currentPricing().version;
      if (deal.app.pricingVersion === to) return s;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, app: { ...d.app, pricingVersion: to } })), audit: log(`${deal.loanNumber}: repriced on ${to} by ${a.by}`) };
    }
    case "addCondition": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const today = serviceDay(s);
      if (addProblem(deal, a.condition, today)) return s;
      const template = a.condition.templateId ? libraryOf(s).find((item) => item.id === a.condition.templateId) : undefined;
      const added: LoanCondition = template
        ? { ...fromTemplate(template, `cond${uid()}`, a.by, today, now()), ...(a.condition.dueOn ? { dueOn: a.condition.dueOn } : {}) }
        : { id: `cond${uid()}`, title: a.condition.title.trim(), detail: a.condition.detail.trim(), category: a.condition.category, owner: a.condition.owner, needsUpload: a.condition.needsUpload, ...(a.condition.dueOn ? { dueOn: a.condition.dueOn } : {}), status: "open", addedBy: a.by, addedAt: now(), files: [] };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, conditions: [...(d.conditions ?? []), added] })), audit: log(`${deal.loanNumber}: condition added: ${added.title}`) };
    }
    case "clearCondition": case "returnCondition": case "waiveCondition": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const condition = deal.conditions?.find((item) => item.id === a.conditionId);
      const to = a.t === "clearCondition" ? "cleared" : a.t === "waiveCondition" ? "waived" : "returned";
      const text = a.t === "clearCondition" ? a.note : a.reason;
      if (changeProblem(condition, to, text)) return s;
      const stamp = { by: a.by, at: now() };
      const change: Partial<LoanCondition> = a.t === "clearCondition" ? { status: "cleared", cleared: { ...stamp, note: a.note.trim() } } : a.t === "waiveCondition" ? { status: "waived", waived: { ...stamp, reason: a.reason.trim() } } : { status: "open", returned: { ...stamp, reason: a.reason.trim() } };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, conditions: d.conditions!.map((item) => (item.id === a.conditionId ? { ...item, ...change } : item)) })), audit: log(`${deal.loanNumber}: condition ${to}: ${condition!.title}`) };
    }
    case "conditionFile": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const condition = deal.conditions?.find((item) => item.id === a.conditionId);
      if (!condition || condition.status === "cleared" || condition.status === "waived") return s;
      const file = { fileName: a.fileName, ...(a.documentId ? { documentId: a.documentId } : {}), at: now(), by: a.by };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, conditions: d.conditions!.map((item) => (item.id === a.conditionId ? { ...item, status: "submitted" as const, files: [...item.files, file] } : item)) })), audit: log(`${deal.loanNumber}: file sent for ${condition.title}`) };
    }
    case "saveConditionTemplate": {
      if (templateProblem(a.template)) return s;
      const library = libraryOf(s);
      const prior = a.template.id ? library.find((item) => item.id === a.template.id) : undefined;
      if (a.template.id && !prior) return s;
      const { rental, ...template } = a.template;
      const saved: ConditionTemplate = { ...template, ...(rental && (!template.products.length || template.products.includes("dscr")) ? { rental } : {}), id: prior?.id ?? `tpl${uid()}`, title: a.template.title.trim(), detail: a.template.detail.trim(), version: (prior?.version ?? 0) + 1, updatedBy: a.by, updatedAt: now() };
      return { ...s, conditionLibrary: prior ? library.map((item) => (item.id === prior.id ? saved : item)) : [...library, saved], audit: log(`Conditions library: ${prior ? (saved.active ? "changed" : prior.active ? "retired" : "changed") : "added"} "${saved.title}" (version ${saved.version})`) };
    }
    case "acceptTermSheet": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (respondProblem(deal, serviceDay(s)) || !a.signedName.trim()) return s;
      const at = now(); const name = a.signedName.trim();
      // A choice of rate and points has to be one the term sheet offered.
      const sheet = latestSheet(deal);
      const choice = a.points === undefined ? undefined : optionAt(sheet?.buyDowns, a.points);
      if (a.points !== undefined && !choice) return s;
      const app = choice ? { ...deal.app, termRate: choice.rate, termPoints: choice.points } : deal.app;
      const e = evaluate(app);
      const moved = Boolean(sheet && choice && (Math.abs(choice.rate - sheet.terms.rate) > 1e-9 || Math.abs(choice.points - sheet.terms.pointsPct) > 1e-9));
      // Accepting locks the rate and points: nothing priced later moves them (Spec A9).
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, app: { ...app, termRate: e.rate, termPoints: e.pointsPct }, status: "term_sheet_accepted", daysInStage: 0, termSheetSignedBy: name, termSheetSignedAt: at,
        termSheets: d.termSheets?.map((x, i, all) => (i === all.length - 1 ? { ...x, status: "accepted" as const, response: { at, by: name, signedName: name }, ...(moved ? { terms: chosenTerms(d, x, choice!), boughtDown: { rate: x.terms.rate, pointsPct: x.terms.pointsPct } } : {}) } : x)) })), audit: log(`${deal.loanNumber}: term sheet${sheet ? ` ${sheet.version}` : ""} accepted by ${name}${moved ? `, choosing ${e.rate}% with ${e.pointsPct} points` : ""}`) };
    }
    case "issueTermSheet": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const input = { rate: a.rate, points: a.points, termMonths: a.termMonths, prepay: a.prepay };
      if (sheetProblem(deal, input)) return s;
      const sheet = draftSheet(deal, input, a.by, serviceDay(s), now());
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, app: pricedApp(d.app, input), status: "term_sheet_issued", daysInStage: 0, pricingException: undefined, termSheetSignedBy: undefined, termSheetSignedAt: undefined,
        termSheets: [...(d.termSheets ?? []).map((x) => (x.status === "sent" ? { ...x, status: "superseded" as const } : x)), sheet] })),
        audit: log(`${deal.loanNumber}: term sheet ${sheet.version} sent at ${sheet.terms.rate}% and ${sheet.terms.pointsPct} points, open until ${sheet.expiresOn}`) };
    }
    case "requestPricingException": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const input = { rate: a.rate, points: a.points, termMonths: a.termMonths, prepay: a.prepay };
      if (exceptionRequestProblem(deal, input, a.note)) return s;
      const pricingException = { rate: a.rate, points: a.points, termMonths: a.termMonths, reasons: exceptionReasons(deal.app, input), note: a.note.trim(), requestedBy: a.by, requestedAt: now(), status: "pending" as const };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, pricingException })), audit: log(`${deal.loanNumber}: pricing exception asked for by ${a.by}: ${a.rate}% and ${a.points} points`) };
    }
    case "decidePricingException": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (exceptionDecisionProblem(deal, a.by)) return s;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, pricingException: { ...d.pricingException!, status: a.approve ? "approved" : "declined", decidedBy: a.by, decidedAt: now(), decision: a.note.trim() } })), audit: log(`${deal.loanNumber}: pricing exception ${a.approve ? "approved" : "declined"} by ${a.by}`) };
    }
    case "requestTermSheetChanges": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (respondProblem(deal, serviceDay(s)) || !a.note.trim()) return s;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, status: "underwriting", daysInStage: 0, termSheets: d.termSheets?.map((x, i, all) => (i === all.length - 1 ? { ...x, status: "changes_requested" as const, response: { at: now(), by: a.by, note: a.note.trim() } } : x)) })), audit: log(`${deal.loanNumber}: changes asked for on the term sheet`) };
    }
    case "checkTermSheets": {
      const { remind, expire } = termSheetChecks(s.deals, a.asOf);
      if (!remind.length && !expire.length) return s;
      const last = (d: Deal, change: Partial<NonNullable<Deal["termSheets"]>[number]>) => d.termSheets!.map((x, i, all) => (i === all.length - 1 ? { ...x, ...change } : x));
      // An expired term sheet sends the loan back to underwriting for a new one (Spec 4.3).
      return { ...s, deals: s.deals.map((d) => (expire.includes(d.id) ? { ...d, status: "underwriting" as const, daysInStage: 0, termSheets: last(d, { status: "expired" }) } : remind.includes(d.id) ? { ...d, termSheets: last(d, { remindedOn: a.asOf }) } : d)),
        audit: [...expire.map((id) => ({ at: now(), text: `${s.deals.find((d) => d.id === id)!.loanNumber}: term sheet expired` })), ...s.audit].slice(0, 50) };
    }
    case "saveScope": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, scope: a.scope, scopeSummary: a.summary, docs: d.docs.map((x) => (x.id === "sow" && (x.status === "requested" || x.status === "rejected") ? { ...x, status: "in_review", fileName: "Scope of work (online)" } : x)) })), audit: log(`${deal.loanNumber}: scope of work submitted`) };
    }
    case "requestDraw": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const lines = a.lines.filter((line) => line.requested > 0);
      if (drawRequestError(deal, lines)) return s;
      const at = now();
      // Only the photos of lines asked for, each stamped with when it arrived so its age can be checked.
      const linePhotos = (a.linePhotos ?? []).filter((photo) => lines.some((line) => line.scopeId === photo.scopeId)).map((photo, index): DrawPhoto => ({ ...photo, id: `dp${uid()}${index}`, at }));
      // Checked from the borrower's photos where it qualifies and they asked; otherwise by an inspector. Its fee is fixed now.
      const path: DrawPath = a.path === "desk" && !deskProblem(s, deal, lines, linePhotos, at) ? "desk" : "inspector";
      const fee = drawFees()[path];
      const draw: DrawRequest = { id: `draw${uid()}`, dealId: a.dealId, requestedAt: at, by: a.by, note: a.note, contact: a.contact, photos: a.photos, photoIds: a.photoIds, lines: lines.map((line) => (line.claimedPct === undefined ? line : { ...line, claimedPct: Math.min(1, Math.max(0, line.claimedPct)) })), ...(linePhotos.length ? { linePhotos } : {}), status: "submitted", approvers: [], path, ...(fee ? { fee } : {}) };
      return { ...s, draws: [draw, ...s.draws], audit: log(`${deal.loanNumber}: draw of $${lines.reduce((sum, line) => sum + line.requested, 0).toLocaleString()} requested`) };
    }
    case "askForPhotos": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const request: PhotoRequest = { id: a.requestId, dealId: a.dealId, drawId: a.drawId, ...(a.stormId ? { stormId: a.stormId } : {}), to: a.to, email: a.email, who: a.who, scopeIds: a.scopeIds, sentBy: a.by, byTeam: a.byTeam, sentAt: now(), expiresAt: a.expiresAt, status: "open", photos: [] };
      // Photos of the property after a storm are its follow-up, so the storm page shows who's been asked.
      const storms = a.stormId ? (s.storms ?? []).map((storm) => (storm.id === a.stormId ? { ...storm, followedUp: [...new Set([...(storm.followedUp ?? []), a.dealId])] } : storm)) : s.storms;
      return { ...s, storms, photoRequests: [request, ...s.photoRequests], audit: log(`${deal.loanNumber}: ${a.stormId ? "photos of the property after the storm" : "photos"} requested from ${a.to}`) };
    }
    case "renewPhotoRequest": return { ...s, photoRequests: photos(a.requestId, (r) => ({ ...r, expiresAt: a.expiresAt, status: r.status === "off" ? (r.finishedAt ? "received" : "open") : r.status })), audit: log(`New photo link sent to ${requestOf(a.requestId).to}`) };
    case "turnOffPhotoRequest": return { ...s, photoRequests: photos(a.requestId, (r) => ({ ...r, status: "off" })), audit: log(`Photo link for ${requestOf(a.requestId).to} turned off`) };
    case "addRequestPhoto": return { ...s, photoRequests: photos(a.requestId, (r) => ({ ...r, photos: [...r.photos, a.photo] })) };
    case "removeRequestPhoto": return { ...s, photoRequests: photos(a.requestId, (r) => ({ ...r, photos: r.photos.filter((photo) => photo.id !== a.photoId) })) };
    case "finishPhotoRequest": {
      const request = requestOf(a.requestId); const deal = s.deals.find((d) => d.id === request.dealId)!;
      const signs = Boolean(a.signDraw && request.who === "contractor" && request.drawId);
      // An inspector's link records the inspection itself: percent complete on each of the draw's lines.
      const inspects = Boolean(a.observed && request.who === "inspector" && s.draws.some((draw) => draw.id === request.drawId && draw.status === "inspecting"));
      const at = now();
      return { ...s, photoRequests: photos(a.requestId, (r) => ({ ...r, status: "received", finishedAt: at, finishedBy: a.by, note: a.note })),
        draws: s.draws.map((draw) => {
          if (draw.id !== request.drawId) return draw;
          const signed = signs ? { ...draw, contractorSigned: { name: a.by.trim(), at, requestId: request.id } } : draw;
          return inspects ? { ...signed, status: "inspected" as const, lines: signed.lines.map((line) => ({ ...line, observedPct: Math.min(1, Math.max(0, a.observed![line.scopeId] ?? 0)) })), inspection: { by: a.by.trim(), at, requestId: request.id, notes: a.note.trim() } } : signed;
        }),
        audit: log(`${deal.loanNumber}: ${request.photos.length} photos received from ${a.by}${signs ? ", who signed off the draw's work" : ""}${inspects ? ", who recorded the inspection" : ""}`) };
    }
    case "sendInspector": {
      // A storm since the last inspection sends an inspected or approved draw back for a fresh one (lib/storms.ts).
      const again = (d: DrawRequest) => (d.status === "inspected" || d.status === "approved") && Boolean(freshInspectionNeeded(s.deals.find((deal) => deal.id === d.dealId) ?? {}, d));
      // A photo review sent on to an inspector takes the inspector's fee instead, and says why.
      const escalate = (d: DrawRequest) => d.path === "desk" && d.status === "submitted";
      return { ...s, draws: s.draws.map((d) => (d.id === a.drawId && (d.status === "submitted" || again(d)) ? { ...d, status: "inspecting", ...(again(d) ? { approvers: [], approved: undefined } : {}), ...(escalate(d) ? { path: "inspector" as const, fee: drawFees().inspector || undefined, escalated: { by: a.by ?? "The team", at: now(), reason: a.reason?.trim() ?? "" } } : {}) } : d)), audit: log(s.draws.some((d) => d.id === a.drawId && escalate(d)) ? `Photo review sent on to an inspector: ${a.reason?.trim()}` : "Draw inspection ordered") };
    }
    case "deskReview": {
      const draw = s.draws.find((d) => d.id === a.drawId);
      if (!draw || deskReviewProblem(draw, a.observed)) return s;
      const at = now();
      return { ...s, draws: s.draws.map((d) => (d.id === a.drawId ? { ...d, status: "inspected", lines: d.lines.map((line) => ({ ...line, observedPct: a.observed[line.scopeId] })), inspection: { by: a.by, at, notes: a.note.trim(), method: "desk" } } : d)), audit: log(`Draw reviewed from the borrower's photos by ${a.by}`) };
    }
    case "recordInspection": return { ...s, draws: s.draws.map((d) => (d.id === a.drawId && d.status === "inspecting" ? { ...d, status: "inspected", lines: d.lines.map((line) => ({ ...line, observedPct: a.observed[line.scopeId] ?? 0 })), inspection: { by: "The team", at: now(), notes: "" } } : d)), audit: log("Draw inspection recorded") };
    case "approveDrawRequest": {
      const draw = s.draws.find((d) => d.id === a.drawId)!; const deal = s.deals.find((d) => d.id === draw.dealId)!;
      if (approvalError(deal, draw, a.by)) return s;
      const amount = reviewDraw(deal, draw).approved;
      const approvers = [...draw.approvers, a.by];
      const done = approvers.length >= approversNeeded(deal, amount);
      return { ...s, draws: s.draws.map((d) => (d.id === a.drawId ? { ...d, approvers, status: done ? "approved" : d.status, approved: done ? amount : undefined, decidedAt: done ? now() : d.decidedAt } : d)), audit: log(`${deal.loanNumber}: draw approved by ${a.by}${done ? "" : "; second approver needed"}`) };
    }
    case "rejectDraw": return { ...s, draws: s.draws.map((d) => (d.id === a.drawId ? { ...d, status: "rejected", reason: a.reason, decidedAt: now() } : d)), audit: log(`Draw rejected: ${a.reason}`) };
    case "releaseDraw": {
      const draw = s.draws.find((d) => d.id === a.drawId)!; const deal = s.deals.find((d) => d.id === draw.dealId)!;
      // No money goes out to anyone not screened in the last few days.
      // Nor before the lien law's protections are in place, unless an owner released it past them (Fla. Stat. ch. 713).
      if (draw.status !== "approved" || !draw.approved || ofacBlocker(deal, serviceDay(s)) || unreleasedHolds(deal, draw, serviceDay(s)).length) return s;
      return { ...s,
        draws: s.draws.map((d) => (d.id === a.drawId ? { ...d, status: "funded", fundedAt: now() } : d)),
        // Brought up to today first, so the payments already due keep the amount they owed before this draw.
        // Partners that fund draws as they're released are asked for their share; LendHous has paid the borrower already.
        deals: upd(deal.id, (d) => ({ ...settle(d, serviceDay(s)), disbursedDraws: (d.disbursedDraws ?? 0) + draw.approved!, scope: releaseToScope(d.scope ?? [], d, draw), ...(d.partnerFunding?.drawsAsReleased ? { drawCalls: [...(d.drawCalls ?? []), ...drawCallsFor(s, d, draw.id, draw.approved!, serviceDay(s), (n) => `dc${uid()}${n}`)] } : {}) })),
        audit: log(`${deal.loanNumber}: draw of $${draw.approved.toLocaleString()} released${draw.fee ? `, $${toSend(draw).toLocaleString("en-US")} sent after the $${draw.fee.toLocaleString("en-US")} ${draw.path === "desk" ? "photo review" : "inspection"} fee` : ""}`) };
    }
    case "requestChangeOrder": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (changeOrderProblem(deal, a)) return s;
      const order: ChangeOrder = { id: a.orderId, from: a.from, to: a.to, ...(a.to === "new" ? { newDivision: a.newDivision!.trim() } : {}), amount: round2(a.amount), reason: a.reason.trim(), ...(a.arv ? { arv: a.arv } : {}), by: a.by, byTeam: a.byTeam, at: now(), status: "requested" };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, changeOrders: [...(d.changeOrders ?? []), order] })), audit: log(`${deal.loanNumber}: change order asked for by ${a.by}: $${order.amount.toLocaleString("en-US")}`) };
    }
    case "decideChangeOrder": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const order = deal.changeOrders?.find((item) => item.id === a.orderId);
      // Checked again on the budget as it is now: a draw may have used the money since it was asked for.
      if (order?.status !== "requested" || (a.approve && changeOrderProblem(deal, order))) return s;
      const decided = { by: a.by, at: now(), note: a.note.trim() };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, ...(a.approve ? { scope: applyChange(d.scope ?? [], order) } : {}), changeOrders: d.changeOrders!.map((item) => (item.id === a.orderId ? { ...item, status: a.approve ? "approved" as const : "declined" as const, decided } : item)) })), audit: log(`${deal.loanNumber}: change order ${a.approve ? "approved" : "declined"} by ${a.by}`) };
    }
    case "recordOverrun": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const overrun = { id: a.overrunId, amount: round2(a.amount), ...(a.scopeId ? { scopeId: a.scopeId } : {}), note: a.note.trim(), by: a.by, at: now() };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, overruns: [...(d.overruns ?? []), overrun] })), audit: log(`${deal.loanNumber}: overrun of $${overrun.amount.toLocaleString("en-US")} found by ${a.by}`) };
    }
    case "coverOverrun": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, overruns: (d.overruns ?? []).map((item) => (item.id === a.overrunId && !item.covered ? { ...item, covered: { by: a.by, at: now(), how: a.how.trim() } } : item)) })), audit: log(`${deal.loanNumber}: overrun covered (${a.how.trim()})`) };
    }
    case "saveLienFile": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (lienFileProblem(a, serviceDay(s))) return s;
      const noc = a.noc ? { ...a.noc, reference: a.noc.reference.trim(), expiresOn: a.noc.expiresOn || defaultNocExpiry(a.noc.recordedOn), by: a.by, at: now() } : deal.lienFile?.noc;
      const lienFile = { notices: [], ...deal.lienFile, contractor: a.contractor.trim(), noc, ...(a.mortgageRecordedOn ? { mortgageRecordedOn: a.mortgageRecordedOn } : {}) };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, lienFile })), audit: log(`${deal.loanNumber}: lien file saved${a.noc ? `, notice of commencement recorded ${a.noc.recordedOn}` : ""}`) };
    }
    case "addNoticeToOwner": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (!a.lienor.trim() || a.servedOn > serviceDay(s)) return s;
      const notice: NoticeToOwner = { id: `nto${uid()}`, lienor: a.lienor.trim(), role: a.role, servedOn: a.servedOn, by: a.by, at: now() };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, lienFile: { ...d.lienFile, notices: [...(d.lienFile?.notices ?? []), notice] } })), audit: log(`${deal.loanNumber}: notice to owner from ${notice.lienor}`) };
    }
    case "saveInsurance": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const input = { kind: a.kind, carrier: a.carrier.trim(), policy: a.policy.trim(), expiresOn: a.expiresOn, ...(a.coverage !== undefined ? { coverage: Math.round(a.coverage) } : {}), ...(a.windIncluded !== undefined && a.kind !== "windstorm" && a.kind !== "flood" ? { windIncluded: a.windIncluded } : {}), ...(a.mortgagee !== undefined ? { mortgagee: a.mortgagee } : {}), ...(a.citizens !== undefined ? { citizens: a.citizens } : {}), ...(a.kind === "flood" && a.program ? { program: a.program } : {}) };
      if (policyProblem(deal, input)) return s;
      const policy: InsurancePolicy = { ...input, by: a.by, at: now() };
      return { ...s, deals: upd(a.dealId, (d) => withInsurance(d, putPolicy(insuranceFileOf(d), policy))), audit: log(`${deal.loanNumber}: ${policyWord(a.kind)} policy on file to ${a.expiresOn}`) };
    }
    case "saveAssociationPolicy": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const association = { carrier: a.carrier.trim(), citizens: a.citizens, by: a.by, at: now() };
      return { ...s, deals: upd(a.dealId, (d) => withInsurance(d, { ...insuranceFileOf(d), association })), audit: log(`${deal.loanNumber}: the condo association's building is insured by ${association.carrier}`) };
    }
    case "setFloodZone": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const flood = { sfha: a.sfha, zone: a.zone.trim().toUpperCase(), by: a.by, at: now() };
      return { ...s, deals: upd(a.dealId, (d) => withFloodFollowUps(withInsurance(d, { ...insuranceFileOf(d), flood }), flood.sfha, serviceDay(s), flood.at)), audit: log(`${deal.loanNumber}: flood zone recorded${flood.zone ? ` (${flood.zone})` : ""}, ${a.sfha ? "in" : "not in"} a special flood hazard area`) };
    }
    case "insuranceRenewal": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (renewalProblem(deal, a, serviceDay(s))) return s;
      const renewal: InsuranceRenewal = { id: `ren${uid()}`, kind: a.kind, carrier: a.carrier.trim(), policy: a.policy.trim(), expiresOn: a.expiresOn, fileName: a.fileName, ...(a.documentId ? { documentId: a.documentId } : {}), by: a.by, at: now(), status: "submitted" };
      return { ...s, deals: upd(a.dealId, (d) => { const file = insuranceFileOf(d); return withInsurance(d, { ...file, renewals: [...(file.renewals ?? []), renewal] }); }), audit: log(`${deal.loanNumber}: ${policyWord(a.kind)} renewal sent in, to ${a.expiresOn}`) };
    }
    case "decideRenewal": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const file = insuranceFileOf(deal);
      const renewal = file.renewals?.find((item) => item.id === a.renewalId);
      if (!renewal || renewal.status !== "submitted" || (!a.accept && !a.note.trim())) return s;
      const decided = { ...renewal, status: a.accept ? ("accepted" as const) : ("returned" as const), decided: { by: a.by, at: now(), note: a.note.trim() } };
      const renewals = (file.renewals ?? []).map((item) => (item.id === a.renewalId ? decided : item));
      const policy: InsurancePolicy = { kind: renewal.kind, carrier: renewal.carrier, policy: renewal.policy, expiresOn: renewal.expiresOn, mortgagee: a.mortgagee, ...(a.coverage !== undefined ? { coverage: Math.round(a.coverage) } : {}), ...(a.windIncluded !== undefined && renewal.kind !== "windstorm" && renewal.kind !== "flood" ? { windIncluded: a.windIncluded } : {}), fileName: renewal.fileName, ...(renewal.documentId ? { documentId: renewal.documentId } : {}), by: a.by, at: now() };
      const next = a.accept ? putPolicy({ ...file, renewals }, policy) : { ...file, renewals };
      return { ...s, deals: upd(a.dealId, (d) => withInsurance(d, next)), audit: log(`${deal.loanNumber}: ${policyWord(renewal.kind)} renewal ${a.accept ? `accepted, on file to ${renewal.expiresOn}` : "sent back"}`) };
    }
    case "lienWaiverReceived": case "affidavitReceived": {
      const draw = s.draws.find((d) => d.id === a.drawId);
      const deal = draw && s.deals.find((d) => d.id === draw.dealId);
      if (!draw || !deal || draw.status === "funded" || draw.status === "rejected") return s;
      if (a.t === "affidavitReceived") return { ...s, draws: s.draws.map((d) => (d.id === a.drawId ? { ...d, affidavit: { fileName: a.fileName, ...(a.documentId ? { documentId: a.documentId } : {}), sentBy: a.by, sentAt: now() } } : d)), audit: log(`${deal.loanNumber}: contractor's final affidavit received`) };
      const party = partiesFor(deal.lienFile, "9999-12-31").find((item) => item.key === a.partyKey);
      if (!party) return s;
      const waiver: LienWaiver = { id: `lw${uid()}`, partyKey: party.key, party: party.name, kind: a.kind, fileName: a.fileName, ...(a.documentId ? { documentId: a.documentId } : {}), sentBy: a.by, sentAt: now() };
      return { ...s, draws: s.draws.map((d) => (d.id === a.drawId ? { ...d, waivers: [...(d.waivers ?? []), waiver] } : d)), audit: log(`${deal.loanNumber}: ${a.kind} lien waiver from ${party.name} received`) };
    }
    case "checkLienWaiver": case "rejectLienWaiver": {
      const draw = s.draws.find((d) => d.id === a.drawId)!;
      const waiver = draw.waivers?.find((item) => item.id === a.waiverId);
      if (a.t === "checkLienWaiver" ? waiverCheckProblem(waiver, a.amount, a.throughOn, serviceDay(s)) : !waiver || waiver.checked || waiver.rejected || !a.reason.trim()) return s;
      const change = a.t === "checkLienWaiver" ? { checked: { by: a.by, at: now(), amount: a.amount, conditional: a.conditional, ...(a.throughOn ? { throughOn: a.throughOn } : {}) } } : { rejected: { by: a.by, at: now(), reason: a.reason.trim() } };
      return { ...s, draws: s.draws.map((d) => (d.id === a.drawId ? { ...d, waivers: d.waivers!.map((item) => (item.id === a.waiverId ? { ...item, ...change } : item)) } : d)), audit: log(`Lien waiver from ${waiver!.party} ${a.t === "checkLienWaiver" ? "checked" : "rejected"}`) };
    }
    case "checkAffidavit": {
      const draw = s.draws.find((d) => d.id === a.drawId)!;
      if (!draw.affidavit || draw.affidavit.checked) return s;
      return { ...s, draws: s.draws.map((d) => (d.id === a.drawId ? { ...d, affidavit: { ...d.affidavit!, checked: { by: a.by, at: now(), unpaidLienors: a.unpaidLienors } } } : d)), audit: log(`Contractor's final affidavit checked${a.unpaidLienors ? ": it lists unpaid lienors" : ""}`) };
    }
    case "setFinalDraw":
      return { ...s, draws: s.draws.map((d) => (d.id === a.drawId && d.status !== "funded" ? { ...d, final: a.final } : d)) };
    case "overrideDrawHolds": {
      const draw = s.draws.find((d) => d.id === a.drawId)!; const deal = s.deals.find((d) => d.id === draw.dealId)!;
      const holds = drawHolds(deal, draw, serviceDay(s));
      if (!holds.length || !a.reason.trim() || draw.status === "funded") return s;
      return { ...s, draws: s.draws.map((d) => (d.id === a.drawId ? { ...d, override: { by: a.by, at: now(), reason: a.reason.trim(), holds } } : d)), audit: log(`${deal.loanNumber}: draw released past ${holds.length} lien-law hold${holds.length === 1 ? "" : "s"} by ${a.by}: ${a.reason.trim()}`) };
    }
    case "checkInsurance": {
      const { remind, lapsed } = insuranceChecks(s.deals, a.asOf);
      if (!remind.length && !lapsed.length) return s;
      const told = (dealId: string, policy: InsurancePolicy) => lapsed.some((item) => item.dealId === dealId && item.kind === policy.kind) ? { ...policy, lapseNoticeOn: a.asOf } : remind.some((item) => item.dealId === dealId && item.kind === policy.kind) ? { ...policy, remindedOn: a.asOf } : policy;
      const touched = new Set([...remind, ...lapsed].map((item) => item.dealId));
      return { ...s, deals: s.deals.map((d) => (touched.has(d.id) ? withInsurance(d, { ...insuranceFileOf(d), policies: policiesOf(d).map((policy) => told(d.id, policy)) }) : d)) };
    }
    case "markApplicationComplete": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (deal.completed || a.on > serviceDay(s)) return s;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, completed: { at: now(), on: a.on, by: a.by } })), audit: log(`${deal.loanNumber}: application complete as of ${a.on}`) };
    }
    case "saveRevenue": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const revenue = { amount: Math.round(a.amount), year: a.year, by: a.by, at: now() };
      // A decline whose notice hasn't gone out follows the revenue now known.
      const adverseAction = deal.adverseAction && !deal.adverseAction.notice ? { ...deal.adverseAction, large: isLarge(revenue), dueOn: noticeDueOn({ completed: deal.completed, revenue }, deal.adverseAction.decidedOn) } : deal.adverseAction;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, revenue, adverseAction })), audit: log(`${deal.loanNumber}: gross revenue for ${a.year} recorded`) };
    }
    case "saveAdverseReasons": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const action = deal.adverseAction;
      if (!action || reasonsProblem(a.reasons) || (action.large ? action.statement : action.notice)) return s;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, adverseAction: { ...action, reasons: a.reasons.map((item) => item.trim()).filter(Boolean) } })), audit: log(`${deal.loanNumber}: reasons for the decline set`) };
    }
    case "recordAdverseNotice": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const owed = noticeOwed(deal);
      if (!owed || owed.kind !== a.kind) return s;
      const sent = { sentOn: serviceDay(s), sentAt: now(), by: a.by, method: a.method, to: a.to, ...(a.result ? { result: a.result } : {}) };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, adverseAction: { ...d.adverseAction!, [a.kind]: sent } })), audit: log(`${deal.loanNumber}: ${a.kind === "notice" ? "adverse action notice" : "statement of reasons"} sent by ${a.method}`) };
    }
    case "recordReasonsRequest": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (requestProblem(deal.adverseAction, a.receivedOn, serviceDay(s))) return s;
      const request = { receivedOn: a.receivedOn, by: a.by, at: now(), dueOn: addDays(a.receivedOn, STATEMENT_DAYS) };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, adverseAction: { ...d.adverseAction!, request } })), audit: log(`${deal.loanNumber}: written request for the decline reasons received ${a.receivedOn}`) };
    }
    case "addPropertyPhotos": {
      const deal = s.deals.find((d) => d.id === a.dealId);
      const known = new Set((deal?.propertyPhotos ?? []).map((photo) => photo.id));
      const added = a.photos.filter((photo) => !known.has(photo.id)).map((photo) => ({ ...photo, by: a.by }));
      if (!deal || !added.length) return s;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, propertyPhotos: [...(d.propertyPhotos ?? []), ...added] })), audit: log(`${deal.loanNumber}: ${added.length} photo${added.length === 1 ? "" : "s"} of the property added`) };
    }
    case "removePropertyPhoto": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (!deal.propertyPhotos?.some((photo) => photo.id === a.photoId)) return s;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, propertyPhotos: d.propertyPhotos!.filter((photo) => photo.id !== a.photoId) })), audit: log(`${deal.loanNumber}: a photo of the property removed`) };
    }
    case "setExitPlan": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (exitPlanProblem(a.plan)) return s;
      const plan: ExitPlan = { choice: a.plan.choice, confidence: a.plan.confidence, note: a.plan.note.trim(), ...(a.plan.choice === "sell" ? { listPrice: a.plan.listPrice, saleBy: a.plan.saleBy } : {}), ...(a.plan.choice === "refi_other" && a.plan.lender?.trim() ? { lender: a.plan.lender.trim() } : {}), by: a.by, at: now() };
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, exitPlan: plan })), audit: log(`${deal.loanNumber}: exit plan set by ${a.by}: ${EXIT_CHOICES[plan.choice].toLowerCase()} (${CONFIDENCE[plan.confidence].toLowerCase()})`) };
    }
    case "setShowcase": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (Boolean(deal.showcase?.on) === a.on) return s;
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, showcase: { on: a.on, by: a.by, at: now() } })), audit: log(`${deal.loanNumber}: ${a.on ? "shown on" : "taken off"} the website's recently funded list by ${a.by}`) };
    }
    case "setLegalHold": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const reason = a.reason.trim();
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, legalHold: reason ? { reason, by: a.by, at: now() } : undefined })), audit: log(`${deal.loanNumber}: legal hold ${reason ? "placed" : "lifted"} by ${a.by}`) };
    }
    case "recordPayment": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const payment: LoanPayment = { id: `pay${uid()}`, amount: Math.round(a.amount * 100) / 100, receivedOn: a.receivedOn, method: a.method, reference: a.reference, by: a.by, at: now() };
      const day = a.receivedOn > serviceDay(s) ? a.receivedOn : serviceDay(s);
      return { ...s, deals: upd(a.dealId, (d) => settle({ ...d, payments: [...(d.payments ?? []), payment] }, day)), audit: log(`${deal.loanNumber}: payment of ${money(payment.amount)} received ${a.receivedOn}`) };
    }
    case "reversePayment": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const payment = deal.payments?.find((p) => p.id === a.paymentId);
      if (!payment || payment.reversed) return s;
      const reversed = { by: a.by, at: now(), reason: a.reason };
      return { ...s, deals: upd(a.dealId, (d) => settle({ ...d, payments: (d.payments ?? []).map((p) => (p.id === a.paymentId ? { ...p, reversed } : p)) }, serviceDay(s))), audit: log(`${deal.loanNumber}: payment of ${money(payment.amount)} reversed: ${a.reason}`) };
    }
    case "waiveLateFee": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (deal.waivedFees?.some((item) => item.due === a.due)) return s;
      const waiver = { due: a.due, by: a.by, at: now(), reason: a.reason };
      return { ...s, deals: upd(a.dealId, (d) => settle({ ...d, waivedFees: [...(d.waivedFees ?? []), waiver] }, serviceDay(s))), audit: log(`${deal.loanNumber}: late fee on the ${a.due} payment waived by ${a.by}`) };
    }
    case "settleLoans": {
      const entries: { at: string; text: string }[] = [];
      const deals = s.deals.map((d) => {
        const next = settle(d, a.asOf);
        if (next === d || JSON.stringify(next) === JSON.stringify(d)) return d;
        const before = ledger(d); const after = ledger(next);
        if (after.paymentsLate > before.paymentsLate) entries.push({ at: now(), text: `${d.loanNumber}: ${after.paymentsLate} payment${after.paymentsLate === 1 ? "" : "s"} past due` });
        if (next.status !== d.status) entries.push({ at: now(), text: `${d.loanNumber}: moved to ${next.status.replace(/_/g, " ")}` });
        return next;
      });
      if (deals.every((d, index) => d === s.deals[index])) return s;
      return { ...s, deals, audit: [...entries.reverse(), ...s.audit].slice(0, 50) };
    }
    case "requestPayoff": case "logPayoffRequest": case "submitPayoffRequest": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const channel: PayoffChannel = a.t === "requestPayoff" ? "portal" : a.t === "logPayoffRequest" ? a.channel : "web_form";
      const requester: PayoffRequester = a.t === "requestPayoff" ? { kind: "borrower", name: a.by } : a.requester;
      // Someone else asking needs the borrower's written authority (701.04(1)(a)); staff logging one say whether it came with it.
      const check = a.t === "submitPayoffRequest" ? a.check
        : a.t === "logPayoffRequest" && requester.kind !== "borrower" ? (a.authorized ? { status: "accepted" as const, note: "The borrower's written authorization came with the request.", by: a.by, at: now() } : { status: "pending" as const, note: "Waiting for the borrower's written authorization." })
        : undefined;
      const payoff: PayoffRequest = {
        id: `payoff${uid()}`, dealId: a.dealId, goodThrough: a.goodThrough, requestedAt: now(), by: requester.name, status: "requested",
        receivedOn: receivedOnFor(channel, a.t === "requestPayoff" ? serviceDay(s) : a.sentOn), channel, requester,
        ...(check ? { check } : {}), ...(a.t === "logPayoffRequest" ? { loggedBy: a.by } : {}), ...(a.t !== "requestPayoff" && a.note.trim() ? { note: a.note.trim() } : {}),
        ...payoffFor(deal, a.goodThrough),
      };
      return { ...s, payoffs: [payoff, ...s.payoffs], audit: log(`${deal.loanNumber}: payoff letter requested by ${requester.name}, good through ${a.goodThrough}`) };
    }
    case "acceptPayoffCheck":
      return { ...s, payoffs: s.payoffs.map((p) => (p.id === a.payoffId && p.check?.status === "pending" ? { ...p, check: { ...p.check, status: "accepted", note: a.note.trim() || p.check.note, by: a.by, at: now() } } : p)), audit: log("Payoff request checked") };
    case "refusePayoff":
      return { ...s, payoffs: s.payoffs.map((p) => (p.id === a.payoffId && p.status === "requested" ? { ...p, status: "refused", refused: { by: a.by, at: now(), reason: a.reason.trim() } } : p)), audit: log(`Payoff request refused: ${a.reason.trim()}`) };
    case "issuePayoffLetter": {
      const request = s.payoffs.find((p) => p.id === a.payoffId);
      const deal = s.deals.find((d) => d.id === request?.dealId);
      const today = serviceDay(s);
      if (!request || !deal || issueProblem(deal, request, a.goodThrough, a.reason, today)) return s;
      const prior = latestLetter(request);
      const letter: PayoffLetter = { number: (request.letters?.length ?? 0) + 1, issuedAt: now(), issuedBy: a.by, ...letterFigures(deal, a.goodThrough, today), ...(prior ? { replaces: prior.number, reason: a.reason.trim() } : {}) };
      return { ...s, payoffs: s.payoffs.map((p) => (p.id === request.id ? { ...p, status: "sent", letters: [...(p.letters ?? []), letter] } : p)), audit: log(`${deal.loanNumber}: payoff letter ${letter.number} issued, ${money(letter.total)} good through ${letter.goodThrough}`) };
    }
    case "payoffLetterDelivered":
      return { ...s, payoffs: s.payoffs.map((p) => (p.id === a.payoffId ? { ...p, letters: p.letters?.map((l) => (l.number === a.number ? { ...l, delivery: { to: a.to, result: a.result, at: now() } } : l)) } : p)) };
    case "recordPayoff": {
      const today = serviceDay(s);
      const deal = settle(s.deals.find((d) => d.id === a.dealId)!, a.receivedOn > today ? a.receivedOn : today);
      const letter = a.onLetter && s.payoffs.find((p) => p.id === a.onLetter!.payoffId && p.dealId === deal.id)?.letters?.find((l) => l.number === a.onLetter!.number);
      if ((a.onLetter && !letter) || payoffError(deal, a.amount, a.receivedOn, today, letter || undefined)) return s;
      const owed = payoffOn(deal, a.receivedOn).quote.total;
      const paidOff = { amount: Math.round(a.amount * 100) / 100, receivedOn: a.receivedOn, method: a.method, reference: a.reference, by: a.by, at: now(), owed, ...(letter ? { letter: { payoffId: a.onLetter!.payoffId, number: letter.number, total: letter.total, shortfall: Math.max(0, Math.round((owed - a.amount) * 100) / 100) } } : {}) };
      return closeLoan(s, deal, paidOff, `${deal.loanNumber}: paid off with ${money(paidOff.amount)} received ${a.receivedOn}`);
    }
    case "saleProceeds": {
      // A third party won the foreclosure sale: the clerk's money ends the loan, even short of what was owed.
      const today = serviceDay(s);
      const deal = settle(s.deals.find((d) => d.id === a.dealId)!, today);
      const sale = deal.foreclosure?.sale;
      if (sale?.winner !== "third_party" || deal.paidOff || !(a.amount > 0) || a.on < sale.on || a.on > today) return s;
      const owed = payoffOn(deal, a.on).quote.total;
      if (a.amount > owed + 0.005) return s;
      const paidOff: Payoff = { amount: round2(a.amount), receivedOn: a.on, method: "other", reference: a.reference, by: a.by, at: now(), owed, foreclosureSale: { saleOn: sale.on, shortfall: Math.max(0, round2(owed - a.amount)) } };
      return closeLoan(s, { ...deal, foreclosure: { ...deal.foreclosure!, steps: [...deal.foreclosure!.steps, { step: "certificate_of_title", on: a.on, note: "Sold to a third party; the clerk paid the sale money", by: a.by, at: now() }] } }, paidOff, `${deal.loanNumber}: foreclosure sale money of ${money(paidOff.amount)} received ${a.on}${paidOff.foreclosureSale!.shortfall ? `, ${money(paidOff.foreclosureSale!.shortfall)} short` : ""}`);
    }
    case "recordLienRelease": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (!deal.paidOff) return s;
      const before = deal.paidOff.release;
      const release = a.step === "sent" ? { ...before, sentOn: a.on, reference: a.reference || before?.reference || "", by: a.by } : { ...before, sentOn: before?.sentOn ?? a.on, recordedOn: a.on, reference: a.reference, by: a.by };
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, paidOff: { ...d.paidOff!, release } })), audit: log(`${deal.loanNumber}: satisfaction of mortgage ${a.step === "sent" ? "sent for recording" : "recorded"} ${a.on}`) };
    }
    case "closeApplication": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (!PRE_FUNDING.includes(deal.status)) return s;
      const closure: Closure = { outcome: a.outcome, reason: a.reason, note: a.note, by: a.by, at: now(), from: deal.status };
      // A decline starts the Reg B notice, due by the revenue rule (12 CFR 1002.9).
      const revenue = a.outcome === "declined" && a.revenue ? { ...a.revenue, by: a.by, at: closure.at } : deal.revenue;
      const adverseAction = a.outcome === "declined" ? startAdverseAction({ completed: deal.completed, revenue }, closure, serviceDay(s), closure.at) : deal.adverseAction;
      // Whatever capital was held for it goes back, open bids are turned down and its photo links stop working.
      return { ...s,
        deals: upd(deal.id, (d) => ({ ...d, status: a.outcome, daysInStage: 0, closure, allocations: [], capitalStatus: "not_started", fundingApprovers: undefined, revenue, adverseAction,
          // Withdrawing while a term sheet waits is declining it (Spec 4.3).
          termSheets: a.outcome === "withdrawn" && d.status === "term_sheet_issued" ? d.termSheets?.map((x, i, all) => (i === all.length - 1 && x.status === "sent" ? { ...x, status: "declined" as const, response: { at: now(), by: a.by, note: a.note } } : x)) : d.termSheets })),
        bids: s.bids.map((b) => (b.dealId === deal.id && b.status === "submitted" ? { ...b, status: "declined" } : b)),
        photoRequests: s.photoRequests.map((r) => (r.dealId === deal.id && r.status === "open" ? { ...r, status: "off" } : r)),
        audit: log(`${deal.loanNumber}: ${a.outcome} (${closureReason(closure)})`) };
    }
    case "reopenApplication": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (!deal.closure) return s;
      const to = reopenTo(deal.closure);
      // Reopened before the notice went out, there's no adverse action to tell them about; one already sent stays on file.
      if (deal.adverseAction && !deal.adverseAction.notice) s = { ...s, deals: upd(deal.id, (d) => ({ ...d, adverseAction: undefined })) };
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, status: to, daysInStage: 0, closure: undefined })), audit: log(`${deal.loanNumber}: reopened by ${a.by} at ${to.replace(/_/g, " ")}`) };
    }
    case "declareDefault": {
      const today = serviceDay(s);
      const deal = settle(s.deals.find((d) => d.id === a.dealId)!, today);
      if (defaultError(deal, a.kind, a.effectiveOn, today)) return s;
      const opened = { kind: a.kind, effectiveOn: a.effectiveOn, note: a.note, by: a.by, at: now() };
      return { ...s, deals: upd(deal.id, () => ({ ...deal, status: "default", daysInStage: 0, defaults: [...(deal.defaults ?? []), opened] })), audit: log(`${deal.loanNumber}: default declared by ${a.by}, effective ${a.effectiveOn} (${DEFAULT_KINDS[a.kind]})`) };
    }
    case "cureDefault": {
      const today = serviceDay(s);
      const deal = settle(s.deals.find((d) => d.id === a.dealId)!, today);
      if (cureError(deal, today)) return s;
      const cured = { by: a.by, at: now(), note: a.note };
      // Back to whatever the payments say it is.
      return { ...s, deals: upd(deal.id, () => settle({ ...deal, status: "servicing_current", defaults: deal.defaults?.map((x) => (x.cured ? x : { ...x, cured })) }, today)), audit: log(`${deal.loanNumber}: default cured by ${a.by}`) };
    }
    case "requestExtension": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (extensionRequestError(deal, a.months, serviceDay(s), a.byTeam)) return s;
      const extension: LoanExtension = { id: `ext${uid()}`, months: a.months, reason: a.reason, requestedBy: a.by, requestedAt: now(), fee: extensionFee(deal, a.months), fromMaturity: maturityOf(deal), status: "requested", approvers: [] };
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, extensions: [...(d.extensions ?? []), extension] })), audit: log(`${deal.loanNumber}: ${a.months}-month extension requested by ${a.by}`) };
    }
    case "approveExtension": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const extension = deal.extensions?.find((x) => x.id === a.extensionId);
      if (extension?.status !== "requested" || extension.approvers.includes(a.by)) return s;
      const approvers = [...extension.approvers, a.by];
      const done = approvers.length >= 2;
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, extensions: d.extensions?.map((x) => (x.id === a.extensionId ? { ...x, approvers, status: done ? "approved" : x.status } : x)) })), audit: log(`${deal.loanNumber}: extension approved by ${a.by}${done ? "" : "; second approver needed"}`) };
    }
    case "declineExtension": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const extension = deal.extensions?.find((x) => x.id === a.extensionId);
      if (extension?.status !== "requested" && extension?.status !== "approved") return s;
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, extensions: d.extensions?.map((x) => (x.id === a.extensionId ? { ...x, status: "declined", declined: { by: a.by, at: now(), reason: a.reason } } : x)) })), audit: log(`${deal.loanNumber}: extension declined by ${a.by}: ${a.reason}`) };
    }
    case "executeExtension": {
      const today = serviceDay(s);
      const deal = settle(s.deals.find((d) => d.id === a.dealId)!, today);
      const extension = deal.extensions?.find((x) => x.id === a.extensionId);
      if (!extension || executeError(deal, extension, a.on, today)) return s;
      const executed = { by: a.by, at: now(), on: a.on, method: a.method, reference: a.reference };
      // A signed extension ends a default on the loan: the borrower is current and the maturity has moved.
      const cured = { by: a.by, at: now(), note: "Cured by the extension" };
      const next: Deal = { ...deal, status: "servicing_current", maturityNotices: undefined, extensions: deal.extensions?.map((x) => (x.id === a.extensionId ? { ...x, status: "executed", executed } : x)), defaults: deal.defaults?.map((x) => (x.cured ? x : { ...x, cured })) };
      return { ...s, deals: upd(deal.id, () => settle(next, today)), audit: log(`${deal.loanNumber}: extended ${extension.months} months to ${maturityOf(next)}; fee of ${money(extension.fee)} received`) };
    }
    case "proposeModification": {
      const today = serviceDay(s);
      const deal = settle(s.deals.find((d) => d.id === a.dealId)!, today);
      const terms = { rate: a.rate, capitalize: a.capitalize, waiveFees: a.waiveFees, months: a.months };
      if (proposalProblem(deal, terms, today, inBankruptcy(deal))) return s;
      const modification: LoanModification = { id: `mod${uid()}`, ...(a.rate !== undefined ? { rate: a.rate } : {}), capitalize: a.capitalize, waiveFees: a.waiveFees, ...(a.months ? { months: a.months } : {}), reason: a.reason.trim(), proposedBy: a.by, proposedAt: now(), proposedOn: today, status: "proposed", approvers: [] };
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, modifications: [...(d.modifications ?? []), modification] })), audit: log(`${deal.loanNumber}: modification proposed by ${a.by}: ${modificationWords(modificationPreview(deal, terms, today))}`) };
    }
    case "approveModification": case "declineModification": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const modification = deal.modifications?.find((x) => x.id === a.modificationId);
      if (!modification || (modification.status !== "proposed" && modification.status !== "approved")) return s;
      if (a.t === "declineModification") return { ...s, deals: upd(deal.id, (d) => ({ ...d, modifications: d.modifications?.map((x) => (x.id === a.modificationId ? { ...x, status: "declined", declined: { by: a.by, at: now(), reason: a.reason.trim() } } : x)) })), audit: log(`${deal.loanNumber}: modification declined by ${a.by}: ${a.reason.trim()}`) };
      if (modification.status !== "proposed" || modification.approvers.includes(a.by)) return s;
      const approvers = [...modification.approvers, a.by];
      const done = approvers.length >= 2;
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, modifications: d.modifications?.map((x) => (x.id === a.modificationId ? { ...x, approvers, status: done ? "approved" : x.status } : x)) })), audit: log(`${deal.loanNumber}: modification approved by ${a.by}${done ? "" : "; second approver needed"}`) };
    }
    case "signModification": {
      const today = serviceDay(s);
      const deal = settle(s.deals.find((d) => d.id === a.dealId)!, today);
      const modification = deal.modifications?.find((x) => x.id === a.modificationId);
      if (!modification || signProblem(deal, modification, a.on, today, inBankruptcy(deal))) return s;
      const p = modificationPreview(deal, modification, a.on);
      const executed = { on: a.on, effectiveOn: p.effectiveOn, reference: a.reference.trim(), by: a.by, at: now(), fromRate: p.fromRate, toRate: p.toRate, fromMaturity: p.fromMaturity, toMaturity: p.toMaturity, fromPayment: p.fromPayment, newPayment: p.newPayment, capitalizedDues: p.capitalizedDues, capitalizedPayments: p.capitalizedPayments, fees: p.fees, capitalizedFees: p.capitalizedFees, waivedFees: p.waivedFees, afterPayments: p.afterPayments };
      const moved = Boolean(modification.months);
      let next = settle({ ...deal, modifications: deal.modifications?.map((x) => (x.id === a.modificationId ? { ...x, status: "executed" as const, executed } : x)), ...(moved ? { maturityNotices: undefined, exitAsked: undefined } : {}) }, today);
      // Signed with nothing left behind, it ends a default, and any foreclosure with it.
      if (openDefault(next) && !cureError(next, today)) {
        const cured = { by: a.by, at: now(), note: "Cured by the modification" };
        next = settle({ ...next, status: "servicing_current", defaults: next.defaults?.map((x) => (x.cured ? x : { ...x, cured })), foreclosure: next.foreclosure && !next.foreclosure.stopped ? { ...next.foreclosure, stopped: { on: a.on, why: "modified", note: "", by: a.by, at: now() } } : next.foreclosure }, today);
      }
      return { ...s, deals: upd(deal.id, () => next), audit: log(`${deal.loanNumber}: modification signed ${a.on} (${a.reference.trim()}): ${modificationWords(p)}`) };
    }
    case "logContact": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const contact = { id: `ct${uid()}`, on: a.on, channel: a.channel, with: a.with.trim(), outcome: a.outcome, note: a.note.trim(), by: a.by, at: now() };
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, contacts: [...(d.contacts ?? []), contact].sort((x, y) => x.on.localeCompare(y.on) || x.at.localeCompare(y.at)) })), audit: log(`${deal.loanNumber}: ${a.channel} with ${contact.with} logged by ${a.by}`) };
    }
    case "recordPromise": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const promise = { id: `ptp${uid()}`, amount: round2(a.amount), madeOn: serviceDay(s), dueBy: a.dueBy, note: a.note.trim(), by: a.by, at: now() };
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, promises: [...(d.promises ?? []), promise] })), audit: log(`${deal.loanNumber}: promise to pay ${money(promise.amount)} by ${a.dueBy} recorded by ${a.by}`) };
    }
    case "cancelPromise":
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, promises: d.promises?.map((x) => (x.id === a.promiseId && !x.cancelled ? { ...x, cancelled: { by: a.by, at: now(), reason: a.reason.trim() } } : x)) })), audit: log(`Promise to pay withdrawn by ${a.by}`) };
    case "logNotice": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const cureBy = a.kind === "default" ? a.cureBy || addDays(a.sentOn, COLLECTIONS.cureDays) : undefined;
      const notice = { id: `nt${uid()}`, kind: a.kind, sentOn: a.sentOn, method: a.method, to: a.to.trim(), tracking: a.tracking.trim(), amount: round2(a.amount), ...(cureBy ? { cureBy } : {}), by: a.by, at: now() };
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, notices: [...(d.notices ?? []), notice] })), audit: log(`${deal.loanNumber}: ${NOTICE_KINDS[a.kind].toLowerCase()} sent ${a.sentOn} by ${DELIVERY_METHODS[a.method].toLowerCase()}`) };
    }
    case "noticeOutcome": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const outcome = a.outcome === "delivered" ? { delivered: { on: a.on, proof: a.detail.trim(), by: a.by, at: now() } } : { returned: { on: a.on, reason: a.detail.trim(), by: a.by, at: now() } };
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, notices: d.notices?.map((x) => (x.id === a.noticeId ? { ...x, ...outcome } : x)) })), audit: log(`${deal.loanNumber}: notice ${a.outcome} ${a.on}`) };
    }
    case "recordBankruptcy": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const bankruptcy = { id: `bk${uid()}`, debtor: a.debtor.trim(), chapter: a.chapter, caseNumber: a.caseNumber.trim(), court: a.court.trim(), filedOn: a.filedOn, by: a.by, at: now() };
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, bankruptcies: [...(d.bankruptcies ?? []), bankruptcy] })), audit: log(`${deal.loanNumber}: chapter ${a.chapter} bankruptcy filed ${a.filedOn} by ${bankruptcy.debtor} (case ${bankruptcy.caseNumber}); collection paused`) };
    }
    case "bankruptcyClaimFiled": case "endBankruptcy": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const change = a.t === "bankruptcyClaimFiled" ? { claimFiledOn: a.on } : { ended: { on: a.on, how: a.how, by: a.by, at: now() } };
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, bankruptcies: d.bankruptcies?.map((x) => (x.id === a.bankruptcyId ? { ...x, ...change } : x)) })), audit: log(a.t === "bankruptcyClaimFiled" ? `${deal.loanNumber}: proof of claim filed ${a.on}` : `${deal.loanNumber}: bankruptcy ended ${a.on} (${BANKRUPTCY_ENDS[a.how].toLowerCase()})`) };
    }
    case "recordAdvance": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const advance = { id: `adv${uid()}`, on: a.on, kind: a.kind, amount: round2(a.amount), note: a.note.trim(), by: a.by, at: now() };
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, advances: [...(d.advances ?? []), advance] })), audit: log(`${deal.loanNumber}: ${money(advance.amount)} paid out for ${ADVANCE_KINDS[a.kind].toLowerCase()}`) };
    }
    case "advancesRepaid": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      const repaid = { id: `rep${uid()}`, amount: round2(a.amount), on: a.on, reference: a.reference.trim(), by: a.by, at: now() };
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, advancesRepaid: [...(d.advancesRepaid ?? []), repaid] })), audit: log(`${deal.loanNumber}: ${money(repaid.amount)} of costs repaid by the borrower`) };
    }
    case "referForeclosure": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      return { ...s, deals: upd(deal.id, (d) => ({ ...d, foreclosure: { attorney: a.attorney.trim(), referredOn: a.on, by: a.by, at: now(), steps: [] } })), audit: log(`${deal.loanNumber}: referred to ${a.attorney.trim()} for foreclosure`) };
    }
    case "foreclosureStep": {
      const today = serviceDay(s);
      const deal = settle(s.deals.find((d) => d.id === a.dealId)!, today);
      const case_ = deal.foreclosure;
      if (!case_ || stepProblem(deal, a.step, a.on, today, a)) return s;
      const step = { step: a.step, on: a.on, note: a.note.trim(), by: a.by, at: now() };
      const foreclosure = { ...case_, steps: [...case_.steps, step], ...(a.caseNumber?.trim() ? { caseNumber: a.caseNumber.trim() } : {}), ...(a.county?.trim() ? { county: a.county.trim() } : {}), ...(a.step === "judgment" ? { judgment: a.judgment } : {}), ...(a.step === "sale_held" ? { sale: { on: a.on, ...a.sale! } } : {}) };
      if (a.step !== "certificate_of_title") return { ...s, deals: upd(deal.id, () => ({ ...deal, foreclosure })), audit: log(`${deal.loanNumber}: foreclosure, ${stepLabel(a.step).toLowerCase()} ${a.on}`) };
      return takeTitle(s, { ...deal, foreclosure }, a.on, "certificate_of_title", a.by, `${deal.loanNumber}: certificate of title ${a.on}; the property is bank-owned`);
    }
    case "stopForeclosure": {
      const today = serviceDay(s);
      const deal = settle(s.deals.find((d) => d.id === a.dealId)!, today);
      if (!deal.foreclosure || deal.foreclosure.stopped) return s;
      const foreclosure = { ...deal.foreclosure, stopped: { on: a.on, why: a.why, note: a.note.trim(), by: a.by, at: now() } };
      if (a.why === "dismissed") return { ...s, deals: upd(deal.id, () => ({ ...deal, foreclosure })), audit: log(`${deal.loanNumber}: foreclosure dismissed ${a.on}`) };
      return takeTitle(s, { ...deal, foreclosure }, a.on, "deed_in_lieu", a.by, `${deal.loanNumber}: deed in lieu of foreclosure taken ${a.on}; the property is bank-owned`);
    }
    case "listReo":
      return { ...s, deals: upd(a.dealId, (d) => (d.reo && !d.reo.sold ? { ...d, reo: { ...d.reo, listed: { on: a.on, price: round2(a.price), by: a.by }, ...(a.value ? { value: round2(a.value) } : {}) } } : d)), audit: log(`Bank-owned property listed for ${money(a.price)}`) };
    case "sellReo": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      if (!deal.reo || deal.reo.sold) return s;
      const sold: Deal = { ...deal, daysInStage: 0, allocations: [], reo: { ...deal.reo, sold: { on: a.on, price: round2(a.price), closingCosts: round2(a.closingCosts), reference: a.reference.trim(), by: a.by, at: now() } } };
      // Each partner's share of what came back, rolled or owed to it the way it chose, as at a payoff.
      const proceeds = payoffProceeds(s, sold, (n) => `pp${uid()}${n}`);
      return { ...s, partners: withProceeds(s.partners, proceeds), deals: upd(deal.id, () => sold), audit: log(`${deal.loanNumber}: bank-owned property sold ${a.on} for ${money(a.price)}`) };
    }
    case "sendMessage": {
      const text = a.text.trim();
      if (!text) return s;
      return { ...s, messages: [...s.messages, { id: `msg${uid()}`, dealId: a.dealId, from: a.from, side: a.side, text, at: now() }] };
    }
    case "uploadDoc": return { ...s, deals: upd(a.dealId, (d) => ({ ...d, docs: d.docs.map((x) => (x.id === a.docId ? { ...x, status: "uploaded", fileName: a.fileName, documentId: a.documentId, uploadedAt: now() } : x)) })), audit: log(`Document uploaded: ${a.fileName}`) };
    case "docStatus": return { ...s, deals: upd(a.dealId, (d) => ({ ...d, docs: d.docs.map((x) => (x.id === a.docId ? { ...x, status: a.status, teamNote: a.status === "rejected" ? a.note?.trim() || undefined : undefined, acceptedOn: a.status === "accepted" ? serviceDay(s) : undefined, carriedFrom: undefined, ...(x.carriedFrom && a.status === "requested" ? { fileName: undefined, documentId: undefined } : {}) } : x)) })), audit: log(`Document ${a.docId} → ${a.status}`) };
    case "route": {
      const deal = s.deals.find((d) => d.id === a.dealId)!; const L = evaluate(deal.app).noteAmount;
      const inH = a.route === "in_house" ? L : a.route === "partner" ? 0 : Math.min(L, Math.max(0, a.inHouseAmount));
      const allocations = inH > 0 ? [{ sourceId: "gt-main", amount: inH }] : [];
      const capitalStatus = a.route === "in_house" ? "reserved" : deal.teaserSentTo.length ? deal.capitalStatus : "recommended";
      return { ...s, deals: upd(a.dealId, (d) => ({ ...d, route: a.route, allocations, capitalStatus })), audit: log(`${deal.loanNumber}: route set to ${a.route}${a.route === "split" ? ` (in-house $${inH.toLocaleString()})` : ""}`) };
    }
    case "sendTeaser": return { ...s, deals: upd(a.dealId, (d) => ({ ...d, teaserSentTo: Array.from(new Set([...d.teaserSentTo, ...a.partnerIds])), capitalStatus: d.capitalStatus === "not_started" || d.capitalStatus === "recommended" ? "teaser_out" : d.capitalStatus })), audit: log(`Blind teaser sent to ${a.partnerIds.length} partner(s)`) };
    case "bid": {
      const b: Bid = { ...a.bid, id: `bid${uid()}`, at: now(), status: "submitted" };
      return { ...s, bids: [b, ...s.bids], deals: upd(a.bid.dealId, (d) => ({ ...d, capitalStatus: d.capitalStatus === "teaser_out" ? "bids_in" : d.capitalStatus })), audit: log(`${a.bid.type === "accept_as_offered" ? "Accept-as-offered" : "Bid"} received from ${a.bid.partnerId}`) };
    }
    case "acceptBid": {
      const b = s.bids.find((x) => x.id === a.bidId)!; const deal = s.deals.find((d) => d.id === b.dealId)!; const L = evaluate(deal.app).noteAmount;
      const partnerAmt = Math.round((L * b.pct) / 100);
      // A partner that funds draws as they're released wires only its share of the rest at closing, and any money it
      // rolled over from a loan that paid off goes in first (lib/capital-moves.ts).
      const fundsDraws = Boolean(s.partners.find((p) => p.id === b.partnerId)?.fundsDraws);
      const atClosing = closingShare(deal, b.pct, fundsDraws);
      const fromCredit = Math.min(atClosing, creditOf(s, b.partnerId, deal.id));
      const inHouse = L - partnerAmt;
      const allocations = [{ sourceId: `partner:${b.partnerId}`, amount: partnerAmt }, ...(inHouse > 0 ? [{ sourceId: "gt-main", amount: inHouse }] : [])];
      return { ...s,
        bids: s.bids.map((x) => (x.id === b.id ? { ...x, status: "accepted" } : x.dealId === b.dealId && x.status === "submitted" ? { ...x, status: "declined" } : x)),
        deals: upd(b.dealId, (d) => ({ ...d, allocations, route: inHouse > 0 ? "split" : "partner", capitalStatus: "reserved", partnerFunding: { partnerId: b.partnerId, amount: atClosing, ...(fromCredit > 0 ? { fromCredit } : {}), ...(fundsDraws ? { drawsAsReleased: true } : {}) } })),
        audit: log(`${deal.loanNumber}: bid from ${b.partnerId} accepted; partner commitment issued; other bids declined`) };
    }
    case "commit": return { ...s, deals: upd(a.dealId, (d) => ({ ...d, capitalStatus: "committed" })), audit: log(`Capital committed (required before clear to close)`) };
    case "signNda": return { ...s, partners: s.partners.map((p) => (p.id === a.partnerId ? { ...p, ndaSigned: true } : p)), audit: log(`NDA / Non-Circumvention e-signed by ${a.partnerId} (demo)`) };
    case "signBuyerNda": return { ...s, buyers: s.buyers.map((b) => (b.id === a.buyerId ? { ...b, ndaSigned: true } : b)), audit: log(`Loan buyer NDA e-signed by ${a.buyerId} (demo)`) };
    case "listLoan": {
      const deal = s.deals.find((d) => d.id === a.dealId)!;
      // A loan can be listed again after a withdrawal, so the sale's id has to be new each time.
      const sale: LoanSale = { id: `s-${a.dealId}-${uid()}`, dealId: a.dealId, askPct: a.askPct, status: "listed", listedAt: now().slice(0, 10) };
      return { ...s, sales: [sale, ...s.sales], audit: log(`${deal.loanNumber}: listed for sale at ${a.askPct}% of balance`) };
    }
    case "unlistLoan": {
      const sale = s.sales.find((x) => x.id === a.saleId)!; const deal = s.deals.find((d) => d.id === sale.dealId)!;
      return { ...s, sales: s.sales.map((x) => (x.id === a.saleId ? { ...x, status: "withdrawn" } : x)), offers: s.offers.map((o) => (o.saleId === a.saleId && o.status === "submitted" ? { ...o, status: "declined" } : o)), audit: log(`${deal.loanNumber}: sale withdrawn; open offers declined`) };
    }
    case "offerLoan": {
      const sale = s.sales.find((x) => x.id === a.saleId)!; const deal = s.deals.find((d) => d.id === sale.dealId)!;
      const offer: LoanOffer = { id: `offer${uid()}`, saleId: a.saleId, buyerId: a.buyerId, pricePct: a.pricePct, note: a.note, atAsk: a.atAsk, status: "submitted", at: now() };
      return { ...s, offers: [offer, ...s.offers], audit: log(`${deal.loanNumber}: offer of ${a.pricePct}% from ${a.buyerId}`) };
    }
    case "decideOffer": {
      const offer = s.offers.find((o) => o.id === a.offerId)!; const sale = s.sales.find((x) => x.id === offer.saleId)!; const deal = s.deals.find((d) => d.id === sale.dealId)!;
      if (!a.accept) return { ...s, offers: s.offers.map((o) => (o.id === offer.id ? { ...o, status: "declined" } : o)), audit: log(`${deal.loanNumber}: offer from ${offer.buyerId} declined`) };
      return { ...s,
        offers: s.offers.map((o) => (o.id === offer.id ? { ...o, status: "accepted" } : o.saleId === offer.saleId && o.status === "submitted" ? { ...o, status: "declined" } : o)),
        sales: s.sales.map((x) => (x.id === sale.id ? { ...x, status: "sold", soldTo: offer.buyerId, soldPct: offer.pricePct, soldAt: now().slice(0, 10) } : x)),
        // The note leaves LendHous's books, which frees that capital to lend again.
        deals: upd(deal.id, (d) => ({ ...d, allocations: [{ sourceId: `buyer:${offer.buyerId}`, amount: evaluate(d.app).noteAmount }] })),
        audit: log(`${deal.loanNumber}: sold to ${offer.buyerId} at ${offer.pricePct}% of balance; other offers declined`) };
    }
  }
}

