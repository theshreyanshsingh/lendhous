// What kind of update a notification is, how its person wants that kind to reach them, and the Notifications page's
// grouping by loan. Every alert carries an event code ("draw.requested", "loan.term_sheet_issued"); its prefix decides
// the topic. A person picks, per topic, email right away, once a day in a summary, or only in the app. Legal and
// security notices always go by email at once (Spec v3 12.1 "(L)"). Pure, so the rules are tested without a database.
import type { View } from "./permissions";

export type NoticeTopic = "messages" | "documents" | "progress" | "draws" | "payments" | "insurance" | "investors" | "compliance" | "other";
export type TopicChoice = "now" | "daily" | "app";
export type NoticeChoices = Partial<Record<NoticeTopic, TopicChoice>>;

type TopicInfo = { label: string; hint: string; prefixes: string[]; views: View[]; /** What partners and buyers see, where it differs. */ holders?: { label: string; hint: string } };

/** In the order the page lists them. The first matching prefix wins, so "loan.paid_off" is listed before "loan.". */
export const TOPICS: Record<NoticeTopic, TopicInfo> = {
  messages: { label: "Messages", hint: "A reply on a loan's message thread", prefixes: ["message."], views: ["admin", "borrower", "broker"] },
  documents: { label: "Documents and conditions", hint: "Something asked for, sent back or received", prefixes: ["doc.", "condition.", "photos.", "closing.title_update"], views: ["admin", "borrower", "broker"] },
  progress: { label: "Loan progress", hint: "Applications, term sheets, closing and funding", prefixes: ["application.", "loan.submitted", "loan.assigned", "loan.term_sheet", "loan.reopened", "loan.declined", "loan.withdrawn", "closing.", "wire.", "pricing.", "broker.", "quote.", "lead."], views: ["admin", "borrower", "broker"] },
  draws: { label: "Draws and budgets", hint: "Draw requests, decisions and lien waivers", prefixes: ["draw.", "lien.", "budget."], views: ["admin", "borrower", "broker"] },
  payments: { label: "Payments and payoffs", hint: "Payments, statements, payoffs, extensions and rewards", prefixes: ["payment.", "payoff.", "statement.", "loan.paid_off", "loan.default", "loan.lien_released", "loan.property_released", "extension.", "modification.", "exit.", "taxes.", "referral."], views: ["admin", "borrower", "broker", "partner", "buyer"] },
  insurance: { label: "Insurance and storms", hint: "Policies running out, flood zones and hurricanes", prefixes: ["insurance.", "flood.", "storm."], views: ["admin", "borrower"] },
  investors: { label: "Deals, bids and offers", hint: "Teasers, bids, offers, funds and investor updates", prefixes: ["bid.", "offer.", "teaser.", "investor.", "partner_funds."], views: ["admin", "partner", "buyer"] },
  compliance: { label: "Screening and collections", hint: "OFAC reviews, decline notices, bankruptcy and foreclosure", prefixes: ["ofac.", "adverse_action.", "bankruptcy.", "foreclosure."], views: ["admin", "partner", "buyer"], holders: { label: "Bankruptcy and foreclosure", hint: "A borrower in bankruptcy, and each step of a foreclosure" } },
  other: { label: "Everything else", hint: "Anything not listed above", prefixes: [], views: ["admin", "borrower", "broker", "partner", "buyer"] },
};

export const CHOICES: Record<TopicChoice, string> = { now: "Email right away", daily: "Once a day, in one email", app: "Only here, no email" };

/** The owners' morning email is its own summary: it never waits for another. */
const ALWAYS_NOW = ["digest."];

export function topicOf(eventCode: string): NoticeTopic {
  for (const [topic, info] of Object.entries(TOPICS) as [NoticeTopic, TopicInfo][]) if (info.prefixes.some((prefix) => eventCode.startsWith(prefix))) return topic;
  return "other";
}

/** A topic's name and hint as a workspace sees them. */
export const topicWords = (topic: NoticeTopic, view: View | null) => ((view === "partner" || view === "buyer") && TOPICS[topic].holders) || TOPICS[topic];

