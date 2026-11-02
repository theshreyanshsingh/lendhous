// What a credit officer needs from a borrower before a term sheet: who stands behind the loan, what they've done before,
// and anything in their history that needs a closer look. No database or React here, so the application, the server's
// checks, the staff review and the tests all read the same rules.
import type { Application, Estimate } from "./engine";
import type { Declarations, Doc, Guarantor, Sponsor, TrackDeal } from "./mockData";

/** Asked of the borrower, every guarantor and the borrowing entity. A yes isn't a decline: it means a person reads the file. */
export const DECLARATIONS: { key: Exclude<keyof Declarations, "explanation">; question: string }[] = [
  { key: "bankruptcy", question: "Filed for bankruptcy in the last 4 years?" },
  { key: "foreclosure", question: "Had a foreclosure, short sale or deed in lieu in the last 3 years?" },
  { key: "delinquent", question: "Currently late or in default on any loan or mortgage?" },
  { key: "judgments", question: "Have unpaid judgments, tax liens or collections over $10,000?" },
  { key: "lawsuit", question: "Party to a lawsuit right now?" },
  { key: "felony", question: "Ever been convicted of a felony or of fraud?" },
  { key: "borrowedDownPayment", question: "Borrowing any of the down payment or closing costs?" },
];

export const CITIZENSHIP: Record<Guarantor["citizenship"], string> = { us: "US citizen", resident: "Permanent resident", foreign: "Foreign national" };
export const TRACK_KIND: Record<TrackDeal["kind"], string> = { flip: "Fix and flip", rental: "Rental", build: "New build" };

/** Experience counts what was finished in the last 36 months, the window the application has always asked about. */
export const EXPERIENCE_MONTHS = 36;

export const anyYes = (declarations: Declarations) => DECLARATIONS.some((item) => declarations[item.key]);

/** The score a loan is priced on: the lowest guarantor's, since any of them may end up being the one who repays. */
export const qualifyingFico = (guarantors: Guarantor[]) => (guarantors.length ? Math.min(...guarantors.map((item) => item.fico)) : 0);

const withinWindow = (completed: string, now: Date) => {
  const [year, month] = completed.split("-").map(Number);
  const months = (now.getUTCFullYear() - year) * 12 + (now.getUTCMonth() + 1 - month);
  return months >= 0 && months <= EXPERIENCE_MONTHS;
};

/** Deals that count toward experience: finished in the window, and, when asked for, only those a person has checked. */
export function countedDeals(track: TrackDeal[], now: Date, verifiedOnly = false) {
  const counted = track.filter((item) => withinWindow(item.completed, now) && (!verifiedOnly || item.verified));
  return { deals: counted.length, builds: counted.filter((item) => item.kind === "build").length };
}

/**
 * The application's credit inputs, taken from the people and deals listed rather than from numbers typed in, so nobody
 * prices a loan on experience they haven't listed or a score that isn't anyone's.
 */
export function withSponsor(app: Application, sponsor: Sponsor, now: Date, verifiedOnly = false): Application {
  const experience = countedDeals(sponsor.trackRecord, now, verifiedOnly);
  return { ...app, fico: qualifyingFico(sponsor.guarantors), foreignNational: sponsor.guarantors.some((item) => item.citizenship === "foreign"), verifiedDeals: experience.deals, groundUpBuilds: experience.builds };
}

/** Why this borrower profile can't be accepted yet, or null. */
export function sponsorProblem(sponsor: Sponsor) {
  const named = sponsor.guarantors.filter((item) => item.name.trim());
  if (!named.length) return "Add at least one guarantor.";
  if (named.length !== sponsor.guarantors.length) return "Every guarantor needs a name.";
  if (sponsor.guarantors.some((item) => item.fico < 300 || item.fico > 850)) return "Each guarantor's credit score should be between 300 and 850.";
  const owned = sponsor.guarantors.reduce((sum, item) => sum + item.ownershipPct, 0);
  if (owned > 100) return "Ownership adds up to more than 100%.";
  if (sponsor.trackRecord.some((item) => !item.address.trim() || !/^\d{4}-\d{2}$/.test(item.completed) || item.purchasePrice <= 0)) return "Each past deal needs an address, the month it was finished, and what was paid for it.";
  if (anyYes(sponsor.declarations) && !sponsor.declarations.explanation.trim()) return "Explain the questions you answered yes to.";
  return null;
}

