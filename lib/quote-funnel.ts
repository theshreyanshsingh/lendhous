// How visitors move through the quote: started it, saw their terms, saved them (a Lead), became a loan, funded. The first
// two are anonymous daily counts (QuoteCount); nothing about the person or the deal is kept until they save.
import type { Book } from "./book";
import type { Period } from "./reports";

export const QUOTE_STEPS = ["started", "shown"] as const;
export type QuoteStep = (typeof QUOTE_STEPS)[number];
const FUNDED = ["funded", "servicing_current", "servicing_delinquent", "matured", "default", "paid_off", "reo"];

/** A site's short name in a widget's address (?site=wholesale): lowercase letters, digits and dashes. */
export const siteSlug = (raw: unknown) => (typeof raw === "string" && /^[a-z0-9-]{1,24}$/.test(raw) ? raw : "");
/** Where a quote came from: "site" (the /start page), or the widget, "embed" or "embed:<site>". */
export const embedChannel = (site?: string) => (siteSlug(site) ? `embed:${siteSlug(site)}` : "embed");
export function channelOf(raw: unknown) {
  if (raw === "site" || raw === "embed") return raw;
  return typeof raw === "string" && raw.startsWith("embed:") && siteSlug(raw.slice(6)) ? raw : "site";
}
/** A referral code as the widget's address carries it, or "" (lib/brokers.ts makes them). */
export const refOf = (raw: unknown) => (typeof raw === "string" && /^[a-z2-9]{4,16}$/.test(raw) ? raw : "");

export const channelLabel = (channel: string) => (channel === "site" ? "Website quote page" : channel === "embed" ? "Quote widget" : `Quote widget on ${channel.slice(6)}`);

export type FunnelCount = { day: string; channel: string; ref: string; started: number; shown: number };
export type FunnelLead = { day: string; channel: string; brokerId: string | null; loanId: string | null };
export type FunnelRow = { key: string; label: string; started: number; shown: number; saved: number; loans: number; funded: number };

/** The funnel for a period, one row per channel and referring broker, busiest first, with a total. */
export function quoteFunnel(counts: FunnelCount[], leads: FunnelLead[], book: Pick<Book, "deals" | "brokers">, period: Period): { rows: FunnelRow[]; total: FunnelRow } {
  const inPeriod = (day: string) => day >= period.from && day <= period.to;
  const codeOf = new Map(book.brokers.filter((broker) => broker.referralCode).map((broker) => [broker.id, broker.referralCode!]));
  const nameOf = new Map(book.brokers.filter((broker) => broker.referralCode).map((broker) => [broker.referralCode!, broker.name]));
  const rows = new Map<string, FunnelRow>();
  const row = (channel: string, ref: string) => {
    const key = ref ? `${channel}|${ref}` : channel;
    if (!rows.has(key)) rows.set(key, { key, label: `${channelLabel(channel)}${ref ? `, referred by ${nameOf.get(ref) ?? "a broker"}` : ""}`, started: 0, shown: 0, saved: 0, loans: 0, funded: 0 });
    return rows.get(key)!;
  };
  for (const count of counts.filter((item) => inPeriod(item.day))) {
    const target = row(count.channel, count.ref);
    target.started += count.started;
    target.shown += count.shown;
  }
  for (const lead of leads.filter((item) => inPeriod(item.day))) {
    const target = row(lead.channel, (lead.brokerId && codeOf.get(lead.brokerId)) || "");
    target.saved++;
    const loan = lead.loanId ? book.deals.find((deal) => deal.id === lead.loanId) : undefined;
    if (loan) target.loans++;
    if (loan && FUNDED.includes(loan.status)) target.funded++;
  }
  const list = [...rows.values()].sort((a, b) => b.started + b.saved - (a.started + a.saved) || a.label.localeCompare(b.label));
  const total = list.reduce((sum, item) => ({ ...sum, started: sum.started + item.started, shown: sum.shown + item.shown, saved: sum.saved + item.saved, loans: sum.loans + item.loans, funded: sum.funded + item.funded }), { key: "total", label: "All quotes", started: 0, shown: 0, saved: 0, loans: 0, funded: 0 });
  return { rows: list, total };
}

/** A share as a whole percent, or a dash when there's nothing to divide by. */
export const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

/** The widget's address on LendHous's site, with the broker's code or the site it sits on. */
export function embedPath(options: { ref?: string; site?: string } = {}) {
  const query = [refOf(options.ref) && `ref=${refOf(options.ref)}`, siteSlug(options.site) && `site=${siteSlug(options.site)}`].filter(Boolean).join("&");
  return `/embed/quote${query ? `?${query}` : ""}`;
}

/**
 * What a site pastes to show the quote: the frame, and a few lines that let it grow with the form instead of scrolling.
 * The height messages are only taken from LendHous's own origin.
 */
export function embedSnippet(origin: string, options: { ref?: string; site?: string } = {}) {
  const src = `${origin}${embedPath(options)}`;
  return [
    `<iframe src="${src}" title="LendHous loan quote" style="width:100%;height:1500px;border:0" loading="lazy"></iframe>`,
    `<script>addEventListener("message",function(e){if(e.origin!=="${origin}"||!e.data||e.data.type!=="lendhous-quote-height")return;document.querySelectorAll('iframe[src^="${origin}/embed/quote"]').forEach(function(f){if(f.contentWindow===e.source)f.style.height=e.data.height+"px"})})</script>`,
  ].join("\n");
}
