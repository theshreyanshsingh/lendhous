"use client";
import { borrowerTimeline, timelineIndex } from "@/lib/mockData";
export default function Tracker({ status }: { status: Parameters<typeof timelineIndex>[0] }) {
  const idx = timelineIndex(status);
  return (
    <ol className="flex items-center gap-1" data-testid="tracker">
      {borrowerTimeline.map((t, i) => (
        <li key={t} className="flex flex-1 flex-col items-center gap-1 text-center">
          <div className={`h-2 w-full rounded-full ${i < idx ? "bg-primary" : i === idx ? "bg-link" : "bg-accent"}`} />
          <span className={`text-[10px] leading-tight sm:text-xs ${i === idx ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{t}</span>
        </li>
      ))}
    </ol>
  );
}

