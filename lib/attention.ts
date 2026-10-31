// What's waiting on the team right now, across every queue. It drives the pipeline's list and the menu's counts.
import type { Book } from "./book";

export type AttentionItem = { key: string; label: string; count: number; href: string };

const firstDeal = (ids: string[]) => (ids.length === 1 ? `/admin/deals/${ids[0]}` : "/admin");

export function attentionCounts(s: Book, newLeads: number) {
  const draws = s.draws.filter((draw) => draw.status !== "funded" && draw.status !== "rejected").length;
  const offers = s.offers.filter((offer) => offer.status === "submitted").length;
  const payoffs = s.payoffs.filter((payoff) => payoff.status === "requested").length;
  const late = s.deals.filter((deal) => deal.paymentsLate).length;
  return { leads: newLeads, draws, offers, payoffs, late, servicing: payoffs + late };
}

export function attentionItems(s: Book, newLeads: number): AttentionItem[] {
  const counts = attentionCounts(s, newLeads);
  const toReview = s.deals.filter((deal) => deal.docs.some((doc) => doc.status === "uploaded" || doc.status === "in_review"));
  const docs = toReview.reduce((sum, deal) => sum + deal.docs.filter((doc) => doc.status === "uploaded" || doc.status === "in_review").length, 0);
  const newApps = s.deals.filter((deal) => deal.status === "submitted");
  const bids = s.bids.filter((bid) => bid.status === "submitted");
  const funding = s.deals.filter((deal) => deal.status === "closing" && (deal.fundingApprovers?.length ?? 0) < 2);
  const items: AttentionItem[] = [
    { key: "leads", label: "Website briefs to answer", count: counts.leads, href: "/admin/leads" },
    { key: "applications", label: "New applications", count: newApps.length, href: firstDeal(newApps.map((deal) => deal.id)) },
    { key: "documents", label: "Documents to review", count: docs, href: firstDeal(toReview.map((deal) => deal.id)) },
    { key: "funding", label: "Loans waiting on funding approval", count: funding.length, href: firstDeal(funding.map((deal) => deal.id)) },
    { key: "bids", label: "Partner bids to decide", count: bids.length, href: firstDeal([...new Set(bids.map((bid) => bid.dealId))]) },
    { key: "draws", label: "Draws in progress", count: counts.draws, href: "/admin/draws" },
    { key: "payoffs", label: "Payoff requests", count: counts.payoffs, href: "/admin/servicing" },
    { key: "late", label: "Loans past due", count: counts.late, href: "/admin/servicing" },
    { key: "offers", label: "Offers on loans for sale", count: counts.offers, href: "/admin/loan-sales" },
  ];
  return items.filter((item) => item.count > 0);
}
