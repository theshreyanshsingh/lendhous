// Each person's queue: the things waiting on the team, one by one, with the loan, how long each has waited against its
// target, and any deadline the law sets. The person's own loans come first, then everything else they could pick up.
import type { Book } from "./book";
import { activeWire, wireVerified } from "./closing";
import { lienReleaseOpen, openExtension, PRE_FUNDING } from "./loan-exits";
import { isMine, needsOfficer } from "./loan-team";
import type { Deal } from "./mockData";
import { firmHeld, latestScreening } from "./ofac";
import { insuranceLapsed, openRenewals } from "./insurance";
import { dueOf, staleLetter } from "./payoffs";
import { noticeOwed } from "./adverse-action";
import { needsExitAnswer } from "./exit-plans";
import { clockOf, SLA_TARGETS, type Clock, type Targets } from "./sla";
import { servicingDate } from "./servicing";

export type QueueItem = {
  key: string; label: string; href: string;
  deal?: Pick<Deal, "id" | "loanNumber" | "borrowerName" | "address">;
  /** When it started waiting. */
  since?: string;
  /** A deadline the law sets, as a day. */
  due?: string;
  clock?: Clock;
  /** Whose loan it is, when it's someone's. */
  owner?: string;
  mine: boolean;
  /** Lower is more urgent among items with no deadline or clock. */
  priority: number;
};

const tab = (deal: Deal, name?: string) => `/admin/deals/${deal.id}${name ? `?tab=${encodeURIComponent(name)}` : ""}`;
const firstStage = (deal: Deal, statuses: string[]) => (deal.stages ?? []).filter((stage) => statuses.includes(stage.status)).map((stage) => stage.at).sort()[0];
const oldest = (days: (string | undefined)[]) => days.filter((day): day is string => Boolean(day)).sort()[0];

