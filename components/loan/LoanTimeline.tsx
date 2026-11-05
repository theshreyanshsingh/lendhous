"use client";
import { useServiceDay } from "@/components/loan/use-service-day";
import { usd } from "@/components/ui";
import { shortDay } from "@/lib/format";
import { loanTimeline } from "@/lib/loan-timeline";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";

const DOT = { done: "border-primary bg-primary", now: "border-link bg-card ring-4 ring-link/15", next: "border-rule bg-card" } as const;

/** The loan's journey: each step's date and how long it took, today's step, the target closing, then draws and maturity. */
export function LoanTimeline({ deal, side }: { deal: Deal; side: "team" | "client" }) {
  const { s } = useStore();
  const today = useServiceDay();
  const timeline = loanTimeline(deal, s.draws, today);
  if (!timeline) return null;
  const { points, draws } = timeline;
  return (
    <div className="mt-5 border-t border-border pt-4" data-testid="loan-timeline">
      <ol className="grid gap-x-1 gap-y-3 sm:flex sm:items-start">
        {points.map((point, i) => (
          <li key={point.label} className="relative flex min-w-0 gap-3 sm:flex-1 sm:flex-col sm:gap-2" data-testid="timeline-point" data-state={point.state}>
            {/* the line to the next step: down the side on a phone, across on a wider screen */}
            {i < points.length - 1 && <span aria-hidden="true" className={`absolute top-3 left-[5px] h-full w-px sm:top-[5px] sm:left-3 sm:h-px sm:w-full ${point.state === "done" ? "bg-primary" : "bg-rule"}`} />}
            <span aria-hidden="true" className={`relative z-10 mt-1 size-[11px] shrink-0 rounded-full border-2 sm:mt-0 ${DOT[point.state]}`} />
            <div className="min-w-0 text-xs leading-snug">
              <p className={point.state === "now" ? "font-semibold text-foreground" : point.state === "done" ? "text-foreground" : "text-muted-foreground"}>{point.label}{point.state === "now" && <span className="sr-only"> (now)</span>}</p>
              {point.on && <p className="text-muted-foreground tabular-nums">{point.target ? "Target " : ""}{shortDay(point.on)}</p>}
              {point.days !== undefined && <p className="text-faint tabular-nums">{point.days === 0 ? "same day" : `${point.days} day${point.days === 1 ? "" : "s"}${point.state === "now" ? " so far" : ""}`}</p>}
            </div>
          </li>
        ))}
      </ol>
      {draws.length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid="timeline-draws">
          <span className="font-medium text-foreground">{side === "client" ? "Draws paid" : "Draws funded"}</span>
          {draws.map((draw) => <span key={`${draw.on}${draw.amount}`} className="inline-flex items-center gap-1.5 tabular-nums"><span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />{shortDay(draw.on)} · {usd(draw.amount)}</span>)}
        </p>
      )}
    </div>
  );
}
