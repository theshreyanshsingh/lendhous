// Conditions (Spec A10, B17, A23): what has to happen before the loan documents are drawn, before funding, and after
// closing. Each has an owner, a due date and a status: open, submitted (a file came in), cleared, or waived, which takes
// its own permission and a reason. Loans get the library's standard conditions for their product when they start
// clearing conditions, and can't clear to close with a prior-to-docs or prior-to-funding one still open. The reducer,
// the access rules and the screens all ask these, so the button a screen offers and the rule the server applies can't
// disagree.
import type { Product } from "./engine";
import type { ConditionCategory, ConditionOwner, ConditionTemplate, Deal, LoanCondition } from "./mockData";
import { addDays } from "./servicing";

export const CATEGORIES: Record<ConditionCategory, string> = { prior_to_docs: "Prior to loan documents", prior_to_funding: "Prior to funding", post_closing: "After closing" };
export const OWNERS: Record<ConditionOwner, string> = { borrower: "Borrower", processor: "Processor", underwriter: "Underwriter", title: "Title company" };
export const CONDITION_STATUS: Record<LoanCondition["status"], string> = { open: "Open", submitted: "Submitted", cleared: "Cleared", waived: "Waived" };
const PRODUCTS: Product[] = ["fix_flip", "bridge", "ground_up", "dscr"];

const standard = (id: string, title: string, detail: string, category: ConditionCategory, owner: ConditionOwner, needsUpload: boolean, products: Product[] = [], dueDays = category === "post_closing" ? 60 : 10): ConditionTemplate => ({ id, title, detail, category, owner, needsUpload, products, dueDays, active: true, version: 1, updatedBy: "LendHous", updatedAt: "2026-11-04T00:00:00Z" });

/**
 * PLACEHOLDER standard conditions until GT and the attorney set the real list: the library starts with these, and the
 * owner edits it on the Conditions library page.
 */
export const DEFAULT_LIBRARY: ConditionTemplate[] = [
  standard("std-entity", "Company documents", "Articles of organization, the operating agreement, and a certificate of good standing from Sunbiz.", "prior_to_docs", "borrower", true),
  standard("std-valuation", "Valuation supports the loan", "The appraisal or BPO is in and supports the value the loan was sized on.", "prior_to_docs", "underwriter", false),
  standard("std-title", "Title commitment reviewed", "The commitment's requirements are listed for closing and nothing on it stops the loan.", "prior_to_docs", "processor", false),
  standard("std-budget", "Scope of work and budget approved", "The rehab or construction budget is reviewed against the scope and the after-repair value.", "prior_to_docs", "underwriter", false, ["fix_flip", "ground_up"]),
  { ...standard("std-lease", "Leases or rent roll", "Signed leases for occupied units, or a rent roll with the market rent for vacant ones.", "prior_to_docs", "borrower", true, ["dscr"]), rental: "long_term" },
  // Short-term rentals in Florida (PLACEHOLDER until the attorney confirms): the state's vacation rental license, any local
  // registration, association rules that allow stays under 30 days, and income that supports the loan.
  { ...standard("std-str-income", "Short-term rental income supports the loan", "The payout statements for the last 12 months, or the projection for a property without them, support the income the loan was sized on.", "prior_to_docs", "underwriter", false, ["dscr"]), rental: "short_term" },
  { ...standard("std-str-hoa", "Association rules allow short-term rentals", "The HOA or condo declaration and rules allow rentals shorter than 30 days, with any minimum stay or yearly limit noted. A copy, or a letter from the association.", "prior_to_docs", "borrower", true, ["dscr"]), rental: "short_term" },
  { ...standard("std-str-license", "Vacation rental license", "The property's Florida vacation rental license from DBPR (Fla. Stat. 509.241), or proof it's been applied for.", "prior_to_funding", "borrower", true, ["dscr"]), rental: "short_term" },
  { ...standard("std-str-local", "Local rental registration and tourist tax", "The city's or county's short-term rental registration where it requires one, and the county tourist development tax and Florida sales tax accounts.", "prior_to_funding", "borrower", true, ["dscr"]), rental: "short_term" },
  standard("std-insurance", "Insurance naming LendHous", "A binder for the property's insurance, with LendHous as mortgagee and loss payee.", "prior_to_funding", "borrower", true),
  standard("std-builders-risk", "Builder's risk insurance", "A builder's risk policy covering the construction, with LendHous as loss payee.", "prior_to_funding", "borrower", true, ["ground_up"]),
  standard("std-funds", "Funds to close", "A current bank statement showing the cash to close and the reserves.", "prior_to_funding", "borrower", true),
  standard("std-guaranty", "Guaranty signed", "Each guarantor's signed personal guaranty is in.", "prior_to_funding", "processor", false),
  standard("std-final-policy", "Final title policy", "The final lender's title policy is received and matches the commitment.", "post_closing", "title", false),
];

