// Who sees what in the loan book, and who may do what to it. Everything an account receives or sends passes through here,
// because the browser can't be trusted to hide a borrower's name or to ask only for what its screen offers.
// No database code, so the rules can be tested on their own.
import type { RoleCode } from "@prisma/client";
import { emptyBook, type Book, type BookAction } from "./book";
import { verifyProblem, wireProblem, wireVerified } from "./closing";
import { latestScreening, ofacBlocker } from "./ofac";
import { sponsorProblem, withSponsor } from "./credit";
import { scopeError } from "./draws";
import { cureError, defaultError, DECLINE_REASONS, executeError, extensionRequestError, isClosedApplication, payoffError, PRE_FUNDING, WITHDRAW_REASONS } from "./loan-exits";
import { MAX_PHOTOS_PER_LINK, photoRequestState, photosClosed } from "./photo-requests";
import { evaluate } from "./engine";
import type { Deal, Doc, LoanPayment, LoanSale } from "./mockData";
import { currentPricing, pricingPayload } from "./pricing-versions";
import { ledger, servicingDate } from "./servicing";
import { viewFor, type MemberAccess, type Permission } from "./permissions";

export type Viewer = MemberAccess & { id: string; name: string; roleCodes: RoleCode[]; organizationId?: string | null };

/** The firm a partner, buyer or broker acts for: their organization, or themselves when they have none. */
export const firmOf = (viewer: Viewer) => viewer.organizationId ?? viewer.id;

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

/** Removes what identifies the borrower, for a partner or buyer who hasn't closed on the loan. */
function blind(deal: Deal): Deal {
  return { ...deal, borrowerId: "", borrowerName: "", entityName: "", address: "", city: "", zip: deal.zip.slice(0, 3), docs: [], scope: [], scopeSummary: "", brokerId: undefined, brokerPoints: undefined, allocations: [], teaserSentTo: [], route: undefined, source: "", termSheetSignedBy: undefined, termSheetSignedAt: undefined, fundingApprovers: undefined, sponsor: undefined, creditReview: undefined, closure: undefined, defaults: undefined, extensions: undefined, paidOff: undefined, closing: undefined, wires: undefined, fundingWireId: undefined, screenings: undefined, titleLink: undefined, ...quietPayments(deal, false) };
}

/** What only the team sees on a loan it shares with a client. Wire instructions never leave the team: a client who sees them is a client who can be sent fake ones. */
function forClient(deal: Deal): Deal {
  return { ...deal, allocations: [], teaserSentTo: [], route: undefined, capitalStatus: "not_started", contractorIsGtAffiliate: undefined, source: "", fundingApprovers: undefined, creditReview: undefined, ...quietPayments(deal, true), ...quietExits(deal), wires: undefined, fundingWireId: undefined, screenings: undefined, titleLink: undefined };
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
    return { ...empty, borrowerId: viewer.id, deals: mine.map((deal) => ({ ...forClient(deal), brokerId: undefined, brokerPoints: undefined })), draws: book.draws.filter((draw) => ids.has(draw.dealId)).map((draw) => ({ ...draw, approvers: [] })), photoRequests: book.photoRequests.filter((request) => ids.has(request.dealId)), payoffs: book.payoffs.filter((payoff) => ids.has(payoff.dealId)), messages: shared(ids) };
  }

  if (view === "broker") {
    const firm = firmOf(viewer);
    const mine = book.deals.filter((deal) => deal.brokerId === firm);
    return { ...empty, brokerId: firm, brokers: [{ id: firm, name: viewer.name }], deals: mine.map(forClient), messages: shared(new Set(mine.map((deal) => deal.id))) };
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
    return { ...empty, partnerId: me.id, partners: [me], bids: [...mine, ...taken], deals: deals.map((deal) => (won.has(deal.id) ? { ...forClient(deal), teaserSentTo: [me.id], contractorIsGtAffiliate: deal.contractorIsGtAffiliate } : { ...blind(deal), teaserSentTo: [me.id] })) };
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
      if (view === "borrower") return ok({ ...action, client: { name: viewer.name, borrowerId: viewer.id }, source: "web_quote" });
      if (view === "broker") return action.client?.name?.trim() ? ok({ ...action, client: { name: action.client.name.trim(), brokerId: firm, brokerPoints: Math.min(5, Math.max(0, action.client.brokerPoints ?? 0)) }, source: "broker" }) : no("Enter your client's name.");
      if (staff && allowed("view_pipeline")) return action.client?.name?.trim() ? ok({ ...action, client: { name: action.client.name.trim(), borrowerId: action.client.borrowerId }, source: action.source ?? "staff" }) : no("Enter the borrower's name.");
      return no(NOT_ALLOWED);
    }

    case "advanceLoan": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staff) return no(NOT_ALLOWED);
      if (deal.status === "underwriting") return allowed("issue_term_sheet", Math.round(evaluate(deal.app).noteAmount * 100)) ? ok() : no("This loan is above your term sheet limit.");
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

    case "acceptTermSheet": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      return view === "borrower" && deal.borrowerId === viewer.id ? ok() : no("Only the borrower can accept a term sheet.");
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
      const blocked = action.t === "releaseDraw" ? ofacBlocker(dealOf(draw.dealId)!, servicingDate(new Date())) : null;
      return blocked ? no(`${blocked}.`) : staffOnly("approve_draw");
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
      return ok({ ...action, by: viewer.name });
    }
    case "sendPayoff":
      if (!book.payoffs.some((payoff) => payoff.id === action.payoffId)) return no(GONE);
      return staffOnly("service_loans");
    case "recordPayoff": {
      const deal = dealOf(action.dealId);
      if (!deal) return no(GONE);
      if (!staff || !allowed("service_loans")) return no(NOT_ALLOWED);
      const refused = payoffError(deal, action.amount, action.receivedOn, servicingDate(new Date()));
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
