// Who sees what in the loan book, and who may do what to it. Everything an account receives or sends passes through here,
// because the browser can't be trusted to hide a borrower's name or to ask only for what its screen offers.
// No database code, so the rules can be tested on their own.
import type { RoleCode } from "@prisma/client";
import { emptyBook, serviceDay, type Book, type BookAction } from "./book";
import { verifyProblem, wireProblem, wireVerified } from "./closing";
import { firmHeld, firmOfacBlocker, latestScreening, ofacBlocker } from "./ofac";
import { INSURED, openRenewals, policyProblem } from "./insurance";
import { assignProblem } from "./loan-team";
import { receivedProblem, sendToFor, sentProblem } from "./partner-funding";
import { sponsorProblem, withSponsor } from "./credit";
import { scopeError } from "./draws";
import { cureError, defaultError, DECLINE_REASONS, executeError, extensionRequestError, isClosedApplication, payoffError, payoffOn, PRE_FUNDING, WITHDRAW_REASONS } from "./loan-exits";
import { goodThroughProblem, issueProblem } from "./payoffs";
import { addProblem, changeProblem, libraryOf, templateProblem } from "./conditions";
import { drawHolds, lienFileProblem, unreleasedHolds, waiverCheckProblem } from "./lien-law";
import { reasonsProblem, requestProblem, revenueProblem } from "./adverse-action";
import { exceptionDecisionProblem, exceptionRequestProblem, issueProblem as sheetProblem, latestSheet, pricedApp, respondProblem } from "./term-sheets";
import { MAX_PHOTOS_PER_LINK, photoRequestState, photosClosed } from "./photo-requests";
import { evaluate } from "./engine";
import { showcaseable } from "./showcase";
import { exitPlanProblem } from "./exit-plans";
import { agentProblem, OWN_DOC_ID, ownDocProblem } from "./borrower-docs";
import type { Broker, Deal, Doc, InvestorChecks, LoanPayment, LoanSale, PayoffRequest } from "./mockData";
import { currentPricing, pricingPayload } from "./pricing-versions";
import { shortDay } from "./format";
import { addDays, advancesOwed, ledger, ledgerOf, openDefault, SERVICED, servicingDate } from "./servicing";
import { proposalProblem, signProblem } from "./modifications";
import { COLLECTIONS, defaultNotice, inBankruptcy, openBankruptcy, stayProblem, stepProblem } from "./collections";
import { viewFor, type MemberAccess, type Permission } from "./permissions";
import { approveProblem, canSendDeals, feePaidProblem } from "./brokers";
import { bonusPaidProblem, referralProblem, referralsBy } from "./referrals";
import { optionAt } from "./buy-down";
import { brandProblem } from "./broker-program";
import { surveyProblem } from "./surveys";
import { updateProblem, workoutProblem } from "./investor-updates";
import { transferProblem } from "./capital-moves";
import { releaseQuote, scheduleProblem } from "./portfolio";
import { changeOrderProblem, CONTINGENCY_ID, openChanges, reservePaymentProblem } from "./budget";

export type Viewer = MemberAccess & { id: string; name: string; roleCodes: RoleCode[]; organizationId?: string | null };

/** The firm a partner, buyer or broker acts for: their organization, or themselves when they have none. */
export const firmOf = (viewer: Viewer) => viewer.organizationId ?? viewer.id;

/** A broker's own firm as it sees it: where it stands and what it signed, not the sanctions check or who approved it. */
const ownFirm = (book: Book, firm: string, name: string): Broker => {
  const broker = book.brokers.find((item) => item.id === firm);
  if (!broker) return { id: firm, name };
  const { screening: _screening, approved: _approved, ...rest } = broker;
  return rest;
};

/** A partner's or buyer's own firm as it sees it: not its sanctions screening or the owners the team entered. */
const ownRecord = <T extends InvestorChecks>(firm: T): T => { const { screening: _screening, principals: _principals, ...rest } = firm; return rest as T; };
// Said to a firm on hold without naming the sanctions list: the team explains it in person.
const FIRM_HELD = "LendHous needs to finish a check on your firm first. Your contact at LendHous can tell you more.";

const FUNDED = ["funded", "servicing_current", "servicing_delinquent", "matured", "default"];
const money = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const BEFORE_CLOSING = ["submitted", "initial_review", "underwriting", "term_sheet_issued", "term_sheet_accepted", "conditions"];
// Until a term sheet goes out, the borrower's profile and the credit review can still change.
const IN_REVIEW = ["submitted", "initial_review", "underwriting"];
// From an accepted term sheet until the money goes out: when wire instructions can be entered.
const WIRE_STAGES = ["term_sheet_accepted", "conditions", "clear_to_close", "closing"];

/** The payment record without who on the team keyed it in or why a fee was waived. Amounts and dates stay: they are the pay history. */
const quietPayments = (deal: Deal, keepReference: boolean): Partial<Deal> => ({
  payments: deal.payments?.map((payment): LoanPayment => ({ ...payment, by: "", reference: keepReference ? payment.reference : "", reversed: payment.reversed && { ...payment.reversed, by: "", reason: keepReference ? payment.reversed.reason : "" } })),
  waivedFees: deal.waivedFees?.map((item) => ({ ...item, by: "", reason: "" })),
});

/**
 * Declines, defaults, extensions and the payoff without who on the team decided or their notes. Why a loan was turned
 * down goes to the borrower in the notice the attorney approves, not through the portal.
 */
const quietExits = (deal: Deal): Partial<Deal> => ({
  closure: deal.closure && { ...deal.closure, by: "", note: "", reason: deal.closure.outcome === "declined" ? "" : deal.closure.reason },
  defaults: deal.defaults?.map((item) => ({ ...item, by: "", note: "", cured: item.cured && { ...item.cured, by: "", note: "" } })),
  extensions: deal.extensions?.map((item) => ({ ...item, approvers: item.approvers.map(() => ""), declined: item.declined && { ...item.declined, by: "" }, executed: item.executed && { ...item.executed, by: "" } })),
  paidOff: deal.paidOff && { ...deal.paidOff, by: "", release: deal.paidOff.release && { ...deal.paidOff.release, by: "" } },
});

/** A payoff request as the borrower sees it: who asked and every letter, without who on the team handled it or how it was checked. */
const quietPayoff = (payoff: PayoffRequest): PayoffRequest => ({
  ...payoff, loggedBy: undefined, note: undefined,
  check: payoff.check && { status: payoff.check.status, note: "" },
  refused: payoff.refused && { ...payoff.refused, by: "" },
  letters: payoff.letters?.map((letter) => ({ ...letter, issuedBy: "", delivery: letter.delivery && { ...letter.delivery, to: [] } })),
});

/** Removes what identifies the borrower, for a partner or buyer who hasn't closed on the loan. */
function blind(deal: Deal): Deal {
  return { ...deal, insurance: undefined, friendReferral: undefined, surveys: undefined, investorUpdates: undefined, workout: undefined, lastSale: undefined, geo: undefined, stormHold: undefined, transfers: undefined, drawCalls: undefined, releases: undefined, properties: deal.properties?.map(({ id, county, zip, propertyType, value, monthlyRent, taxesAnnual, insuranceAnnual, hoaMonthly, released }) => ({ id, address: "", city: "", zip: `${zip.slice(0, 3)}xx`, county, propertyType, value, monthlyRent, taxesAnnual, insuranceAnnual, hoaMonthly, released })), borrowerId: "", borrowerName: "", entityName: "", address: "", city: "", zip: deal.zip.slice(0, 3), docs: [], scope: [], scopeSummary: "", brokerId: undefined, brokerPoints: undefined, allocations: [], teaserSentTo: [], route: undefined, source: "", termSheetSignedBy: undefined, termSheetSignedAt: undefined, fundingApprovers: undefined, sponsor: undefined, creditReview: undefined, closure: undefined, defaults: undefined, extensions: undefined, modifications: undefined, contacts: undefined, promises: undefined, notices: undefined, bankruptcies: undefined, advances: undefined, advancesRepaid: undefined, foreclosure: undefined, reo: undefined, paidOff: undefined, closing: undefined, wires: undefined, fundingWireId: undefined, screenings: undefined, titleLink: undefined, termSheets: undefined, pricingException: undefined, conditions: undefined, lienFile: undefined, completed: undefined, revenue: undefined, adverseAction: undefined, legalHold: undefined, propertyPhotos: undefined, partnerFunding: undefined, agents: undefined, ...quietPayments(deal, false) };
}

/** The conditions that are the borrower's to meet (Spec B17), without who on the team handled them or why one was waived. */
const clientConditions = (deal: Deal): Partial<Deal> => ({
  conditions: deal.conditions?.filter((item) => item.owner === "borrower").map((item) => ({ ...item, addedBy: "", cleared: item.cleared && { ...item.cleared, by: "", note: "" }, waived: item.waived && { ...item.waived, by: "", reason: "" }, returned: item.returned && { ...item.returned, by: "" }, files: item.files.map((file) => ({ ...file, by: "" })) })),
});

/** The decline notice as the borrower sees it: what went out and when, without who on the team sent it or any legal hold. */
const clientRecords = (deal: Deal): Partial<Deal> => ({
  legalHold: undefined,
  completed: deal.completed && { ...deal.completed, by: "" },
  revenue: deal.revenue && { ...deal.revenue, by: "" },
  adverseAction: deal.adverseAction && { ...deal.adverseAction, notice: deal.adverseAction.notice && { ...deal.adverseAction.notice, by: "", to: [] }, statement: deal.adverseAction.statement && { ...deal.adverseAction.statement, by: "", to: [] }, request: deal.adverseAction.request && { ...deal.adverseAction.request, by: "" } },
});

/** The newest term sheet only (Spec 13.2), without the matrix's room, the exception or who sent it. */
const latestForClient = (deal: Deal): Partial<Deal> => {
  const sheet = latestSheet(deal);
  return { termSheets: sheet ? [{ ...sheet, issuedBy: "", matrix: { rate: [0, 0], points: [0, 0] }, exception: undefined }] : undefined, pricingException: undefined };
};

/**
 * Collections as the borrower and broker see them: the terms a modification set and costs owed, without the team's calls,
 * promises, notices, the bankruptcy and foreclosure files, a proposal still being decided, or who did what.
 */
