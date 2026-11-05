// Who sees what in the loan book, and who may do what to it. Everything an account receives or sends passes through here,
// because the browser can't be trusted to hide a borrower's name or to ask only for what its screen offers.
// No database code, so the rules can be tested on their own.
import type { RoleCode } from "@prisma/client";
import { emptyBook, serviceDay, type Book, type BookAction } from "./book";
import { verifyProblem, wireProblem, wireVerified } from "./closing";
import { latestScreening, ofacBlocker } from "./ofac";
import { assignProblem } from "./loan-team";
import { receivedProblem, sendToFor, sentProblem } from "./partner-funding";
import { sponsorProblem, withSponsor } from "./credit";
import { scopeError } from "./draws";
import { cureError, defaultError, DECLINE_REASONS, executeError, extensionRequestError, isClosedApplication, payoffError, PRE_FUNDING, WITHDRAW_REASONS } from "./loan-exits";
import { goodThroughProblem, issueProblem } from "./payoffs";
import { addProblem, changeProblem, libraryOf, templateProblem } from "./conditions";
import { drawHolds, lienFileProblem, unreleasedHolds, waiverCheckProblem } from "./lien-law";
import { reasonsProblem, requestProblem, revenueProblem } from "./adverse-action";
import { exceptionDecisionProblem, exceptionRequestProblem, issueProblem as sheetProblem, latestSheet, pricedApp, respondProblem } from "./term-sheets";
import { MAX_PHOTOS_PER_LINK, photoRequestState, photosClosed } from "./photo-requests";
import { evaluate } from "./engine";
import { showcaseable } from "./showcase";
import type { Broker, Deal, Doc, LoanPayment, LoanSale, PayoffRequest } from "./mockData";
import { currentPricing, pricingPayload } from "./pricing-versions";
import { ledger, servicingDate } from "./servicing";
import { viewFor, type MemberAccess, type Permission } from "./permissions";
import { approveProblem, canSendDeals, feePaidProblem } from "./brokers";

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

const FUNDED = ["funded", "servicing_current", "servicing_delinquent", "matured", "default"];
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
  return { ...deal, borrowerId: "", borrowerName: "", entityName: "", address: "", city: "", zip: deal.zip.slice(0, 3), docs: [], scope: [], scopeSummary: "", brokerId: undefined, brokerPoints: undefined, allocations: [], teaserSentTo: [], route: undefined, source: "", termSheetSignedBy: undefined, termSheetSignedAt: undefined, fundingApprovers: undefined, sponsor: undefined, creditReview: undefined, closure: undefined, defaults: undefined, extensions: undefined, paidOff: undefined, closing: undefined, wires: undefined, fundingWireId: undefined, screenings: undefined, titleLink: undefined, termSheets: undefined, pricingException: undefined, conditions: undefined, lienFile: undefined, completed: undefined, revenue: undefined, adverseAction: undefined, legalHold: undefined, propertyPhotos: undefined, partnerFunding: undefined, ...quietPayments(deal, false) };
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

