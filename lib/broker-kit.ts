// The broker kit (docs/competitor-gaps-2026-11-09.md, rank 25): what lets a small Florida brokerage sell LendHous loans
// under its own name. Its brand on the quote widget it puts on its own site (LendHous is still named as the lender), a
// program sheet printed from today's rate grid with its contact details and referral link, and a short course on how
// LendHous lends, with a question at the end of each lesson. The course is PLACEHOLDER copy until GT reviews it; its
// numbers come from the app's own rules, so they can't drift from what the loans actually do. Pure.
import { PROTECTION_MONTHS } from "./brokers";
import type { Broker } from "./mockData";

export type Lesson = { id: string; title: string; minutes: number; points: string[]; check: { question: string; options: string[]; answer: number } };

export const BROKER_COURSE: Lesson[] = [
  {
    id: "lending", title: "How LendHous lends", minutes: 3,
    points: [
      "LendHous makes business-purpose loans to real estate investors on Florida property: fix and flip, bridge, ground-up construction and DSCR rental loans.",
      "It doesn't lend on a home the borrower will live in. Those go to a licensed consumer lender.",
      "A quote takes about a minute and shows real terms from today's pricing. A term sheet follows underwriting; the conditions come next, then closing.",
    ],
    check: { question: "A client wants a loan on the house they'll live in. Can LendHous make it?", options: ["Yes, at a higher rate", "No: LendHous makes business-purpose loans only", "Only with a guarantor"], answer: 1 },
  },
  {
    id: "deals", title: "Sending a deal, and keeping your client", minutes: 3,
    points: [
      "Submit a deal from your portal. You can fill in the client's details yourself, or send the client a link to fill in their own.",
      `A client who asks for a quote through your referral link or your website widget is yours for ${PROTECTION_MONTHS} months, under the broker agreement.`,
      "You'll hear at every step: documents in, appraisal, term sheet, clear to close, funding, draws and payoff.",
    ],
    check: { question: "How long is a client yours after they come through your link?", options: ["30 days", `${PROTECTION_MONTHS} months`, "For as long as they have a loan"], answer: 1 },
  },
  {
    id: "fees", title: "Your fee", minutes: 2,
    points: [
      "Your points are set on the term sheet the client accepts, so the client sees them before closing.",
      "The fee is paid at closing, and your portal shows each one from expected to paid, with the year's total.",
      "LendHous reports fees on a 1099-NEC, so keep your W-9 current on the Tax form page: without it, 24% backup withholding applies.",
    ],
    check: { question: "When is your fee paid?", options: ["At closing", "When the loan pays off", "Monthly, with the interest"], answer: 0 },
  },
  {
    id: "florida", title: "What Florida loans need", minutes: 4,
    points: [
      "Every loan needs the building insured, windstorm cover, and flood insurance in a special flood hazard area (FEMA zones A and V), each naming LendHous as mortgagee. Citizens also requires flood cover on its policies.",
      "A condo loan needs its building checked: the milestone inspection, the reserve study and any special assessment.",
      "A buyer who isn't a U.S. citizen or permanent resident answers the SB 264 questions before the loan clears to close.",
    ],
    check: { question: "Which property must have flood insurance?", options: ["Only waterfront homes", "One in a special flood hazard area (zones A or V)", "None: it's always optional"], answer: 1 },
  },
  {
    id: "draws", title: "Draws on rehab and construction", minutes: 3,
    points: [
      "The rehab budget is held back and paid in draws as the work is done, after an inspection or, where it qualifies, a review of the borrower's phone photos.",
      "Before money goes out, the contractor's lien waiver for the work is checked, roof, electrical, plumbing and similar lines need their permit, and the title company searches for anything recorded since closing.",
      "A detailed budget, line by line, gets draws out faster than one with a large 'miscellaneous' line.",
    ],
    check: { question: "What does LendHous check before releasing a draw?", options: ["Only the borrower's photos", "The contractor's lien waiver, the permits and a title search, among others", "Nothing once the loan has funded"], answer: 1 },
  },
];

export const lessonIds = new Set(BROKER_COURSE.map((lesson) => lesson.id));

/** How far the brokerage has got through the course. */
export function courseProgress(broker: Pick<Broker, "training">) {
  const done = BROKER_COURSE.filter((lesson) => broker.training?.done.includes(lesson.id)).length;
  return { done, total: BROKER_COURSE.length, finished: done === BROKER_COURSE.length };
}

/** Why this answer doesn't complete the lesson, or null. */
export function lessonProblem(lessonId: string, answer: number) {
  const lesson = BROKER_COURSE.find((item) => item.id === lessonId);
  if (!lesson) return "That lesson isn't in the course.";
  return lesson.check.answer === answer ? null : "Not quite. Read the lesson again and try once more.";
}