const clientCollections = (deal: Deal): Partial<Deal> => ({
  contacts: undefined, promises: undefined, notices: undefined, bankruptcies: undefined, foreclosure: undefined, reo: undefined,
  modifications: deal.modifications?.filter((item) => item.status === "approved" || item.status === "executed").map((item) => ({ ...item, reason: "", proposedBy: "", approvers: [], executed: item.executed && { ...item.executed, by: "" } })),
  advances: deal.advances?.filter((item) => !deal.reo || item.on < deal.reo.since).map((item) => ({ ...item, note: "", by: "" })),
  advancesRepaid: deal.advancesRepaid?.map((item) => ({ ...item, by: "" })),
});

/** The borrower's agents without who wrote them down, which may be someone on the team. */
const clientAgents = (deal: Deal): Partial<Deal> => ({
  agents: deal.agents && Object.fromEntries(Object.entries(deal.agents).map(([role, contact]) => [role, contact && { ...contact, by: "" }])),
});

/** The insurance file without who on the team entered or checked each part. */
const clientInsurance = (deal: Deal): Partial<Deal> => ({
  insurance: deal.insurance && { ...deal.insurance, policies: deal.insurance.policies.map((item) => ({ ...item, by: "" })), flood: deal.insurance.flood && { ...deal.insurance.flood, by: "" }, renewals: deal.insurance.renewals?.map((item) => ({ ...item, decided: item.decided && { ...item.decided, by: "" } })) },
});

/** What only the team sees on a loan it shares with a client. Wire instructions never leave the team: a client who sees them is a client who can be sent fake ones. */
function forClient(deal: Deal): Deal {
  return { ...deal, ...latestForClient(deal), ...clientConditions(deal), ...clientRecords(deal), ...clientAgents(deal), ...clientInsurance(deal), ...clientCollections(deal), partnerFunding: undefined, transfers: undefined, drawCalls: undefined, allocations: [], teaserSentTo: [], route: undefined, capitalStatus: "not_started", contractorIsGtAffiliate: undefined, source: "", fundingApprovers: undefined, creditReview: undefined, ...quietPayments(deal, true), ...quietExits(deal), wires: undefined, fundingWireId: undefined, screenings: undefined, titleLink: undefined, friendReferral: undefined, surveys: undefined, investorUpdates: undefined, workout: undefined, lastSale: undefined };
}

/**
 * What a partner or buyer that holds a loan also sees: the team's updates for its investors, any workout, the foreclosure's
 * steps and the bank-owned property's sale, which its statements follow. Not the team's calls, notices or notes.
 */
const forHolder = (deal: Deal): Deal => ({ ...forClient(deal), investorUpdates: deal.investorUpdates, workout: deal.workout, bankruptcies: deal.bankruptcies?.map((item) => ({ ...item, debtor: "", caseNumber: "", court: "", by: "", ended: item.ended && { ...item.ended, by: "" } })), advances: deal.advances?.map((item) => ({ ...item, note: "", by: "" })), foreclosure: deal.foreclosure && { ...deal.foreclosure, by: "", steps: deal.foreclosure.steps.map((step) => ({ ...step, note: "", by: "" })), stopped: deal.foreclosure.stopped && { ...deal.foreclosure.stopped, note: "", by: "" } }, reo: deal.reo && { ...deal.reo, by: "", listed: deal.reo.listed && { ...deal.reo.listed, by: "" }, sold: deal.reo.sold && { ...deal.reo.sold, by: "" } } });

/** A partner's own draw shares, and the share transfers it was part of, on a loan it holds or held. */
const ownMoves = (deal: Deal, partnerId: string) => {
  const calls = deal.drawCalls?.filter((call) => call.partnerId === partnerId);
  const transfers = deal.transfers?.filter((item) => item.from === partnerId || item.to === partnerId);
  return { drawCalls: calls?.length ? calls : undefined, transfers: transfers?.length ? transfers : undefined };
};

/** The part of the book this account may see. Nothing else leaves the server. */
export function scopeBook(book: Book, viewer: Viewer): Book {
  const scoped = scopeRecords(book, viewer);
  // The browser prices with the same numbers: the current version for new quotes, and each loan's own.
  return { ...scoped, pricing: pricingPayload(scoped.deals.map((deal) => deal.app.pricingVersion)) };
}

function scopeRecords(book: Book, viewer: Viewer): Book {
  const empty = emptyBook();
  const view = viewFor(viewer.roleCodes);
  if (view === "admin") return { ...book, partnerId: "", buyerId: "", brokerId: "", borrowerId: "" };
  const shared = (dealIds: Set<string>) => book.messages.filter((message) => dealIds.has(message.dealId) && message.side !== "internal");

  if (view === "borrower") {
    const mine = book.deals.filter((deal) => deal.borrowerId === viewer.id);
    const ids = new Set(mine.map((deal) => deal.id));
    return { ...empty, borrowerId: viewer.id, deals: mine.map((deal) => ({ ...forClient(deal), surveys: deal.surveys, brokerId: undefined, brokerPoints: undefined })), draws: book.draws.filter((draw) => ids.has(draw.dealId)).map((draw) => ({ ...draw, approvers: [], override: undefined })), photoRequests: book.photoRequests.filter((request) => ids.has(request.dealId)), payoffs: book.payoffs.filter((payoff) => ids.has(payoff.dealId)).map(quietPayoff), messages: shared(ids), myReferrals: referralsBy(book.deals, viewer.id) };
  }

  if (view === "broker") {
    const firm = firmOf(viewer);
    const mine = book.deals.filter((deal) => deal.brokerId === firm);
    return { ...empty, brokerId: firm, brokers: [ownFirm(book, firm, viewer.name)], deals: mine.map(forClient), messages: shared(new Set(mine.map((deal) => deal.id))) };
  }

  if (view === "partner") {
    const me = book.partners.find((partner) => partner.id === firmOf(viewer));
    if (!me) return empty;
    if (!me.ndaSigned) return { ...empty, partnerId: me.id, partners: [ownRecord(me)] };
    const mine = book.bids.filter((bid) => bid.partnerId === me.id);
    const won = new Set(mine.filter((bid) => bid.status === "accepted").map((bid) => bid.dealId));
    const deals = book.deals.filter((deal) => deal.teaserSentTo.includes(me.id));
    // Someone else's accepted bid only says the deal is gone: no firm, no price.
    const taken = book.bids.filter((bid) => bid.partnerId !== me.id && bid.status === "accepted" && deals.some((deal) => deal.id === bid.dealId)).map((bid) => ({ ...bid, partnerId: "", pct: 0, lenderRate: 0, lenderPoints: 0, conditions: "" }));
    return { ...empty, partnerId: me.id, partners: [ownRecord(me)], bids: [...mine, ...taken], deals: deals.map((deal) => (won.has(deal.id) ? { ...forHolder(deal), teaserSentTo: [me.id], contractorIsGtAffiliate: deal.contractorIsGtAffiliate, partnerFunding: deal.partnerFunding?.partnerId === me.id ? { ...deal.partnerFunding, sendTo: sendToFor(deal) } : undefined, ...ownMoves(deal, me.id) } : { ...blind(deal), teaserSentTo: [me.id] })) };
  }

  if (view === "buyer") {
    const me = book.buyers.find((buyer) => buyer.id === firmOf(viewer));
    if (!me) return empty;
    if (!me.ndaSigned) return { ...empty, buyerId: me.id, buyers: [ownRecord(me)] };
    const offers = book.offers.filter((offer) => offer.buyerId === me.id);
    const offered = new Set(offers.map((offer) => offer.saleId));
    const hideBuyer = (sale: LoanSale): LoanSale => (sale.soldTo === me.id ? sale : { ...sale, soldTo: sale.soldTo ? "another buyer" : undefined, soldPct: undefined, soldAt: undefined });
    const sales = book.sales.filter((sale) => sale.status === "listed" || sale.soldTo === me.id || offered.has(sale.id));
    const owned = new Set(sales.filter((sale) => sale.soldTo === me.id).map((sale) => sale.dealId));
    const deals = book.deals.filter((deal) => sales.some((sale) => sale.dealId === deal.id));
    return { ...empty, buyerId: me.id, buyers: [ownRecord(me)], offers, sales: sales.map(hideBuyer), deals: deals.map((deal) => (owned.has(deal.id) ? forHolder(deal) : blind(deal))) };
  }
  return empty;
}

/** Can this account read a stored file? Staff, whoever the loan belongs to, and a partner or buyer who has closed on it. */
export function canOpenFile(book: Book, viewer: Viewer, dealId: string, allowed: (permission: Permission) => boolean) {
  const deal = book.deals.find((item) => item.id === dealId);
  if (!deal) return false;
  const view = viewFor(viewer.roleCodes);
  if (view === "admin") return allowed("view_pipeline") || allowed("assign_inspection") || allowed("approve_draw");
  if (view === "borrower") return deal.borrowerId === viewer.id;
  if (view === "broker") return deal.brokerId === firmOf(viewer);
  if (view === "partner") return book.bids.some((bid) => bid.dealId === dealId && bid.partnerId === firmOf(viewer) && bid.status === "accepted");
  if (view === "buyer") return book.sales.some((sale) => sale.dealId === dealId && sale.soldTo === firmOf(viewer));
  return false;
}

export const canUploadFile = (book: Book, viewer: Viewer, dealId: string, allowed: (permission: Permission) => boolean) => {
  const deal = book.deals.find((item) => item.id === dealId);
  if (!deal) return false;
  const view = viewFor(viewer.roleCodes);
  if (view === "admin") return allowed("review_documents");
  return (view === "borrower" && deal.borrowerId === viewer.id) || (view === "broker" && deal.brokerId === firmOf(viewer));
};

/** Who can send someone a photo link: staff who deal with documents, draws or servicing, and the borrower on their own loan. */
export const canAskForPhotos = (book: Book, viewer: Viewer, dealId: string, allowed: (permission: Permission) => boolean) => {
  const deal = book.deals.find((item) => item.id === dealId);
  if (!deal) return false;
  const view = viewFor(viewer.roleCodes);
  if (view === "admin") return allowed("assign_inspection") || allowed("approve_draw") || allowed("review_documents") || allowed("service_loans");
  return view === "borrower" && deal.borrowerId === viewer.id;
};