/** Every item waiting on the team today, for the viewer, split into their own loans and the rest, most urgent first. */
export function workQueue(book: Book, viewer: { id: string; email?: string }, now: Date, targets: Targets = SLA_TARGETS, newLeads = 0) {
  const items: QueueItem[] = [];
  const add = (item: Omit<QueueItem, "mine" | "owner" | "deal"> & { deal?: Deal }) => {
    const { deal } = item;
    items.push({ ...item, deal: deal && { id: deal.id, loanNumber: deal.loanNumber, borrowerName: deal.borrowerName, address: deal.address }, mine: Boolean(deal && isMine(deal, viewer)), owner: deal?.team?.officer?.name ?? deal?.team?.processor?.name });
  };
  const today = servicingDate(now);
  for (const deal of book.deals) {
    const notice = noticeOwed(deal);
    if (notice) add({ key: `notice:${deal.id}`, label: "Send the decline notice (Reg B)", href: tab(deal), deal, due: notice.dueOn, priority: 0 });
    const screening = latestScreening(deal)?.status;
    if (screening === "review" || screening === "match") add({ key: `ofac:${deal.id}`, label: "Review a possible sanctions match", href: tab(deal, "Score & Flags"), deal, priority: 2 });
    if (activeWire(deal) && !wireVerified(deal) && PRE_FUNDING.includes(deal.status)) add({ key: `wire:${deal.id}`, label: "Verify the wire instructions by phone", href: tab(deal, "Closing"), deal, priority: 3 });
    if (deal.status === "closing" && (deal.fundingApprovers?.length ?? 0) < 2) add({ key: `funding:${deal.id}`, label: "Approve the funding", href: tab(deal), deal, priority: 4 });
    if (deal.paymentsLate) add({ key: `late:${deal.id}`, label: "Payment past due", href: tab(deal, "Servicing"), deal, priority: 5 });
    if (insuranceLapsed(deal, today)) add({ key: `insurance:${deal.id}`, label: "Insurance lapsed: get the renewal", href: tab(deal, "Servicing"), deal, priority: 5 });
    const renewals = openRenewals(deal);
    if (renewals.length) add({ key: `renewal:${deal.id}`, label: `Check ${renewals.length === 1 ? "an insurance renewal" : `${renewals.length} insurance renewals`}`, href: tab(deal, "Servicing"), deal, since: oldest(renewals.map((item) => item.at)), priority: 12 });
    if (deal.status === "matured") add({ key: `matured:${deal.id}`, label: "Past maturity", href: tab(deal, "Servicing"), deal, priority: 6 });
    else if (needsExitAnswer(deal)) add({ key: `exit:${deal.id}`, label: "Call about the exit plan: no answer yet", href: tab(deal, "Servicing"), deal, priority: 6 });
    if (openExtension(deal)) add({ key: `extension:${deal.id}`, label: "Decide the extension request", href: tab(deal, "Servicing"), deal, priority: 7 });
    if (lienReleaseOpen(deal)) add({ key: `release:${deal.id}`, label: "Record the mortgage release", href: tab(deal, "Servicing"), deal, priority: 8 });
    if (deal.pricingException?.status === "pending") add({ key: `exception:${deal.id}`, label: "Decide the pricing exception", href: tab(deal, "Term sheet"), deal, since: deal.pricingException.requestedAt, priority: 9 });
    if (book.bids.some((bid) => bid.dealId === deal.id && bid.status === "submitted")) add({ key: `bids:${deal.id}`, label: "Decide the partner bids", href: tab(deal, "Capital Routing"), deal, priority: 10 });
    const submitted = (deal.conditions ?? []).filter((item) => item.status === "submitted");
    if (submitted.length) add({ key: `conditions:${deal.id}`, label: `Review ${submitted.length} condition${submitted.length === 1 ? "" : "s"} sent in`, href: tab(deal, "Conditions"), deal, priority: 12 });
    const docs = deal.docs.filter((doc) => doc.status === "uploaded" || doc.status === "in_review");
    if (docs.length) {
      const since = oldest(docs.map((doc) => doc.uploadedAt));
      add({ key: `docs:${deal.id}`, label: `Review ${docs.length} document${docs.length === 1 ? "" : "s"}`, href: tab(deal, "Documents"), deal, since, clock: since ? clockOf(since, now, targets.docReview) : undefined, priority: 13 });
    }
    if (deal.status === "submitted") {
      const since = firstStage(deal, ["submitted"]);
      add({ key: `new:${deal.id}`, label: "Look at the new application", href: tab(deal), deal, since, clock: since ? clockOf(since, now, targets.firstLook) : undefined, priority: 14 });
    }
    if (deal.status === "underwriting" && !(deal.termSheets ?? []).some((sheet) => sheet.status === "sent")) {
      const since = deal.completed?.at ?? firstStage(deal, ["underwriting"]);
      add({ key: `sheet:${deal.id}`, label: "Build and send the term sheet", href: tab(deal, "Term sheet"), deal, since, clock: since ? clockOf(since, now, targets.termSheet) : undefined, priority: 15 });
    }
    if (needsOfficer(deal)) add({ key: `officer:${deal.id}`, label: "Needs a loan officer", href: tab(deal), deal, priority: 16 });
  }
  for (const payoff of book.payoffs) {
    const deal = book.deals.find((item) => item.id === payoff.dealId);
    if (!deal) continue;
    if (payoff.status === "requested") add({ key: `payoff:${payoff.id}`, label: "Send the payoff letter", href: "/admin/servicing", deal, due: dueOf(payoff), priority: 1 });
    else if (payoff.status === "sent" && staleLetter(deal, payoff, today)) add({ key: `payoff:${payoff.id}`, label: "Correct the payoff letter: its figures moved", href: "/admin/servicing", deal, priority: 1 });
  }
  for (const draw of book.draws) {
    const deal = book.deals.find((item) => item.id === draw.dealId);
    if (!deal || draw.status === "funded" || draw.status === "rejected") continue;
    const deciding = draw.status !== "approved";
    add({ key: `draw:${draw.id}`, label: deciding ? "Decide the draw request" : "Release the approved draw", href: "/admin/draws", deal, since: draw.requestedAt, clock: deciding ? clockOf(draw.requestedAt, now, targets.drawDecision) : undefined, priority: 11 });
  }
  // Partner lenders, loan buyers and brokerages with a possible sanctions match: nothing moves with them until it's reviewed.
  for (const [kind, firms, href] of [["partner", book.partners, "/admin/partners"], ["buyer", book.buyers, "/admin/partners"], ["broker", book.brokers, "/admin/brokers"]] as const) {
    for (const firm of firms) if (firmHeld(firm)) items.push({ key: `ofac-${kind}:${firm.id}`, label: `Review a possible sanctions match: ${firm.name}`, href, mine: false, priority: 2 });
  }
  if (newLeads) items.push({ key: "leads", label: `Answer ${newLeads} quote request${newLeads === 1 ? "" : "s"}`, href: "/admin/leads", mine: false, priority: 17 });
  const offers = book.offers.filter((offer) => offer.status === "submitted").length;
  if (offers) items.push({ key: "offers", label: `Decide ${offers} offer${offers === 1 ? "" : "s"} on loans for sale`, href: "/admin/loan-sales", mine: false, priority: 18 });
  const ranked = items.sort(byUrgency);
  return { mine: ranked.filter((item) => item.mine), team: ranked.filter((item) => !item.mine) };
}

const CLOCK_RANK = { red: 0, amber: 1, ok: 2 } as const;
/** Legal deadlines first, soonest first; then clocks past their target, then nearly there; then by kind; then oldest. */
export function byUrgency(a: QueueItem, b: QueueItem) {
  if (a.due || b.due) return !a.due ? 1 : !b.due ? -1 : a.due.localeCompare(b.due) || a.priority - b.priority;
  const clock = (item: QueueItem) => (item.clock ? CLOCK_RANK[item.clock.state] : 2);
  return clock(a) - clock(b) || a.priority - b.priority || (a.since ?? "9").localeCompare(b.since ?? "9");
}

/** Items past their target, as lines for the owners' morning email: what, which loan, and whose. */
export function pastTarget(book: Book, now: Date, targets: Targets = SLA_TARGETS) {
  const { mine, team } = workQueue(book, { id: "" }, now, targets);
  return [...mine, ...team].filter((item) => item.clock?.state === "red").map((item) => `${item.label} · ${item.deal?.loanNumber ?? ""} · ${item.owner ?? "no one assigned"} · ${item.clock!.text}`);
}
