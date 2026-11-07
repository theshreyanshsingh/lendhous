// Draw protections under Florida's construction lien law (Fla. Stat. ch. 713). Before construction money goes out the
// lender records the Notice of Commencement (713.13(7)), after its mortgage so lien claims can't come ahead of it
// (713.07), and it lapses if work doesn't start within 90 days or once a year passes (713.13(2), (6)). Subcontractors and
// suppliers not hired by the borrower serve notices to owner (713.06(2)); each draw then needs a statutory lien waiver
// from the contractor and every one of them (713.20), and the last one final waivers and the contractor's final payment
// affidavit (713.06(3)(d)). No policy on the building, or any lapsed policy (lib/insurance.ts), stops draws too. An owner can release past these
// holds with a reason. The reducer, the access rules and the screens all ask these, so they can't disagree.
import { insuranceHold } from "./insurance";
import type { Deal, DrawRequest, LienFile, LienWaiver } from "./mockData";
import { addDays } from "./servicing";

/** Days after recording the notice in which work has to start, or the notice is void (713.13(2)). */
export const NOC_START_DAYS = 90;
export const LIENOR_ROLES: Record<"subcontractor" | "supplier" | "sub_subcontractor" | "other", string> = { subcontractor: "Subcontractor", supplier: "Supplier", sub_subcontractor: "Sub-subcontractor", other: "Other lienor" };
/** The default end of a Notice of Commencement: a year after it's recorded (713.13(6)). */
export const defaultNocExpiry = (recordedOn: string) => { const [year, month, day] = recordedOn.split("-").map(Number); return new Date(Date.UTC(year + 1, month - 1, day)).toISOString().slice(0, 10); };

const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** When the mortgage was recorded: from the title company's link, or entered with the lien file. */
export const mortgageRecordedOn = (deal: Pick<Deal, "closing" | "lienFile">) => deal.closing?.recording?.on ?? deal.lienFile?.mortgageRecordedOn;

/** What's wrong with the Notice of Commencement for paying out construction money today. Empty when it's sound. */
export function nocProblems(deal: Pick<Deal, "closing" | "lienFile">, today: string) {
  const noc = deal.lienFile?.noc;
  if (!noc) return ["No Notice of Commencement is on file. LendHous has to record it before construction money goes out (Fla. Stat. 713.13(7))."];
  const problems: string[] = [];
  if (!noc.lenderNamed) problems.push("The Notice of Commencement has to name LendHous as the lender and to get copies of notices to owner (713.13(1), (7)).");
  const mortgage = mortgageRecordedOn(deal);
  if (!mortgage) problems.push("The mortgage's recording date isn't on file, so its priority over lien claims can't be checked.");
  else if (noc.recordedOn < mortgage) problems.push(`The Notice of Commencement was recorded on ${longDay(noc.recordedOn)}, before the mortgage (${longDay(mortgage)}), so lien claims can come ahead of the mortgage (713.07). Ask the attorney.`);
  else if (noc.recordedOn === mortgage && !noc.mortgageFirst) problems.push("The notice and the mortgage were recorded the same day. Check the official records show the mortgage first, then confirm it.");
  if (today > noc.expiresOn) problems.push(`The Notice of Commencement expired on ${longDay(noc.expiresOn)}. Record an amended one (713.13(6)).`);
  const startBy = addDays(noc.recordedOn, NOC_START_DAYS);
  if (noc.commencedOn ? noc.commencedOn > startBy : today > startBy) problems.push(`Work didn't start within ${NOC_START_DAYS} days of recording, so the notice is void (713.13(2)). Record a new one.`);
  else if (noc.commencedOn && noc.commencedOn < noc.recordedOn) problems.push("Work started before the notice was recorded (713.13(1)). Ask the attorney before paying anything out.");
  return problems;
}

