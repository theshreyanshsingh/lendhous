// The sample payoff letter at /payoff-letter/demo, built from the FAKE demo book the way a real one is.
import { demoBook } from "./book";
import { letterContent, letterFigures } from "./payoffs";
import { DEMO_SERVICING_DAY } from "./servicing";

export function demoLetter() {
  const book = demoBook();
  const request = book.payoffs.find((item) => item.id === "payoff-1")!;
  const deal = book.deals.find((item) => item.id === request.dealId)!;
  const letter = { number: 1, issuedAt: `${DEMO_SERVICING_DAY}T15:00:00Z`, issuedBy: "Sam Servicer (FAKE)", ...letterFigures(deal, request.goodThrough, DEMO_SERVICING_DAY) };
  return { ...letterContent(deal, { ...request, letters: [letter] }, letter), sample: true };
}
