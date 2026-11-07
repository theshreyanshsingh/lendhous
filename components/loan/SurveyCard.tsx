"use client";
import { useState } from "react";
import { serviceDay } from "@/lib/book";
import type { Deal } from "@/lib/mockData";
import { promoter, surveyDue } from "@/lib/surveys";
import { useStore } from "@/lib/store";

/**
 * One question after closing and after payoff: how likely is the borrower to recommend LendHous (lib/surveys.ts). A 9 or
 * 10 is asked for a public review when an owner has set where.
 */
export function SurveyCard({ deal }: { deal: Deal }) {
  const { s, dispatch, reviewUrl } = useStore();
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState<number | null>(null);
  const stage = surveyDue(deal, serviceDay(s));
  if (sent !== null) return (
    <div className="glass space-y-2 p-4 text-sm" data-testid="survey-thanks" role="status">
      <p className="font-medium">Thank you for telling us.</p>
      {promoter(sent) && reviewUrl ? <p>Would you say so in a review? It helps other investors find us. <a className="text-link underline" href={reviewUrl} target="_blank" rel="noreferrer" data-testid="survey-review">Leave a review</a></p> : <p className="text-muted-foreground">Your loan officer reads every answer.</p>}
    </div>
  );
  if (!stage) return null;
  return (
    <section className="glass space-y-3 p-4" data-testid="survey" aria-labelledby="survey-title">
      <h2 id="survey-title" className="text-base font-medium">{stage === "funded" ? "Your loan has funded." : "Your loan is paid off."} How likely are you to recommend LendHous to another investor?</h2>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="0 is not at all likely, 10 is extremely likely">
        {Array.from({ length: 11 }, (_, n) => <button key={n} type="button" role="radio" aria-checked={score === n} data-testid={`survey-score-${n}`} className={`size-11 rounded-[2px] border text-sm font-medium ${score === n ? "border-primary bg-primary text-primary-foreground" : "border-rule hover:border-faint"}`} onClick={() => setScore(n)}>{n}</button>)}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground"><span>Not at all likely</span><span>Extremely likely</span></div>
      <label className="block"><span className="label">What would make it a 10? (optional)</span><textarea className="desk-input min-h-16" maxLength={1000} data-testid="survey-comment" value={comment} onChange={(event) => setComment(event.target.value)} /></label>
      <button type="button" className="btn-primary w-full sm:w-auto" data-testid="survey-send" disabled={score === null} onClick={async () => { if (score !== null && (await dispatch({ t: "answerSurvey", dealId: deal.id, stage, score, comment }))) setSent(score); }}>Send</button>
    </section>
  );
}
