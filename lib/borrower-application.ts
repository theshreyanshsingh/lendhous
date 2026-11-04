// The borrower application a loan officer sends as a secure link (no sign-in): five steps the borrower can finish over a
// few visits, then four consents and a typed signature. Pure, so the form, the server and the tests read the same rules.
// What goes into the loan book is what underwriting prices on; the private details (birth dates, Social Security numbers,
// home addresses, the EIN) stay sealed with the signed application and never travel with the loan.
import { DECLARATIONS } from "./credit";
import type { AddressValue } from "./places";
import type { Application } from "./engine";
import type { Declarations, Guarantor, Sponsor, TrackDeal } from "./mockData";
import { LOAN_TYPES, PRICED, type LoanType } from "./quote";

export const STEPS = ["Loan & contact", "Property", "Loan details", "Vesting & guarantors", "Review & sign"] as const;
/** How long a link works after it's sent. */
export const LINK_DAYS = 14;

export type DeclarationKey = (typeof DECLARATIONS)[number]["key"];
export type GuarantorInfo = {
  firstName: string; lastName: string; email: string; phone: string; dob: string; fico: string; ssn: string;
  home: AddressValue; twoYears: boolean | null; mailingSame: boolean | null; mailing: AddressValue;
  marital: "" | "married" | "unmarried"; citizenship: "" | Guarantor["citizenship"]; ownershipPct: string;
  answers: Partial<Record<DeclarationKey, boolean>>; occupy: boolean | null; explanation: string;
};
export type AppDraft = {
  contact: { firstName: string; lastName: string; email: string; phone: string };
  loanType: LoanType;
  property: { address: AddressValue; floodZone: "" | "yes" | "no" | "unsure"; propertyType: "" | "sfr" | "2_4" | "condo" | "townhome"; beds: string; baths: string; sqft: string; lotAcres: string; occupancy: "" | "vacant" | "tenant" };
  loan: { purpose: "purchase" | "refinance" | "cash_out"; purchasePrice: string; asIsValue: string; rehab: string; arv: string; requestedAmount: string; plan: string; exit: "" | "sell" | "refinance" | "hold" | "cash"; closeDate: string; monthlyRent: string; taxesAnnual: string; insuranceAnnual: string; liquidity: string };
  vesting: { hasLlc: boolean | null; entityName: string; entityState: string; ein: string; address: AddressValue };
  guarantors: GuarantorInfo[];
  trackRecord: TrackDeal[];
};

const blankAddress = (): AddressValue => ({ street: "", city: "", state: "", zip: "", county: "" });
export const blankGuarantor = (): GuarantorInfo => ({ firstName: "", lastName: "", email: "", phone: "", dob: "", fico: "", ssn: "", home: blankAddress(), twoYears: null, mailingSame: null, mailing: blankAddress(), marital: "", citizenship: "", ownershipPct: "", answers: {}, occupy: null, explanation: "" });
export const blankDraft = (): AppDraft => ({
  contact: { firstName: "", lastName: "", email: "", phone: "" }, loanType: "fix_flip",
  property: { address: blankAddress(), floodZone: "", propertyType: "", beds: "", baths: "", sqft: "", lotAcres: "", occupancy: "" },
  loan: { purpose: "purchase", purchasePrice: "", asIsValue: "", rehab: "", arv: "", requestedAmount: "", plan: "", exit: "", closeDate: "", monthlyRent: "", taxesAnnual: "", insuranceAnnual: "", liquidity: "" },
  vesting: { hasLlc: null, entityName: "", entityState: "FL", ein: "", address: blankAddress() },
  guarantors: [blankGuarantor()], trackRecord: [],
});

/** A new application from a signed-in borrower's portal, starting with what their account already says. */
export function draftForAccount(account: { name: string; email: string; phone?: string | null }) {
  const draft = blankDraft();
  const [firstName = "", ...rest] = account.name.trim().split(/\s+/);
  draft.contact = { firstName, lastName: rest.join(" "), email: account.email, phone: account.phone ?? "" };
  draft.guarantors = [{ ...blankGuarantor(), firstName, lastName: rest.join(" "), email: account.email, phone: account.phone ?? "" }];
  return draft;
}

