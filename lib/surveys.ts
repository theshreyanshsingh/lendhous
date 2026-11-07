// One question at closing and at payoff (docs/competitor-gaps.md, 1.10): how likely the borrower is to recommend LendHous,
// 0 to 10, with a comment if they like. The answers make a net promoter score for the reports, and a borrower who'd
// recommend us is asked for a review, at the link an owner sets in Settings. No competitor publishes one. Pure.
import type { Deal } from "./mockData";
import { addDays, SERVICED } from "./servicing";

export type SurveyStage = "funded" | "paid_off";
export type SurveyAnswer = NonNullable<Deal["surveys"]>[number];

/** How long after closing, or after the payoff, the question stays up. */
export const SURVEY_DAYS = 60;

/** The question the borrower is asked on this loan today, or null. */
export function surveyDue(deal: Deal, today: string): SurveyStage | null {
  const answered = (stage: SurveyStage) => (deal.surveys ?? []).some((item) => item.stage === stage);
  if (deal.status === "paid_off" && !answered("paid_off")) {
    const paidOn = deal.paidOff?.receivedOn;
    return paidOn && addDays(paidOn, SURVEY_DAYS) >= today ? "paid_off" : null;
  }
  if (SERVICED.includes(deal.status) && !answered("funded") && deal.closingDate <= today && addDays(deal.closingDate, SURVEY_DAYS) >= today) return "funded";
  return null;
}

/** Why this answer can't be saved, or null. */
export function surveyProblem(deal: Deal | undefined, stage: SurveyStage, score: number, today: string): string | null {
  if (!deal) return "That loan no longer exists.";
  if (surveyDue(deal, today) !== stage) return (deal.surveys ?? []).some((item) => item.stage === stage) ? "You've already answered this one. Thank you." : "This question isn't open on this loan.";
  if (!Number.isInteger(score) || score < 0 || score > 10) return "Choose a number from 0 to 10.";
  return null;
}

/** Someone who answers 9 or 10 is asked for a public review. */
export const promoter = (score: number) => score >= 9;

/** The net promoter score of the answers given in a period: the share of 9s and 10s less the share of 0 to 6. */
export function surveyScore(deals: Deal[], period: { from: string; to: string }) {
  const answers = deals.flatMap((deal) => deal.surveys ?? []).filter((item) => item.at.slice(0, 10) >= period.from && item.at.slice(0, 10) <= period.to);
  const promoters = answers.filter((item) => item.score >= 9).length;
  const detractors = answers.filter((item) => item.score <= 6).length;
  return { answers: answers.length, promoters, detractors, nps: answers.length ? Math.round(((promoters - detractors) / answers.length) * 100) : null, comments: answers.filter((item) => item.comment.trim()).map((item) => ({ score: item.score, comment: item.comment, stage: item.stage, at: item.at })) };
}