type Result = { error: string } | { action: BookAction };
const no = (error: string): Result => ({ error });
const NOT_ALLOWED = "Your account can't do that.";
const LINK_CLOSED = "This link has been turned off. Ask for a new one.";
const PHOTOS_CLOSED = "Photos can't be added once the loan is paid off or its draw has been decided.";
const GONE = "That record no longer exists.";

/**
 * Whether this account may take this action, and the action as the server will run it. Names and firms come from the
 * session, never from the request. allowed() checks the role matrix, including per-person changes.
 */
export function authorize(book: Book, viewer: Viewer, action: BookAction, allowed: (permission: Permission, amountCents?: number) => boolean, trusted = false): Result {
  const view = viewFor(viewer.roleCodes);
  const staff = view === "admin";
  const firm = firmOf(viewer);
  const dealOf = (id: string) => book.deals.find((deal) => deal.id === id);
  const ok = (next: BookAction = action): Result => ({ action: next });
  const staffOnly = (...permissions: Permission[]) => (staff && permissions.some((permission) => allowed(permission)) ? ok() : no(NOT_ALLOWED));
  const staffOnlyAllowed = (...permissions: Permission[]) => staff && permissions.some((permission) => allowed(permission));
  const ownsDeal = (deal: Deal) => (view === "borrower" && deal.borrowerId === viewer.id) || (view === "broker" && deal.brokerId === firm);

  switch (action.t) {
    case "loadSample": case "clearSample": case "reset":
      return no(NOT_ALLOWED);

    case "submitApp": {
      if (!action.address.trim() || !action.city.trim() || !action.zip.trim() || !action.entityName.trim()) return no("Add the property address, city, ZIP and the borrowing entity.");
      // A borrower or broker sends the whole profile. Staff starting a loan from a call can leave it for the borrower to add.
      if (action.sponsor) {
        const problem = sponsorProblem(action.sponsor);
        if (problem) return no(problem);
      } else if (view === "borrower" || view === "broker") return no("Add the guarantors, past deals and declarations.");
      if (!evaluate(action.sponsor ? withSponsor(action.app, action.sponsor, new Date()) : action.app).eligible) return no("This loan isn't eligible as entered.");
      // Staff's repeat-borrower mark is for loans from before this system; borrowers' and brokers' loans are counted instead.
      const { repeatBorrower: _mark, ...counted } = action.app;
      if (view === "borrower") return ok({ ...action, app: counted, client: { name: viewer.name, borrowerId: viewer.id }, source: "web_quote" });
      if (view === "broker" && !canSendDeals(book.brokers.find((item) => item.id === firm))) return no("LendHous approves a brokerage before it sends deals. Sign the broker agreement on your Broker page; you'll hear when it's approved.");
      if (view === "broker" && firmHeld(book.brokers.find((item) => item.id === firm))) return no(FIRM_HELD);
      if (view === "broker") return action.client?.name?.trim() ? ok({ ...action, app: counted, client: { name: action.client.name.trim(), brokerId: firm, brokerPoints: Math.min(5, Math.max(0, action.client.brokerPoints ?? 0)) }, source: "broker" }) : no("Enter your client's name.");
      if (staff && allowed("view_pipeline")) return action.client?.name?.trim() ? ok({ ...action, client: { name: action.client.name.trim(), borrowerId: action.client.borrowerId }, source: action.source ?? "staff" }) : no("Enter the borrower's name.");
      return no(NOT_ALLOWED);
    }

    case "advanceLoan": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staff) return no(NOT_ALLOWED);
      if (deal.status === "underwriting") return no("Send the term sheet from the Term sheet tab, with its terms.");
      if (deal.status === "closing") return allowed("approve_funding") ? ok() : no(NOT_ALLOWED);
      return allowed("manage_conditions") || allowed("route_capital") ? ok() : no(NOT_ALLOWED);
    }
    case "repriceLoan": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staff || !allowed("issue_term_sheet")) return no(NOT_ALLOWED);
      if (!IN_REVIEW.includes(deal.status)) return no("Its terms are set once the term sheet goes out.");
      if (deal.app.pricingVersion === currentPricing().version) return no("It's already on the current pricing.");
      if (!evaluate({ ...deal.app, pricingVersion: currentPricing().version }).eligible) return no("It isn't eligible on the current pricing.");
      return ok({ ...action, by: viewer.name });
    }
    case "approveFunding":
      if (!dealOf(action.dealId)) return no(GONE);
      if (!staff || !allowed("approve_funding")) return no(NOT_ALLOWED);
      if (dealOf(action.dealId)!.fundingApprovers?.includes(viewer.name)) return no("A second, different approver is required.");
      if (!wireVerified(dealOf(action.dealId)!)) return no("Verify the wire instructions first: an approval is for one verified wire.");
      return ok({ ...action, by: viewer.name });
    case "recordScreening":
      if (!trusted) return no(NOT_ALLOWED);
      return dealOf(action.dealId) ? ok() : no(GONE);
    case "decideScreening": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staffOnlyAllowed("clear_ofac")) return no(NOT_ALLOWED);
      const latest = latestScreening(deal);
      if (latest?.id !== action.screeningId || latest.status !== "review") return no("That screening has no open match to review.");
      if (action.reason.trim().length < 10) return no("Say why, in enough detail for an examiner: what you compared and what didn't match.");
      return ok({ ...action, reason: action.reason.trim(), by: viewer.name });
    }
    case "openTitleLink": case "titleFundsReceived": case "titleRecording":
      // Only the server does these: it made the link, or it checked the link these came through.
      if (!trusted) return no(NOT_ALLOWED);
      return dealOf(action.dealId) ? ok() : no(GONE);
    case "turnOffTitleLink":
      if (!dealOf(action.dealId)) return no(GONE);
      return staffOnly("manage_conditions", "approve_funding");
    case "addClosingChecklist": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staffOnlyAllowed("manage_conditions", "review_documents")) return no(NOT_ALLOWED);
      return PRE_FUNDING.includes(deal.status) ? ok() : no("This loan has already funded.");
    }
    case "saveClosing": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staffOnlyAllowed("manage_conditions", "approve_funding")) return no(NOT_ALLOWED);
      if (!PRE_FUNDING.includes(deal.status)) return no("The closing details are set once the loan funds.");
      return action.closing.company.trim() ? ok() : no("Add the title company or closing attorney.");
    }
    case "enterWire": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      // The title company enters its own instructions through its link (trusted); otherwise only staff who handle closings.
      if (!trusted && !staffOnlyAllowed("manage_conditions", "approve_funding")) return no(NOT_ALLOWED);
      if (!WIRE_STAGES.includes(deal.status)) return no("Wire instructions go in once the term sheet is accepted and before the loan funds.");
      const cleaned = { ...action, routing: action.routing.replace(/\s/g, ""), account: action.account.replace(/\s/g, ""), by: trusted ? action.by : viewer.name };
      const refused = wireProblem(cleaned);
      if (refused) return no(refused);
      return deal.wires?.some((wire) => wire.id === action.wireId) ? no("Those instructions are already saved.") : ok(cleaned);
    }
    case "verifyWire": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staffOnlyAllowed("manage_conditions", "approve_funding")) return no(NOT_ALLOWED);
      const refused = verifyProblem(deal.wires?.find((wire) => wire.id === action.wireId), viewer.name, action.phone, action.phoneSource, action.spokeWith);
      return refused ? no(refused) : ok({ ...action, by: viewer.name });
    }
    case "updateDealNumbers": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staff || !allowed("issue_term_sheet")) return no(NOT_ALLOWED);
      if (deal.properties?.length && (["purchasePrice", "arv", "monthlyRent", "taxesAnnual", "insuranceAnnual", "hoaMonthly"] as const).some((key) => key in action.changes && action.changes[key] !== deal.app[key])) return no("A portfolio loan's values, rents and costs come from its properties: change them on the property schedule.");
      return BEFORE_CLOSING.includes(deal.status) ? ok() : no("This loan's numbers are locked once it clears to close.");
    }
    case "saveProperties": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staff || !allowed("issue_term_sheet")) return no(NOT_ALLOWED);
      if (!BEFORE_CLOSING.includes(deal.status)) return no("A loan's properties are set once it clears to close.");
      if (deal.app.product !== "dscr") return no("Portfolio loans are rental (DSCR) loans.");
      if (action.properties.some((property) => property.propertyType !== "sfr" && property.propertyType !== "2_4" && property.propertyType !== "condo" && property.propertyType !== "townhome")) return no("Each property is a 1-4 unit home, condo or townhome.");
      const problem = scheduleProblem(action.properties);
      return problem ? no(problem) : ok({ ...action, by: viewer.name });
    }
    case "releaseProperty": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staff || !allowed("service_loans")) return no(NOT_ALLOWED);
      const today = serviceDay(book);
      if (action.on > today) return no("The day the release price arrived can't be in the future.");
      const quote = releaseQuote(deal, action.propertyId, action.on);
      if ("problem" in quote) return no(quote.problem);
      if (action.amount + 0.005 < quote.total) return no(`The release takes ${money(quote.total)}: ${money(quote.price)} to principal and ${money(quote.interest)} of interest to the day.`);
      const blocked = ofacBlocker(deal, today);
      return blocked ? no(`${blocked}.`) : ok({ ...action, by: viewer.name });
    }
    case "addDocRequest":
      if (!dealOf(action.dealId)) return no(GONE);
      return staffOnly("review_documents", "manage_conditions");
    case "addOwnDoc": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!(view === "borrower" && deal.borrowerId === viewer.id)) return no(NOT_ALLOWED);
      if (isClosedApplication(deal.status) || deal.status === "paid_off") return no("This loan isn't taking documents any more.");
      if (!OWN_DOC_ID.test(action.docId) || deal.docs.some((doc) => doc.id === action.docId)) return no("That didn't go through. Try again.");
      const problem = ownDocProblem(action.name);
      return problem ? no(problem) : ok({ ...action, by: viewer.name });
    }
    case "setAgent": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      const problem = agentProblem(action.contact);
      if (problem) return no(problem);
      if (view === "borrower" && deal.borrowerId === viewer.id) return isClosedApplication(deal.status) ? no("This application has ended.") : ok({ ...action, by: viewer.name });
      return staffOnlyAllowed("review_documents", "manage_conditions", "service_loans") ? ok({ ...action, by: viewer.name }) : no(NOT_ALLOWED);
    }
    case "docStatus":
      if (!dealOf(action.dealId)) return no(GONE);
      return staffOnly("review_documents");
    case "saveSponsor": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!ownsDeal(deal) && !(staff && allowed("review_documents"))) return no(NOT_ALLOWED);
      if (deal.creditReview) return no("The credit review is signed off. Ask the team to reopen it to change this.");
      if (!IN_REVIEW.includes(deal.status)) return no("The borrower profile is locked once a term sheet is issued.");
      const problem = sponsorProblem(action.sponsor);
      return problem ? no(problem) : ok();
    }
    case "verifyTrackDeal": {
      const deal = dealOf(action.dealId);
      if (!deal?.sponsor?.trackRecord.some((item) => item.id === action.trackId)) return no(GONE);
      if (deal.creditReview) return no("The credit review is signed off. Reopen it to change what's verified.");
      return staffOnly("review_documents", "issue_term_sheet");
    }
    // Signing off is a credit decision, so it takes the same authority as issuing a term sheet.
    case "signOffCredit": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staff || !allowed("issue_term_sheet")) return no(NOT_ALLOWED);
      if (deal.creditReview) return no("The credit review is already signed off.");
      if (!IN_REVIEW.includes(deal.status)) return no("A term sheet has already gone out on this loan.");
      return ok({ ...action, by: viewer.name });
    }
    case "reopenCreditReview": {
      const deal = dealOf(action.dealId);
      if (!deal?.creditReview) return no("The credit review isn't signed off.");
      if (!staff || !allowed("issue_term_sheet")) return no(NOT_ALLOWED);
      return IN_REVIEW.includes(deal.status) ? ok() : no("A term sheet has already gone out on this loan.");
    }
    case "applyBorrowerInfo":
      if (!trusted) return no(NOT_ALLOWED);
      return dealOf(action.dealId) ? ok() : no(GONE);
    case "linkBorrower":
      // Only the server's own invite step does this, after it has looked the account up.
      return trusted ? ok() : no(NOT_ALLOWED);
    case "partnerFundsSent": {
      const deal = dealOf(action.dealId);
      if (!deal || view !== "partner") return no(NOT_ALLOWED);
      const problem = sentProblem(deal, firm);
      return problem ? no(problem) : ok();
    }
    case "partnerFundsReceived": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      // Money taken in from a firm is checked like money paid out: a clean screening from the last few days.
      const screened = firmOfacBlocker(book.partners.find((item) => item.id === deal.partnerFunding?.partnerId), serviceDay(book));
      if (screened) return no(`${screened}.`);
      const problem = receivedProblem(deal);
      return problem ? no(problem) : staffOnly("route_capital", "manage_capital");
    }
    case "brokerApplied":
      // The broker's own page does this on the server, after screening the firm and storing its files.
      return trusted ? ok() : no(NOT_ALLOWED);
    case "brokerScreened":
      if (!trusted) return no(NOT_ALLOWED);
      return book.brokers.some((item) => item.id === action.brokerId) ? ok() : no(GONE);
    case "firmScreened":
      if (!trusted) return no(NOT_ALLOWED);
      return (action.kind === "partner" ? book.partners : book.buyers).some((item) => item.id === action.firmId) ? ok() : no(GONE);
    case "decideFirmScreening": {
      const firmRecord = (action.kind === "partner" ? book.partners : action.kind === "buyer" ? book.buyers : book.brokers).find((item) => item.id === action.firmId);
      if (firmRecord?.screening?.id !== action.screeningId || firmRecord.screening.status !== "review") return no("That screening has no open match to review.");
      if (!action.reason.trim()) return no("Say what you compared: dates of birth, addresses, nationality or the listing's details.");
      return staffOnlyAllowed("clear_ofac") ? ok({ ...action, reason: action.reason.trim(), by: viewer.name }) : no(NOT_ALLOWED);
    }
    case "approveBroker": {
      const problem = approveProblem(book.brokers.find((item) => item.id === action.brokerId), action.reason);
      return problem ? no(problem) : staffOnlyAllowed("manage_brokers") ? ok({ ...action, by: viewer.name }) : no(NOT_ALLOWED);
    }
    case "saveBrokerBrand": {
      const broker = book.brokers.find((item) => item.id === action.brokerId);
      if (!broker) return no(GONE);
      const own = view === "broker" && firmOf(viewer) === broker.id;
      if (!own && !staffOnlyAllowed("manage_brokers")) return no(NOT_ALLOWED);
      if (broker.status !== "approved") return no("LendHous approves a brokerage before its brand goes on quotes.");
      const problem = brandProblem(action.brand);
      return problem ? no(problem) : ok();
    }
    case "setBrokerLetterLimit": {
      const broker = book.brokers.find((item) => item.id === action.brokerId);
      if (!broker) return no(GONE);
      if (broker.status !== "approved" && action.limit > 0) return no("Approve the brokerage before it issues letters.");
      if (!Number.isFinite(action.limit) || action.limit < 0 || action.limit > 5_000_000) return no("A letter limit is $0 to $5,000,000.");
      return staffOnlyAllowed("manage_brokers") ? ok({ ...action, by: viewer.name }) : no(NOT_ALLOWED);
    }
    case "suspendBroker": {
      const broker = book.brokers.find((item) => item.id === action.brokerId);
      if (!broker || broker.status === "suspended") return no("That brokerage isn't active.");
      if (!action.reason.trim()) return no("Say why it's being suspended.");
      return staffOnlyAllowed("manage_brokers") ? ok({ ...action, by: viewer.name }) : no(NOT_ALLOWED);
    }
    case "referLoan":
      // Starting a loan from a lead does this, after reading which broker's link the lead came from.
      if (!trusted) return no(NOT_ALLOWED);
      return dealOf(action.dealId) ? ok() : no(GONE);
    case "referFriend": {
      // Starting a loan from a lead does this, after reading whose link the lead came from and the bonus in Settings.
      if (!trusted) return no(NOT_ALLOWED);
      const problem = referralProblem(book.deals, action.dealId, action.referrerId);
      return problem ? no(problem) : ok();
    }
    case "placeProperty": case "recordFloodMap":
      // Only the server places a property, from the geocoder, and asks FEMA's flood map about it.
      if (!trusted) return no(NOT_ALLOWED);
      return dealOf(action.dealId) ? ok() : no(GONE);
    case "recordStormCheck":
      // Only the server reads NHC's forecast cones.
      if (!trusted) return no(NOT_ALLOWED);
      return action.storms.every((storm) => storm.dealIds.every((id) => dealOf(id))) ? ok() : no(GONE);
    case "saveLastSale": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!(action.price > 0)) return no("Enter the price it last sold for.");
      if (action.on > serviceDay(book)) return no("The sale date can't be in the future.");
      return staffOnlyAllowed("review_documents", "manage_conditions", "issue_term_sheet") ? ok({ ...action, by: viewer.name }) : no(NOT_ALLOWED);
    }
    case "postInvestorUpdate": {
      const problem = updateProblem(dealOf(action.dealId), action.text);
      return problem ? no(problem) : staffOnlyAllowed("manage_capital", "service_loans") ? ok({ ...action, text: action.text.trim(), by: viewer.name }) : no(NOT_ALLOWED);
    }
    case "setWorkout": {
      const problem = workoutProblem(dealOf(action.dealId), action.on, action.note);
      return problem ? no(problem) : staffOnlyAllowed("service_loans", "declare_default") ? ok({ ...action, by: viewer.name }) : no(NOT_ALLOWED);
    }
    case "answerSurvey": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!(view === "borrower" && deal.borrowerId === viewer.id)) return no(NOT_ALLOWED);
      const problem = surveyProblem(deal, action.stage, action.score, serviceDay(book));
      return problem ? no(problem) : ok({ ...action, comment: action.comment.trim() });
    }
    case "referralBonusPaid": {
      const problem = bonusPaidProblem(dealOf(action.dealId), action.amount, action.on, serviceDay(book));
      return problem ? no(problem) : staffOnlyAllowed("manage_capital", "service_loans") ? ok({ ...action, by: viewer.name }) : no(NOT_ALLOWED);
    }
    case "setBrokerPoints": {
      const deal = dealOf(action.dealId);
      if (!deal?.brokerId) return no("This loan has no broker.");
      if (!IN_REVIEW.includes(deal.status)) return no("The broker's fee is set before the term sheet goes out.");
      if (!Number.isFinite(action.points) || action.points < 0 || action.points > 5) return no("A broker's fee is 0 to 5 points.");
      return staffOnly("issue_term_sheet", "manage_brokers");
    }
    case "brokerFeePaid": {
      const problem = feePaidProblem(dealOf(action.dealId), action.amount, action.on, serviceDay(book));
      return problem ? no(problem) : staffOnlyAllowed("manage_brokers", "manage_capital") ? ok({ ...action, by: viewer.name }) : no(NOT_ALLOWED);
    }
    case "assignLoanTeam": {
      // The server looks the person up and checks assign_loans (or someone taking an open seat) before it gets here.
      if (!trusted) return no(NOT_ALLOWED);
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      const problem = assignProblem(deal, action.role, action.member);
      return problem ? no(problem) : ok();
    }
    case "uploadDoc":
      // Only the upload route does this, after the file is safely stored.
      return trusted ? ok() : no("Upload the file itself to mark this document as received.");
    // Only the server does these, once it has checked who is asking or which link was opened. The state is checked again
    // here, on the book as it is now, because a link can be turned off or its draw decided while a photo is on its way.
    case "askForPhotos": {
      if (!trusted) return no(NOT_ALLOWED);
      const deal = dealOf(action.dealId);
      if (!deal || (action.drawId && !book.draws.some((draw) => draw.id === action.drawId && draw.dealId === deal.id))) return no(GONE);
      // An inspector's link is for one draw the team has ordered an inspection on.
      if (action.who === "inspector" && (!action.byTeam || book.draws.find((draw) => draw.id === action.drawId)?.status !== "inspecting")) return no("An inspector's link is for a draw with an inspection ordered.");
      return photosClosed(deal, book.draws.find((draw) => draw.id === action.drawId)) ? no(PHOTOS_CLOSED) : ok();
    }
    case "renewPhotoRequest": case "turnOffPhotoRequest": case "addRequestPhoto": case "removeRequestPhoto": case "finishPhotoRequest": {
      if (!trusted) return no(NOT_ALLOWED);
      const request = book.photoRequests.find((item) => item.id === action.requestId);
      if (!request) return no(GONE);
      if (action.t === "turnOffPhotoRequest") return ok();
      const deal = dealOf(request.dealId);
      const draw = book.draws.find((item) => item.id === request.drawId);
      if (action.t === "renewPhotoRequest") return photoRequestState({ ...request, status: "open", expiresAt: action.expiresAt }, deal, draw) === "open" ? ok() : no(PHOTOS_CLOSED);
      if (photoRequestState(request, deal, draw) !== "open") return no(LINK_CLOSED);
      if (action.t === "addRequestPhoto" && request.photos.length >= MAX_PHOTOS_PER_LINK) return no(`This link is full at ${MAX_PHOTOS_PER_LINK} photos. Remove one or ask for a new link.`);
      if (action.t === "finishPhotoRequest" && !request.photos.length) return no("Add at least one photo first.");
      return ok();
    }

    case "route": case "sendTeaser":
      if (!dealOf(action.dealId)) return no(GONE);
      if (FUNDED.includes(dealOf(action.dealId)!.status)) return no("This loan is already funded.");
      if (action.t === "sendTeaser") {
        const held = book.partners.filter((item) => action.partnerIds.includes(item.id) && firmHeld(item));
        if (held.length) return no(`${held.map((item) => item.name).join(", ")} ${held.length === 1 ? "has" : "have"} a possible or confirmed OFAC match. Nothing goes to them until it's reviewed.`);
      }
      return staffOnly("route_capital");
    case "acceptBid": {
      const bid = book.bids.find((item) => item.id === action.bidId);
      if (!bid || bid.status !== "submitted") return no("That bid is no longer open.");
      // A partner's commitment is money LendHous takes, so the firm is screened first.
      const screened = firmOfacBlocker(book.partners.find((item) => item.id === bid.partnerId));
      if (screened) return no(`${screened}.`);
      return staffOnly("route_capital");
    }
    case "commit":
      if (!dealOf(action.dealId)) return no(GONE);
      return staffOnly("route_capital", "manage_capital");
    case "saveSource": case "removeSource":
      return staffOnly("manage_capital");
    case "saveFirm": case "setFundsDraws":
      if (action.t === "setFundsDraws" && !book.partners.some((partner) => partner.id === action.partnerId)) return no(GONE);
      return staffOnly("route_capital", "manage_capital");

    // A partner says what happens to its money when a loan pays off; the team can record it on the partner's word.
    case "setRollover": {
      if (!book.partners.some((partner) => partner.id === action.partnerId)) return no(GONE);
      const own = view === "partner" && firm === action.partnerId;
      if (!own && !staffOnlyAllowed("route_capital", "manage_capital")) return no(NOT_ALLOWED);
      return ok({ ...action, by: viewer.name });
    }
    case "sendProceeds": {
      const item = book.partners.find((partner) => partner.id === action.partnerId)?.proceeds?.find((x) => x.id === action.proceedsId);
      if (!item) return no(GONE);
      if (!staffOnlyAllowed("route_capital", "manage_capital")) return no(NOT_ALLOWED);
      if (item.sent) return no("That's already marked sent.");
      if (item.toSend <= 0) return no("Nothing from that payoff is owed: it was all rolled over.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(action.on) || action.on > serviceDay(book) || action.on < item.on) return no("Choose the day it was sent, from the payoff to today.");
      const held = firmOfacBlocker(book.partners.find((partner) => partner.id === action.partnerId), serviceDay(book));
      return held ? no(`${held}.`) : ok({ ...action, by: viewer.name });
    }
    case "transferShare": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staffOnlyAllowed("route_capital")) return no(NOT_ALLOWED);
      if (action.rate !== undefined && !(action.rate > 0 && action.rate <= 25)) return no("The new holder's rate is a percent above 0 and at most 25.");
      const problem = transferProblem(book, deal, action.from, action.to, action.on, serviceDay(book));
      return problem ? no(problem) : ok({ ...action, by: viewer.name });
    }
    case "settleTransfer": {
      const transfer = dealOf(action.dealId)?.transfers?.find((item) => item.id === action.transferId);
      if (!transfer) return no(GONE);
      if (!staffOnlyAllowed("route_capital", "manage_capital")) return no(NOT_ALLOWED);
      if (transfer.settled) return no("That transfer is already settled.");
      if (action.on > serviceDay(book) || action.on < transfer.on) return no("Choose the day it settled, from the transfer to today.");
      return ok({ ...action, by: viewer.name });
    }
    case "drawCallSent": case "drawCallReceived": {
      const call = dealOf(action.dealId)?.drawCalls?.find((item) => item.id === action.callId);
      if (!call) return no(GONE);
      if (action.t === "drawCallSent" ? !(view === "partner" && firm === call.partnerId) : !staffOnlyAllowed("route_capital", "manage_capital")) return no(NOT_ALLOWED);
      if (action.t === "drawCallSent" ? call.sent || call.received : call.received) return no("That's already recorded.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(action.on) || action.on > serviceDay(book) || action.on < call.calledOn) return no("Choose a day from when it was asked for to today.");
      if (action.t === "drawCallReceived") {
        const held = firmOfacBlocker(book.partners.find((partner) => partner.id === call.partnerId), serviceDay(book));
        if (held) return no(`${held}.`);
      }
      return ok({ ...action, by: viewer.name });
    }

    case "bid": {
      const me = book.partners.find((partner) => partner.id === firm);
      const deal = dealOf(action.bid.dealId);
      if (view !== "partner" || !me?.ndaSigned || !deal?.teaserSentTo.includes(me.id)) return no(NOT_ALLOWED);
      if (firmHeld(me)) return no(FIRM_HELD);
      if (book.bids.some((bid) => bid.dealId === deal.id && bid.partnerId === me.id)) return no("You've already responded to this deal.");
      return ok({ ...action, bid: { ...action.bid, partnerId: me.id } });
    }
    case "signNda":
      if (view !== "partner" || !book.partners.some((partner) => partner.id === firm)) return no(NOT_ALLOWED);
      return ok({ ...action, partnerId: firm });
    case "signBuyerNda":
      if (view !== "buyer" || !book.buyers.some((buyer) => buyer.id === firm)) return no(NOT_ALLOWED);
      return ok({ ...action, buyerId: firm });

    case "listLoan": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!FUNDED.includes(deal.status)) return no("Only a funded loan can be sold.");
      if (book.sales.some((sale) => sale.dealId === deal.id && sale.status !== "withdrawn")) return no("This loan is already listed or sold.");
      return staffOnly("route_capital", "manage_capital");
    }
    case "unlistLoan":
      if (book.sales.find((sale) => sale.id === action.saleId)?.status !== "listed") return no("That sale is no longer open.");
      return staffOnly("route_capital", "manage_capital");
    case "offerLoan": {
      const me = book.buyers.find((buyer) => buyer.id === firm);
      if (view !== "buyer" || !me?.ndaSigned) return no(NOT_ALLOWED);
      if (firmHeld(me)) return no(FIRM_HELD);
      if (book.sales.find((sale) => sale.id === action.saleId)?.status !== "listed") return no("That loan is no longer for sale.");
      if (book.offers.some((offer) => offer.saleId === action.saleId && offer.buyerId === me.id && offer.status === "submitted")) return no("You already have an offer on this loan.");
      return ok({ ...action, buyerId: me.id });
    }
    case "decideOffer": {
      const offer = book.offers.find((item) => item.id === action.offerId);
      if (!offer || offer.status !== "submitted") return no("That offer is no longer open.");
      if (book.sales.find((sale) => sale.id === offer.saleId)?.status !== "listed") return no("That loan is no longer for sale.");
      // Selling a loan takes the buyer's money: a clean screening from the last few days.
      const screened = action.accept ? firmOfacBlocker(book.buyers.find((item) => item.id === offer.buyerId), serviceDay(book)) : null;
      if (screened) return no(`${screened}.`);
      return staffOnly("route_capital", "manage_capital");
    }

    case "acceptTermSheet": case "requestTermSheetChanges": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!(view === "borrower" && deal.borrowerId === viewer.id)) return no(`Only the borrower can ${action.t === "acceptTermSheet" ? "accept a term sheet" : "ask for changes to a term sheet"}.`);
      const refused = respondProblem(deal, serviceDay(book));
      if (refused) return no(refused);
      if (action.t === "requestTermSheetChanges" && !action.note.trim()) return no("Say what you'd like changed.");
      if (action.t === "acceptTermSheet" && action.points !== undefined && !optionAt(latestSheet(deal)?.buyDowns, action.points)) return no("That rate and points choice isn't on this term sheet.");
      return ok(action.t === "requestTermSheetChanges" ? { ...action, note: action.note.trim(), by: viewer.name } : action);
    }
    case "issueTermSheet": case "requestPricingException": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      const input = { rate: action.rate, points: action.points, termMonths: action.termMonths, prepay: action.prepay };
      // The underwriter's dollar limit applies to the loan as these terms size it (Spec 4.3).
      if (!staff || !allowed("issue_term_sheet", Math.round(evaluate(pricedApp(deal.app, input)).noteAmount * 100))) return no(staffOnlyAllowed("issue_term_sheet") ? "This loan is above your term sheet limit." : NOT_ALLOWED);
      const refused = action.t === "issueTermSheet" ? sheetProblem(deal, input) : exceptionRequestProblem(deal, input, action.note);
      return refused ? no(refused) : ok({ ...action, by: viewer.name });
    }
    case "decidePricingException": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staffOnlyAllowed("approve_matrix_exception")) return no(NOT_ALLOWED);
      const refused = exceptionDecisionProblem(deal, viewer.name);
      if (refused) return no(refused);
      return !action.approve && !action.note.trim() ? no("Say why it's declined.") : ok({ ...action, by: viewer.name });
    }
    case "checkTermSheets":
      return trusted ? ok() : no(NOT_ALLOWED);
    case "markApplicationComplete": case "saveRevenue": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staffOnlyAllowed("review_documents", "issue_term_sheet", "manage_conditions")) return no(NOT_ALLOWED);
      const today = serviceDay(book);
      if (action.t === "saveRevenue") { const refused = revenueProblem(action.amount, action.year, today); return refused ? no(refused) : ok({ ...action, by: viewer.name }); }
      if (deal.completed) return no(`It was marked complete on ${deal.completed.on}.`);
      if (!PRE_FUNDING.includes(deal.status) && !isClosedApplication(deal.status)) return no("This loan is past the application.");
      return /^\d{4}-\d{2}-\d{2}$/.test(action.on) && action.on <= today ? ok({ ...action, by: viewer.name }) : no("Enter the day it became complete, today or earlier.");
    }
    case "saveAdverseReasons": case "recordReasonsRequest": {
      const deal = dealOf(action.dealId);
      if (!deal?.adverseAction) return no("This application wasn't declined.");
      // The decline notice is a credit decision's paperwork: the same authority as declining.
      if (!staffOnlyAllowed("issue_term_sheet")) return no(NOT_ALLOWED);
      if (action.t === "recordReasonsRequest") { const refused = requestProblem(deal.adverseAction, action.receivedOn, serviceDay(book)); return refused ? no(refused) : ok({ ...action, by: viewer.name }); }
      if (deal.adverseAction.large ? deal.adverseAction.statement : deal.adverseAction.notice) return no("The reasons have already gone out.");
      const refused = reasonsProblem(action.reasons);
      return refused ? no(refused) : ok({ ...action, by: viewer.name });
    }
    case "recordAdverseNotice":
      return trusted ? ok() : no("Send the notice from the loan's page.");
    case "addPropertyPhotos":
      return trusted ? ok() : no("Upload the photos themselves.");
    case "setExitPlan": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!FUNDED.includes(deal.status)) return no("An exit plan is for a funded loan.");
      const problem = exitPlanProblem(action.plan);
      if (problem) return no(problem);
      // The borrower tells us; the team can write down what the borrower said on a call.
      if (view === "borrower" && deal.borrowerId === viewer.id) return ok({ ...action, by: viewer.name });
      return staffOnlyAllowed("service_loans") ? ok({ ...action, by: viewer.name }) : no(NOT_ALLOWED);
    }
    case "setShowcase": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      // Only the borrower can put their loan on the website; the team can take it down.
      if (view === "borrower" && deal.borrowerId === viewer.id) return showcaseable(deal) || !action.on ? ok({ ...action, by: viewer.name }) : no("A loan goes on the website once it's funded.");
      if (action.on) return no(NOT_ALLOWED);
      return staffOnlyAllowed("service_loans", "manage_roles") ? ok({ ...action, by: viewer.name }) : no(NOT_ALLOWED);
    }
    case "removePropertyPhoto": {
      const deal = dealOf(action.dealId);
      if (!deal?.propertyPhotos?.some((photo) => photo.id === action.photoId)) return no(GONE);
      // The application link takes away a photo its borrower sent (trusted); otherwise it's the team's call.
      return trusted ? ok() : staffOnly("review_documents", "manage_conditions");
    }
    case "setLegalHold": {
      if (!dealOf(action.dealId)) return no(GONE);
      return staffOnlyAllowed("manage_roles") ? ok({ ...action, by: viewer.name }) : no(NOT_ALLOWED);
    }
    case "addCondition": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staffOnlyAllowed("manage_conditions")) return no(NOT_ALLOWED);
      const refused = addProblem(deal, action.condition, serviceDay(book));
      if (refused) return no(refused);
      if (action.condition.templateId && !libraryOf(book).some((item) => item.id === action.condition.templateId && item.active)) return no("That standard condition isn't in the library.");
      return ok({ ...action, by: viewer.name });
    }
    case "clearCondition": case "returnCondition": case "waiveCondition": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      // Waiving takes its own permission (Spec A10); clearing and sending back are the people who manage conditions.
      if (!staffOnlyAllowed(action.t === "waiveCondition" ? "waive_conditions" : "manage_conditions")) return no(NOT_ALLOWED);
      const refused = changeProblem(deal.conditions?.find((item) => item.id === action.conditionId), action.t === "clearCondition" ? "cleared" : action.t === "waiveCondition" ? "waived" : "returned", action.t === "clearCondition" ? action.note : action.reason);
      return refused ? no(refused) : ok({ ...action, by: viewer.name });
    }
    case "conditionFile":
      return trusted ? ok() : no("Upload the file itself to send it for a condition.");
    case "saveConditionTemplate": {
      if (!staffOnlyAllowed("manage_roles")) return no(NOT_ALLOWED);
      if (action.template.id && !libraryOf(book).some((item) => item.id === action.template.id)) return no(GONE);
      const refused = templateProblem(action.template);
      return refused ? no(refused) : ok({ ...action, by: viewer.name });
    }
    case "saveScope": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!ownsDeal(deal) && !(staff && allowed("review_documents"))) return no(NOT_ALLOWED);
      if (!BEFORE_CLOSING.includes(deal.status)) return no("The scope of work is locked once a loan clears to close.");
      // Budgets come from the request, but what has been released comes from the record. The one line a borrower can add
      // is the contingency (lib/budget.ts), and it can be taken out again while nothing is released from it.
      const existing = (deal.scope ?? []).map((line) => ({ ...line, budget: action.scope.find((item) => item.id === line.id)?.budget ?? line.budget }));
      const contingency = action.scope.find((item) => item.id === CONTINGENCY_ID);
      const withContingency = contingency && !existing.some((line) => line.id === CONTINGENCY_ID) ? [...existing, { id: CONTINGENCY_ID, division: "Contingency", budget: contingency.budget, released: 0 }] : existing;
      const scope = withContingency.filter((line) => line.id !== CONTINGENCY_ID || line.budget > 0 || line.released > 0);
      const refused = scopeError(scope, evaluate(deal.app).holdback);
      return refused ? no(refused) : ok({ ...action, scope });
    }
    case "requestDraw": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!(view === "borrower" && deal.borrowerId === viewer.id)) return no(NOT_ALLOWED);
      if (!FUNDED.includes(deal.status)) return no("Draws start once the loan is funded.");
      if (action.linePhotos?.some((photo) => photo.documentId && !action.photoIds?.includes(photo.documentId))) return no("A photo on this draw wasn't uploaded with it. Try again.");
      return ok({ ...action, by: viewer.name });
    }
    case "requestChangeOrder": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      const team = staff && (allowed("approve_draw") || allowed("assign_inspection") || allowed("service_loans"));
      if (!team && !(view === "borrower" && deal.borrowerId === viewer.id)) return no(NOT_ALLOWED);
      if (openChanges(deal).length >= 5) return no("This loan has five change orders waiting already. Wait for those to be decided.");
      const refused = changeOrderProblem(deal, action);
      return refused ? no(refused) : ok({ ...action, by: viewer.name, byTeam: Boolean(team) });
    }
    case "decideChangeOrder": {
      const deal = dealOf(action.dealId);
      const order = deal?.changeOrders?.find((item) => item.id === action.orderId);
      if (!deal || !order) return no(GONE);
      if (!staff || !allowed("approve_draw")) return no(NOT_ALLOWED);
      if (order.status !== "requested") return no("That change order has already been decided.");
      if (!action.approve && !action.note.trim()) return no("Say why, so the borrower knows what to change.");
      const refused = action.approve ? changeOrderProblem(deal, order) : null;
      return refused ? no(refused) : ok({ ...action, by: viewer.name });
    }
    case "recordOverrun": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!FUNDED.includes(deal.status)) return no("Overruns are found on a funded loan's inspections.");
      if (!Number.isFinite(action.amount) || action.amount <= 0) return no("Enter how much more the work will cost.");
      if (action.scopeId && !(deal.scope ?? []).some((line) => line.id === action.scopeId)) return no("That budget line is no longer on this loan.");
      if (!action.note.trim()) return no("Say what the inspection found.");
      return staffOnlyAllowed("assign_inspection", "approve_draw") ? ok({ ...action, by: viewer.name }) : no(NOT_ALLOWED);
    }
    case "coverOverrun": {
      const deal = dealOf(action.dealId);
      const overrun = deal?.overruns?.find((item) => item.id === action.overrunId);
      if (!deal || !overrun) return no(GONE);
      if (overrun.covered) return no("That overrun is already covered.");
      if (!action.how.trim()) return no("Say how it was covered: the borrower paid the contractor, or a change order moved the money.");
      return staffOnlyAllowed("approve_draw") ? ok({ ...action, by: viewer.name }) : no(NOT_ALLOWED);
    }
    case "sendInspector": case "recordInspection":
      if (!book.draws.some((draw) => draw.id === action.drawId)) return no(GONE);
      return staffOnly("assign_inspection", "approve_draw");
    case "approveDrawRequest":
      if (!book.draws.some((draw) => draw.id === action.drawId)) return no(GONE);
      if (!staff || !allowed("approve_draw")) return no(NOT_ALLOWED);
      return ok({ ...action, by: viewer.name });
    case "rejectDraw": case "releaseDraw": {
      const draw = book.draws.find((item) => item.id === action.drawId);
      if (!draw) return no(GONE);
      const blocked = action.t === "releaseDraw" ? ofacBlocker(dealOf(draw.dealId)!, serviceDay(book)) : null;
      if (blocked) return no(`${blocked}.`);
      // Florida's lien law and the insurance hold the money until they're met or an owner releases it past them.
      const holds = action.t === "releaseDraw" ? unreleasedHolds(dealOf(draw.dealId)!, draw, serviceDay(book)) : [];
      return holds.length ? no(holds[0]) : staffOnly("approve_draw");
    }
    case "saveInsurance": case "setFloodZone": case "decideRenewal": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staffOnlyAllowed("manage_conditions", "service_loans", "approve_draw", "assign_inspection")) return no(NOT_ALLOWED);
      if (!INSURED.includes(deal.status)) return no("The insurance file is kept from an accepted term sheet until the loan is paid off.");
      if (action.t === "saveInsurance") { const refused = policyProblem(deal, action); if (refused) return no(refused); }
      if (action.t === "decideRenewal") {
        if (!openRenewals(deal).some((item) => item.id === action.renewalId)) return no("That renewal has already been looked at.");
        if (!action.accept && !action.note.trim()) return no("Say what's wrong with it, so the borrower knows what to send.");
      }
      return ok({ ...action, by: viewer.name });
    }
    case "insuranceRenewal":
      // The upload route sends this once the file is stored, after checking the uploader is the borrower or the team.
      if (!trusted) return no("Upload the policy itself to send it.");
      return dealOf(action.dealId) ? ok() : no(GONE);
    case "saveLienFile": case "addNoticeToOwner": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staffOnlyAllowed("approve_draw", "assign_inspection", "manage_conditions")) return no(NOT_ALLOWED);
      if (!["term_sheet_accepted", "conditions", "clear_to_close", "closing", ...FUNDED].includes(deal.status)) return no("The lien file is kept from an accepted term sheet until the loan is paid off.");
      const today = serviceDay(book);
      if (action.t === "saveLienFile") { const refused = lienFileProblem(action, today); if (refused) return no(refused); }
      if (action.t === "addNoticeToOwner" && (!action.lienor.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(action.servedOn) || action.servedOn > today)) return no("Add who served it and the day it was served, today or earlier.");
      return ok({ ...action, by: viewer.name });
    }
    case "lienWaiverReceived": case "affidavitReceived": case "checkInsurance":
      return trusted ? ok() : no("Upload the file itself to send it.");
    case "checkLienWaiver": case "rejectLienWaiver": case "checkAffidavit": case "setFinalDraw": {
      const draw = book.draws.find((item) => item.id === action.drawId);
      if (!draw) return no(GONE);
      if (!staffOnlyAllowed("approve_draw", "assign_inspection")) return no(NOT_ALLOWED);
      if (action.t === "checkLienWaiver") { const refused = waiverCheckProblem(draw.waivers?.find((item) => item.id === action.waiverId), action.amount, action.throughOn, serviceDay(book)); if (refused) return no(refused); }
      if (action.t === "rejectLienWaiver" && !action.reason.trim()) return no("Say what's wrong with it.");
      if (action.t === "checkAffidavit" && !draw.affidavit) return no("The affidavit hasn't come in.");
      return ok(action.t === "setFinalDraw" ? action : { ...action, by: viewer.name });
    }
    case "overrideDrawHolds": {
      const draw = book.draws.find((item) => item.id === action.drawId);
      if (!draw) return no(GONE);
      if (!staffOnlyAllowed("override_draw_holds")) return no(NOT_ALLOWED);
      if (!drawHolds(dealOf(draw.dealId)!, draw, serviceDay(book)).length) return no("Nothing is holding this draw.");
      return action.reason.trim() ? ok({ ...action, by: viewer.name }) : no("Say why it should go out anyway.");
    }
    case "recordPayment": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!FUNDED.includes(deal.status)) return no("This loan isn't being serviced.");
      if (!staff || !allowed("service_loans")) return no(NOT_ALLOWED);
      if (action.receivedOn > servicingDate(new Date())) return no("The date received can't be in the future.");
      if (action.receivedOn < deal.closingDate) return no("That date is before the loan closed.");
      if (action.amount > evaluate(deal.app).noteAmount) return no("That's more than the whole loan. A full repayment goes through a payoff.");
      if (action.method === "reserve") { const refused = reservePaymentProblem(deal, action.amount, servicingDate(new Date())); if (refused) return no(refused); }
      const reference = action.reference.trim();
      // The same amount, day and reference twice is a double entry, not two payments.
      if (deal.payments?.some((payment) => !payment.reversed && payment.amount === action.amount && payment.receivedOn === action.receivedOn && payment.reference === reference)) return no("That payment is already recorded. If it's a second one, add its reference to tell them apart.");
      return ok({ ...action, reference, by: viewer.name });
    }
    case "reversePayment": {
      const deal = dealOf(action.dealId);
      const payment = deal?.payments?.find((item) => item.id === action.paymentId);
      if (!deal || !payment) return no(GONE);
      if (payment.reversed) return no("That payment is already reversed.");
      if (!FUNDED.includes(deal.status)) return no("This loan isn't being serviced.");
      if (!staff || !allowed("service_loans")) return no(NOT_ALLOWED);
      return ok({ ...action, by: viewer.name });
    }
    case "waiveLateFee": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staff || !allowed("waive_fee")) return no(NOT_ALLOWED);
      const row = ledger(deal).rows.find((item) => item.due === action.due);
      if (!row?.late || row.waived) return no("There's no late fee on that payment to waive.");
      return ok({ ...action, by: viewer.name });
    }
    case "settleLoans":
      return trusted ? ok() : no(NOT_ALLOWED);
    case "requestPayoff": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!FUNDED.includes(deal.status)) return no("This loan isn't funded.");
      if (!(view === "borrower" && deal.borrowerId === viewer.id) && !(staff && allowed("service_loans"))) return no(NOT_ALLOWED);
      const date = goodThroughProblem(action.goodThrough, serviceDay(book));
      return date ? no(date) : ok({ ...action, by: viewer.name });
    }
    case "logPayoffRequest": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staffOnlyAllowed("service_loans")) return no(NOT_ALLOWED);
      if (!FUNDED.includes(deal.status)) return no("This loan isn't funded.");
      if (action.sentOn > serviceDay(book)) return no("The day it was sent can't be in the future.");
      if (action.requester.kind === "title" && !action.requester.company?.trim()) return no("Add the title company or law firm.");
      const date = goodThroughProblem(action.goodThrough, serviceDay(book));
      return date ? no(date) : ok({ ...action, by: viewer.name });
    }
    case "submitPayoffRequest":
    case "payoffLetterDelivered":
      return trusted ? ok() : no(NOT_ALLOWED);
    case "acceptPayoffCheck": case "refusePayoff": case "issuePayoffLetter": {
      const request = book.payoffs.find((payoff) => payoff.id === action.payoffId);
      const deal = request && dealOf(request.dealId);
      if (!request || !deal) return no(GONE);
      if (!staffOnlyAllowed("service_loans")) return no(NOT_ALLOWED);
      if (action.t === "acceptPayoffCheck") return request.check?.status === "pending" ? ok({ ...action, by: viewer.name }) : no("There's nothing to check on this request.");
      if (action.t === "refusePayoff") return request.status === "requested" ? ok({ ...action, by: viewer.name }) : no("Only a request still waiting for its letter can be refused.");
      const refused = issueProblem(deal, request, action.goodThrough, action.reason, serviceDay(book));
      return refused ? no(refused) : ok({ ...action, by: viewer.name });
    }
    case "recordPayoff": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staff || !allowed("service_loans")) return no(NOT_ALLOWED);
      const letter = action.onLetter && book.payoffs.find((payoff) => payoff.id === action.onLetter!.payoffId && payoff.dealId === deal.id)?.letters?.find((item) => item.number === action.onLetter!.number);
      if (action.onLetter && !letter) return no("That payoff letter isn't on this loan.");
      const refused = payoffError(deal, action.amount, action.receivedOn, servicingDate(new Date()), letter || undefined);
      return refused ? no(refused) : ok({ ...action, reference: action.reference.trim(), by: viewer.name });
    }
    case "recordLienRelease": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staff || !allowed("service_loans")) return no(NOT_ALLOWED);
      if (deal.status !== "paid_off" || !deal.paidOff) return no("Only a loan paid off here has a release to track.");
      if (deal.paidOff.release?.recordedOn) return no("The release is already recorded.");
      if (action.on > servicingDate(new Date())) return no("The date can't be in the future.");
      if (action.on < deal.paidOff.receivedOn) return no("That's before the payoff arrived.");
      const reference = action.reference.trim();
      if (action.step === "recorded" && !reference) return no("Add where it was recorded: the book and page, or the instrument number.");
      return ok({ ...action, reference, by: viewer.name });
    }

    case "closeApplication": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!PRE_FUNDING.includes(deal.status)) return no(isClosedApplication(deal.status) ? "This application is already closed." : "A funded loan ends with a payoff, not a withdrawal.");
      if (!(action.reason in (action.outcome === "declined" ? DECLINE_REASONS : WITHDRAW_REASONS))) return no("Choose a reason.");
      // Turning a loan down is a credit decision. Withdrawing is the borrower's call, or the team's on their word.
      const team = staff && (allowed("issue_term_sheet") || (action.outcome === "withdrawn" && allowed("manage_conditions")));
      if (!team && !(action.outcome === "withdrawn" && view === "borrower" && deal.borrowerId === viewer.id)) return no(NOT_ALLOWED);
      if (action.revenue && (action.outcome !== "declined" || !staff)) return ok({ ...action, revenue: undefined, by: viewer.name, byTeam: staff });
      if (action.revenue && revenueProblem(action.revenue.amount, action.revenue.year, serviceDay(book))) return no(revenueProblem(action.revenue.amount, action.revenue.year, serviceDay(book))!);
      return ok({ ...action, by: viewer.name, byTeam: staff });
    }
    case "reopenApplication": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staff || !allowed("issue_term_sheet")) return no(NOT_ALLOWED);
      return deal.closure ? ok({ ...action, by: viewer.name }) : no("This application isn't closed.");
    }
    case "declareDefault": case "cureDefault": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staff || !allowed("declare_default")) return no(NOT_ALLOWED);
      const today = servicingDate(new Date());
      const refused = action.t === "declareDefault" ? defaultError(deal, action.kind, action.effectiveOn, today) : cureError(deal, today);
      return refused ? no(refused) : ok({ ...action, by: viewer.name });
    }
    case "requestExtension": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!(view === "borrower" && deal.borrowerId === viewer.id) && !(staff && allowed("service_loans"))) return no(NOT_ALLOWED);
      const refused = extensionRequestError(deal, action.months, servicingDate(new Date()), staff);
      return refused ? no(refused) : ok({ ...action, by: viewer.name, byTeam: staff });
    }
    case "approveExtension": case "declineExtension": case "executeExtension": {
      const deal = dealOf(action.dealId);
      const extension = deal?.extensions?.find((item) => item.id === action.extensionId);
      if (!deal || !extension) return no(GONE);
      if (action.t === "executeExtension") {
        if (!staff || !allowed("service_loans")) return no(NOT_ALLOWED);
        const refused = executeError(deal, extension, action.on, servicingDate(new Date()));
        return refused ? no(refused) : ok({ ...action, reference: action.reference.trim(), by: viewer.name });
      }
      if (!staff || !allowed("approve_extension")) return no(NOT_ALLOWED);
      if (action.t === "declineExtension") return extension.status === "requested" || extension.status === "approved" ? ok({ ...action, by: viewer.name }) : no("That extension is already decided.");
      if (extension.status !== "requested") return no("That extension is already decided.");
      return extension.approvers.includes(viewer.name) ? no("A second, different approver is required.") : ok({ ...action, by: viewer.name });
    }

    case "proposeModification": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staff || !allowed("service_loans")) return no(NOT_ALLOWED);
      if (!action.reason.trim()) return no("Say why the loan is being modified.");
      const today = serviceDay(book);
      const problem = proposalProblem(deal, { rate: action.rate, capitalize: action.capitalize, waiveFees: action.waiveFees, months: action.months }, today, inBankruptcy(deal));
      return problem ? no(problem) : ok({ ...action, reason: action.reason.trim().slice(0, 500), by: viewer.name });
    }
    case "approveModification": case "declineModification": case "signModification": {
      const deal = dealOf(action.dealId);
      const modification = deal?.modifications?.find((item) => item.id === action.modificationId);
      if (!deal || !modification) return no(GONE);
      if (action.t === "signModification") {
        if (!staff || !allowed("service_loans")) return no(NOT_ALLOWED);
        if (!action.reference.trim()) return no("Enter the signed agreement's reference.");
        const problem = signProblem(deal, modification, action.on, serviceDay(book), inBankruptcy(deal));
        return problem ? no(problem) : ok({ ...action, by: viewer.name });
      }
      if (!staff || !allowed("approve_extension")) return no(NOT_ALLOWED);
      if (action.t === "declineModification") return !action.reason.trim() ? no("Say why it's declined.") : modification.status === "proposed" || modification.status === "approved" ? ok({ ...action, by: viewer.name }) : no("That modification is already decided.");
      if (modification.status !== "proposed") return no("That modification is already decided.");
      return modification.approvers.includes(viewer.name) ? no("A second, different approver is required.") : ok({ ...action, by: viewer.name });
    }
    case "logContact": case "recordPromise": case "cancelPromise": case "logNotice": case "noticeOutcome": case "recordBankruptcy": case "bankruptcyClaimFiled": case "endBankruptcy": case "recordAdvance": case "advancesRepaid": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staff || !allowed("service_loans")) return no(NOT_ALLOWED);
      const problem = collectionProblem(deal, action, serviceDay(book));
      return problem ? no(problem) : ok({ ...action, by: viewer.name });
    }
    case "referForeclosure": case "foreclosureStep": case "stopForeclosure": case "saleProceeds": case "listReo": case "sellReo": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staff || !allowed("declare_default")) return no(NOT_ALLOWED);
      const problem = foreclosureProblem(deal, action, serviceDay(book));
      return problem ? no(problem) : ok({ ...action, by: viewer.name });
    }

    case "sendMessage": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (staff) return ok({ ...action, from: viewer.name, side: action.side === "internal" ? "internal" : "team" });
      if (ownsDeal(deal)) return ok({ ...action, from: viewer.name, side: view === "broker" ? "broker" : "borrower" });
      return no(NOT_ALLOWED);
    }
  }
}

