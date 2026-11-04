// A broker's quote for their client, as a PDF with the brokerage's name on it (docs/next-features-prompt.md, H). It still
// names LendHous as the lender and says it isn't a commitment: the agreement doesn't let a broker promise terms.
import { evaluate, type Application } from "./engine";
import { spreadRate } from "./usury";
import type { SheetContent } from "./term-sheets";

const money = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const percent = (value: number) => `${value.toFixed(3).replace(/0$/, "")}%`;
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const PRODUCTS: Record<Application["product"], string> = { fix_flip: "Fix and flip", bridge: "Bridge", ground_up: "Ground-up construction", dscr: "DSCR rental" };

export type QuoteFor = { app: Application; broker: string; client: string; brokerPoints: number; address: string; today: string };

/** The quote's content, laid out like a term sheet so it prints the same way. PLACEHOLDER wording until the attorney reads it. */
export function brokerQuoteContent(input: QuoteFor): SheetContent {
  const e = evaluate(input.app);
  const fee = Math.round(e.noteAmount * input.brokerPoints) / 100;
  const rental = input.app.product === "dscr";
  const terms: [string, string][] = [["Loan amount (estimated)", money(e.noteAmount)]];
  if (e.holdback > 0) terms.push(["Rehab or construction holdback", `${money(e.holdback)}, released in draws`]);
  terms.push(["Interest rate (estimated)", `${percent(e.rate)} a year${rental ? ", 30-year amortizing" : ", interest only"}`]);
  terms.push(["Origination points", `${e.pointsPct}% (${money(e.points)})`], ["Lender fees", money(e.lenderFees)]);
  if (input.brokerPoints > 0) terms.push(["Broker's fee", `${input.brokerPoints}% (${money(fee)}), paid by the borrower to ${input.broker} at closing`]);
  terms.push(["Term", rental ? "30 years" : `${e.termMonths} months`], [rental ? "Monthly payment (estimated)" : "First monthly payment (estimated)", money(e.monthlyPayment)]);
  terms.push(["Cash to close (estimated)", money(e.cashToClose + fee)]);
  if (!rental) terms.push(["Rate with all points, spread over the term", `${spreadRate(e.rate, e.pointsPct + input.brokerPoints, e.termMonths).toFixed(2)}% a year`]);
  return {
    lender: "LendHous", title: "Loan quote", subtitle: `Prepared by ${input.broker} for ${input.client} · ${longDay(input.today)}`,
    facts: [["For", input.client], ["Property", input.address || "To be confirmed"], ["Loan", `${PRODUCTS[input.app.product]}, ${input.app.purpose === "purchase" ? "purchase" : "refinance"}`], ["Lender", "LendHous"], ["Broker", input.broker]],
    terms, conditions: [],
    paragraphs: [
      "This is an estimate from LendHous's pricing today, not a commitment to lend or an offer of terms. A loan depends on LendHous's underwriting, the appraisal, title, insurance and the borrower's documents; only a term sheet LendHous issues and the borrower accepts sets the terms.",
      `LendHous is the lender. ${input.broker} is an independent broker: it can't approve a loan, set its terms or act for LendHous.`,
      "For business-purpose loans on investment property only, never for a home the borrower or their family lives in.",
    ],
    signature: e.eligible ? "Figures as of the date above." : `As entered, this loan wouldn't qualify: ${e.hardStops[0] ?? "see a loan officer"}.`,
  };
}