/**
 * A repeat borrower's next application, from their last signed one: the same contact, entity, guarantors and past deals,
 * with a new property and loan. Social Security numbers, birth dates, credit scores and the declarations are asked again:
 * each application is its own certification, and a score over 90 days old is pulled again anyway.
 */
export function repeatDraft(signed: AppDraft): AppDraft {
  const base = blankDraft();
  return {
    ...base, contact: { ...signed.contact }, loanType: signed.loanType, vesting: { ...signed.vesting, address: { ...signed.vesting.address } },
    guarantors: signed.guarantors.map((g) => ({ ...g, ssn: "", dob: "", fico: "", answers: {}, occupy: null, explanation: "" })),
    trackRecord: signed.trackRecord.map(({ verified: _verified, ...deal }) => deal),
  };
}

/** The same start from a loan with no signed application on file (one the team entered): its entity, guarantors and past deals. */
export function draftFromLoan(deal: import("./mockData").Deal, account: { name: string; email: string; phone?: string | null }): AppDraft {
  const draft = repeatDraft(draftFromDeal(deal, account.email));
  const mine = draftForAccount(account);
  const formed = !/\(LLC to be formed\)$/.test(deal.entityName);
  return { ...draft, contact: mine.contact, vesting: formed ? draft.vesting : { ...draft.vesting, hasLlc: false, entityName: "" }, guarantors: deal.sponsor?.guarantors.length ? draft.guarantors.map((g, at) => (at === 0 ? { ...g, phone: account.phone || g.phone } : g)) : mine.guarantors };
}

/** A saved draft with any part missing filled from a blank one, so an older draft opens in a newer form. */
export function completeDraft(saved: unknown): AppDraft {
  const base = blankDraft();
  if (!saved || typeof saved !== "object") return base;
  const draft = saved as Partial<AppDraft>;
  return {
    contact: { ...base.contact, ...draft.contact }, loanType: draft.loanType && draft.loanType in LOAN_TYPES ? draft.loanType : base.loanType,
    property: { ...base.property, ...draft.property, address: { ...base.property.address, ...draft.property?.address } },
    loan: { ...base.loan, ...draft.loan }, vesting: { ...base.vesting, ...draft.vesting, address: { ...base.vesting.address, ...draft.vesting?.address } },
    guarantors: (draft.guarantors?.length ? draft.guarantors : base.guarantors).slice(0, 4).map((item) => ({ ...blankGuarantor(), ...item, home: { ...blankAddress(), ...item.home }, mailing: { ...blankAddress(), ...item.mailing }, answers: { ...item.answers } })),
    trackRecord: (draft.trackRecord ?? []).slice(0, 40),
  };
}

export const num = (text: string) => { const value = Number(String(text).replace(/[^0-9.]/g, "")); return String(text).trim() === "" || !Number.isFinite(value) ? undefined : value; };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digits = (text: string) => text.replace(/\D/g, "");
const fullAddress = (address: AddressValue) => Boolean(address.street.trim() && address.city.trim() && /^[A-Z]{2}$/.test(address.state) && /^\d{5}/.test(address.zip));
/** A guarantor's age on a day, from a YYYY-MM-DD birth date. */
const ageOn = (dob: string, today: string) => { const [y, m, d] = dob.split("-").map(Number); const [ty, tm, td] = today.split("-").map(Number); return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0); };
const rehabLoan = (type: LoanType) => type === "fix_flip" || type === "ground_up";
const rental = (type: LoanType) => type.startsWith("dscr") || type === "second";