/** The topics a workspace hears about, for its settings. A person with no workspace sees every one. */
export const topicsFor = (view: View | null) => (Object.keys(TOPICS) as NoticeTopic[]).filter((topic) => !view || TOPICS[topic].views.includes(view));

/** What a stored preference says, cleaned: anything unknown is "right away", which is how it worked before. */
export function readChoices(value: unknown): NoticeChoices {
  if (!value || typeof value !== "object") return {};
  const out: NoticeChoices = {};
  for (const [topic, choice] of Object.entries(value as Record<string, unknown>)) if (topic in TOPICS && typeof choice === "string" && choice in CHOICES) out[topic as NoticeTopic] = choice as TopicChoice;
  return out;
}

/** How one notice reaches its person. */
export function routeNotice(input: { eventCode: string; legal: boolean; email: boolean; inApp: boolean; choices: unknown; hasAccount: boolean }) {
  // Someone without an account (a quote request, a title officer) has no preferences: email, and a copy kept.
  if (input.legal || !input.hasAccount) return { email: true, summary: false, keep: true, push: input.hasAccount, readNow: false };
  const choice = ALWAYS_NOW.some((prefix) => input.eventCode.startsWith(prefix)) ? "now" : readChoices(input.choices)[topicOf(input.eventCode)] ?? "now";
  const email = input.email && choice === "now";
  const summary = input.email && choice === "daily";
  // A notice waiting for the summary is kept even by someone who keeps nothing here, so the summary can send it; it's
  // already read for them, so it never counts as unread.
  return { email, summary, keep: input.inApp || summary, push: choice === "now", readNow: summary && !input.inApp };
}

/** A loan number in a notice, for notices saved before they carried one ("Draw released: LH-1004"). */
const LOAN = /\b[A-Z]{1,5}-(?:DEMO-)?\d{3,6}\b/;
export const loanIn = (subject: string, body: string) => subject.match(LOAN)?.[0] ?? body.match(LOAN)?.[0];

/** The email text, without the "Sign in:" line every alert ends with, which the app doesn't need. */
export const inAppBody = (body: string) => body.replace(/\n*\s*Sign in: \S+\s*$/, "").trim();

export type Notice = { id: string; subject: string; body: string; eventCode: string; createdAt: Date; readAt: Date | null; loan?: string | null; link?: string | null };
export type NoticeGroup<T extends Notice = Notice> = { key: string; loan?: string; notices: T[]; unread: number; latest: Date };

/** Newest first, grouped by loan; notices about no loan share one group. Groups are ordered by their newest notice. */
export function groupNotices<T extends Notice>(notices: T[]): NoticeGroup<T>[] {
  const groups = new Map<string, NoticeGroup<T>>();
  for (const notice of [...notices].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    const loan = notice.loan || loanIn(notice.subject, notice.body);
    const key = loan ?? "";
    const group = groups.get(key) ?? { key, loan, notices: [], unread: 0, latest: notice.createdAt };
    group.notices.push(notice);
    if (!notice.readAt) group.unread++;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.latest.getTime() - a.latest.getTime());
}

/** A link inside LendHous only: a path, never another site. */
export const safeLink = (link?: string | null) => (link && link.startsWith("/") && !link.startsWith("//") && !link.includes("\\") ? link : undefined);

const firstLine = (body: string) => inAppBody(body).split("\n").find((line) => line.trim())?.trim() ?? "";

/** The once-a-day email: every held notice in a line or two, grouped by loan, with a link to the page. */
export function summaryEmail(notices: Notice[], origin: string) {
  const groups = groupNotices(notices);
  const lines: string[] = [];
  for (const group of groups) {
    lines.push(group.loan ? `${group.loan}` : "Other updates");
    for (const notice of group.notices) lines.push(`- ${notice.subject}${firstLine(notice.body) && firstLine(notice.body) !== notice.subject ? `: ${firstLine(notice.body)}` : ""}`);
    lines.push("");
  }
  const count = notices.length;
  return {
    subject: `Your LendHous updates: ${count} since yesterday`,
    body: `Here ${count === 1 ? "is the update" : `are the ${count} updates`} you asked to get once a day.\n\n${lines.join("\n")}\nSee each one in full, and change what reaches you by email: ${origin}/admin/account/notifications`,
  };
}
