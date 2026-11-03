// Who hears about what. Competitors' borrowers get told when their loan moves; so do these, and so does the team.
// Only names the loan number and what happened: details stay behind sign-in.
import type { Book, BookAction } from "@/lib/book";
import { notify, notifyTeam } from "@/lib/email";
import { evaluate } from "@/lib/engine";
import type { Deal } from "@/lib/mockData";
import { pricingConfig } from "@/lib/pricing-config";
import { DEFAULT_KINDS, maturityAfter, WITHDRAW_REASONS } from "@/lib/loan-exits";
import { prisma } from "@/lib/prisma";
import { defaultInterestFrom, defaultRate, ledger, maturityOf } from "@/lib/servicing";

const origin = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

type Alert = { to: "team" | "borrower" | "broker" | "partner" | "buyer"; dealId?: string; firmId?: string; subject: string; body: string; event: string };

/** The partner lenders and loan buyers who hold part of a loan, from who it's allocated to. */
const holdersOf = (deal?: Deal) => (deal?.allocations ?? []).flatMap((item): Pick<Alert, "to" | "firmId">[] => (item.sourceId.startsWith("partner:") ? [{ to: "partner", firmId: item.sourceId.slice(8) }] : item.sourceId.startsWith("buyer:") ? [{ to: "buyer", firmId: item.sourceId.slice(6) }] : []));

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
    case "recordPayoff": {
      const deal = loan(action.dealId);
      if (!deal?.paidOff) return [];
      const { amount, owed, receivedOn } = deal.paidOff;
      const over = amount - owed >= 0.01 ? ` You paid ${dollars(amount - owed)} more than the payoff; your LendHous team will refund it.` : "";
      return [
        { to: "borrower", dealId: deal.id, subject: `Paid in full: ${deal.loanNumber}`, body: `We received your payoff of ${dollars(amount)} on ${longDate(receivedOn)}. Your loan is paid in full. We'll send the satisfaction of your mortgage to be recorded.${over}`, event: "loan.paid_off" },
        { to: "team", subject: `Paid off: ${deal.loanNumber}`, body: `${deal.borrowerName} paid off the loan with ${dollars(amount)} received ${longDate(receivedOn)} (${dollars(owed)} owed). Get the satisfaction of mortgage out within ${pricingConfig.lienReleaseDays} days.`, event: "loan.paid_off" },
        // The allocations are gone once it's paid off, so who held it comes from before.
        ...holdersOf(before.deals.find((item) => item.id === deal.id)).map((holder) => ({ ...holder, subject: `A loan you hold was paid off: ${deal.loanNumber}`, body: `${deal.loanNumber} was paid off on ${longDate(receivedOn)}. Your share follows under your agreement.`, event: "loan.paid_off" })),
      ];
    }
    case "recordLienRelease": {
      const deal = loan(action.dealId);
      if (!deal || action.step !== "recorded") return [];
      return [{ to: "borrower", dealId: deal.id, subject: `Your mortgage release is recorded: ${deal.loanNumber}`, body: `The satisfaction of the mortgage on ${deal.address}, ${deal.city} was recorded on ${longDate(action.on)} (${action.reference}).`, event: "loan.lien_released" }];
    }
    case "closeApplication": {
      const deal = loan(action.dealId);
      if (!deal) return [];
      const where = `${deal.address}, ${deal.city}`;
      const clients = (subject: string, body: string, event: string): Alert[] => [{ to: "borrower", dealId: deal.id, subject, body, event }, { to: "broker", dealId: deal.id, subject, body: body.replace("your application", "your client's application"), event }];
      // The reasons go out in the notice the attorney approves, so the email doesn't give them.
      if (action.outcome === "declined") return clients(`About your application: ${deal.loanNumber}`, `After review, LendHous can't offer a loan on your application for ${where}. Your LendHous team will follow up.`, "loan.declined");
      const reason = (WITHDRAW_REASONS[action.reason] ?? action.reason).toLowerCase();
      if (action.byTeam) return clients(`Your application is closed: ${deal.loanNumber}`, `We've closed your application for ${where} as withdrawn (${reason}). If that's not right, contact your LendHous team.`, "loan.withdrawn");
      const subject = `Application withdrawn: ${deal.loanNumber}`;
      return [
        { to: "team", subject, body: `${deal.borrowerName} withdrew the application for ${where}: ${reason}.${action.note ? ` They said: ${action.note}` : ""}`, event: "loan.withdrawn" },
        { to: "broker", dealId: deal.id, subject, body: `${deal.borrowerName} withdrew the application for ${where}.`, event: "loan.withdrawn" },
      ];
    }
    case "reopenApplication": {
      const deal = loan(action.dealId);
      return deal ? [{ to: "borrower", dealId: deal.id, subject: `Your application is open again: ${deal.loanNumber}`, body: `Your application for ${deal.address}, ${deal.city} is open again. Sign in to see its next step.`, event: "loan.reopened" }] : [];
    }
    case "declareDefault": {
      const deal = loan(action.dealId);
      if (!deal) return [];
      const kind = DEFAULT_KINDS[action.kind].toLowerCase();
      const rate = defaultRate(evaluate(deal.app).rate).toFixed(2);
      return [
        { to: "borrower", dealId: deal.id, subject: `Your loan is in default: ${deal.loanNumber}`, body: `LendHous has declared your loan in default, effective ${longDate(action.effectiveOn)} (${kind}). Interest now runs at the default rate of ${rate}% from ${longDate(defaultInterestFrom(deal))}. Your LendHous servicing team will contact you; call them to talk about bringing the loan current.`, event: "loan.default" },
        { to: "team", subject: `Default declared: ${deal.loanNumber}`, body: `${deal.borrowerName}: ${action.by} declared the loan in default, effective ${longDate(action.effectiveOn)} (${kind}). Send the notice of default from the attorney's template.`, event: "loan.default" },
        ...holdersOf(deal).map((holder) => ({ ...holder, subject: `A loan you hold is in default: ${deal.loanNumber}`, body: `LendHous declared ${deal.loanNumber} in default, effective ${longDate(action.effectiveOn)} (${kind}).`, event: "loan.default" })),
      ];
    }
    case "cureDefault": {
      const deal = loan(action.dealId);
      if (!deal) return [];
      return [
        { to: "borrower", dealId: deal.id, subject: `Your loan is out of default: ${deal.loanNumber}`, body: "Thank you. Your loan is current again and interest is back at the note rate.", event: "loan.default_cured" },
        { to: "team", subject: `Default cured: ${deal.loanNumber}`, body: `${deal.borrowerName}: ${action.by} lifted the default. ${action.note}`, event: "loan.default_cured" },
        ...holdersOf(deal).map((holder) => ({ ...holder, subject: `A loan you hold is out of default: ${deal.loanNumber}`, body: `${deal.loanNumber} is current again.`, event: "loan.default_cured" })),
      ];
    }
    case "requestExtension": {
      const deal = loan(action.dealId);
      const extension = deal?.extensions?.at(-1);
      if (!deal || !extension) return [];
      const team: Alert = { to: "team", subject: `Extension requested: ${deal.loanNumber}`, body: `${action.by} asked for ${action.months} more month${action.months === 1 ? "" : "s"} on ${deal.borrowerName}'s loan: ${action.reason}. It needs two approvers.`, event: "extension.requested" };
      return action.byTeam ? [team, { to: "borrower", dealId: deal.id, subject: `Your extension request: ${deal.loanNumber}`, body: `We've asked for a ${action.months}-month extension on your loan for you. The fee would be ${dollars(extension.fee)}. We'll tell you when it's decided.`, event: "extension.requested" }] : [team];
    }
    case "approveExtension": {
      const deal = loan(action.dealId);
      const extension = deal?.extensions?.find((item) => item.id === action.extensionId);
      // Only once both approvers have signed off.
      if (!deal || extension?.status !== "approved" || before.deals.find((item) => item.id === deal.id)?.extensions?.find((item) => item.id === action.extensionId)?.status === "approved") return [];
      return [{ to: "borrower", dealId: deal.id, subject: `Extension approved: ${deal.loanNumber}`, body: `Your ${extension.months}-month extension is approved. To finish it, sign the extension agreement and pay the ${dollars(extension.fee)} fee; your servicing team will send them. Your loan will then mature on ${longDate(maturityAfter(deal, extension))}.`, event: "extension.approved" }];
    }
    case "declineExtension": {
      const deal = loan(action.dealId);
      return deal ? [{ to: "borrower", dealId: deal.id, subject: `About your extension request: ${deal.loanNumber}`, body: `Your extension request wasn't approved: ${action.reason}. Your loan still matures on ${longDate(maturityOf(deal))}. Call your servicing team to talk about the payoff.`, event: "extension.declined" }] : [];
    }
    case "executeExtension": {
      const deal = loan(action.dealId);
      const extension = deal?.extensions?.find((item) => item.id === action.extensionId);
      if (!deal || extension?.status !== "executed") return [];
      const maturity = longDate(maturityOf(deal));
      return [
        { to: "borrower", dealId: deal.id, subject: `Your loan is extended: ${deal.loanNumber}`, body: `Your loan now matures on ${maturity}. We received the ${dollars(extension.fee)} extension fee. Thank you.`, event: "extension.executed" },
        { to: "team", subject: `Extended: ${deal.loanNumber}`, body: `${deal.borrowerName}'s loan now matures on ${maturity}.`, event: "extension.executed" },
        ...holdersOf(deal).map((holder) => ({ ...holder, subject: `A loan you hold was extended: ${deal.loanNumber}`, body: `${deal.loanNumber} was extended ${extension.months} month${extension.months === 1 ? "" : "s"}; it now matures on ${maturity}.`, event: "extension.executed" })),
      ];
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
