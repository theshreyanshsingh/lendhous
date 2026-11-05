// Who hears about what. Competitors' borrowers get told when their loan moves; so do these, and so does the team.
// Only names the loan number and what happened: details stay behind sign-in.
import { serviceDay, type Book, type BookAction } from "@/lib/book";
import { notify, notifyTeam } from "@/lib/email";
import { TEAM_ROLE_LABEL, teamEmails } from "@/lib/loan-team";
import { evaluate } from "@/lib/engine";
import type { Deal } from "@/lib/mockData";
import { currentPricing } from "@/lib/pricing-versions";
import { DEFAULT_KINDS, maturityAfter, WITHDRAW_REASONS } from "@/lib/loan-exits";
import { latestSheet } from "@/lib/term-sheets";
import { dueOf, fromThirdParty, letterChanges, receivedOf, requesterLine, staleLetter } from "@/lib/payoffs";
import { prisma } from "@/lib/prisma";
import { defaultInterestFrom, defaultRateOf, ledger, maturityOf, servicingTermsOf } from "@/lib/servicing";

const origin = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

/** "email" is someone with no account here, like a title company that asked for a payoff letter. */
type Alert = { to: "team" | "borrower" | "broker" | "partner" | "buyer" | "email"; dealId?: string; firmId?: string; email?: string; subject: string; body: string; event: string };

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
  const { delinquentDays, defaultNoticeDays } = servicingTermsOf(after);
  if (was.daysPastDue < delinquentDays && now.daysPastDue >= delinquentDays) both(`${delinquentDays} days past due: ${after.loanNumber}`, `Your loan is ${now.daysPastDue} days past due. ${dollars(now.amountDue)} brings it current. Please pay it now or call us to talk about it.`, "loan.delinquent", `the loan is ${now.daysPastDue} days past due, ${dollars(now.amountDue)} owed.`);
  if (was.daysPastDue < defaultNoticeDays && now.daysPastDue >= defaultNoticeDays) alerts.push({ to: "team", subject: `${defaultNoticeDays} days past due: ${after.loanNumber}`, body: `${after.borrowerName}'s loan is ${now.daysPastDue} days past due. Decide whether to send a notice of default; talk to counsel first.`, event: "loan.default_review" });
  // The exit plan question: on its own, or added to a maturity notice going out the same night.
  const askedNow = (after.exitAsked ?? []).filter((days) => !(before.exitAsked ?? []).includes(days));
  const planLink = `Tell us how you'll pay it off, so we can help in time: ${origin()}/admin/borrower/${after.id}#exit-plan`;
  const notice = (after.maturityNotices ?? []).filter((days) => !(before.maturityNotices ?? []).includes(days));
  if (askedNow.length && !notice.length && !now.matured) alerts.push({ to: "borrower", dealId: after.id, subject: `How will you pay off ${after.loanNumber}?`, body: `Your loan matures in ${now.daysToMaturity} days, on ${longDate(now.maturity)}. Are you selling, refinancing (LendHous makes rental loans too), asking for an extension, or paying it off another way? ${planLink}`, event: "exit.asked" });
  if (notice.length && !now.matured) both(`Your loan matures ${longDate(now.maturity)}: ${after.loanNumber}`, `Your loan matures in ${now.daysToMaturity} days, on ${longDate(now.maturity)}. Plan to pay it off by then: you can ask for a payoff statement on your loan page. If you need more time, talk to us before it matures.${askedNow.length ? ` ${planLink}` : ""}`, "loan.maturity_notice", `the loan matures in ${now.daysToMaturity} days, on ${longDate(now.maturity)}.`);
  if (after.status === "matured" && before.status !== "matured") both(`Your loan has matured: ${after.loanNumber}`, `Your loan matured on ${longDate(now.maturity)} and the full balance is now due. From then, interest runs at the default rate of ${defaultRateOf(after).toFixed(2)}%. Sign in to ask for a payoff statement.`, "loan.matured", `the loan matured on ${longDate(now.maturity)} and hasn't been paid off.`);
  return alerts;
}

