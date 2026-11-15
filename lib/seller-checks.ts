// Checks against someone posing as the owner to sell a property they don't own (docs/competitor-gaps-2026-11-09.md,
// rank 8). In ALTA's 2026 survey 59% of title companies saw an attempt, up from 28% in 2024, and 82% named vacant land
// as the main target: a lot owned free and clear by someone who lives elsewhere, sold through a notary the "seller"
// picked, to a buyer told to hurry. A ground-up loan starts with a lot. So on a purchase of land, or of anything whose
// owner lives elsewhere and owes nothing on it, the title company has to confirm it checked the seller's identity
// without relying on contact details the seller gave, before the loan funds. Pure, so every screen and the server agree.
import type { Deal, SellerContact, SellerFile, SellerIdMethod, SellerNotary } from "./mockData";
import { addDays } from "./servicing";

export const CONTACT: Record<SellerContact, string> = {
  in_person: "Met in person",
  video: "On a video call, face to face",
  phone: "By phone, at a number found independently",
  written_only: "Only by email or text",
  none: "Nobody has reached them",
};
export const NOTARY: Record<SellerNotary, string> = {
  title_company: "The title company's own closer or notary",
  online_notary: "An online notary the title company arranged",
  seller_chosen: "A notary the seller chose, or signing by mail",
  unknown: "Not known yet",
};
export const ID_METHODS: Record<SellerIdMethod, string> = {
  in_person_id: "Met the seller in person and checked a government photo ID",
  id_and_selfie: "A government ID check matched to a live selfie, through an identity service",
  online_notary: "Remote online notarization with the ID check and identity questions Florida requires",
};
/** A method as the end of a sentence: only its first letter lowered, so "ID" stays "ID". */
export const methodWords = (method: SellerIdMethod) => ID_METHODS[method].charAt(0).toLowerCase() + ID_METHODS[method].slice(1);
/** What a processor watches for on any sale, whatever the loan. */
export const RED_FLAGS = [
  "The seller wants to use their own notary or sign by mail, away from the title company.",
  "The seller won't do a video call or meet, and talks only by email or text.",
  "The price is well below what the property is worth, or the seller wants a quick, all-cash sale.",
  "The money is to go to an account that isn't in the seller's name, or the instructions change late.",
  "The owner's tax bill goes to a different state or country, and the lot has no mortgage.",
  "The seller's ID, phone or email doesn't match the owner in the county's records.",
];

/** Long-held lots draw impersonators: the real owner rarely checks on them. */
export const LONG_HELD_YEARS = 10;
/** PLACEHOLDER: a price this far below the appraised or land value is flagged. */
export const BELOW_VALUE = 0.25;

/** The collateral is a lot: a ground-up loan buys or refinances land. */
export const vacantLand = (deal: Pick<Deal, "app">) => deal.app.product === "ground_up";

/** Whether the seller's identity has to be checked independently before this loan funds. */
export function sellerCheckNeeded(deal: Pick<Deal, "app" | "seller">) {
  if (deal.app.purpose !== "purchase") return false;
  return vacantLand(deal) || Boolean(deal.seller?.absentee && deal.seller.freeAndClear);
}

export type SellerFlag = { level: "stop" | "warn" | "note"; text: string };

