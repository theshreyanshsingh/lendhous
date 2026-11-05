"use client";
import Link from "next/link";
import { Badge, Section, usd } from "@/components/ui";
import { CONFIDENCE, EXIT_CHASE_DAYS, EXIT_CHOICES, maturityDesk } from "@/lib/exit-plans";
import { shortDay } from "@/lib/format";
import { balanceOf } from "@/lib/servicing";
import { useStore } from "@/lib/store";

const SURE_TONE = { sure: "green", likely: "blue", unsure: "amber" } as const;

/** The short-term loans coming due, by how soon, each with how the borrower says it will end and how sure they are. */
export function MaturityDesk() {
  const { s } = useStore();
  const groups = maturityDesk(s.deals);
  return (
    <Section title="Maturity desk" right={<span className="text-xs text-muted-foreground">Borrowers are asked at 120, 90, 60 and 30 days</span>}>
      {groups.length === 0 ? <p className="text-sm text-muted-foreground">No short-term loans are open.</p> : (
        <div className="space-y-4" data-testid="maturity-desk">
          {groups.map((group) => (
            <div key={group.key} data-testid={`desk-${group.key}`}>
              <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{group.label} ({group.rows.length})</h3>
              <ul className="divide-y divide-border text-sm">
                {group.rows.map((row) => (
                  <li key={row.deal.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2" data-testid="desk-row">
                    <span className="min-w-0 flex-1 basis-60">
                      <Link href={`/admin/deals/${row.deal.id}?tab=Servicing`} className="font-medium text-link underline-offset-2 hover:underline">{row.deal.loanNumber}</Link> <span className="text-muted-foreground">· {row.deal.borrowerName} · {usd(balanceOf(row.deal))}</span>
                      <span className="block text-xs text-muted-foreground">Matures {shortDay(row.maturity)} · {row.days >= 0 ? `${row.days} days` : `${-row.days} days ago`}</span>
                    </span>
                    {row.plan ? (
                      <span className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="desk-plan"><span>{EXIT_CHOICES[row.plan.choice]}</span><Badge tone={SURE_TONE[row.plan.confidence]}>{CONFIDENCE[row.plan.confidence]}</Badge>{s.deals.some((deal) => deal.refinances === row.deal.id) && <Badge tone="green">Refinance applied</Badge>}</span>
                    ) : <span className={`text-xs ${row.days <= EXIT_CHASE_DAYS ? "font-medium text-bad" : "text-muted-foreground"}`} data-testid="desk-no-plan">No plan yet{row.asked.length ? `, asked at ${row.asked.join(", ")} days` : ""}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