/**
 * A payoff letter whose figures this change moved: a payment, a reversal, a waived fee, a draw, a default. LendHous is
 * held to a letter it sent, and a correction only takes its place if it reaches them a business day before they pay,
 * so the team hears straight away.
 */
function staleLetterAlerts(before: Book, after: Book): Alert[] {
  const today = serviceDay(after);
  return after.payoffs.flatMap((payoff) => {
    const deal = after.deals.find((item) => item.id === payoff.dealId);
    const prior = before.deals.find((item) => item.id === payoff.dealId);
    const was = before.payoffs.find((item) => item.id === payoff.id);
    if (!deal || !prior || !was || (deal === prior && was === payoff)) return [];
    const stale = staleLetter(deal, payoff, today);
    if (!stale || staleLetter(prior, was, today)) return [];
    return [{ to: "team" as const, subject: `Payoff letter out of date: ${deal.loanNumber}`, body: `Letter ${stale.letter.number} to ${requesterLine(payoff)} says ${dollars(stale.letter.total)} through ${longDate(stale.letter.goodThrough)}; it's now ${dollars(stale.now.total)} (${letterChanges(stale.letter, stale.now).join("; ")}). Send a corrected letter from the loan's Servicing tab today. It only replaces the old one if they get it by 3 p.m. their time at least one business day before they pay.`, event: "payoff.stale" }];
  });
}

/** The alerts one action causes. Pure, so it can be tested. */
export function alertsFor(before: Book, after: Book, action: BookAction): Alert[] {
  return [...actionAlerts(before, after, action), ...staleLetterAlerts(before, after)];
}

