"use client";
import { Section, Stat, statGrid } from "@/components/ui";
import type { Period } from "@/lib/reports";
import { surveyScore } from "@/lib/surveys";
import { useStore } from "@/lib/store";
import { shortDay } from "@/lib/format";

/** What borrowers said after closing and payoff in the period: the net promoter score and their comments (lib/surveys.ts). */
export function SurveyReport({ period }: { period: Period }) {
  const { s } = useStore();
  const score = surveyScore(s.deals, period);
  return (
    <Section title="What borrowers say">
      <div className={statGrid} data-testid="survey-report">
        <Stat label="Net promoter score" value={score.nps === null ? "None yet" : String(score.nps)} sub="share of 9s and 10s, less 0 to 6" />
        <Stat label="Answers" value={score.answers} sub="after closing or payoff" />
        <Stat label="Would recommend us" value={score.promoters} sub="answered 9 or 10" />
        <Stat label="Wouldn't" value={score.detractors} sub="answered 0 to 6" />
      </div>
      {score.comments.length > 0 && <ul className="mt-3 space-y-1 text-sm" data-testid="survey-comments">{score.comments.map((item) => <li key={item.at}><b className="tabular-nums">{item.score}</b> · {item.comment} <span className="text-xs text-muted-foreground">({item.stage === "funded" ? "at closing" : "at payoff"}, {shortDay(item.at.slice(0, 10))})</span></li>)}</ul>}
    </Section>
  );
}
