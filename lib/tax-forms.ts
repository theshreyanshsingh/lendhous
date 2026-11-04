// Year-end information returns (research Nov 2026: docs/next-features-prompt.md, E). LendHous collects and passes on
// interest for partners and buyers (1099-INT, as the middleman under Treas. Reg. 1.6049-4), pays brokers (1099-NEC),
// and receives interest from individual borrowers (1098). Pure: who gets which form, for how much, and what's missing.
// The thresholds are TAX_CONFIG, for LendHous's CPA to confirm.
import type { Book } from "./book";
import { evaluate, fundedBalances } from "./engine";
import { holdingsOf, splitOf, type Investor } from "./investor-statements";
import type { Deal } from "./mockData";
import { SERVICED } from "./servicing";
import { feeOf } from "./brokers";

/** PLACEHOLDER until the CPA confirms: $10 is section 6049 interest's threshold; $600 may apply to the rest. */
export const TAX_CONFIG = { interestThreshold: 10, brokerFeeThreshold: 2_000, mortgageInterestThreshold: 600, backupWithholdingPct: 24 };

export const CLASSIFICATIONS = {
  individual: "Individual or sole proprietor", c_corp: "C corporation", s_corp: "S corporation", partnership: "Partnership", trust: "Trust or estate",
  llc_c: "LLC taxed as a C corporation", llc_s: "LLC taxed as an S corporation", llc_p: "LLC taxed as a partnership", llc_disregarded: "Single-member LLC (disregarded)", other: "Other",
} as const;
export type Classification = keyof typeof CLASSIFICATIONS;
const CORPORATION: Classification[] = ["c_corp", "s_corp", "llc_c", "llc_s"];

export type W9 = { legalName: string; businessName: string; classification: Classification; tinType: "ssn" | "ein"; tin: string; exemptPayeeCode: string; address: { street: string; city: string; state: string; zip: string } };
export type W8 = { name: string; entity: boolean; country: string; foreignTin: string; address: string };
/** What's on file for a payee: a W-9, a foreign person's W-8BEN or W-8BEN-E, or nothing. */
export type OnFile = { kind: "w9"; form: W9; signedAt: string } | { kind: "w8"; form: W8; signedAt: string; expiresOn: string } | null;

const digits = (text: string) => text.replace(/\D/g, "");

/** Why a W-9 can't be accepted as entered, or null. */
export function w9Problem(form: W9) {
  if (!form.legalName.trim()) return "Enter the name on your tax return.";
  if (!(form.classification in CLASSIFICATIONS)) return "Choose your federal tax classification.";
  if (digits(form.tin).length !== 9) return `Enter your ${form.tinType === "ein" ? "EIN" : "Social Security number"}: 9 digits.`;
  if (form.classification !== "individual" && form.classification !== "llc_disregarded" && form.tinType === "ssn") return "A business taxed as a corporation, partnership or trust gives its EIN.";
  if (!form.address.street.trim() || !form.address.city.trim() || !/^[A-Z]{2}$/.test(form.address.state.trim().toUpperCase()) || !/^\d{5}(-\d{4})?$/.test(form.address.zip.trim())) return "Enter your full US address.";
  return null;
}

/** A W-8BEN lasts until December 31 of the third year after the year it's signed. */
export const w8ExpiresOn = (signedOn: string) => `${Number(signedOn.slice(0, 4)) + 3}-12-31`;
export const maskTin = (tin: string) => { const d = digits(tin); return d.length === 9 ? `•••-••-${d.slice(5)}` : ""; };

/** The next business day on or after a date: a deadline on a weekend moves to Monday. */
const businessDay = (day: string) => { const date = new Date(`${day}T12:00:00Z`); while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };
/** The deadlines for a tax year's forms (filed the next year). */
export const deadlines = (year: number) => ({ recipients: businessDay(`${year + 1}-01-31`), brokerFeesToIrs: businessDay(`${year + 1}-01-31`), paperToIrs: businessDay(`${year + 1}-02-28`), efileToIrs: businessDay(`${year + 1}-03-31`) });

export type FormLine = {
  form: "1099-INT" | "1099-NEC" | "1098";
  payeeType: "partner" | "buyer" | "broker" | "borrower"; payeeId: string; name: string;
  amount: number; loans: string[];
  /** Below the threshold, or an exempt payee: no form, but still listed. */
  due: boolean; reason: string;
  onFile: "w9" | "w8" | "missing" | "not_needed";
  backupWithholding: number;
  /** 1098 only. */
  principal?: number; originated?: string; property?: string;
};

const round2 = (amount: number) => Math.round(amount * 100) / 100;
const inYear = (year: number) => (day: string) => day.startsWith(`${year}-`);
const funded = (deal: Deal) => SERVICED.includes(deal.status) || deal.status === "paid_off";

/** Whether the borrower of record is a person: no entity, or one still to be formed. */
export const individualBorrower = (deal: Deal) => !deal.entityName.trim() || /to be formed/i.test(deal.entityName);

function payeeLine(line: Omit<FormLine, "due" | "reason" | "onFile" | "backupWithholding">, onFile: OnFile, threshold: number, exemptWhen: (form: W9) => boolean): FormLine {
  const status = onFile ? onFile.kind : "missing";
  if (line.amount < threshold) return { ...line, amount: round2(line.amount), due: false, reason: `Under $${threshold.toLocaleString("en-US")}`, onFile: status, backupWithholding: 0 };
  if (onFile?.kind === "w9" && exemptWhen(onFile.form)) return { ...line, amount: round2(line.amount), due: false, reason: `Exempt: ${CLASSIFICATIONS[onFile.form.classification]}`, onFile: status, backupWithholding: 0 };
  if (onFile?.kind === "w8") return { ...line, amount: round2(line.amount), due: false, reason: "Foreign person: Form 1042-S, for the CPA", onFile: status, backupWithholding: 0 };
  return { ...line, amount: round2(line.amount), due: true, reason: onFile ? "Due" : "Due, and no W-9 on file", onFile: status, backupWithholding: onFile ? 0 : round2((line.amount * TAX_CONFIG.backupWithholdingPct) / 100) };
}