/** What on this purchase looks like seller fraud, worst first. */
export function sellerFlags(deal: Pick<Deal, "app" | "seller" | "closing">, today: string): SellerFlag[] {
  if (deal.app.purpose !== "purchase") return [];
  const seller = deal.seller;
  const flags: SellerFlag[] = [];
  if (seller?.rollLetter?.answer === "denied") flags.push({ level: "stop", text: "The owner at the tax roll's address says they aren't selling. Stop the closing and call the title company." });
  if (seller?.proceeds === "other_account") flags.push({ level: "warn", text: "The seller's money is to go to an account that isn't in the seller's name." });
  if (seller?.notary === "seller_chosen") flags.push({ level: "warn", text: "The seller picked their own notary, or is signing by mail away from the title company." });
  if (seller && (seller.contact === "written_only" || seller.contact === "none")) flags.push({ level: "warn", text: seller.contact === "none" ? "Nobody has reached the seller." : "Nobody has seen or spoken with the seller: email and texts only." });
  if (seller?.rushed) flags.push({ level: "warn", text: "The seller is pressing for a fast close or an all-cash buyer." });
  const value = Math.max(deal.app.appraisedAsIs ?? 0, deal.app.landValue ?? 0);
  if (value > 0 && deal.app.purchasePrice > 0 && deal.app.purchasePrice < value * (1 - BELOW_VALUE)) flags.push({ level: "warn", text: `The price is ${Math.round((1 - deal.app.purchasePrice / value) * 100)}% below the ${deal.app.appraisedAsIs && deal.app.appraisedAsIs >= (deal.app.landValue ?? 0) ? "appraised" : "land"} value.` });
  if (vacantLand(deal)) flags.push({ level: "note", text: "Vacant land: the kind of sale seller impersonators target most." });
  if (seller?.absentee) flags.push({ level: "note", text: "The owner's tax bill goes to an address other than the property." });
  if (seller?.freeAndClear) flags.push({ level: "note", text: "No mortgage on record, so no lender's payoff vouches for the owner." });
  if (seller?.ownedSince && addDays(seller.ownedSince, LONG_HELD_YEARS * 365) <= today) flags.push({ level: "note", text: `Owned since ${seller.ownedSince.slice(0, 4)}: owners of long-held property rarely notice a fake sale.` });
  if (seller?.rollLetter && !seller.rollLetter.answer) flags.push({ level: "note", text: `A letter went to the tax roll's address on ${seller.rollLetter.sentOn}, with no answer yet.` });
  return [...flags.filter((flag) => flag.level === "stop"), ...flags.filter((flag) => flag.level === "warn"), ...flags.filter((flag) => flag.level === "note")];
}

/** What stops this loan funding on the seller's account. Empty when nothing does. */
export function sellerBlockers(deal: Pick<Deal, "app" | "seller" | "closing">) {
  const blockers: string[] = [];
  if (deal.seller?.rollLetter?.answer === "denied") blockers.push("The owner at the tax roll's address says they aren't selling (Fraud checks)");
  if (sellerCheckNeeded(deal) && !deal.closing?.sellerVerified) blockers.push(`The title company hasn't confirmed it checked the seller's identity independently${vacantLand(deal) ? " (vacant land)" : ""} (Closing tab)`);
  return blockers;
}

export type SellerInput = Omit<SellerFile, "by" | "at">;

/** Why the seller can't be saved as entered, or null. */
export function sellerProblem(deal: Pick<Deal, "app"> | undefined, input: SellerInput, today: string) {
  if (!deal) return "That loan no longer exists.";
  if (deal.app.purpose !== "purchase") return "A seller is only on a purchase.";
  if (!input.name.trim()) return "Add the seller's name as the tax roll and deed show it.";
  if (!(input.contact in CONTACT) || !(input.notary in NOTARY) || !["own_account", "other_account", "unknown"].includes(input.proceeds)) return "Choose an answer for each question.";
  if (input.ownedSince && (!/^\d{4}-\d{2}-\d{2}$/.test(input.ownedSince) || input.ownedSince > today)) return "Enter the day the seller took title, today or earlier.";
  const letter = input.rollLetter;
  if (letter) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(letter.sentOn) || letter.sentOn > today) return "Enter the day the letter went out, today or earlier.";
    if (letter.answer && !["confirmed", "denied"].includes(letter.answer)) return "Choose what the owner said.";
    if (letter.answeredOn && (letter.answeredOn < letter.sentOn || letter.answeredOn > today)) return "The owner's answer comes after the letter and no later than today.";
  }
  return null;
}

/** Why the seller's identity can't be confirmed this way, or null. Only before the loan funds. */
export function verifySellerProblem(deal: Pick<Deal, "app" | "status" | "closing"> | undefined, method: string, preFunding: string[]) {
  if (!deal) return "That loan no longer exists.";
  if (deal.app.purpose !== "purchase") return "There's no seller on a refinance.";
  if (!preFunding.includes(deal.status)) return "The loan has already funded.";
  if (!deal.closing?.company) return "Save the closing agent first.";
  if (!(method in ID_METHODS)) return "Choose how the seller's identity was checked.";
  return null;
}
