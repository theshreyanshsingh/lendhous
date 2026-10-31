"use client";
import { borrowerTimeline, timelineIndex } from "@/lib/mockData";
export default function Tracker({ status }: { status: Parameters<typeof timelineIndex>[0] }) {
  const idx = timelineIndex(status);
  return (
    <div data-testid="tracker">
      <ol className="flex items-start gap-1">
        {borrowerTimeline.map((t, i) => (
          <li key={t} className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
            <div className={`h-2 w-full rounded-full ${i < idx ? "bg-primary" : i === idx ? "bg-link" : "bg-accent"}`} />
            <span className={`hidden text-xs leading-tight sm:block ${i === idx ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{t}</span>
          </li>
        ))}
      </ol>
      {/* Six labels don't fit side by side on a phone, so it names the current step instead. */}
      <p className="mt-1.5 text-xs text-muted-foreground sm:hidden">Step {idx + 1} of {borrowerTimeline.length}: <span className="font-semibold text-foreground">{borrowerTimeline[idx]}</span></p>
    </div>
  );
}