/** Every form a tax year calls for, and the near misses, from the book and what each payee has on file. */
export function taxYear(book: Book, year: number, onFile: (type: string, id: string) => OnFile) {
  const counts = inYear(year);
  const investors: Investor[] = [...book.partners.map((partner) => ({ type: "partner" as const, id: partner.id })), ...book.buyers.map((buyer) => ({ type: "buyer" as const, id: buyer.id }))];
  const interest = investors.flatMap((investor) => {
    const held = holdingsOf(book, investor).map((holding) => ({ holding, split: splitOf(holding, counts) })).filter((item) => item.split.payments > 0);
    if (!held.length) return [];
    const name = (investor.type === "partner" ? book.partners : book.buyers).find((item) => item.id === investor.id)?.name ?? investor.id;
    const amount = held.reduce((sum, item) => sum + item.split.interest - item.split.servicingFee, 0);
    // An IRA or tax-exempt organization has an exempt-payee code; corporations are exempt by classification.
    return [payeeLine({ form: "1099-INT", payeeType: investor.type, payeeId: investor.id, name, amount, loans: held.map((item) => item.holding.deal.loanNumber) }, onFile(investor.type, investor.id), TAX_CONFIG.interestThreshold, (form) => CORPORATION.includes(form.classification) || Boolean(form.exemptPayeeCode.trim()))];
  });
  // Each brokerage paid in the year: the fee as recorded paid (lib/brokers.ts), or one not recorded yet at closing. Every
  // broker on a loan counts, with or without a firm record.
  const brokerIds = [...new Set(book.deals.flatMap((deal) => (deal.brokerId ? [deal.brokerId] : [])))];
  const brokerFees = brokerIds.flatMap((brokerId) => {
    const paid = book.deals.filter((deal) => deal.brokerId === brokerId && funded(deal) && counts(deal.brokerFeePaid?.on ?? deal.closingDate) && feeOf(deal).amount > 0);
    if (!paid.length) return [];
    const amount = paid.reduce((sum, deal) => sum + feeOf(deal).amount, 0);
    const broker = { id: brokerId, name: book.brokers.find((item) => item.id === brokerId)?.name ?? "Broker (no firm record)" };
    return [payeeLine({ form: "1099-NEC", payeeType: "broker", payeeId: broker.id, name: broker.name, amount, loans: paid.map((deal) => deal.loanNumber) }, onFile("broker", broker.id), TAX_CONFIG.brokerFeeThreshold, (form) => CORPORATION.includes(form.classification))];
  });
  const mortgageInterest = book.deals.filter((deal) => funded(deal) && individualBorrower(deal)).flatMap((deal): FormLine[] => {
    const rate = evaluate(deal.app).rate;
    const split = splitOf({ deal, share: 1, investorRate: rate, noteRate: rate }, counts);
    if (!split.payments) return [];
    const amount = round2(split.interest);
    const due = amount >= TAX_CONFIG.mortgageInterestThreshold;
    const e = evaluate(deal.app);
    return [{ form: "1098", payeeType: "borrower", payeeId: deal.borrowerId, name: deal.borrowerName, amount, loans: [deal.loanNumber], due, reason: due ? "Due" : `Under $${TAX_CONFIG.mortgageInterestThreshold}`, onFile: "not_needed", backupWithholding: 0, principal: round2(fundedBalances(e, deal.app, deal.disbursedDraws).disbursed), originated: deal.closingDate, property: `${deal.address}, ${deal.city} ${deal.zip}` }];
  });
  const lines = [...interest, ...brokerFees, ...mortgageInterest];
  return { year, deadlines: deadlines(year), lines, due: lines.filter((line) => line.due), missingW9: lines.filter((line) => line.due && line.onFile === "missing") };
}

/** Rows shaped like IRIS's CSV upload, one per form due. Check the columns against IRS's current template before uploading. */
export function irisRows(lines: FormLine[], tins: (line: FormLine) => { tinType: string; tin: string; name: string; street: string; city: string; state: string; zip: string } | null, year: number) {
  return lines.filter((line) => line.due).map((line) => {
    const payee = tins(line);
    const base = { "Form Type": line.form, "Tax Year": year, "Recipient TIN Type": payee?.tinType.toUpperCase() ?? "", "Recipient TIN": payee?.tin ?? "", "Recipient Name": payee?.name ?? line.name, "Recipient Address": payee?.street ?? "", City: payee?.city ?? "", State: payee?.state ?? "", ZIP: payee?.zip ?? "" };
    if (line.form === "1099-INT") return { ...base, "Box 1 Interest Income": line.amount, "Box 4 Federal Income Tax Withheld": line.backupWithholding };
    if (line.form === "1099-NEC") return { ...base, "Box 1 Nonemployee Compensation": line.amount, "Box 4 Federal Income Tax Withheld": line.backupWithholding };
    return { ...base, "Box 1 Mortgage Interest Received": line.amount, "Box 2 Outstanding Mortgage Principal": line.principal ?? 0, "Box 3 Mortgage Origination Date": line.originated ?? "", "Box 8 Property Address": line.property ?? "" };
  });
}
