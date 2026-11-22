"use client";
import { useState } from "react";
import type { Deal, SettlementCheck as Check } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { Badge, Section, shortDate } from "@/components/ui";
import { expectedFigures, SETTLEMENT_KEYS, SETTLEMENT_LABELS, SETTLEMENT_OPEN, settlementHold, settlementLines, type SettlementKey, type SettlementLine } from "@/lib/term-changes";

const small = "h-9! px-3! text-xs!";
const money = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export type SettlementDraft = Record<SettlementKey, string>;
export const draftOf = (check?: Pick<Check, "figures">): SettlementDraft => Object.fromEntries(SETTLEMENT_KEYS.map((key) => [key, check?.figures[key] !== undefined ? String(check.figures[key]) : ""])) as SettlementDraft;
/** The typed lines as numbers: blank stays out, anything else is read without its commas and dollar sign. */
export const figuresOf = (draft: SettlementDraft): Check["figures"] => Object.fromEntries(SETTLEMENT_KEYS.flatMap((key) => { const raw = draft[key].replace(/[$,\s]/g, ""); return raw ? [[key, Number(raw)]] : []; }));

/** The statement's lender lines beside the agreed terms. */
export function SettlementLines({ lines }: { lines: SettlementLine[] }) {
  return (
    <table className="stack-table w-full text-sm" data-testid="settlement-lines">
      <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 font-normal">Line</th><th className="py-1 text-right font-normal">Agreed terms</th><th className="py-1 text-right font-normal">Statement</th><th className="py-1 text-right font-normal">Check</th></tr></thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.key} className="border-t border-border" data-testid="settlement-line" data-off={line.off ? "1" : undefined}>
            <td className="py-1.5" data-label="Line">{line.label}</td>
            <td className="py-1.5 text-right tabular-nums" data-label="Agreed terms">{money(line.expected)}</td>
            <td className="py-1.5 text-right tabular-nums" data-label="Statement">{money(line.stated)}</td>
            <td className="py-1.5 text-right" data-label="Check">{line.off ? <Badge tone="rose">Differs by {money(Math.abs(line.stated - line.expected))}</Badge> : <Badge tone="green">Matches</Badge>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The fields for each lender line, with what the terms say beside each one to make it easy to read off the statement. */
export function SettlementFields({ draft, onChange, expected }: { draft: SettlementDraft; onChange: (next: SettlementDraft) => void; expected?: Record<SettlementKey, number> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {SETTLEMENT_KEYS.map((key) => (
        <label key={key} className="block min-w-0"><span className="label">{SETTLEMENT_LABELS[key]}</span>
          <input className="desk-input" inputMode="decimal" autoComplete="off" placeholder="None on the statement" data-testid={`settlement-${key}`} value={draft[key]} onChange={(event) => onChange({ ...draft, [key]: event.target.value })} />
          {expected && <span className="text-[11px] text-faint">The terms say {money(expected[key])}</span>}
        </label>
      ))}
    </div>
  );
}

/**
 * The draft settlement statement checked against the agreed terms, line by line (lib/term-changes.ts). The title company
 * types it in on its link, or the team does from the statement. A line that differs holds funding until it's fixed or
 * someone who approves funding says why it's right.
 */
export function SettlementCheck({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SettlementDraft>(() => draftOf(deal.settlement));
  const [reason, setReason] = useState("");
  const check = deal.settlement;
  if (!SETTLEMENT_OPEN.includes(deal.status) && !check) return null;
  const lines = settlementLines(deal);
  const off = lines.filter((line) => line.off);
  const open = SETTLEMENT_OPEN.includes(deal.status);
  const save = async () => { if (await dispatch({ t: "saveSettlement", dealId: deal.id, figures: figuresOf(draft), by: viewerName, via: "team" })) setEditing(false); };
  const explain = async () => { if (await dispatch({ t: "explainSettlement", dealId: deal.id, reason, by: viewerName })) setReason(""); };
  return (
    <Section title="Settlement statement check" right={check ? <Badge tone={!off.length ? "green" : check.explained ? "slate" : "rose"}>{!off.length ? "Matches the terms" : check.explained ? "Difference explained" : `${off.length} line${off.length === 1 ? "" : "s"} differ`}</Badge> : undefined}>
      <div className="space-y-3 text-sm" data-testid="settlement-check">
        {!check && !editing && <p className="text-muted-foreground">The title company enters its draft settlement statement&apos;s lender lines on its link, and they&apos;re checked here against the agreed terms. You can also type them in from the statement.</p>}
        {check && <SettlementLines lines={lines} />}
        {check && <p className="text-xs text-muted-foreground">Entered {shortDate(check.at)} by {check.by}{check.via === "title" ? " on the title company's link" : ""}.</p>}
        {check?.explained && <p className="text-xs text-muted-foreground" data-testid="settlement-explained">Explained by {check.explained.by} on {shortDate(check.explained.at)}: {check.explained.reason}</p>}
        {settlementHold(deal) && open && (
          <div className="space-y-2 rounded-[2px] border border-bad/30 bg-bad/5 p-3">
            <p className="text-bad">Funding waits until the title company corrects the statement, or you say why the difference is right.</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-0 flex-1 basis-56"><span className="label">Why it&apos;s right (someone who approves funding)</span><input className="desk-input" data-testid="settlement-reason" maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
              <button type="button" className={`btn-ghost ${small}`} data-testid="settlement-explain" disabled={!reason.trim()} onClick={() => void explain()}>Explain it</button>
            </div>
          </div>
        )}
        {open && !editing && <button type="button" className={`btn-ghost ${small}`} data-testid="settlement-enter" onClick={() => { setDraft(draftOf(check)); setEditing(true); }}>{check ? "Enter new figures" : "Enter the figures"}</button>}
        {open && editing && (
          <div className="space-y-3">
            <SettlementFields draft={draft} onChange={setDraft} expected={expectedFigures(deal)} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`btn-primary ${small}`} data-testid="settlement-save" disabled={!draft.loanAmount.trim()} onClick={() => void save()}>Check them</button>
              <button type="button" className={`btn-ghost ${small}`} onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
