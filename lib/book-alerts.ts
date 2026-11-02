// Who hears about what. Competitors' borrowers get told when their loan moves; so do these, and so does the team.
// Only names the loan number and what happened: details stay behind sign-in.
import type { Book, BookAction } from "@/lib/book";
import { notify, notifyTeam } from "@/lib/email";
import { evaluate } from "@/lib/engine";
import type { Deal } from "@/lib/mockData";
import { pricingConfig } from "@/lib/pricing-config";
import { prisma } from "@/lib/prisma";
import { defaultRate, ledger } from "@/lib/servicing";

const origin = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

type Alert = { to: "team" | "borrower" | "broker" | "partner" | "buyer"; dealId?: string; firmId?: string; subject: string; body: string; event: string };

const dollars = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** What the nightly check found on one loan: payments that just went late, 30 and 90 days past due, maturity coming or passed. */
function servicingAlerts(before: Deal, after: Deal): Alert[] {
  const was = ledger(before); const now = ledger(after);
  const alerts: Alert[] = [];
  const both = (subject: string, body: string, event: string, team = body) => alerts.push({ to: "borrower", dealId: after.id, subject, body, event }, { to: "team", subject, body: `${after.borrowerName}: ${team}`, event });
  const wasLate = new Set(was.rows.filter((row) => row.late).map((row) => row.due));
  for (const row of now.rows.filter((item) => item.status === "late" && !wasLate.has(item.due))) {
    const fee = row.fee ? ` A late fee of ${dollars(row.fee)} has been added.` : "";
    both(`Payment late: ${after.loanNumber}`, `The payment of ${dollars(row.amount)} due ${longDate(row.due)} hasn't arrived.${fee} To bring the loan current, pay ${dollars(now.amountDue)}. If you've already sent it, contact your LendHous servicing team.`, "payment.late", `the payment of ${dollars(row.amount)} due ${longDate(row.due)} is late. ${dollars(now.amountDue)} is past due.`);
  }
  const { delinquentDays, defaultNoticeDays } = pricingConfig.servicing;
  if (was.daysPastDue < delinquentDays && now.daysPastDue >= delinquentDays) both(`${delinquentDays} days past due: ${after.loanNumber}`, `Your loan is ${now.daysPastDue} days past due. ${dollars(now.amountDue)} brings it current. Please pay it now or call us to talk about it.`, "loan.delinquent", `the loan is ${now.daysPastDue} days past due, ${dollars(now.amountDue)} owed.`);
  if (was.daysPastDue < defaultNoticeDays && now.daysPastDue >= defaultNoticeDays) alerts.push({ to: "team", subject: `${defaultNoticeDays} days past due: ${after.loanNumber}`, body: `${after.borrowerName}'s loan is ${now.daysPastDue} days past due. Decide whether to send a notice of default; talk to counsel first.`, event: "loan.default_review" });
  const notice = (after.maturityNotices ?? []).filter((days) => !(before.maturityNotices ?? []).includes(days));
  if (notice.length && !now.matured) both(`Your loan matures ${longDate(now.maturity)}: ${after.loanNumber}`, `Your loan matures in ${now.daysToMaturity} days, on ${longDate(now.maturity)}. Plan to pay it off by then: you can ask for a payoff statement on your loan page. If you need more time, talk to us before it matures.`, "loan.maturity_notice", `the loan matures in ${now.daysToMaturity} days, on ${longDate(now.maturity)}.`);
  if (after.status === "matured" && before.status !== "matured") both(`Your loan has matured: ${after.loanNumber}`, `Your loan matured on ${longDate(now.maturity)} and the full balance is now due. From then, interest runs at the default rate of ${defaultRate(evaluate(after.app).rate).toFixed(2)}%. Sign in to ask for a payoff statement.`, "loan.matured", `the loan matured on ${longDate(now.maturity)} and hasn't been paid off.`);
  return alerts;
}

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
    case "finishPhotoRequest": {
      const request = after.photoRequests.find((item) => item.id === action.requestId);
      if (!request) return [];
      // Pressing send again with nothing new tells nobody anything, so it alerts nobody.
      const prior = before.photoRequests.find((item) => item.id === action.requestId);
      if (prior?.status === "received" && !request.photos.some((photo) => !prior.finishedAt || photo.at > prior.finishedAt)) return [];
      const told = `${action.by} sent ${request.photos.length} photo${request.photos.length === 1 ? "" : "s"} of the work.`;
      const team: Alert = { to: "team", subject: `Photos received: ${number(request.dealId)}`, body: told, event: "photos.received" };
      return request.who === "contractor" ? [team, { ...team, to: "borrower", dealId: request.dealId }] : [team];
    }
    case "rejectDraw": case "releaseDraw": {
      const draw = after.draws.find((item) => item.id === action.drawId);
      if (!draw) return [];
      return [{ to: "borrower", dealId: draw.dealId, subject: `Update on your draw: ${number(draw.dealId)}`, body: action.t === "releaseDraw" ? `Your draw of $${(draw.approved ?? 0).toLocaleString("en-US")} was released.` : `Your draw wasn't approved: ${draw.reason}`, event: `draw.${action.t === "releaseDraw" ? "released" : "rejected"}` }];
    }
    case "recordPayment": {
      const deal = loan(action.dealId);
      if (!deal) return [];
      const after = ledger(deal);
      const still = after.amountDue > 0 && after.paymentsLate ? ` Your loan is still ${dollars(after.amountDue)} past due.` : "";
      return [{ to: "borrower", dealId: deal.id, subject: `Payment received: ${deal.loanNumber}`, body: `We received your payment of ${dollars(action.amount)} on ${longDate(action.receivedOn)}. Thank you.${still}`, event: "payment.received" }];
    }
    case "reversePayment": {
      const deal = loan(action.dealId);
      const payment = deal?.payments?.find((item) => item.id === action.paymentId);
      if (!deal || !payment) return [];
      return [{ to: "borrower", dealId: deal.id, subject: `A payment was reversed: ${deal.loanNumber}`, body: `Your payment of ${dollars(payment.amount)} received ${longDate(payment.receivedOn)} was reversed: ${action.reason}. Sign in to see what's due now.`, event: "payment.reversed" }];
    }
    case "settleLoans":
      return after.deals.flatMap((deal) => {
        const prior = before.deals.find((item) => item.id === deal.id);
        return prior && prior !== deal ? servicingAlerts(prior, deal) : [];
      });
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
