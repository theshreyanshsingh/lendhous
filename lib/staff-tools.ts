// Staff speed-ups (docs/feature-ideas-2026-11-22.md, rank 13): the team's saved replies for loan messages, with blanks
// filled from the loan, and each person's saved pipeline views. Files on messages live with the messages themselves
// (LoanMessage.files). Pure.
import type { Product } from "./engine";
import type { Deal, LoanStatus } from "./mockData";

export interface SavedReply { id: string; title: string; text: string; by: string; at: string }

export const VIEW_KINDS = { pipeline: "In the pipeline", funded: "Funded", ended: "Declined and withdrawn", all: "Every loan" } as const;
export type ViewKind = keyof typeof VIEW_KINDS;
export interface PipelineFilters { q: string; product: "all" | Product; team: "all" | "mine" | "unassigned"; view: ViewKind; stage: "all" | LoanStatus; layout: "list" | "board" }
/** A pipeline view someone saved. Each person sees and changes only their own. */
export interface PipelineView { id: string; name: string; ownerId: string; filters: PipelineFilters; at: string }

export const NO_FILTERS: PipelineFilters = { q: "", product: "all", team: "all", view: "pipeline", stage: "all", layout: "list" };
export const MAX_REPLIES = 50;
export const MAX_VIEWS = 12;

/** The blanks a saved reply can hold, and what each becomes on a loan. */
export const BLANKS = ["{first name}", "{loan number}", "{address}", "{closing date}", "{my name}"] as const;

const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** A saved reply written out for one loan, by one person. */
export function fillReply(text: string, deal: Pick<Deal, "borrowerName" | "loanNumber" | "address" | "city" | "closingDate">, me: string) {
  const first = deal.borrowerName.replace(/\s*\(FAKE\)\s*/g, " ").trim().split(/\s+/)[0] ?? "";
  const values: Record<(typeof BLANKS)[number], string> = { "{first name}": first, "{loan number}": deal.loanNumber, "{address}": `${deal.address}, ${deal.city}`, "{closing date}": deal.closingDate ? longDay(deal.closingDate) : "the closing date", "{my name}": me.replace(/\s*\(FAKE\)\s*/g, " ").trim() };
  return BLANKS.reduce((out, blank) => out.split(blank).join(values[blank]), text);
}

/** Why a reply can't be saved as written, or null. */
export function replyProblem(replies: SavedReply[], input: { replyId: string; title: string; text: string }) {
  if (!input.title.trim()) return "Give the reply a short name.";
  if (input.title.trim().length > 80) return "Keep the name under 80 characters.";
  if (!input.text.trim()) return "Write the reply.";
  if (input.text.length > 4000) return "Keep the reply under 4,000 characters.";
  if (replies.some((item) => item.id !== input.replyId && item.title.trim().toLowerCase() === input.title.trim().toLowerCase())) return "There's already a reply with that name.";
  if (!replies.some((item) => item.id === input.replyId) && replies.length >= MAX_REPLIES) return `The team can keep up to ${MAX_REPLIES} saved replies. Delete one first.`;
  return null;
}

/** Why a view can't be saved like this, or null. */
export function viewProblem(views: PipelineView[], input: { viewId: string; name: string; ownerId: string }) {
  const mine = views.filter((item) => item.ownerId === input.ownerId);
  if (!input.name.trim()) return "Name the view.";
  if (input.name.trim().length > 60) return "Keep the name under 60 characters.";
  if (mine.some((item) => item.id !== input.viewId && item.name.trim().toLowerCase() === input.name.trim().toLowerCase())) return "You already have a view with that name.";
  if (!mine.some((item) => item.id === input.viewId) && mine.length >= MAX_VIEWS) return `You can keep up to ${MAX_VIEWS} views. Delete one first.`;
  return null;
}

/** The demo team's replies. A real team starts with none and saves its own. */
export const DEMO_REPLIES: SavedReply[] = [
  { id: "reply-demo-docs", title: "Documents received", text: "Hi {first name}, thanks: we have your documents for {address} and we're going through them now. You'll hear from us within one business day.\n\n{my name}", by: "Pat Processor (FAKE)", at: "2026-10-01T14:00:00Z" },
  { id: "reply-demo-appraisal", title: "Appraisal ordered", text: "Hi {first name}, we've ordered the appraisal for {address}. The appraiser will call you to set a time to see the property; you can follow it on your loan page.\n\n{my name}", by: "Pat Processor (FAKE)", at: "2026-10-01T14:05:00Z" },
  { id: "reply-demo-closing", title: "Closing check-in", text: "Hi {first name}, we're on track to close {loan number} on {closing date}. Is there anything you need from us before then?\n\n{my name}", by: "Olivia Owner (FAKE)", at: "2026-10-02T15:00:00Z" },
];

export const sameFilters = (a: PipelineFilters, b: PipelineFilters) => (Object.keys(NO_FILTERS) as (keyof PipelineFilters)[]).every((key) => a[key] === b[key]);
