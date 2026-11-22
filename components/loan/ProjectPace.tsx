"use client";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { Badge, Section } from "@/components/ui";
import { shortDay } from "@/lib/format";
import { PACE_LABEL, paceWords, projectPace, STALL_DAYS } from "@/lib/project-pace";
import { useServiceDay } from "./use-service-day";

const TONE = { on_pace: "green", behind: "amber", stalled: "rose" } as const;

/** One bar: a share, with its label beside it. */
function Bar({ label, value, testid }: { label: string; value: number; testid: string }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-2 text-xs max-sm:grid-cols-[6rem_1fr_2.75rem]" data-testid={testid}>
      <span className="text-muted-foreground">{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-foreground/70" style={{ width: `${Math.round(value * 100)}%` }} /></span>
      <span className="text-right tabular-nums">{Math.round(value * 100)}%</span>
    </div>
  );
}

/**
 * A rehab's pace (lib/project-pace.ts): the share of the holdback drawn next to the share of the term used, the last draw
 * asked for, and whether the rest gets drawn before maturity at the rate so far. The team and the borrower see the same.
 */
export function ProjectPace({ deal, side }: { deal: Deal; side: "team" | "client" }) {
  const { s } = useStore();
  const today = useServiceDay();
  const pace = today ? projectPace(deal, s.draws, today) : null;
  if (!pace) return null;
  return (
    <Section title={side === "team" ? "Project pace" : "Your project's pace"} right={<Badge tone={TONE[pace.state]}>{PACE_LABEL[pace.state]}</Badge>}>
      <div className="space-y-2 text-sm" data-testid="project-pace">
        <Bar label="Rehab drawn" value={pace.drawn} testid="pace-drawn" />
        <Bar label="Term used" value={pace.used} testid="pace-used" />
        <p className="text-xs text-muted-foreground" data-testid="pace-words">{paceWords(pace)} {pace.lastActivity === deal.closingDate ? `No draw asked for since closing on ${shortDay(pace.lastActivity)}.` : `Last draw asked for on ${shortDay(pace.lastActivity)}.`} Matures {shortDay(pace.maturity)}.</p>
        {pace.state === "stalled" && <p className="text-xs text-bad">{side === "team" ? `No draw in ${STALL_DAYS} days or more: the borrower is asked for an update with photos each month until one comes in. Consider whether advances should stop.` : "We haven't had a draw request in a while. A few photos of the work, or a message about what's holding it up, helps us help you."}</p>}
      </div>
    </Section>
  );
}
