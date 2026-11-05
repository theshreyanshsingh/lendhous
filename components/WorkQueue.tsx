"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui";
import { serviceDay } from "@/lib/book";
import { initialsOf } from "@/lib/loan-team";
import { daysBetween } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { workQueue, type QueueItem } from "@/lib/work-queue";

const SHOWN = 8;
const CLOCK_TONE = { red: "bg-bad/10 text-bad", amber: "bg-warn/12 text-warn", ok: "bg-muted text-muted-foreground" } as const;

function dueText(due: string, today: string) {
  const left = daysBetween(today, due);
  return { text: left < 0 ? `${-left} day${left === -1 ? "" : "s"} late` : left === 0 ? "due today" : `${left} day${left === 1 ? "" : "s"} left`, urgent: left <= 2 };
}

function Row({ item, today }: { item: QueueItem; today: string }) {
  const due = item.due ? dueText(item.due, today) : null;
  return (
    <li data-testid="queue-item" data-key={item.key}>
      <Link href={item.href} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm hover:bg-hover/60">
        {/* On a phone the label takes the line and its deadline or clock sits under it. */}
        <span className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
          <span className="block font-medium">{item.label}</span>
          {item.deal && <span className="block truncate text-xs text-muted-foreground">{item.deal.loanNumber} · {item.deal.borrowerName} · {item.deal.address}</span>}
        </span>
        {due ? <span className={`shrink-0 rounded-[2px] px-2 py-0.5 text-xs font-medium ${due.urgent ? "bg-bad/10 text-bad" : "bg-warn/12 text-warn"}`} data-testid="queue-due">{due.text}</span>
          : item.clock ? <span className={`shrink-0 rounded-[2px] px-2 py-0.5 text-xs font-medium ${CLOCK_TONE[item.clock.state]}`} data-testid="queue-clock" data-state={item.clock.state} title={`Target: ${item.clock.target.hours} ${item.clock.target.business ? "business " : ""}hours`}>{item.clock.text}</span> : null}
        {item.owner && !item.mine && <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold" title={`${item.owner}'s loan`} aria-label={`${item.owner}'s loan`}>{initialsOf(item.owner)}</span>}
      </Link>
    </li>
  );
}

function List({ title, items, today, testid, empty }: { title: string; items: QueueItem[]; today: string; testid: string; empty: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <div className="min-w-0" data-testid={testid}>
      <h3 className="mb-1 flex items-baseline justify-between gap-2 text-sm font-medium"><span>{title}</span><span className="text-xs font-normal text-muted-foreground">{items.length}</span></h3>
      {items.length === 0 ? <p className="py-2 text-sm text-muted-foreground">{empty}</p> : (
        <ul className="divide-y divide-border">{shown.map((item) => <Row key={item.key} item={item} today={today} />)}</ul>
      )}
      {items.length > SHOWN && <button type="button" className="mt-1 text-xs text-link underline" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${items.length}`}</button>}
    </div>
  );
}

/**
 * What each person should do next, one item at a time: their own loans first, then what the team could pick up. Each
 * shows its legal deadline or how long it's waited against its target, and opens where it's done.
 */
export function WorkQueue() {
  const { s, newLeads, viewer, targets, local } = useStore();
  const [now, setNow] = useState<Date | null>(null);
  // The clocks run against the book's own day: today for a real book, the demo's fixed day (mid-afternoon) for the demo.
  useEffect(() => {
    const tick = () => setNow(local ? new Date(`${serviceDay(s)}T15:00:00-04:00`) : new Date());
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [s, local]);
  if (!now) return <section className="glass p-4" data-testid="work-queue"><h2 className="eyebrow mb-2">Your queue</h2><Skeleton /></section>;
  const { mine, team } = workQueue(s, viewer, now, targets, newLeads);
  const late = [...mine, ...team].filter((item) => item.clock?.state === "red").length;
  const today = serviceDay(s);
  return (
    <section className="glass min-w-0 p-4" data-testid="work-queue">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><h2 className="eyebrow">Your queue</h2>{late > 0 && <span className="text-xs font-medium text-bad" data-testid="queue-late">{late} past {late === 1 ? "its" : "their"} target</span>}</div>
      <div className="grid gap-6 lg:grid-cols-2">
        <List title="On your loans" items={mine} today={today} testid="queue-mine" empty="Nothing waiting on your loans." />
        <List title="For the team" items={team} today={today} testid="queue-team" empty="Nothing else waiting." />
      </div>
    </section>
  );
}
