// Stopping construction advances, Florida's way (Fla. Stat. 713.3471; PLACEHOLDER until the attorney confirms the
// wording and who must be told). A lender that stops making advances before the work is done must tell the contractor,
// and each lienor who served it a notice to owner, in writing, within 5 business days. Until advances start again, no
// draw goes out. Pure, so the loan page, the draw desk, the work queue and the alerts agree.
import { evaluate } from "./engine";
import { LIENOR_ROLES, unreleasedHolds } from "./lien-law";
import type { AdvanceStop, Deal, DrawRequest } from "./mockData";
import { isBusinessDay } from "./sla";
import { addDays } from "./servicing";
import { holdbackLeft } from "./budget";

/** PLACEHOLDER (713.3471): business days to send the notice after advances stop. */
export const STOP_NOTICE_BUSINESS_DAYS = 5;
export const STOP_REASONS = { default: "The loan is in default", stalled: "The work has stopped", storm: "Storm damage to the property", budget: "The budget is short of what the work needs", other: "Something else" } as const;
export type StopReason = keyof typeof STOP_REASONS;
export const NOTICE_METHODS = { mail: "Certified mail", hand: "Hand delivery", email: "Email (with a copy by mail)" } as const;
export type NoticeMethod = keyof typeof NOTICE_METHODS;

const ADVANCING = ["funded", "servicing_current", "servicing_delinquent", "matured", "default"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A funded rehab or construction loan with holdback still to advance: the kind whose advances can stop. */
export const advancing = (deal: Deal) => ADVANCING.includes(deal.status) && evaluate(deal.app).holdback > 0 && holdbackLeft(deal) > 0.5;
/** The stop in force, if advances are stopped now. */
export const openStop = (deal: Pick<Deal, "advanceStops">): AdvanceStop | undefined => { const last = deal.advanceStops?.at(-1); return last && !last.resumed ? last : undefined; };

/** A typed reason, ready to end a sentence the app adds its own full stop to. */
export const clause = (text: string) => text.trim().replace(/[.!?;,]+$/, "");

/** Who must be told: the contractor, and every lienor who served the lender a notice to owner. */
export function stopRecipients(deal: Pick<Deal, "lienFile">) {
  const people: { key: string; name: string; role: string }[] = [];
  if (deal.lienFile?.contractor) people.push({ key: "contractor", name: deal.lienFile.contractor, role: "Contractor" });
  for (const notice of deal.lienFile?.notices ?? []) people.push({ key: notice.id, name: notice.lienor, role: LIENOR_ROLES[notice.role] });
  return people;
}

/** The last day the notice can go: 5 Florida business days after the day advances stopped. */
export function noticeDueOn(stoppedOn: string) {
  let day = stoppedOn;
  for (let counted = 0; counted < STOP_NOTICE_BUSINESS_DAYS;) { day = addDays(day, 1); if (isBusinessDay(day)) counted++; }
  return day;
}

/** Whom the open stop still has to tell, and by when. Null when advances aren't stopped. */
export function noticeStatus(deal: Deal, today: string) {
  const stop = openStop(deal);
  if (!stop) return null;
  const due = noticeDueOn(stop.on);
  const missing = stopRecipients(deal).filter((person) => !stop.notices.some((notice) => notice.key === person.key));
  return { stop, due, missing, late: missing.length > 0 && today > due };
}

/** Why no draw goes out while advances are stopped, or null. */
export const stopHold = (deal: Deal) => { const stop = openStop(deal); return stop ? `Advances are stopped since ${stop.on} (${STOP_REASONS[stop.reason].toLowerCase()}): no draw goes out until they start again.` : null; };

/** What holds a draw's release: a stop first, which no owner can release a draw past, then the lien law's and insurance's holds. */
export const releaseHolds = (deal: Deal, draw: DrawRequest, today: string) => { const stopped = stopHold(deal); return [...(stopped ? [stopped] : []), ...unreleasedHolds(deal, draw, today)]; };

/** Why advances can't be stopped this way, or null. */
export function stopProblem(deal: Deal, on: string, reason: string, note: string, today: string) {
  if (!advancing(deal)) return "Only a funded rehab or construction loan with holdback left has advances to stop.";
  if (openStop(deal)) return "Advances are already stopped.";
  if (!DAY.test(on) || on > today) return "Choose the day advances stopped, today or earlier.";
  if (!(reason in STOP_REASONS)) return "Choose why.";
  if (reason === "other" && !note.trim()) return "Say why advances are stopping.";
  return null;
}

/** Why this notice can't be recorded as sent, or null. */
export function sentProblem(deal: Deal, key: string, sentOn: string, method: string, today: string) {
  const stop = openStop(deal);
  if (!stop) return "Advances aren't stopped.";
  if (!stopRecipients(deal).some((person) => person.key === key)) return "That person isn't owed this notice.";
  if (stop.notices.some((notice) => notice.key === key)) return "That notice is already recorded.";
  if (!DAY.test(sentOn) || sentOn < stop.on || sentOn > today) return "Enter the day it was sent: on or after the stop, and not in the future.";
  if (!(method in NOTICE_METHODS)) return "Choose how it was sent.";
  return null;
}

/** Why advances can't start again, or null. */
export function resumeProblem(deal: Deal, on: string, note: string, today: string) {
  const stop = openStop(deal);
  if (!stop) return "Advances aren't stopped.";
  if (!DAY.test(on) || on < stop.on || on > today) return "Choose the day advances start again: on or after the stop, and not in the future.";
  if (!note.trim()) return "Say what changed.";
  return null;
}

const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The notice itself, for one recipient. PLACEHOLDER wording until the attorney approves it. */
export function stopNoticeText(deal: Deal, recipient: { name: string; role: string }, stop: AdvanceStop, lender = "LendHous") {
  return [
    `Notice that construction loan advances have stopped (Fla. Stat. 713.3471)`,
    `To: ${recipient.name} (${recipient.role.toLowerCase()})`,
    `Property: ${deal.address}, ${deal.city}, Florida ${deal.zip}`,
    `Owner: ${deal.entityName || deal.borrowerName}`,
    `Loan: ${deal.loanNumber}`,
    `${lender}, the construction lender on this property, stopped making advances under its loan on ${longDay(stop.on)}, before the improvements were finished. No further advances will be made unless and until ${lender} notifies you that they have resumed.`,
    `You are receiving this notice as the contractor, or as a lienor who served ${lender} with a notice to owner. It does not waive any right you may have under Part I of Chapter 713, Florida Statutes.`,
    `${lender} · Sent ${STOP_NOTICE_BUSINESS_DAYS} business days or less after advances stopped.`,
  ].join("\n\n");
}
