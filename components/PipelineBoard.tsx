"use client";
import Link from "next/link";
import { useState } from "react";
import { PropertyPicture } from "@/components/PropertyPicture";
import { usd } from "@/components/ui";
import { BOARD_COLUMNS, boardMove } from "@/lib/board";
import type { Estimate } from "@/lib/engine";
import { initialsOf } from "@/lib/loan-team";
import type { Deal, LoanStatus } from "@/lib/mockData";
import { useStore } from "@/lib/store";

/**
 * The pipeline as columns by stage. Drag a card onto the next column to move it, when its next step allows; the board
 * says why when it doesn't.
 */
export function PipelineBoard({ rows, today, inStage }: { rows: { d: Deal; e: Estimate }[]; today: string; inStage: (deal: Deal) => number }) {
  const { dispatch } = useStore();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<LoanStatus | null>(null);
  const [said, setSaid] = useState("");
  const drop = (to: LoanStatus) => {
    const row = rows.find(({ d }) => d.id === dragging);
    setOver(null); setDragging(null);
    if (!row) return;
    const move = boardMove(row.d, row.e, to, today || undefined);
    if (!move.ok) return setSaid(move.why);
    setSaid("");
    void dispatch({ t: "advanceLoan", dealId: row.d.id });
  };
  return (
    <div className="space-y-2 p-3" data-testid="pipeline-board">
      {said && <p role="alert" className="rounded-[2px] bg-warn/12 px-3 py-2 text-sm text-warn" data-testid="board-refused">{said}</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {BOARD_COLUMNS.map((column) => {
          const cards = rows.filter(({ d }) => d.status === column.code);
          return (
            <section key={column.code} className={`min-w-0 rounded-[2px] border p-2 transition-colors ${over === column.code ? "border-link bg-link/5" : "border-border bg-muted/30"}`} data-testid={`board-column-${column.code}`}
              onDragOver={(event) => { event.preventDefault(); setOver(column.code); }} onDragLeave={() => setOver(null)} onDrop={(event) => { event.preventDefault(); drop(column.code); }}>
              <h3 className="mb-2 flex items-baseline justify-between gap-2 px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase"><span>{column.label}</span><span>{cards.length}</span></h3>
              <ul className="space-y-2">
                {cards.length === 0 && <li className="px-1 py-3 text-xs text-faint">Nothing here.</li>}
                {cards.map(({ d, e }) => (
                  <li key={d.id} draggable onDragStart={(event) => { event.dataTransfer.setData("text/plain", d.id); setDragging(d.id); }} onDragEnd={() => setDragging(null)} className={`glass cursor-grab p-2 ${dragging === d.id ? "opacity-60" : ""}`} data-testid="board-card" data-deal={d.id}>
                    <Link href={`/admin/deals/${d.id}`} className="flex gap-2" draggable={false}>
                      <PropertyPicture deal={d} variant="thumb" />
                      <span className="min-w-0 flex-1 text-xs">
                        <span className="block font-semibold text-link">{d.loanNumber}</span>
                        <span className="block truncate text-foreground">{d.borrowerName}</span>
                        <span className="block text-muted-foreground tabular-nums">{usd(e.noteAmount)} · {inStage(d)}d in stage</span>
                      </span>
                      {d.team?.officer && <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold" title={`Loan officer: ${d.team.officer.name}`}>{initialsOf(d.team.officer.name)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