/** The library as it stands: the one saved for this account, or the starting one until someone edits it. */
export const libraryOf = (book: { conditionLibrary?: ConditionTemplate[] }) => (book.conditionLibrary?.length ? book.conditionLibrary : DEFAULT_LIBRARY);

/** The active standard conditions for a loan: its product's, and a rental's only for the way it's let (lease or by the night). */
export const templatesFor = (library: ConditionTemplate[], app: Pick<Deal["app"], "product" | "rentalType">) => library.filter((item) => item.active && (!item.products.length || item.products.includes(app.product)) && (!item.rental || item.rental === (app.rentalType ?? "long_term")));

/** A condition made from a standard one, due its number of days from today. */
export const fromTemplate = (template: ConditionTemplate, id: string, by: string, today: string, at: string): LoanCondition => ({
  id, templateId: template.id, title: template.title, detail: template.detail, category: template.category, owner: template.owner, needsUpload: template.needsUpload,
  dueOn: addDays(today, template.dueDays), status: "open", addedBy: by, addedAt: at, files: [],
});

/** The standard conditions a loan doesn't have yet. */
export const missingStandard = (deal: Pick<Deal, "conditions" | "app">, library: ConditionTemplate[]) => templatesFor(library, deal.app).filter((template) => !(deal.conditions ?? []).some((item) => item.templateId === template.id));

export const isDone = (condition: LoanCondition) => condition.status === "cleared" || condition.status === "waived";
/** Conditions that hold up clear to close: prior to documents or prior to funding, not cleared or waived. */
export const blockingConditions = (deal: Pick<Deal, "conditions">) => (deal.conditions ?? []).filter((item) => item.category !== "post_closing" && !isDone(item));
/** What the borrower is asked for. Waived ones aren't needed, so they aren't shown. */
export const borrowerConditions = (deal: Pick<Deal, "conditions">) => (deal.conditions ?? []).filter((item) => item.owner === "borrower" && item.status !== "waived");
export const overdue = (condition: LoanCondition, today: string) => !isDone(condition) && Boolean(condition.dueOn) && condition.dueOn! < today;

// Before funding any condition can be added; after it, only ones for after closing.
const ADDABLE = ["underwriting", "term_sheet_issued", "term_sheet_accepted", "conditions", "clear_to_close", "closing"];
const SERVICED = ["funded", "servicing_current", "servicing_delinquent", "matured", "default"];

export type ConditionInput = Pick<LoanCondition, "title" | "detail" | "category" | "owner" | "needsUpload"> & { dueOn?: string; templateId?: string };

/** Why this condition can't be added to the loan, or null. */
export function addProblem(deal: Deal, input: ConditionInput, today: string) {
  if (SERVICED.includes(deal.status) ? input.category !== "post_closing" : !ADDABLE.includes(deal.status)) return SERVICED.includes(deal.status) ? "A funded loan can only take conditions for after closing." : "Conditions are added from underwriting until the loan funds.";
  // One from the library brings its own wording; the loan just can't have it twice.
  if (input.templateId && (deal.conditions ?? []).some((item) => item.templateId === input.templateId)) return "This loan already has that condition.";
  if (!input.templateId && !input.title.trim()) return "Say what the condition is.";
  if (!input.templateId && (!(input.category in CATEGORIES) || !(input.owner in OWNERS))) return "Choose when it's due and who it's for.";
  if (input.dueOn && (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn) || input.dueOn < today)) return "The due date can't be in the past.";
  return null;
}

/** Why the condition can't move this way, or null. */
export function changeProblem(condition: LoanCondition | undefined, to: "cleared" | "waived" | "returned", text: string) {
  if (!condition) return "That condition is no longer on this loan.";
  if (isDone(condition)) return `It's already ${condition.status}.`;
  if (to === "returned" && condition.status !== "submitted") return "Only something sent in can be sent back.";
  if ((to === "waived" || to === "returned") && !text.trim()) return to === "waived" ? "Say why it's waived." : "Say what's wrong, so they can fix it.";
  return null;
}

/** Why a file can't go to this condition, or null. The borrower and their broker send only the borrower's. */
export function fileProblem(condition: LoanCondition | undefined, byClient: boolean) {
  if (!condition) return "That condition is no longer on this loan.";
  if (isDone(condition)) return "That condition is already done.";
  if (byClient && condition.owner !== "borrower") return "That one is for the LendHous team.";
  return null;
}

/** Why this standard condition can't be saved, or null. */
export function templateProblem(template: Pick<ConditionTemplate, "title" | "category" | "owner" | "products" | "dueDays">) {
  if (!template.title.trim()) return "Give it a title.";
  if (!(template.category in CATEGORIES) || !(template.owner in OWNERS)) return "Choose when it's due and who it's for.";
  if (template.products.some((product) => !PRODUCTS.includes(product))) return "Choose the products it applies to.";
  if (!Number.isInteger(template.dueDays) || template.dueDays < 1 || template.dueDays > 365) return "It's due 1 to 365 days after it's added.";
  return null;
}
