"use client";
import { useState } from "react";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { Section, shortDate } from "@/components/ui";
import { LOW_SCORE } from "@/lib/surveys";

const small = "h-9! px-3! text-xs!";
const STAGE = { funded: "after closing", paid_off: "at payoff" } as const;

/**
 * A borrower who scored their experience 6 or less, for a manager to call (docs/feature-ideas-2026-11-22.md, rank 15),
 * and what they heard once they have.
 */
export function SurveyFollowUp({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const low = (deal.surveys ?? []).filter((answer) => answer.score <= LOW_SCORE);
  if (!low.length) return null;
  return (
    <Section title="Low survey scores">
      <ul className="space-y-3 text-sm" data-testid="survey-follow-ups">
        {low.map((answer) => (
          <li key={answer.stage} className="space-y-1.5" data-testid="survey-follow-up">
            <p><b className="font-semibold">{answer.score} out of 10</b> {STAGE[answer.stage]}, on {shortDate(answer.at)}{answer.comment ? `: "${answer.comment}"` : ", with no comment."}</p>
            {answer.followUp ? <p className="text-xs text-muted-foreground" data-testid="survey-followed-up">Followed up by {answer.followUp.by} on {shortDate(answer.followUp.at)}: {answer.followUp.note}</p> : (
              <div className="flex flex-wrap items-end gap-2">
                <label className="block min-w-0 flex-1 basis-56"><span className="label">After you call them: what you heard and what&apos;s being done</span><input className="desk-input" data-testid="survey-note" maxLength={1000} value={notes[answer.stage] ?? ""} onChange={(event) => setNotes({ ...notes, [answer.stage]: event.target.value })} /></label>
                <button type="button" className={`btn-primary ${small}`} data-testid="survey-follow-up-save" disabled={!(notes[answer.stage] ?? "").trim()} onClick={() => void dispatch({ t: "surveyFollowUp", dealId: deal.id, stage: answer.stage, note: notes[answer.stage] ?? "", by: viewerName })}>Record the follow-up</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