type CollectionAction = Extract<BookAction, { t: "logContact" | "recordPromise" | "cancelPromise" | "logNotice" | "noticeOutcome" | "recordBankruptcy" | "bankruptcyClaimFiled" | "endBankruptcy" | "recordAdvance" | "advancesRepaid" }>;
/** Why a collections record can't be kept as asked, or null (lib/collections.ts). */
function collectionProblem(deal: Deal, action: CollectionAction, today: string): string | null {
  const live = SERVICED.includes(deal.status);
  const dated = (on: string, what: string) => (on > today ? `${what} can't be in the future.` : on < deal.closingDate ? `${what} is before the loan closed.` : null);
  switch (action.t) {
    case "logContact":
      if (!live) return "This loan isn't being serviced.";
      if (!action.with.trim()) return "Say who you spoke to or tried.";
      return dated(action.on, "The date");
    case "recordPromise": {
      if (!live) return "This loan isn't being serviced.";
      const stayed = stayProblem(deal, "A promise to pay");
      if (stayed) return stayed;
      if (!(action.amount > 0)) return "Enter the amount promised.";
      if (action.dueBy < today) return "The day it's promised by can't be past.";
      return action.dueBy > addDays(today, COLLECTIONS.promiseDays) ? `A promise is for the next ${COLLECTIONS.promiseDays} days; for longer, work out a modification.` : null;
    }
    case "cancelPromise": {
      const promise = deal.promises?.find((item) => item.id === action.promiseId);
      if (!promise || promise.cancelled) return GONE;
      return action.reason.trim() ? null : "Say why it's withdrawn.";
    }
    case "logNotice": {
      if (!live) return "This loan isn't being serviced.";
      const stayed = stayProblem(deal, "Sending a notice");
      if (stayed) return stayed;
      if (!action.to.trim()) return "Enter who it went to and where.";
      if ((action.method === "certified_mail" || action.method === "overnight") && !action.tracking.trim()) return "Enter the tracking number.";
      if (!(action.amount >= 0)) return "Enter the amount the notice states.";
      const l = ledgerOf(deal, today);
      if (action.kind === "late" && !l.paymentsLate && l.feesOwed < 0.005) return "No payment is late.";
      if ((action.kind === "default" || action.kind === "acceleration") && !openDefault(deal)) return "Declare the default first.";
      if (action.kind === "acceleration" && !defaultNotice(deal)) return "Send the notice of default before accelerating.";
      if (action.kind === "maturity_demand" && !l.matured) return "The loan hasn't matured.";
      if (action.cureBy && action.cureBy <= action.sentOn) return "The cure date has to be after the notice is sent.";
      return dated(action.sentOn, "The day it was sent");
    }
    case "noticeOutcome": {
      const notice = deal.notices?.find((item) => item.id === action.noticeId);
      if (!notice) return GONE;
      if (notice.delivered || notice.returned) return "That notice's delivery is already recorded.";
      if (!action.detail.trim()) return action.outcome === "delivered" ? "Enter the proof: the signed receipt, the tracking confirmation or who took it." : "Say why it came back.";
      return action.on < notice.sentOn ? "That's before it was sent." : action.on > today ? "The date can't be in the future." : null;
    }
    case "recordBankruptcy":
      if (!live) return "This loan isn't being serviced.";
      if (openBankruptcy(deal)) return "A bankruptcy case is already open on this loan.";
      if (![7, 11, 13].includes(action.chapter)) return "Choose the chapter.";
      if (!action.debtor.trim() || !action.caseNumber.trim() || !action.court.trim()) return "Enter who filed, the case number and the court.";
      return action.filedOn > today ? "The filing date can't be in the future." : null;
    case "bankruptcyClaimFiled": case "endBankruptcy": {
      const bankruptcy = deal.bankruptcies?.find((item) => item.id === action.bankruptcyId);
      if (!bankruptcy || bankruptcy.ended) return "That case isn't open.";
      if (action.t === "bankruptcyClaimFiled" && bankruptcy.claimFiledOn) return "The proof of claim is already recorded.";
      return action.on < bankruptcy.filedOn ? "That's before the case was filed." : action.on > today ? "The date can't be in the future." : null;
    }
    case "recordAdvance":
      if (!live && !(deal.status === "reo" && !deal.reo?.sold)) return "Costs are recorded on a loan being serviced or a property LendHous owns.";
      if (!(action.amount > 0)) return "Enter the amount paid.";
      return action.on > today ? "The date can't be in the future." : deal.reo && action.on < deal.reo.since ? "That's before LendHous took the property: record it on the loan before then." : null;
    case "advancesRepaid":
      if (!live) return "This loan isn't being serviced.";
      if (!(action.amount > 0)) return "Enter the amount repaid.";
      if (action.amount > advancesOwed(deal) + 0.005) return `Only ${money(advancesOwed(deal))} of costs is owed.`;
      if (!action.reference.trim()) return "Enter the payment's reference.";
      return dated(action.on, "The date");
  }
}