/** What still stops this step, in words for the borrower. Empty when they can go on. */
export function stepProblems(draft: AppDraft, step: number, today: string): string[] {
  const out: string[] = [];
  if (step === 0) {
    const c = draft.contact;
    if (!c.firstName.trim() || !c.lastName.trim()) out.push("Your first and last name.");
    if (!EMAIL.test(c.email.trim())) out.push("An email address we can reach you at.");
    if (digits(c.phone).length < 10) out.push("A phone number with area code.");
  }
  if (step === 1) {
    const p = draft.property;
    if (!fullAddress(p.address)) out.push("The property's full address: street, city, state and ZIP.");
    if (!p.floodZone) out.push("Whether it's in a flood zone (\"I'm not sure\" is fine).");
    if (!p.propertyType) out.push("The property type.");
    if (!p.occupancy) out.push("Whether it's vacant or has a tenant.");
  }
  if (step === 2) {
    const l = draft.loan;
    if (!num(l.purchasePrice)) out.push(l.purpose === "purchase" ? "The purchase price." : "What you paid for it.");
    if (l.purpose !== "purchase" && !num(l.asIsValue)) out.push("What it's worth today.");
    if (rehabLoan(draft.loanType) && num(l.rehab) === undefined) out.push("The renovation or construction budget.");
    if (rehabLoan(draft.loanType) && !num(l.arv)) out.push("The after-repair value (ARV).");
    if (rental(draft.loanType) && !num(l.monthlyRent)) out.push("The monthly rent.");
    if (!l.plan.trim()) out.push("A short description of the plan.");
    if (!l.exit) out.push("Your exit strategy.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.closeDate) || l.closeDate < today) out.push("A closing date from today on.");
  }
  if (step === 3) {
    const v = draft.vesting;
    if (v.hasLlc === null) out.push("Whether you're buying in an LLC.");
    if (v.hasLlc) {
      if (!v.entityName.trim()) out.push("The LLC's name.");
      if (!/^[A-Z]{2}$/.test(v.entityState)) out.push("The state the LLC is registered in.");
      if (v.ein && !/^\d{2}-?\d{7}$/.test(v.ein.trim())) out.push("The EIN as 9 digits (12-3456789), or leave it blank.");
      if (!fullAddress(v.address)) out.push("The LLC's registered address.");
    }
    draft.guarantors.forEach((g, index) => {
      const who = draft.guarantors.length > 1 ? `Guarantor ${index + 1}: ` : "";
      if (!g.firstName.trim() || !g.lastName.trim()) out.push(`${who}first and last name.`);
      if (!EMAIL.test(g.email.trim())) out.push(`${who}email address.`);
      if (digits(g.phone).length < 10) out.push(`${who}phone number.`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(g.dob) || ageOn(g.dob, today) < 18 || ageOn(g.dob, today) > 110) out.push(`${who}date of birth (18 or older).`);
      const fico = num(g.fico);
      if (!fico || fico < 300 || fico > 850) out.push(`${who}estimated credit score, 300 to 850.`);
      if (digits(g.ssn).length !== 9) out.push(`${who}Social Security number, 9 digits.`);
      if (!fullAddress(g.home)) out.push(`${who}home address.`);
      if (g.twoYears === null) out.push(`${who}whether you've lived there 2 years or more.`);
      if (g.mailingSame === null) out.push(`${who}whether mail goes to the home address.`);
      if (g.mailingSame === false && !fullAddress(g.mailing)) out.push(`${who}mailing address.`);
      if (!g.marital) out.push(`${who}marital status.`);
      if (!g.citizenship) out.push(`${who}citizenship.`);
      const own = num(g.ownershipPct);
      if (own === undefined || own < 0 || own > 100) out.push(`${who}ownership of the LLC, 0 to 100%.`);
      if (DECLARATIONS.some((item) => g.answers[item.key] === undefined) || g.occupy === null) out.push(`${who}an answer to every declaration.`);
      if ((DECLARATIONS.some((item) => g.answers[item.key]) || g.occupy) && !g.explanation.trim()) out.push(`${who}an explanation for each yes.`);
    });
    const owned = draft.guarantors.reduce((sum, g) => sum + (num(g.ownershipPct) ?? 0), 0);
    if (owned > 100) out.push("Guarantors' ownership adds up to more than 100%.");
    draft.trackRecord.forEach((deal, index) => { if (!deal.address.trim() || !/^\d{4}-\d{2}$/.test(deal.completed) || !deal.purchasePrice) out.push(`Past deal ${index + 1}: its address, the month it finished and what you paid.`); });
  }
  return out;
}

/** Everything that stops signing: every step's problems, and a home the borrower will live in. */
export function signProblems(draft: AppDraft, today: string) {
  const all = [0, 1, 2, 3].flatMap((step) => stepProblems(draft, step, today));
  if (draft.guarantors.some((g) => g.occupy)) all.unshift("LendHous makes business-purpose loans only. For a home you or your family will live in, please talk to a licensed consumer mortgage lender.");
  return all;
}

/** The consents signed with the application. PLACEHOLDER wording until the attorney approves it; the version is kept with each signature. */
export const CONSENT_VERSION = "2026-11-03-placeholder";

/** How long a portal application keeps after it was last saved. */
export const PORTAL_DAYS = 90;

/** Why an application can't be signed as it stands: something missing, a consent unchecked, or a name that isn't on it. */
export function signatureProblem(draft: AppDraft, consents: Record<ConsentKey, boolean>, signatureName: string, today: string) {
  const problems = signProblems(draft, today);
  if (problems.length) return problems[0];
  if (!CONSENTS.every((item) => consents[item.key] === true)) return "Check each of the four boxes to agree.";
  const signer = signatureName.replace(/\s+/g, " ").trim();
  const names = [draft.contact, ...draft.guarantors].map((person) => `${person.firstName} ${person.lastName}`.replace(/\s+/g, " ").trim().toLowerCase());
  if (!names.includes(signer.toLowerCase())) return "Type your full legal name exactly as you entered it in the application.";
  return null;
}
export const CONSENTS = [
  { key: "application", title: "Loan application acknowledgement and agreement", agree: "I've read and agree to the acknowledgement above, and everything in this application is true and complete as far as I know.", text: [
    "Each person signing, as borrower or guarantor, tells LendHous and anyone it works with on this loan (its lenders, servicers, investors, brokers, attorneys and their successors) that:",
    "1. The loan is for business or investment purposes only. Neither I nor any member of my family will live in the property.",
    "2. The loan will be secured by a mortgage on the property described in this application, and the property won't be used for anything illegal.",
    "3. Nobody at LendHous has made any promise to me about the property's condition or value, and nothing here is a commitment to lend. A loan is offered only by a signed term sheet and closes only on signed loan documents.",
    "4. The information I've given is true and complete. LendHous may rely on it, check it, and keep this application whether or not a loan closes. I'll tell LendHous before closing if anything changes.",
    "5. Knowingly giving false information can lead to civil liability and criminal penalties, including under 18 U.S.C. 1001 and 1014.",
  ] },
  { key: "credit", title: "Authorization for credit and background checks", agree: "I authorize LendHous to get my credit report and run background, identity and sanctions checks for this application.", text: [
    "I authorize LendHous and the lenders and investors it works with on this loan to get consumer credit reports about me and to check my identity, sanctions lists (including the U.S. Treasury's OFAC list), public records, liens, judgments, bankruptcies and criminal history, for the purpose of evaluating this business-purpose loan application and, if it closes, servicing the loan.",
    "I understand these are consumer reports under the Fair Credit Reporting Act, that I'm not required to give this authorization, and that a loan can't be considered without it. On request, LendHous will tell me whether it got a report and the name and address of the agency that provided it.",
  ] },
  { key: "release", title: "Authorization to release information", agree: "I authorize LendHous to get and share the information needed to verify this application through the life of the loan.", text: [
    "I authorize anyone holding information about me, my entity or the property (banks, title companies, employers, insurers, tax authorities and others) to release it to LendHous and the lenders, investors and service providers it works with on this loan, to verify this application and, if the loan closes, for quality control and servicing.",
    "A copy of this authorization is as valid as the original. It stays in effect for the life of the loan unless I revoke it in writing.",
  ] },
  { key: "esign", title: "Consent to electronic signatures and records", agree: "I agree to sign and receive this application and related records electronically.", text: [
    "By checking the box and typing my full legal name, I agree that my electronic signature has the same effect as a handwritten one under the federal ESIGN Act (15 U.S.C. 7001) and Florida's Uniform Electronic Transaction Act.",
    "I agree to receive disclosures, notices and records about this application electronically, by email to the address I gave or in the LendHous portal. To do so I need a current web browser and an email account. I can ask for a paper copy, or withdraw this consent, by writing to my loan officer; withdrawing doesn't undo what was signed before.",
  ] },
] as const;
export type ConsentKey = (typeof CONSENTS)[number]["key"];

const name = (g: { firstName: string; lastName: string }) => `${g.firstName.trim()} ${g.lastName.trim()}`.trim();

/** The application as the loan book needs it: what underwriting prices on, and the borrower's profile. */
export function toLoan(draft: AppDraft) {
  const product = PRICED[draft.loanType] ?? "bridge";
  const l = draft.loan;
  const purchase = num(l.purchasePrice) ?? 0;
  const value = l.purpose === "purchase" ? purchase : num(l.asIsValue) ?? purchase;
  const declarations = Object.fromEntries(DECLARATIONS.map((item) => [item.key, draft.guarantors.some((g) => g.answers[item.key])])) as Omit<Declarations, "explanation">;
  const explanation = draft.guarantors.filter((g) => g.explanation.trim()).map((g) => `${name(g)}: ${g.explanation.trim()}`).join("\n");
  const sponsor: Sponsor = {
    entityState: draft.vesting.hasLlc ? draft.vesting.entityState : "FL",
    guarantors: draft.guarantors.map((g) => ({ name: name(g), ownershipPct: num(g.ownershipPct) ?? 0, fico: num(g.fico) ?? 0, citizenship: g.citizenship || "us" })),
    trackRecord: draft.trackRecord.map(({ verified: _verified, ...deal }) => ({ ...deal, address: deal.address.trim() })),
    declarations: { ...declarations, explanation },
  };
  const app: Application = {
    product, purpose: l.purpose === "purchase" ? "purchase" : l.purpose === "refinance" ? "refi_rt" : "refi_co",
    county: draft.property.address.state === "FL" ? draft.property.address.county || "Other FL" : draft.property.address.county || "Out of state", state: draft.property.address.state,
    propertyType: draft.property.propertyType || "sfr", occupancy: draft.guarantors.some((g) => g.occupy) ? "owner_occupied" : draft.property.occupancy === "tenant" ? "tenant" : "vacant",
    purchasePrice: value, originalPurchasePrice: l.purpose === "purchase" ? undefined : purchase,
    rehab: rehabLoan(draft.loanType) ? num(l.rehab) ?? 0 : 0, arv: rehabLoan(draft.loanType) ? num(l.arv) ?? value : value,
    landValue: product === "ground_up" ? value : undefined, hardCosts: product === "ground_up" ? num(l.rehab) : undefined,
    requestedAmount: num(l.requestedAmount), monthlyRent: num(l.monthlyRent), taxesAnnual: num(l.taxesAnnual), insuranceAnnual: num(l.insuranceAnnual),
    interestReserve: "none", accrual: "full_boat", fico: 0, verifiedDeals: 0, liquidity: num(l.liquidity) ?? 0, valuationSource: "borrower_estimate",
  };
  const borrower = draft.guarantors[0] ? name(draft.guarantors[0]) : name(draft.contact);
  return {
    app, sponsor, borrowerName: borrower || name(draft.contact), email: draft.contact.email.trim().toLowerCase(),
    address: draft.property.address.street.trim(), city: draft.property.address.city.trim(), zip: draft.property.address.zip.trim(),
    entityName: draft.vesting.hasLlc ? draft.vesting.entityName.trim() : `${borrower} (LLC to be formed)`,
    exitStrategy: { sell: "Sell", refinance: "Refi", hold: "Hold", cash: "Pay off in cash", "": "Sell" }[l.exit],
    closingDate: /^\d{4}-\d{2}-\d{2}$/.test(l.closeDate) ? l.closeDate : undefined,
  };
}

/** Masks all but the last four digits of a Social Security number. */
export const maskSsn = (ssn: string) => { const d = digits(ssn); return d.length === 9 ? `•••-••-${d.slice(5)}` : ""; };
/** The draft with every Social Security number masked, for showing to staff without the reveal permission. */
export const withoutSsn = (draft: AppDraft): AppDraft => ({ ...draft, guarantors: draft.guarantors.map((g) => ({ ...g, ssn: maskSsn(g.ssn) })) });
export const loanTypeLabel = (type: LoanType) => LOAN_TYPES[type];

const split = (full: string) => { const parts = full.trim().split(/\s+/); return { firstName: parts.slice(0, -1).join(" ") || parts[0] || "", lastName: parts.length > 1 ? parts[parts.length - 1] : "" }; };
const text = (value: number | undefined) => (value ? value.toLocaleString("en-US") : "");
const PRODUCT_TYPE: Record<string, LoanType> = { fix_flip: "fix_flip", bridge: "bridge", dscr: "dscr", ground_up: "ground_up" };

/** A link's starting point from a quote request: everything the borrower already told us, so they don't type it twice. */
export function draftFromQuote(quote: import("./quote").Quote): AppDraft {
  const draft = blankDraft();
  const type = quote.propertyType === "2_4" || quote.propertyType === "condo" || quote.propertyType === "townhome" || quote.propertyType === "sfr" ? quote.propertyType : "";
  draft.contact = { ...quote.borrower };
  draft.loanType = quote.loanType;
  draft.property = { ...draft.property, address: { ...quote.address }, propertyType: type, beds: quote.beds ? String(quote.beds) : "", baths: quote.baths ? String(quote.baths) : "", sqft: text(quote.sqft) };
  draft.loan = { ...draft.loan, purpose: quote.purpose, purchasePrice: text(quote.purchasePrice), rehab: text(quote.rehab), arv: text(quote.arv), requestedAmount: text(quote.requestedAmount), monthlyRent: text(quote.monthlyRent), closeDate: quote.fundingDate, exit: quote.exit, plan: quote.notes };
  draft.guarantors = [{ ...blankGuarantor(), firstName: quote.borrower.firstName, lastName: quote.borrower.lastName, email: quote.borrower.email, phone: quote.borrower.phone, citizenship: quote.citizenship }];
  return draft;
}

/** From an older website brief, which has less: the name, contact, city and the rough numbers. */
export function draftFromBrief(lead: { name: string; email: string; phone: string; city: string; state: string; propertyValueCents: number; renovationCents: number; requestedLoanCents: number; targetClosing: string; notes: string }): AppDraft {
  const draft = blankDraft();
  const who = split(lead.name);
  draft.contact = { ...who, email: lead.email, phone: lead.phone };
  draft.property.address = { ...draft.property.address, city: lead.city, state: lead.state.trim().toUpperCase().slice(0, 2) };
  draft.loan = { ...draft.loan, purchasePrice: text(lead.propertyValueCents / 100), rehab: text(lead.renovationCents / 100), requestedAmount: text(lead.requestedLoanCents / 100), closeDate: lead.targetClosing, plan: lead.notes };
  draft.guarantors = [{ ...blankGuarantor(), ...who, email: lead.email, phone: lead.phone }];
  return draft;
}

/** From a loan the team already started: its numbers, property and any profile on file. */
export function draftFromDeal(deal: import("./mockData").Deal, email: string): AppDraft {
  const draft = blankDraft();
  const who = split(deal.borrowerName);
  const app = deal.app;
  draft.contact = { ...who, email, phone: "" };
  draft.loanType = PRODUCT_TYPE[app.product] ?? "fix_flip";
  draft.property = { ...draft.property, address: { street: deal.address, city: deal.city, state: app.state, zip: deal.zip, county: app.county }, propertyType: app.propertyType, occupancy: app.occupancy === "tenant" ? "tenant" : app.occupancy === "vacant" ? "vacant" : "" };
  draft.loan = { ...draft.loan, purpose: app.purpose === "purchase" ? "purchase" : app.purpose === "refi_rt" ? "refinance" : "cash_out", purchasePrice: text(app.originalPurchasePrice ?? app.purchasePrice), asIsValue: app.purpose === "purchase" ? "" : text(app.purchasePrice), rehab: text(app.rehab), arv: text(app.arv), requestedAmount: text(app.requestedAmount), monthlyRent: text(app.monthlyRent), taxesAnnual: text(app.taxesAnnual), insuranceAnnual: text(app.insuranceAnnual), liquidity: text(app.liquidity), closeDate: deal.closingDate, exit: deal.exitStrategy === "Refi" ? "refinance" : deal.exitStrategy === "Hold" ? "hold" : "sell" };
  draft.vesting = { ...draft.vesting, hasLlc: deal.entityName ? true : null, entityName: deal.entityName, entityState: deal.sponsor?.entityState ?? "FL" };
  draft.guarantors = deal.sponsor?.guarantors.length
    ? deal.sponsor.guarantors.map((g, index) => ({ ...blankGuarantor(), ...split(g.name), email: index === 0 ? email : "", ownershipPct: String(g.ownershipPct), fico: String(g.fico), citizenship: g.citizenship }))
    : [{ ...blankGuarantor(), ...who, email }];
  draft.trackRecord = deal.sponsor?.trackRecord.map(({ verified: _verified, ...item }) => item) ?? [];
  return draft;
}