function actionAlerts(before: Book, after: Book, action: BookAction): Alert[] {
  const loan = (dealId?: string) => after.deals.find((deal) => deal.id === dealId);
  const number = (dealId?: string) => loan(dealId)?.loanNumber ?? "your loan";
  switch (action.t) {
    case "assignLoanTeam": {
      const deal = after.deals.find((item) => item.id === action.dealId);
      const label = TEAM_ROLE_LABEL[action.role].toLowerCase();
      // Nobody needs an email about taking a loan themselves.
      return deal && action.member && action.member.name !== action.by ? [{ to: "email", email: action.member.email, subject: `You're the ${label} on ${deal.loanNumber}`, body: `${action.by} made you the ${label} on ${deal.loanNumber}: ${deal.borrowerName}, ${deal.address}, ${deal.city}. It's under "Mine" in the pipeline.`, event: "loan.assigned" }] : [];
    }
    case "submitApp": {
      const deal = after.deals.find((item) => !before.deals.some((old) => old.id === item.id));
      return deal ? [{ to: "team", subject: `New application: ${deal.loanNumber}`, body: `${deal.borrowerName} applied for a loan on ${deal.address}, ${deal.city}.`, event: "loan.submitted" }] : [];
    }
    case "advanceLoan": {
      const deal = loan(action.dealId);
      if (!deal) return [];
      // Starting conditions adds the standard ones: the borrower hears what's theirs to send.
      if (deal.status === "conditions") {
        const prior = before.deals.find((item) => item.id === deal.id);
        const mine = (deal.conditions ?? []).filter((item) => item.owner === "borrower" && !prior?.conditions?.some((old) => old.id === item.id));
        if (!mine.length) return [];
        const body = `To get to closing we need: ${mine.map((item) => item.title).join("; ")}. Sign in to see what each one needs and send it.`;
        return [{ to: "borrower", dealId: deal.id, subject: `What we need to close: ${deal.loanNumber}`, body, event: "condition.added" }, { to: "broker", dealId: deal.id, subject: `What we need to close your client's loan: ${deal.loanNumber}`, body, event: "condition.added" }];
      }
      const told: Partial<Record<string, string>> = { clear_to_close: "Your loan is clear to close.", funded: "Your loan has funded." };
      const body = told[deal.status];
      return body ? [{ to: "borrower", dealId: deal.id, subject: `Update on ${deal.loanNumber}`, body, event: `loan.${deal.status}` }, { to: "broker", dealId: deal.id, subject: `Update on ${deal.loanNumber}`, body: body.replace("Your", "Your client's"), event: `loan.${deal.status}` }] : [];
    }
    case "recordReasonsRequest": {
      const deal = loan(action.dealId);
      const request = deal?.adverseAction?.request;
      return deal && request ? [{ to: "team", subject: `Decline reasons requested: ${deal.loanNumber}`, body: `${deal.borrowerName} asked in writing for the reasons their application was declined. The statement of reasons is due by ${longDate(request.dueOn)} (12 CFR 1002.9(a)(3)(ii)).`, event: "adverse_action.requested" }] : [];
    }
    case "recordAdverseNotice": {
      const deal = loan(action.dealId);
      return deal && action.result === "failed" ? [{ to: "team", subject: `Decline letter not delivered: ${deal.loanNumber}`, body: `The ${action.kind === "notice" ? "notice of action" : "statement of reasons"} to ${deal.borrowerName} couldn't be emailed. Download it from the loan's page and mail it today.`, event: "adverse_action.undelivered" }] : [];
    }
    case "addNoticeToOwner": {
      const deal = loan(action.dealId);
      return deal ? [{ to: "borrower", dealId: deal.id, subject: `Notice to owner received: ${deal.loanNumber}`, body: `${action.lienor.trim()} served a notice to owner on your project, so each draw from now on needs their lien waiver as well as your contractor's. Make sure your contractor pays them.`, event: "lien.notice_to_owner" }] : [];
    }
    case "lienWaiverReceived": case "affidavitReceived": {
      const draw = after.draws.find((item) => item.id === action.drawId);
      const deal = draw && loan(draw.dealId);
      if (!deal) return [];
      const what = action.t === "affidavitReceived" ? "the contractor's final payment affidavit" : `a ${action.kind} lien waiver from ${draw.waivers?.at(-1)?.party ?? "a lienor"}`;
      return [{ to: "team", subject: `Draw paperwork received: ${deal.loanNumber}`, body: `${action.by} sent ${what}. Check it against the statutory form on the Draws page.`, event: "lien.waiver_received" }];
    }
    case "rejectLienWaiver": {
      const draw = after.draws.find((item) => item.id === action.drawId);
      const waiver = draw?.waivers?.find((item) => item.id === action.waiverId);
      const deal = draw && loan(draw.dealId);
      return deal && waiver ? [{ to: "borrower", dealId: deal.id, subject: `A lien waiver needs another look: ${deal.loanNumber}`, body: `The ${waiver.kind} lien waiver from ${waiver.party} wasn't accepted: ${action.reason.trim()} It has to be on Florida's statutory form (Fla. Stat. 713.20). Please send a new one.`, event: "lien.waiver_rejected" }] : [];
    }
    case "overrideDrawHolds": {
      const draw = after.draws.find((item) => item.id === action.drawId);
      const deal = draw && loan(draw.dealId);
      return deal && draw?.override ? [{ to: "team", subject: `Draw cleared past its holds: ${deal.loanNumber}`, body: `${action.by} cleared the draw to be released despite: ${draw.override.holds.join(" ")} Why: ${draw.override.reason}`, event: "lien.override" }] : [];
    }
    case "checkInsurance":
      return after.deals.flatMap((deal): Alert[] => {
        const now = deal.lienFile?.insurance; const was = before.deals.find((item) => item.id === deal.id)?.lienFile?.insurance;
        if (!now || !was) return [];
        const kind = now.kind === "builders_risk" ? "builder's risk" : "hazard";
        if (now.lapseNoticeOn && !was.lapseNoticeOn) return [{ to: "borrower", dealId: deal.id, subject: `Your insurance has lapsed: ${deal.loanNumber}`, body: `The ${kind} policy on ${deal.address}, ${deal.city} ended on ${longDate(now.expiresOn)}. No draws can be released until we have the renewal. Please send it now.`, event: "insurance.lapsed" }, { to: "team", subject: `Insurance lapsed: ${deal.loanNumber}`, body: `${deal.borrowerName}'s ${kind} policy (${now.carrier}) ended on ${longDate(now.expiresOn)}. Draws are on hold until it's renewed; consider whether it's a default.`, event: "insurance.lapsed" }];
        if (now.remindedOn && !was.remindedOn) return [{ to: "borrower", dealId: deal.id, subject: `Your insurance renews soon: ${deal.loanNumber}`, body: `The ${kind} policy on ${deal.address}, ${deal.city} ends on ${longDate(now.expiresOn)}. Please send the renewal before then; draws can't be released on a lapsed policy.`, event: "insurance.expiring" }, { to: "team", subject: `Insurance ending soon: ${deal.loanNumber}`, body: `${deal.borrowerName}'s ${kind} policy (${now.carrier}) ends on ${longDate(now.expiresOn)}.`, event: "insurance.expiring" }];
        return [];
      });
    case "addCondition": {
      const deal = loan(action.dealId);
      const added = deal?.conditions?.find((item) => !before.deals.find((old) => old.id === deal.id)?.conditions?.some((prior) => prior.id === item.id));
      if (!deal || !added || added.owner !== "borrower") return [];
      const body = `We need one more thing for your loan: ${added.title}.${added.detail ? ` ${added.detail}` : ""}${added.dueOn ? ` Please send it by ${longDate(added.dueOn)}.` : ""} Sign in to send it.`;
      return [{ to: "borrower", dealId: deal.id, subject: `We need something for your loan: ${deal.loanNumber}`, body, event: "condition.added" }, { to: "broker", dealId: deal.id, subject: `We need something for your client's loan: ${deal.loanNumber}`, body, event: "condition.added" }];
    }
    case "conditionFile": {
      const deal = loan(action.dealId);
      const condition = deal?.conditions?.find((item) => item.id === action.conditionId);
      return deal && condition ? [{ to: "team", subject: `Condition sent in: ${deal.loanNumber}`, body: `${action.by} sent ${action.fileName} for "${condition.title}". Clear it or send it back on the loan's Conditions tab.`, event: "condition.submitted" }] : [];
    }
    case "returnCondition": case "clearCondition": {
      const deal = loan(action.dealId);
      const condition = deal?.conditions?.find((item) => item.id === action.conditionId);
      if (!deal || condition?.owner !== "borrower") return [];
      const body = action.t === "returnCondition" ? `What you sent for "${condition.title}" needs another look: ${action.reason.trim()} Sign in to send it again.` : `"${condition.title}" is cleared. Thank you.`;
      const subject = action.t === "returnCondition" ? `Please send it again: ${deal.loanNumber}` : `Condition cleared: ${deal.loanNumber}`;
      return [{ to: "borrower", dealId: deal.id, subject, body, event: action.t === "returnCondition" ? "condition.returned" : "condition.cleared" }, { to: "broker", dealId: deal.id, subject, body, event: action.t === "returnCondition" ? "condition.returned" : "condition.cleared" }];
    }
    case "issueTermSheet": {
      const deal = loan(action.dealId);
      const sheet = deal && latestSheet(deal);
      if (!deal || !sheet || deal.status !== "term_sheet_issued") return [];
      const offer = `${dollars(sheet.terms.noteAmount)} at ${sheet.terms.rate}%${deal.app.product === "dscr" ? "" : ` for ${sheet.terms.termMonths} months`}`;
      const body = `Version ${sheet.version} of the term sheet is ready: ${offer}. Review and accept it, or ask for changes, in the LendHous portal by ${longDate(sheet.expiresOn)}.`;
      return [{ to: "borrower", dealId: deal.id, subject: `Your term sheet is ready: ${deal.loanNumber}`, body, event: "loan.term_sheet_issued" }, { to: "broker", dealId: deal.id, subject: `Your client's term sheet is ready: ${deal.loanNumber}`, body, event: "loan.term_sheet_issued" }];
    }
    case "requestPricingException": {
      const deal = loan(action.dealId);
      const exception = deal?.pricingException;
      if (!deal || exception?.status !== "pending") return [];
      return [{ to: "team", subject: `Pricing exception to approve: ${deal.loanNumber}`, body: `${action.by} wants to price ${deal.borrowerName}'s loan at ${action.rate}% and ${action.points} points, outside the matrix: ${exception.reasons.join("; ")}. Why: ${exception.note} An owner other than ${action.by} approves it on the loan's Term sheet tab.`, event: "pricing.exception_requested" }];
    }
    case "decidePricingException": {
      const deal = loan(action.dealId);
      const exception = deal?.pricingException;
      if (!deal || !exception || exception.status === "pending") return [];
      return [{ to: "team", subject: `Pricing exception ${exception.status}: ${deal.loanNumber}`, body: `${action.by} ${exception.status} the exception ${exception.requestedBy} asked for (${exception.rate}% and ${exception.points} points)${exception.decision ? `: ${exception.decision}` : "."}`, event: "pricing.exception_decided" }];
    }
    case "requestTermSheetChanges": {
      const deal = loan(action.dealId);
      return deal ? [{ to: "team", subject: `Changes asked for on the term sheet: ${deal.loanNumber}`, body: `${action.by} asked for changes to the term sheet, so the loan is back in underwriting: "${action.note.trim()}"`, event: "loan.term_sheet_changes" }] : [];
    }
    case "checkTermSheets":
      return after.deals.flatMap((deal): Alert[] => {
        const prior = before.deals.find((item) => item.id === deal.id);
        const sheet = latestSheet(deal); const was = prior && latestSheet(prior);
        if (!sheet || !was || sheet === was) return [];
        if (sheet.status === "expired" && was.status === "sent") {
          const body = `The term sheet for ${deal.address}, ${deal.city} expired on ${longDate(sheet.expiresOn)}. Your loan officer can send a new one.`;
          return [{ to: "borrower", dealId: deal.id, subject: `Your term sheet expired: ${deal.loanNumber}`, body, event: "loan.term_sheet_expired" }, { to: "broker", dealId: deal.id, subject: `Your client's term sheet expired: ${deal.loanNumber}`, body, event: "loan.term_sheet_expired" }, { to: "team", subject: `Term sheet expired: ${deal.loanNumber}`, body: `${deal.borrowerName} didn't accept version ${sheet.version} by ${longDate(sheet.expiresOn)}. The loan is back in underwriting for a new one.`, event: "loan.term_sheet_expired" }];
        }
        if (sheet.remindedOn && !was.remindedOn) {
          const body = `Your term sheet for ${deal.address}, ${deal.city} expires on ${longDate(sheet.expiresOn)}. Review and accept it, or ask for changes, in the LendHous portal before then.`;
          return [{ to: "borrower", dealId: deal.id, subject: `Your term sheet expires soon: ${deal.loanNumber}`, body, event: "loan.term_sheet_expiring" }, { to: "broker", dealId: deal.id, subject: `Your client's term sheet expires soon: ${deal.loanNumber}`, body, event: "loan.term_sheet_expiring" }];
        }
        return [];
      });
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
    case "requestPayoff": case "logPayoffRequest": case "submitPayoffRequest": {
      const payoff = after.payoffs.find((item) => !before.payoffs.some((old) => old.id === item.id));
      const deal = loan(action.dealId);
      if (!payoff || !deal) return [];
      const who = requesterLine(payoff);
      const check = payoff.check?.status === "pending" ? ` First: ${payoff.check.note.replace(/\.$/, "")}.` : "";
      const alerts: Alert[] = [{ to: "team", subject: `Payoff letter requested: ${deal.loanNumber}`, body: `${who} asked for a payoff letter good through ${longDate(payoff.goodThrough)}. Florida law gives us until ${longDate(dueOf(payoff))} to send it (received ${longDate(receivedOf(payoff))}).${check}`, event: "payoff.requested" }];
      // The borrower is told whenever someone else asks (Fla. Stat. 701.04(1)(a)), which also catches a request they never authorized.
      if (fromThirdParty(payoff)) alerts.push({ to: "borrower", dealId: deal.id, subject: `Payoff letter requested: ${deal.loanNumber}`, body: `${who} asked us for a payoff letter on your loan for ${deal.address}, ${deal.city}. If you didn't authorize this, call your LendHous servicing team right away.`, event: "payoff.third_party" });
      return alerts;
    }
    case "refusePayoff": {
      const payoff = after.payoffs.find((item) => item.id === action.payoffId);
      if (!payoff || payoff.status !== "refused") return [];
      const body = `We can't send a payoff letter for ${number(payoff.dealId)} on this request: ${action.reason.trim().replace(/\.$/, "")}. Send a new request once that's sorted out.`;
      return payoff.requester?.email ? [{ to: "email", email: payoff.requester.email, subject: `Your payoff request: ${number(payoff.dealId)}`, body, event: "payoff.refused" }] : [{ to: "borrower", dealId: payoff.dealId, subject: `Your payoff request: ${number(payoff.dealId)}`, body, event: "payoff.refused" }];
    }
    case "payoffLetterDelivered": {
      const payoff = after.payoffs.find((item) => item.id === action.payoffId);
      if (!payoff || action.result !== "failed") return [];
      return [{ to: "team", subject: `Payoff letter not delivered: ${number(payoff.dealId)}`, body: `Letter ${action.number} for ${requesterLine(payoff)} couldn't be emailed. Download it from the loan's Servicing tab and send it today another way; the 10 days still run.`, event: "payoff.undelivered" }];
    }
    case "recordScreening": {
      const deal = loan(action.dealId);
      const added = deal?.screenings?.at(-1);
      if (!deal || added?.id !== action.screening.id || added.status !== "review") return [];
      return [{ to: "team", subject: `Possible OFAC match: ${deal.loanNumber}`, body: `Screening ${deal.loanNumber} against the OFAC sanctions list found a possible match. Nothing moves on the loan until someone with authority reviews it on the Credit review tab. Don't tell the borrower.`, event: "ofac.review" }];
    }
    case "decideScreening": {
      const deal = loan(action.dealId);
      if (!deal || action.decision !== "match") return [];
      return [{ to: "team", subject: `Confirmed OFAC match: ${deal.loanNumber}`, body: `${action.by} confirmed an OFAC sanctions match on ${deal.loanNumber}. Don't move or return any money on it. Call counsel now: a blocked or rejected transaction has to be reported to OFAC within 10 business days.`, event: "ofac.match" }];
    }
    case "enterWire": {
      // Changed instructions are the classic sign of wire fraud, so the whole team hears about it.
      const deal = loan(action.dealId);
      if (!deal) return [];
      if ((deal.wires?.length ?? 0) < 2) return [{ to: "team", subject: `Wire instructions to verify: ${deal.loanNumber}`, body: `${action.by} entered wire instructions for ${deal.borrowerName}'s closing. Before anyone approves funding, call the title company at a number you found yourself and have them read the numbers back.`, event: "wire.entered" }];
      return [{ to: "team", subject: `Wire instructions changed: ${deal.loanNumber}`, body: `${action.by} entered new wire instructions for ${deal.borrowerName}'s closing. Funding approvals were cleared. Before anyone approves again, confirm the change by calling the title company at a number you found yourself, never one from an email.`, event: "wire.changed" }];
    }
    case "titleFundsReceived": {
      const deal = loan(action.dealId);
      return deal ? [{ to: "team", subject: `Title has the funds: ${deal.loanNumber}`, body: `${action.by} confirmed ${dollars(action.amount)} reached escrow on ${longDate(action.on)} for ${deal.borrowerName}'s closing.`, event: "closing.funds_received" }] : [];
    }
    case "titleRecording": {
      const deal = loan(action.dealId);
      if (!deal) return [];
      const body = `The mortgage on ${deal.address}, ${deal.city} was recorded on ${longDate(action.on)} (${action.reference}).`;
      return [{ to: "team", subject: `Mortgage recorded: ${deal.loanNumber}`, body: `${body} Accept the recorded copy on the Documents tab.`, event: "closing.recorded" }, { to: "borrower", dealId: deal.id, subject: `Your mortgage is recorded: ${deal.loanNumber}`, body, event: "closing.recorded" }];
    }
    case "recordPayoff": {
      const deal = loan(action.dealId);
      if (!deal?.paidOff) return [];
      const { amount, owed, receivedOn, letter } = deal.paidOff;
      const over = amount - owed >= 0.01 ? ` You paid ${dollars(amount - owed)} more than the payoff; your LendHous team will refund it.` : "";
      const short = letter && letter.shortfall > 0 ? letter.shortfall : 0;
      // Paid on a letter that came up short: the mortgage still has to be released, but the rest is still owed.
      return [
        short
          ? { to: "borrower", dealId: deal.id, subject: `Payoff received: ${deal.loanNumber}`, body: `We received your payoff of ${dollars(amount)} on ${longDate(receivedOn)}, as our payoff letter stated. We'll send the satisfaction of your mortgage to be recorded. Our letter left out ${dollars(short)} that's still owed on the loan; your LendHous team will be in touch about it.`, event: "loan.paid_off" }
          : { to: "borrower", dealId: deal.id, subject: `Paid in full: ${deal.loanNumber}`, body: `We received your payoff of ${dollars(amount)} on ${longDate(receivedOn)}. Your loan is paid in full. We'll send the satisfaction of your mortgage to be recorded.${over}`, event: "loan.paid_off" },
        { to: "team", subject: `Paid off: ${deal.loanNumber}`, body: `${deal.borrowerName} paid off the loan with ${dollars(amount)} received ${longDate(receivedOn)} (${dollars(owed)} owed).${short ? ` It was paid on payoff letter ${letter!.number}, which came to ${dollars(letter!.total)}: ${dollars(short)} is still owed by the borrower and guarantors, but the mortgage has to be released anyway.` : ""} Get the satisfaction of mortgage out within ${currentPricing().lienReleaseDays} days.`, event: "loan.paid_off" },
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
      if (action.outcome === "declined") {
        const due = deal.adverseAction ? [{ to: "team" as const, subject: `Decline notice due: ${deal.loanNumber}`, body: `${deal.borrowerName}'s application was declined. Reg B's notice is due by ${longDate(deal.adverseAction.dueOn)}${deal.adverseAction.large ? " (a business over $1 million: the reasons follow only if they ask in writing)" : ", with the specific reasons"}. Check the reasons and send it from the loan's page.`, event: "adverse_action.due" }] : [];
        return [...clients(`About your application: ${deal.loanNumber}`, `After review, LendHous can't offer a loan on your application for ${where}. A letter explaining our decision will follow.`, "loan.declined"), ...due];
      }
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
      const rate = defaultRateOf(deal).toFixed(2);
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
    case "partnerFundsSent": {
      const deal = after.deals.find((item) => item.id === action.dealId);
      const funding = deal?.partnerFunding;
      return deal && funding ? [{ to: "team", dealId: deal.id, subject: `Partner funds sent: ${deal.loanNumber}`, body: `${action.by} says the partner's share of ${dollars(funding.amount)} was wired on ${longDate(action.sentOn)} (reference ${action.reference || "not given"}). Confirm it arrived in escrow on the loan's Closing tab; the loan can't fund until it has.`, event: "partner_funds.sent" }] : [];
    }
    case "partnerFundsReceived": {
      const deal = after.deals.find((item) => item.id === action.dealId);
      const funding = deal?.partnerFunding;
      return deal && funding ? [{ to: "partner", firmId: funding.partnerId, subject: `Your funds arrived: ${deal.loanNumber}`, body: `LendHous confirmed your share of ${dollars(funding.amount)} arrived in escrow on ${longDate(action.on)}. You'll hear when the loan funds.`, event: "partner_funds.received" }] : [];
    }
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
        // The owners hear about everything; a loan's own officer and processor hear about theirs too.
        const dealId = alert.dealId ?? ("dealId" in action ? action.dealId : undefined);
        await notifyTeam(alert.subject, alert.body + link, alert.event, undefined, teamEmails(after.deals.find((item) => item.id === dealId)));
        continue;
      }
      if (alert.to === "email") {
        if (alert.email) await notify(alert.email, alert.subject, alert.body, { eventCode: alert.event });
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