type ForeclosureAction = Extract<BookAction, { t: "referForeclosure" | "foreclosureStep" | "stopForeclosure" | "saleProceeds" | "listReo" | "sellReo" }>;
/** Why a foreclosure or REO step can't be recorded, or null (lib/collections.ts). */
function foreclosureProblem(deal: Deal, action: ForeclosureAction, today: string): string | null {
  if (action.on > today) return "The date can't be in the future.";
  switch (action.t) {
    case "referForeclosure": {
      if (!openDefault(deal)) return "Declare the default first.";
      if (deal.foreclosure && !deal.foreclosure.stopped) return "The loan is already with the foreclosure attorney.";
      const stayed = stayProblem(deal, "A foreclosure");
      if (stayed) return stayed;
      if (!action.attorney.trim()) return "Enter the attorney or firm.";
      const sent = defaultNotice(deal);
      if (!sent) return "Send the notice of default first: the loan documents give the borrower time to cure.";
      return sent.cureEnds >= action.on ? `The notice of default's cure period runs to ${shortDay(sent.cureEnds)}.` : null;
    }
    case "foreclosureStep":
      return stepProblem(deal, action.step, action.on, today, action);
    case "stopForeclosure":
      if (!deal.foreclosure || deal.foreclosure.stopped) return "No foreclosure is open.";
      if (action.why === "deed_in_lieu") { const stayed = stayProblem(deal, "Taking the deed"); if (stayed) return stayed; }
      return action.on < deal.foreclosure.referredOn ? "That's before it was referred." : null;
    case "saleProceeds": {
      const sale = deal.foreclosure?.sale;
      if (sale?.winner !== "third_party" || deal.paidOff) return "Only a sale a third party won pays the loan this way.";
      if (!(action.amount > 0)) return "Enter the amount the clerk paid.";
      if (!action.reference.trim()) return "Enter the payment's reference.";
      const owed = payoffOn(deal, action.on).quote.total;
      if (action.amount > owed + 0.005) return `The clerk pays LendHous up to the ${money(owed)} owed; any surplus goes to the owner through the court.`;
      return action.on < sale.on ? "That's before the sale." : null;
    }
    case "listReo": case "sellReo":
      if (deal.status !== "reo" || !deal.reo || deal.reo.sold) return "This isn't a bank-owned property for sale.";
      if (!(action.price > 0)) return "Enter the price.";
      if (action.on < deal.reo.since) return "That's before LendHous took the property.";
      if (action.t === "sellReo" && !(action.closingCosts >= 0 && action.closingCosts < action.price)) return "Enter the sale's closing costs.";
      return action.t === "sellReo" && !action.reference.trim() ? "Enter the closing's reference." : null;
  }
}

/** A document's checklist entry, for the upload route. */
export const docOf = (book: Book, dealId: string, docId: string): Doc | undefined => book.deals.find((deal) => deal.id === dealId)?.docs.find((doc) => doc.id === docId);
