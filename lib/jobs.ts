// Scheduled jobs. UPB runs one daily batch; Lendhous needs several nightly jobs (late payments and maturity now, later
// insurance expiry and OFAC re-checks), so each job is named and runs at most once per day: the JobRun.runKey unique
// index makes a second cron call that day a no-op.
import { Prisma } from "@prisma/client";
import { audit } from "@/lib/audit";
import type { Viewer } from "@/lib/book-access";
import { sendAlerts } from "@/lib/book-alerts";
import { readBook, runAction } from "@/lib/book-store";
import { PRE_FUNDING } from "@/lib/loan-exits";
import { refreshSanctionsList, screenDeal } from "@/lib/sanctions-store";
import { encryptStoredData } from "@/lib/encrypt-data";
import { notifyTeam } from "@/lib/email";
import { payoffReminders } from "@/lib/payoffs";
import { noticeReminders } from "@/lib/adverse-action";
import { prisma } from "@/lib/prisma";
import { SERVICED, servicingDate } from "@/lib/servicing";
import { getSettings } from "@/lib/settings";

type Job = (now: Date) => Promise<string>;

async function purgeSessions(now: Date) {
  const [sessions, links, photoLinks, payoffLinks, windows] = await Promise.all([
    prisma.serverSession.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.passwordLink.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.photoLink.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.payoffLink.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.rateWindow.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  return `removed ${sessions.count} expired sessions, ${links.count} password links, ${photoLinks.count} photo links, ${payoffLinks.count} payoff links, ${windows.count} rate windows`;
}

async function cleanRetention(now: Date) {
  const settings = await getSettings();
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - settings.retentionYears);
  // Read, non-legal notices only. Loan files and the audit log are never purged here (Spec v3 10.5 legal hold).
  const notices = await prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff }, readAt: { not: null }, legal: false } });
  return `retention removed ${notices.count} read notices`;
}

// Catches anything saved before encryption, and moves records to the newest key after a rotation.
async function sealStoredData() {
  const done = await encryptStoredData();
  return `encrypted ${done.records} loan records, ${done.leads} leads, ${done.notices} notices, ${done.files} files${done.missing ? `; ${done.missing} files missing` : ""}`;
}

/** The servicing job acts as nobody in particular: settleLoans is a server-only step, so it needs no role. */
const SERVICING: Viewer = { id: "system", name: "LendHous servicing", roleCodes: [] };

// Brings every serviced loan up to today: payments past their grace days go late and owe a fee, loans move to delinquent
// or matured, and borrowers and the team hear about each. Recording a payment does the same for one loan straight away.
async function checkServicing(now: Date) {
  const asOf = servicingDate(now);
  // Letters first: payoff letters due within two days or late, payoff letters already out of date, and decline notices
  // due within five days or late. Payoff letters tonight's check makes out of date are alerted on their own.
  const book = (await readBook()).book;
  const reminders = [...payoffReminders(book, asOf), ...noticeReminders(book.deals, asOf)];
  if (reminders.length) await notifyTeam(`Letters due: ${reminders.length}`, `${reminders.join("\n")}\n\nPayoff letters are due 10 days after a request is received (Fla. Stat. 701.04); decline notices 30 days after a completed application (12 CFR 1002.9). Send them from the loan's page.`, "letters.reminder");
  const result = await runAction(SERVICING, { t: "settleLoans", asOf }, { trusted: true });
  if ("error" in result) return `no loans changed as of ${asOf}${reminders.length ? `; ${reminders.length} payoff reminders` : ""}`;
  const changed = result.after.deals.filter((deal) => !result.before.deals.includes(deal));
  await audit({ actorId: null, action: "book.settleLoans", entityType: "LoanBook", entityId: asOf, after: { loans: changed.map((deal) => ({ loan: deal.loanNumber, status: deal.status, paymentsLate: deal.paymentsLate ?? 0 })) } });
  await sendAlerts(result.before, result.after, result.action);
  const late = changed.filter((deal) => deal.paymentsLate).length;
  return `checked ${changed.length} loans as of ${asOf}; ${late} with payments past due${reminders.length ? `; ${reminders.length} payoff reminders` : ""}`;
}