/** What only the team sees on a loan it shares with a client. Wire instructions never leave the team: a client who sees them is a client who can be sent fake ones. */
function forClient(deal: Deal): Deal {
  return { ...deal, ...latestForClient(deal), ...clientConditions(deal), ...clientRecords(deal), partnerFunding: undefined, allocations: [], teaserSentTo: [], route: undefined, capitalStatus: "not_started", contractorIsGtAffiliate: undefined, source: "", fundingApprovers: undefined, creditReview: undefined, ...quietPayments(deal, true), ...quietExits(deal), wires: undefined, fundingWireId: undefined, screenings: undefined, titleLink: undefined };
}

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
    return { ...empty, borrowerId: viewer.id, deals: mine.map((deal) => ({ ...forClient(deal), brokerId: undefined, brokerPoints: undefined })), draws: book.draws.filter((draw) => ids.has(draw.dealId)).map((draw) => ({ ...draw, approvers: [], override: undefined })), photoRequests: book.photoRequests.filter((request) => ids.has(request.dealId)), payoffs: book.payoffs.filter((payoff) => ids.has(payoff.dealId)).map(quietPayoff), messages: shared(ids) };
  }

  if (view === "broker") {
    const firm = firmOf(viewer);
    const mine = book.deals.filter((deal) => deal.brokerId === firm);
    return { ...empty, brokerId: firm, brokers: [ownFirm(book, firm, viewer.name)], deals: mine.map(forClient), messages: shared(new Set(mine.map((deal) => deal.id))) };
  }

  if (view === "partner") {
    const me = book.partners.find((partner) => partner.id === firmOf(viewer));
    if (!me) return empty;
    if (!me.ndaSigned) return { ...empty, partnerId: me.id, partners: [me] };
    const mine = book.bids.filter((bid) => bid.partnerId === me.id);
    const won = new Set(mine.filter((bid) => bid.status === "accepted").map((bid) => bid.dealId));
    const deals = book.deals.filter((deal) => deal.teaserSentTo.includes(me.id));
    // Someone else's accepted bid only says the deal is gone: no firm, no price.
    const taken = book.bids.filter((bid) => bid.partnerId !== me.id && bid.status === "accepted" && deals.some((deal) => deal.id === bid.dealId)).map((bid) => ({ ...bid, partnerId: "", pct: 0, lenderRate: 0, lenderPoints: 0, conditions: "" }));
    return { ...empty, partnerId: me.id, partners: [me], bids: [...mine, ...taken], deals: deals.map((deal) => (won.has(deal.id) ? { ...forClient(deal), teaserSentTo: [me.id], contractorIsGtAffiliate: deal.contractorIsGtAffiliate, partnerFunding: deal.partnerFunding?.partnerId === me.id ? { ...deal.partnerFunding, sendTo: sendToFor(deal) } : undefined } : { ...blind(deal), teaserSentTo: [me.id] })) };
  }

  if (view === "buyer") {
    const me = book.buyers.find((buyer) => buyer.id === firmOf(viewer));
    if (!me) return empty;
    if (!me.ndaSigned) return { ...empty, buyerId: me.id, buyers: [me] };
    const offers = book.offers.filter((offer) => offer.buyerId === me.id);
    const offered = new Set(offers.map((offer) => offer.saleId));
    const hideBuyer = (sale: LoanSale): LoanSale => (sale.soldTo === me.id ? sale : { ...sale, soldTo: sale.soldTo ? "another buyer" : undefined, soldPct: undefined, soldAt: undefined });
    const sales = book.sales.filter((sale) => sale.status === "listed" || sale.soldTo === me.id || offered.has(sale.id));
    const owned = new Set(sales.filter((sale) => sale.soldTo === me.id).map((sale) => sale.dealId));
    const deals = book.deals.filter((deal) => sales.some((sale) => sale.dealId === deal.id));
    return { ...empty, buyerId: me.id, buyers: [me], offers, sales: sales.map(hideBuyer), deals: deals.map((deal) => (owned.has(deal.id) ? forClient(deal) : blind(deal))) };
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
      return BEFORE_CLOSING.includes(deal.status) ? ok() : no("This loan's numbers are locked once it clears to close.");
    }
    case "addDocRequest":
      if (!dealOf(action.dealId)) return no(GONE);
      return staffOnly("review_documents", "manage_conditions");
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
      const problem = receivedProblem(deal);
      return problem ? no(problem) : staffOnly("route_capital", "manage_capital");
    }
    case "brokerApplied":
      // The broker's own page does this on the server, after screening the firm and storing its files.
      return trusted ? ok() : no(NOT_ALLOWED);
    case "brokerScreened":
      if (!trusted) return no(NOT_ALLOWED);
      return book.brokers.some((item) => item.id === action.brokerId) ? ok() : no(GONE);
    case "approveBroker": {
      const problem = approveProblem(book.brokers.find((item) => item.id === action.brokerId), action.reason);
      return problem ? no(problem) : staffOnlyAllowed("manage_brokers") ? ok({ ...action, by: viewer.name }) : no(NOT_ALLOWED);
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
      return staffOnly("route_capital");
    case "acceptBid": {
      const bid = book.bids.find((item) => item.id === action.bidId);
      if (!bid || bid.status !== "submitted") return no("That bid is no longer open.");
      return staffOnly("route_capital");
    }
    case "commit":
      if (!dealOf(action.dealId)) return no(GONE);
      return staffOnly("route_capital", "manage_capital");
    case "saveSource": case "removeSource":
      return staffOnly("manage_capital");
    case "saveFirm":
      return staffOnly("route_capital", "manage_capital");

    case "bid": {
      const me = book.partners.find((partner) => partner.id === firm);
      const deal = dealOf(action.bid.dealId);
      if (view !== "partner" || !me?.ndaSigned || !deal?.teaserSentTo.includes(me.id)) return no(NOT_ALLOWED);
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
      if (book.sales.find((sale) => sale.id === action.saleId)?.status !== "listed") return no("That loan is no longer for sale.");
      if (book.offers.some((offer) => offer.saleId === action.saleId && offer.buyerId === me.id && offer.status === "submitted")) return no("You already have an offer on this loan.");
      return ok({ ...action, buyerId: me.id });
    }
    case "decideOffer": {
      const offer = book.offers.find((item) => item.id === action.offerId);
      if (!offer || offer.status !== "submitted") return no("That offer is no longer open.");
      if (book.sales.find((sale) => sale.id === offer.saleId)?.status !== "listed") return no("That loan is no longer for sale.");
      return staffOnly("route_capital", "manage_capital");
    }

    case "acceptTermSheet": case "requestTermSheetChanges": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!(view === "borrower" && deal.borrowerId === viewer.id)) return no(`Only the borrower can ${action.t === "acceptTermSheet" ? "accept a term sheet" : "ask for changes to a term sheet"}.`);
      const refused = respondProblem(deal, serviceDay(book));
      if (refused) return no(refused);
      if (action.t === "requestTermSheetChanges" && !action.note.trim()) return no("Say what you'd like changed.");
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
      // Budgets come from the request, but what has been released comes from the record.
      const scope = (deal.scope ?? []).map((line) => ({ ...line, budget: action.scope.find((item) => item.id === line.id)?.budget ?? line.budget }));
      const refused = scopeError(scope, evaluate(deal.app).holdback);
      return refused ? no(refused) : ok({ ...action, scope });
    }
    case "requestDraw": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!(view === "borrower" && deal.borrowerId === viewer.id)) return no(NOT_ALLOWED);
      if (!FUNDED.includes(deal.status)) return no("Draws start once the loan is funded.");
      return ok({ ...action, by: viewer.name });
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
    case "saveLienFile": case "addNoticeToOwner": case "saveInsurance": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staffOnlyAllowed("approve_draw", "assign_inspection", "manage_conditions")) return no(NOT_ALLOWED);
      if (!["term_sheet_accepted", "conditions", "clear_to_close", "closing", ...FUNDED].includes(deal.status)) return no("The lien file is kept from an accepted term sheet until the loan is paid off.");
      const today = serviceDay(book);
      if (action.t === "saveLienFile") { const refused = lienFileProblem(action, today); if (refused) return no(refused); }
      if (action.t === "addNoticeToOwner" && (!action.lienor.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(action.servedOn) || action.servedOn > today)) return no("Add who served it and the day it was served, today or earlier.");
      if (action.t === "saveInsurance" && !action.carrier.trim()) return no("Add the insurance company.");
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

    case "sendMessage": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (staff) return ok({ ...action, from: viewer.name, side: action.side === "internal" ? "internal" : "team" });
      if (ownsDeal(deal)) return ok({ ...action, from: viewer.name, side: view === "broker" ? "broker" : "borrower" });
      return no(NOT_ALLOWED);
    }
  }
}

/** A document's checklist entry, for the upload route. */
export const docOf = (book: Book, dealId: string, docId: string): Doc | undefined => book.deals.find((deal) => deal.id === dealId)?.docs.find((doc) => doc.id === docId);
