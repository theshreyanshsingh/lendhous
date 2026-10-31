// Who hears about what. Competitors' borrowers get told when their loan moves; so do these, and so does the team.
// Only names the loan number and what happened: details stay behind sign-in.
import type { Book, BookAction } from "@/lib/book";
import { notify, notifyTeam } from "@/lib/email";
import { prisma } from "@/lib/prisma";

const origin = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

type Alert = { to: "team" | "borrower" | "broker" | "partner" | "buyer"; dealId?: string; firmId?: string; subject: string; body: string; event: string };

/** The alerts one action causes. Pure, so it can be tested. */
export function alertsFor(before: Book, after: Book, action: BookAction): Alert[] {
  const loan = (dealId?: string) => after.deals.find((deal) => deal.id === dealId);
  const number = (dealId?: string) => loan(dealId)?.loanNumber ?? "your loan";
  switch (action.t) {
    case "submitApp": {
      const deal = after.deals.find((item) => !before.deals.some((old) => old.id === item.id));
      return deal ? [{ to: "team", subject: `New application: ${deal.loanNumber}`, body: `${deal.borrowerName} applied for a loan on ${deal.address}, ${deal.city}.`, event: "loan.submitted" }] : [];
    }
    case "advanceLoan": {
      const deal = loan(action.dealId);
      if (!deal) return [];
      const told: Partial<Record<string, string>> = { term_sheet_issued: "Your term sheet is ready to review and accept.", clear_to_close: "Your loan is clear to close.", funded: "Your loan has funded." };
      const body = told[deal.status];
      return body ? [{ to: "borrower", dealId: deal.id, subject: `Update on ${deal.loanNumber}`, body, event: `loan.${deal.status}` }, { to: "broker", dealId: deal.id, subject: `Update on ${deal.loanNumber}`, body: body.replace("Your", "Your client's"), event: `loan.${deal.status}` }] : [];
    }
    case "acceptTermSheet":
      return [{ to: "team", subject: `Term sheet accepted: ${number(action.dealId)}`, body: `${action.signedName} accepted the term sheet.`, event: "loan.term_sheet_accepted" }];
    case "docStatus":
      return action.status === "rejected" ? [{ to: "borrower", dealId: action.dealId, subject: `A document needs another look: ${number(action.dealId)}`, body: "One of your documents wasn't accepted. Sign in to see which one and upload a new copy.", event: "doc.rejected" }] : [];
    case "addDocRequest":
      return [{ to: "borrower", dealId: action.dealId, subject: `We need a document: ${number(action.dealId)}`, body: `Please upload: ${action.name}.`, event: "doc.requested" }];
    case "requestDraw":
      return [{ to: "team", subject: `Draw requested: ${number(action.dealId)}`, body: `${action.by} requested a draw of $${action.lines.reduce((sum, line) => sum + line.requested, 0).toLocaleString("en-US")}.`, event: "draw.requested" }];
    case "rejectDraw": case "releaseDraw": {
      const draw = after.draws.find((item) => item.id === action.drawId);
      if (!draw) return [];
      return [{ to: "borrower", dealId: draw.dealId, subject: `Update on your draw: ${number(draw.dealId)}`, body: action.t === "releaseDraw" ? `Your draw of $${(draw.approved ?? 0).toLocaleString("en-US")} was released.` : `Your draw wasn't approved: ${draw.reason}`, event: `draw.${action.t === "releaseDraw" ? "released" : "rejected"}` }];
    }
    case "requestPayoff":
      return [{ to: "team", subject: `Payoff requested: ${number(action.dealId)}`, body: `${action.by} asked for a payoff statement good through ${action.goodThrough}.`, event: "payoff.requested" }];
    case "sendPayoff": {
      const payoff = after.payoffs.find((item) => item.id === action.payoffId);
      return payoff ? [{ to: "borrower", dealId: payoff.dealId, subject: `Your payoff statement: ${number(payoff.dealId)}`, body: `Your payoff is ready, good through ${payoff.goodThrough}. Sign in to see it. We will never email wire instructions.`, event: "payoff.sent" }] : [];
    }
    case "sendMessage":
      if (action.side === "internal") return [];
      return action.side === "team"
        ? [{ to: "borrower", dealId: action.dealId, subject: `New message about ${number(action.dealId)}`, body: "You have a new message from the LendHous team. Sign in to read it.", event: "message.team" }, { to: "broker", dealId: action.dealId, subject: `New message about ${number(action.dealId)}`, body: "You have a new message from the LendHous team. Sign in to read it.", event: "message.team" }]
        : [{ to: "team", subject: `New message about ${number(action.dealId)}`, body: `${action.from} sent a message. Sign in to read it.`, event: "message.client" }];
    case "sendTeaser":
      return action.partnerIds.map((firmId) => ({ to: "partner" as const, firmId, subject: "A new deal fits your buy box", body: "LendHous sent you a new deal. Sign in to review it.", event: "teaser.sent" }));
    case "bid":
      return [{ to: "team", subject: `New bid: ${number(action.bid.dealId)}`, body: "A partner lender responded to a teaser.", event: "bid.received" }];
    case "acceptBid": {
      const bid = after.bids.find((item) => item.id === action.bidId);
      return bid ? [{ to: "partner", firmId: bid.partnerId, subject: "Your bid was accepted", body: "LendHous accepted your bid. Sign in to see the full deal room.", event: "bid.accepted" }] : [];
    }
    case "offerLoan":
      return [{ to: "team", subject: "New offer on a loan for sale", body: `A loan buyer offered ${action.pricePct.toFixed(2)}. Sign in to review it.`, event: "offer.received" }];
    case "decideOffer": {
      const offer = after.offers.find((item) => item.id === action.offerId);
      return offer ? [{ to: "buyer", firmId: offer.buyerId, subject: action.accept ? "Your offer was accepted" : "Your offer was declined", body: action.accept ? "LendHous accepted your offer. Sign in to see the loan file and closing steps." : "LendHous declined your offer on a loan.", event: action.accept ? "offer.accepted" : "offer.declined" }] : [];
    }
    default:
      return [];
  }
}

/** Sends them. A failed alert never undoes the change it was about, and notify() keeps a copy in the app. */
export async function sendAlerts(before: Book, after: Book, action: BookAction) {
  for (const alert of alertsFor(before, after, action)) {
    try {
      const link = `\n\nSign in: ${origin()}/login`;
      if (alert.to === "team") {
        await notifyTeam(alert.subject, alert.body + link, alert.event);
        continue;
      }
      const deal = after.deals.find((item) => item.id === alert.dealId);
      const accounts = alert.to === "borrower"
        ? await prisma.user.findMany({ where: { id: deal?.borrowerId ?? "" }, select: { email: true } })
        : await prisma.user.findMany({ where: { OR: [{ id: (alert.to === "broker" ? deal?.brokerId : alert.firmId) ?? "" }, { organizationId: (alert.to === "broker" ? deal?.brokerId : alert.firmId) ?? "" }] }, select: { email: true } });
      for (const account of accounts) await notify(account.email, alert.subject, alert.body + link, { eventCode: alert.event });
    } catch (error) {
      console.error("[lendhous-alerts] could not send an alert:", error);
    }
  }
}