/** What a credit officer should look at closely. Each line says what and why, so the review reads as a checklist. */
export function creditFlags(sponsor: Sponsor | undefined, e: Estimate, now: Date) {
  if (!sponsor) return ["No borrower profile yet: guarantors, track record and declarations are missing"];
  const flags: string[] = [];
  for (const item of DECLARATIONS) if (sponsor.declarations[item.key]) flags.push(`Answered yes: ${item.question.replace(/\?$/, "")}`);
  const owned = sponsor.guarantors.reduce((sum, item) => sum + item.ownershipPct, 0);
  if (owned < 51) flags.push(`Guarantors own only ${owned}% of the borrowing entity; anyone with 20% or more should guarantee`);
  const foreign = sponsor.guarantors.filter((item) => item.citizenship === "foreign");
  if (foreign.length) flags.push(`${foreign.length === 1 ? "A guarantor is a foreign national" : `${foreign.length} guarantors are foreign nationals`}: passport, visa and foreign credit needed`);
  const claimed = countedDeals(sponsor.trackRecord, now).deals;
  const verified = countedDeals(sponsor.trackRecord, now, true).deals;
  if (claimed > verified) flags.push(`${claimed - verified} of ${claimed} past deals not verified yet: check them against settlement statements`);
  for (const flag of e.flags.filter((item) => /liquidity|margin|FICO|ratio is over/i.test(item))) flags.push(flag);
  return flags;
}

const doc = (id: string, name: string, category: string, note: string): Doc => ({ id, name, category, status: "requested", note });

/**
 * The documents this loan needs, from what the application says: the same core list for everyone, then what the loan
 * type, the experience claimed and the answers add. The ids of the core items are the ones the rest of the app knows.
 */
export function needsList(app: Application, sponsor: Sponsor | undefined): Doc[] {
  const docs: Doc[] = [
    doc("id", "Government ID for each guarantor", "Identity", "A driver's license or passport, current and readable."),
    doc("entity", "LLC articles and operating agreement", "Entity", "Shows who owns the borrowing entity and who can sign for it."),
    doc("ein", "EIN letter (IRS CP-575 or 147C)", "Entity", "Confirms the entity's tax number."),
    doc("good-standing", "Certificate of good standing", "Entity", "From the state where the LLC was formed, dated in the last 90 days."),
  ];
  if (app.purpose === "purchase") docs.push(doc("contract", "Purchase contract, signed by both sides", "Property", "With every addendum."));
  else docs.push(doc("payoff", "Payoff letter for the current loan", "Property", "From the lender being paid off."), doc("hud-original", "Settlement statement from when you bought it", "Property", "Shows what was paid and when."));
  if (app.rehab > 0) docs.push(doc("sow", "Scope of work and budget", "Property", "Line by line. You can also fill it in online on this loan."), doc("contractor", "Contractor's license and bid", "Property", "Who is doing the work and what they're charging."));
  if (app.product === "ground_up") docs.push(doc("plans", "Plans and building permit", "Property", "Or the permit application if it hasn't been issued yet."));
  if (app.product === "dscr") docs.push(doc("lease", app.occupancy === "tenant" ? "Current leases" : "Rent estimate or signed lease", "Property", app.occupancy === "tenant" ? "Every lease in place, signed." : "A lease if you have one; otherwise the appraisal's market rent is used."));
  docs.push(doc("bank", "Bank statements, 2 most recent months", "Liquidity", "Every page, showing the cash to close and reserves."));
  if (sponsor && sponsor.trackRecord.length) docs.push(doc("track", "Settlement statements for your past deals", "Experience", "One for each deal you listed, so your experience can be confirmed."));
  if (sponsor?.guarantors.some((item) => item.citizenship === "foreign")) docs.push(doc("foreign", "Passport, visa and foreign credit report", "Identity", "For each foreign national guarantor."));
  if (sponsor && anyYes(sponsor.declarations)) docs.push(doc("explanation", "Letter of explanation", "Credit", "In your own words: what happened and where it stands now."));
  docs.push(doc("insurance", "Insurance quote or binder", "Closing", "Naming LendHous as mortgagee. Needed before closing."));
  return docs;
}

/** Items a newer profile adds to a loan's list, without touching what's already been uploaded or decided. */
export const missingDocs = (current: Doc[], app: Application, sponsor: Sponsor) => needsList(app, sponsor).filter((item) => !current.some((have) => have.id === item.id));

export const emptyDeclarations = (): Declarations => ({ bankruptcy: false, foreclosure: false, delinquent: false, judgments: false, lawsuit: false, felony: false, borrowedDownPayment: false, explanation: "" });
