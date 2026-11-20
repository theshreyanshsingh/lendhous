// Email campaigns (docs/competitor-gaps-2026-11-09.md, rank 29): a rate sheet to the brokers, a note to past borrowers
// about their next loan. Marketing email in the U.S. has to say who sent it and where (a postal address), have an honest
// subject, and carry a working way to stop them that's honored (CAN-SPAM, 15 U.S.C. 7704). So every campaign ends with
// LendHous's mailing address from Settings and a one-click unsubscribe link, nobody who unsubscribed is sent one, and a
// campaign can't go out until the address is set. Loan notices aren't marketing and keep coming. Pure.
import type { Book } from "./book";
import type { PricingConfig } from "./pricing-config";
import { rateGrid } from "./rate-grid";
import { SERVICED } from "./servicing";

export const AUDIENCES = {
  brokers: { label: "Brokers", hint: "People at the approved brokerages" },
  past_borrowers: { label: "Past borrowers", hint: "Borrowers whose loan has paid off" },
  borrowers: { label: "All borrowers", hint: "Borrowers with a funded or paid-off loan" },
} as const;
export type Audience = keyof typeof AUDIENCES;
/** PLACEHOLDER: how many people one campaign may go to, so a mistake stays small. */
export const CAMPAIGN_RULES = { maxRecipients: 2_000, subjectMax: 120, bodyMax: 5_000 };

export type CampaignInput = { audience: Audience; subject: string; body: string };

/** Why the campaign can't go out as written, or null. */
export function campaignProblem(input: CampaignInput, mailingAddress: string) {
  if (!(input.audience in AUDIENCES)) return "Choose who it goes to.";
  if (!input.subject.trim()) return "Give it a subject line that says what's inside.";
  if (input.subject.length > CAMPAIGN_RULES.subjectMax) return `Keep the subject under ${CAMPAIGN_RULES.subjectMax} characters.`;
  if (!input.body.trim()) return "Write the message.";
  if (input.body.length > CAMPAIGN_RULES.bodyMax) return `Keep the message under ${CAMPAIGN_RULES.bodyMax.toLocaleString("en-US")} characters.`;
  if (!mailingAddress.trim()) return "Add LendHous's mailing address in Settings first: marketing email has to carry it.";
  return null;
}

/** Who a campaign goes to, as account ids: from the book, before anyone who unsubscribed is taken out. */
export function audienceIds(book: Pick<Book, "deals" | "brokers">, audience: Audience, brokerUsers: { id: string; firmId: string }[]) {
  if (audience === "brokers") {
    const approved = new Set(book.brokers.filter((broker) => broker.status === "approved").map((broker) => broker.id));
    return [...new Set(brokerUsers.filter((user) => approved.has(user.firmId)).map((user) => user.id))];
  }
  const statuses = audience === "past_borrowers" ? ["paid_off"] : [...SERVICED, "paid_off"];
  return [...new Set(book.deals.filter((deal) => statuses.includes(deal.status)).map((deal) => deal.borrowerId))];
}

/** The footer every campaign carries: who sent it, where from, and how to stop them. */
export function campaignFooter(mailingAddress: string, unsubscribeUrl: string) {
  return `\n\n—\nLendHous · ${mailingAddress.replace(/\s*\n\s*/g, ", ")}\nYou're getting this because you've worked with LendHous. To stop these emails: ${unsubscribeUrl}\nNotices about a loan you have with us still come.`;
}

/** A starting rate-sheet message for brokers, from today's pricing. */
export function rateSheetDraft(config: PricingConfig, sheetUrl: string): CampaignInput {
  // The rental grid runs from the best credit down; the others from the newest investors up to the most experienced.
  const lines = rateGrid(config).map((table) => {
    const best = table.key === "dscr" ? table.rows[0] : table.rows[table.rows.length - 1];
    const worst = table.key === "dscr" ? table.rows[table.rows.length - 1] : table.rows[0];
    return `• ${table.title}: ${best.cells[0]} (${best.label.toLowerCase()}) to ${worst.cells[0]} (${worst.label.toLowerCase()})`;
  });
  return {
    audience: "brokers",
    subject: "LendHous rates this week",
    body: `Hello,\n\nHere's where LendHous's programs price today:\n\n${lines.join("\n")}\n\nYour program sheet, with your name and referral link on it, is ready to print from your portal: ${sheetUrl}\n\nA quote takes about a minute; send us your next deal.`,
  };
}