/** The holdback left before this draw. */
const holdbackLeft = (deal: Pick<Deal, "scope">) => (deal.scope ?? []).reduce((sum, line) => sum + line.budget - line.released, 0);
/** The last draw: marked so, or one that uses up what's left of the holdback. */
export const isFinalDraw = (deal: Pick<Deal, "scope">, draw: DrawRequest) => Boolean(draw.final) || (draw.approved !== undefined && draw.approved + 0.5 >= holdbackLeft(deal));

export type Party = { key: string; name: string };
/** Who has to waive their lien rights for a draw paid on a day: the contractor, and every lienor whose notice came before it. */
export function partiesFor(lien: LienFile | undefined, onDay: string): Party[] {
  if (!lien) return [];
  return [...(lien.contractor ? [{ key: "contractor", name: lien.contractor }] : []), ...lien.notices.filter((item) => item.servedOn <= onDay).map((item) => ({ key: item.id, name: item.lienor }))];
}

/** The waiver from a party that counts for this draw: the right kind, checked, not rejected. */
export const waiverFrom = (draw: DrawRequest, key: string, kind: LienWaiver["kind"]) => draw.waivers?.find((item) => item.partyKey === key && item.kind === kind && item.checked && !item.rejected);

/** Everything that holds a draw's release under the lien law and insurance. Empty when it can go. */
export function drawHolds(deal: Deal, draw: DrawRequest, today: string) {
  const holds = [...nocProblems(deal, today)];
  const insurance = insuranceHold(deal, today);
  if (insurance) holds.push(insurance);
  if (!deal.lienFile?.contractor) holds.push("The contractor isn't on file, so its lien waiver can't be checked.");
  const kind = isFinalDraw(deal, draw) ? "final" : "progress";
  for (const party of partiesFor(deal.lienFile, today)) if (!waiverFrom(draw, party.key, kind)) holds.push(`${party.name}'s ${kind} lien waiver (Fla. Stat. 713.20) isn't checked yet.`);
  if (kind === "final") {
    if (!draw.affidavit?.checked) holds.push("The contractor's final payment affidavit (713.06(3)(d)) isn't checked yet.");
    else if (draw.affidavit.checked.unpaidLienors) holds.push("The contractor's affidavit lists lienors who haven't been paid in full. They're paid before the final draw (713.06(3)(d)).");
  }
  return holds;
}

/** What still holds the release: the holds an owner hasn't released it past. */
export const unreleasedHolds = (deal: Deal, draw: DrawRequest, today: string) => drawHolds(deal, draw, today).filter((hold) => !draw.override?.holds.includes(hold));

/** Why a lien waiver can't be checked as given, or null. A waiver can't cover work not done yet (713.20(2)). */
export function waiverCheckProblem(waiver: LienWaiver | undefined, amount: number, throughOn: string | undefined, today: string) {
  if (!waiver) return "That waiver is no longer on this draw.";
  if (waiver.checked || waiver.rejected) return "It's already been looked at.";
  if (!(amount > 0)) return "Enter the amount it's for.";
  if (waiver.kind === "progress" && (!throughOn || !/^\d{4}-\d{2}-\d{2}$/.test(throughOn))) return "Enter the date it covers work through.";
  if (throughOn && throughOn > today) return "A waiver can't cover work after today (Fla. Stat. 713.20(2)).";
  return null;
}

/** Why the lien file can't be saved as entered, or null. */
export function lienFileProblem(input: { contractor: string; noc?: { recordedOn: string; expiresOn: string; commencedOn?: string } }, today: string) {
  if (!input.contractor.trim()) return "Add the contractor.";
  const noc = input.noc;
  if (!noc) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(noc.recordedOn) || noc.recordedOn > today) return "Enter the day the notice was recorded, today or earlier.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(noc.expiresOn) || noc.expiresOn <= noc.recordedOn) return "The notice ends after it was recorded.";
  if (noc.commencedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(noc.commencedOn) || noc.commencedOn > today)) return "Enter the day work started, today or earlier.";
  return null;
}
