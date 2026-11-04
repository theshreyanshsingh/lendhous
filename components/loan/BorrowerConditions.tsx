"use client";
import { Badge, Section } from "@/components/ui";
import { borrowerConditions, isDone, overdue } from "@/lib/conditions";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { ConditionFiles, ConditionUpload } from "./ConditionsPanel";
import { useServiceDay } from "./use-service-day";
import { shortDay } from "@/lib/format";

/**
 * What the borrower has to send before closing (Spec B17): each condition with what's needed, when it's due and an
 * upload button. Their broker sees the same list and can send for them.
 */
export function BorrowerConditions({ deal, canUpload }: { deal: Deal; canUpload: boolean }) {
  const { local } = useStore();
  const today = useServiceDay();
  const mine = borrowerConditions(deal);
  if (!mine.length) return null;
  const open = mine.filter((item) => !isDone(item)).length;
  return (
    <Section title="What we need from you" right={<Badge tone={open ? "amber" : "green"}>{open ? `${open} to send` : "All done"}</Badge>}>
      <ul className="divide-y divide-border text-sm" data-testid="my-conditions">
        {mine.map((condition) => (
          <li key={condition.id} className="space-y-1 py-2.5" data-testid="my-condition">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0"><p className="font-medium">{condition.title}</p>{condition.detail && <p className="text-xs text-muted-foreground">{condition.detail}</p>}</div>
              <Badge tone={condition.status === "cleared" ? "green" : condition.status === "submitted" ? "blue" : "amber"}>{condition.status === "cleared" ? "Done" : condition.status === "submitted" ? "We're reviewing it" : condition.returned ? "Needs another look" : "Needed"}</Badge>
            </div>
            {condition.dueOn && !isDone(condition) && <p className={`text-xs ${today && overdue(condition, today) ? "text-bad" : "text-muted-foreground"}`}>Please send it by {shortDay(condition.dueOn)}{today && overdue(condition, today) ? " (past due)" : ""}.</p>}
            {condition.returned && condition.status === "open" && <p className="rounded-md bg-warn/10 p-2 text-xs" data-testid="condition-returned">What you sent needs another look: {condition.returned.reason}</p>}
            <ConditionFiles condition={condition} local={local} />
            {canUpload && condition.needsUpload && condition.status !== "cleared" && <ConditionUpload dealId={deal.id} condition={condition} label={condition.files.length ? "Send another file" : "Upload"} />}
          </li>
        ))}
      </ul>
    </Section>
  );
}
