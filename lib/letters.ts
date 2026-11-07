// Pre-approval and proof-of-funds letters (Spec 12.3) for repeat borrowers and GT's wholesale and realty clients. Pure:
// what a letter says, whether it can go out, and whether it still stands. A seller checks one on the public verify
// page its QR code opens, which shows only that it's valid, whom it's for, the limits and the expiry.
import type { Product } from "./engine";

/** "pre_qualification": a broker's own letter, within the limit an owner set for the brokerage (lib/broker-program.ts). */
export type LetterKind = "pre_approval" | "proof_of_funds" | "pre_qualification";
export const LETTER_KIND: Record<LetterKind, string> = { pre_approval: "Pre-approval", proof_of_funds: "Proof of funds", pre_qualification: "Pre-qualification" };
/** The kinds LendHous's own team issues. */
export const STAFF_LETTER_KINDS: LetterKind[] = ["pre_approval", "proof_of_funds"];

/** Most letters a seller sees are under 30 days old; 90 is the longest a lender commonly gives. */
export const LETTER_DAYS = { default: 30, min: 7, max: 90 };

/** PLACEHOLDER wording until the attorney sets it. Each letter starts with these and staff can add their own. */
export const DEFAULT_CONDITIONS = [
  "A satisfactory appraisal or valuation of the property",
  "Clear, insurable title and a title commitment",
  "Final underwriting, including credit, background and OFAC checks on each guarantor",
  "The borrowing entity's documents and good standing",
  "No material change in the borrower's finances before closing",
];

/** PLACEHOLDER: the attorney's wording. It's what keeps a letter from being a promise to lend. */
export const LETTER_DISCLAIMER = [
  "This letter is not a commitment to lend. Any loan is subject to the conditions above, LendHous's underwriting and approval, and loan documents acceptable to LendHous.",
  "For business-purpose loans only, secured by investment property that no borrower, guarantor or family member will live in.",
];

export type LetterDetails = {
  kind: LetterKind;
  name: string; email: string; entityName: string;
  product: Product;
  maxPurchasePrice: number; maxLoan: number;
  /** Set for a letter about one property; empty for a general one. */
  propertyAddress: string;
  conditions: string[];
  validDays: number;
  /** The brokerage that issued a pre-qualification letter through LendHous. */
  brokerName?: string;
};

/** Why a letter can't go out as entered, or null. */
export function letterProblem(details: LetterDetails) {
  if (!details.name.trim()) return "Who is it for? Enter the borrower's name.";
  if (details.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email.trim())) return "That email address doesn't look right.";
  if (!(details.maxPurchasePrice > 0) || details.maxPurchasePrice > 50_000_000) return "Enter the most they can pay for a property.";
  if (!(details.maxLoan > 0) || details.maxLoan > 25_000_000) return "Enter the most LendHous would lend.";
  if (!Number.isInteger(details.validDays) || details.validDays < LETTER_DAYS.min || details.validDays > LETTER_DAYS.max) return `A letter lasts ${LETTER_DAYS.min} to ${LETTER_DAYS.max} days.`;
  if (!details.conditions.some((item) => item.trim())) return "List at least one condition.";
  return null;
}

export type LetterState = "valid" | "expired" | "revoked";
export const letterState = (letter: { expiresOn: string; revokedAt?: string | Date | null }, today: string): LetterState => (letter.revokedAt ? "revoked" : today > letter.expiresOn ? "expired" : "valid");

/** The day a letter issued today stops standing. */
export const expiryFor = (today: string, days: number) => { const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };

/** The printed number: PA-2026-0001 for a pre-approval, PF- for proof of funds, PQ- for a broker's pre-qualification. */
export const letterNumber = (kind: LetterKind, year: string, sequence: number) => `${kind === "pre_approval" ? "PA" : kind === "pre_qualification" ? "PQ" : "PF"}-${year}-${String(sequence).padStart(4, "0")}`;
