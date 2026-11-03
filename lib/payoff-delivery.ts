// Sends a payoff letter once staff issue it: the PDF and a link to whoever asked, by email, the way they asked for it
// (Fla. Stat. 701.04(1)(f)2). A correction goes the same way, and when someone other than the borrower asked, the
// borrower gets a copy of it too (701.04(1)(c)1). How sending went is kept on the letter.
import { audit } from "./audit";
import type { Viewer } from "./book-access";
import { sendAlerts } from "./book-alerts";
import { readBook, runAction } from "./book-store";
import { sendPayoffLetterMail } from "./email";
import { letterPdf } from "./payoff-pdf";
import { createPayoffLink } from "./payoff-links";
import { fromThirdParty, latestLetter, letterContent, longDay, requesterLine } from "./payoffs";
import { prisma } from "./prisma";

const SENDER: Viewer = { id: "system", name: "LendHous servicing", roleCodes: [] };
const origin = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
const money = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Emails the request's newest letter and records how it went. Returns the book after, or null if there was nothing to send. */
export async function deliverPayoffLetter(payoffId: string) {
  const { book } = await readBook();
  const request = book.payoffs.find((item) => item.id === payoffId);
  const deal = request && book.deals.find((item) => item.id === request.dealId);
  const letter = request && latestLetter(request);
  if (!request || !deal || !letter || letter.delivery) return null;
  const lender = process.env.LENDER_NAME || "LendHous";
  const content = letterContent(deal, request, letter, lender);
  const pdf = { filename: `payoff-letter-${content.reference}.pdf`, content: await letterPdf(content) };
  const borrowers = (await prisma.user.findMany({ where: { id: deal.borrowerId || "none" }, select: { email: true } })).map((user) => user.email);
  const property = `${deal.address}, ${deal.city}`;
  const corrected = content.corrected ? `\n\nThis is a corrected letter. ${content.corrected}` : "";
  const figures = `${money(letter.total)} if received by ${longDay(letter.goodThrough)}, plus ${money(letter.perDiem)} for each day after.`;
  const wires = "The letter has no wire instructions, and we never send them by email. To pay, call us at a number you find yourself, from our website or the loan documents, and we'll confirm them on that call.";

  // To whoever asked: their email, or for a request from the portal, the borrower's sign-in.
  const to = request.requester?.email ? [request.requester.email] : borrowers;
  const results: ("sent" | "logged" | "failed")[] = [];
  for (const email of to) {
    const { link, expiresAt } = await createPayoffLink(request.id, letter.number, letter.goodThrough);
    const greeting = request.requester?.email ? request.requester.name.split(" ")[0] : deal.borrowerName.split(" ")[0];
    results.push(await sendPayoffLetterMail(email, `${content.corrected ? "Corrected payoff letter" : "Payoff letter"}: ${deal.loanNumber}, ${property}`, `Hi ${greeting},\n\nHere is ${lender}'s payoff letter for the loan on ${property} (${deal.loanNumber}), attached as a PDF: ${figures}${corrected}\n\nYou can also open it here. If we ever correct it, this link shows the newest letter:\n${link}\n\n${wires}\n\nThe link works until ${longDay(expiresAt.toISOString().slice(0, 10))}. Please don't forward it.`, pdf));
  }
  // The borrower's copy of a correction someone else asked for. Their own copy, from their portal, needs no link.
  const copies = content.corrected && fromThirdParty(request) ? borrowers.filter((email) => !to.includes(email)) : [];
  for (const email of copies) {
    results.push(await sendPayoffLetterMail(email, `Copy of a corrected payoff letter: ${deal.loanNumber}`, `Hi ${deal.borrowerName.split(" ")[0]},\n\nWe sent ${requesterLine(request)} a corrected payoff letter for your loan on ${property}. Florida law asks us to send you a copy, so it's attached: ${figures}\n\n${wires}\n\nSign in to see your loan: ${origin()}/login`, pdf));
  }
  const result = !results.length || results.includes("failed") ? "failed" : results.every((item) => item === "logged") ? "logged" : "sent";
  const saved = await runAction(SENDER, { t: "payoffLetterDelivered", payoffId, number: letter.number, to: [...to, ...copies], result }, { trusted: true });
  if ("error" in saved) return null;
  await sendAlerts(saved.before, saved.after, saved.action);
  await audit({ actorId: null, action: "payoff.letter_sent", entityType: "LoanBook", entityId: deal.id, after: { payoffId, number: letter.number, result, recipients: to.length + copies.length } });
  return saved.after;
}