// Term sheets left open: the borrower and broker are reminded two days before one expires, and one past its last day
// expires and sends the loan back to underwriting for a new one (Spec 4.3, 12.1).
async function checkTermSheets(now: Date) {
  const asOf = servicingDate(now);
  const result = await runAction(SERVICING, { t: "checkTermSheets", asOf }, { trusted: true });
  if ("error" in result) return `no term sheets to remind about or expire as of ${asOf}`;
  await sendAlerts(result.before, result.after, result.action);
  const changed = result.after.deals.filter((deal) => !result.before.deals.includes(deal));
  const expired = changed.filter((deal) => deal.status === "underwriting").length;
  await audit({ actorId: null, action: "book.checkTermSheets", entityType: "LoanBook", entityId: asOf, after: { loans: changed.map((deal) => deal.loanNumber), expired } });
  return `${expired} term sheets expired, ${changed.length - expired} reminders as of ${asOf}`;
}

// Builder's risk and hazard policies on loans being serviced: the borrower and the team hear 30 days before one ends, and
// again once it has lapsed, which holds every draw until it's renewed.
async function checkInsurance(now: Date) {
  const asOf = servicingDate(now);
  const result = await runAction(SERVICING, { t: "checkInsurance", asOf }, { trusted: true });
  if ("error" in result) return `no insurance to warn about as of ${asOf}`;
  await sendAlerts(result.before, result.after, result.action);
  const changed = result.after.deals.filter((deal) => !result.before.deals.includes(deal));
  return `${changed.length} insurance warnings as of ${asOf}`;
}

const SCREENER: Viewer = { id: "system", name: "Nightly sanctions check", roleCodes: [] };

// Downloads Treasury's sanctions list, then screens everyone on every open application and active loan against it. A
// result like the last one just updates when it was confirmed; anything new is recorded, and a possible match alerts
// the team. If the download fails the old list stays and the job fails, so the health check and the team see it.
async function checkSanctions(now: Date) {
  const refreshed = await refreshSanctionsList(fetch, now);
  const book = (await readBook()).book;
  const active = book.deals.filter((deal) => PRE_FUNDING.includes(deal.status) || SERVICED.includes(deal.status));
  let flagged = 0;
  for (const deal of active) {
    const screening = await screenDeal(deal, SCREENER.name, now);
    if ("error" in screening) throw new Error(screening.error);
    const result = await runAction(SCREENER, { t: "recordScreening", dealId: deal.id, screening }, { trusted: true });
    if ("error" in result) continue;
    await sendAlerts(result.before, result.after, result.action);
    if (screening.status === "review") flagged++;
  }
  return `list of ${refreshed.names} names${refreshed.changed ? " (updated)" : ""}; screened ${active.length} loans; ${flagged} possible matches`;
}

export const JOBS: Record<string, Job> = { sanctions: checkSanctions, servicing: checkServicing, termSheets: checkTermSheets, insurance: checkInsurance, sessions: purgeSessions, retention: cleanRetention, encryption: sealStoredData };

export const runKeyFor = (job: string, now: Date) => `${job}:${now.toISOString().slice(0, 10)}`;

export async function runJob(job: string, now = new Date()) {
  const fn = JOBS[job];
  if (!fn) throw new Error(`No job named ${job}.`);
  const runKey = runKeyFor(job, now);
  let run;
  try {
    run = await prisma.jobRun.create({ data: { job, runKey } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { job, skipped: true, summary: "already ran today" };
    throw error;
  }
  try {
    const summary = await fn(now);
    await prisma.jobRun.update({ where: { id: run.id }, data: { ok: true, finishedAt: new Date(), summary } });
    return { job, skipped: false, summary };
  } catch (error) {
    // Free today's key so the next call retries, and keep the failure under a separate key.
    const summary = error instanceof Error ? error.message : String(error);
    await prisma.jobRun.update({ where: { id: run.id }, data: { runKey: `${runKey}:failed:${Date.now()}`, finishedAt: new Date(), summary } });
    console.error(`[lendhous-jobs] ${job} failed:`, error);
    return { job, skipped: false, failed: true, summary };
  }
}

export async function runAllJobs(now = new Date()) {
  const results = [];
  for (const job of Object.keys(JOBS)) results.push(await runJob(job, now));
  return results;
}
