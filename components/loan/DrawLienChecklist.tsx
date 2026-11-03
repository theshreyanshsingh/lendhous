"use client";
import { useRef, useState } from "react";
import { shortDate, usd } from "@/components/ui";
import { drawHolds, isFinalDraw, partiesFor, unreleasedHolds, waiverCheckProblem } from "@/lib/lien-law";
import type { Deal, DrawRequest, LienWaiver } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { useServiceDay } from "./use-service-day";

const small = "h-9! px-3! text-xs!";

function Upload({ deal, draw, party, label }: { deal: Deal; draw: DrawRequest; party: { key: string; kind: "progress" | "final" } | "affidavit"; label: string }) {
  const { uploadLienFile } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const id = party === "affidavit" ? "affidavit" : party.key;
  return (
    <>
      <input ref={input} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" data-testid={`lien-file-${id}`} onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setSending(true);
        await uploadLienFile(deal.id, draw.id, party, file);
        setSending(false);
      }} />
      <button type="button" className={`btn-ghost ${small}`} data-testid="lien-upload" disabled={sending} onClick={() => input.current?.click()}>{sending ? "Uploading…" : label}</button>
    </>
  );
}

const fileLink = (name: string, documentId: string | undefined, local: boolean) => (documentId && !local ? <a className="text-link underline" href={`/api/documents/${documentId}?view=1`} target="_blank" rel="noreferrer">{name}</a> : name);

/** The team checks a waiver against the statutory form: through what date, for how much, and whether it's conditional. */
function CheckWaiver({ draw, waiver }: { draw: DrawRequest; waiver: LienWaiver }) {
  const { dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const [amount, setAmount] = useState("");
  const [throughOn, setThroughOn] = useState("");
  const [conditional, setConditional] = useState(true);
  const [reason, setReason] = useState("");
  const value = Number(amount.replace(/[^0-9.]/g, "")) || 0;
  const problem = today ? waiverCheckProblem(waiver, value, throughOn || undefined, today) : null;
  return (
    <div className="mt-1 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block w-32"><span className="label">Amount ($)</span><input className="desk-input" inputMode="decimal" data-testid="waiver-amount" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        {waiver.kind === "progress" && <label className="block"><span className="label">Work through</span><input className="desk-input" type="date" data-testid="waiver-through" max={today || undefined} value={throughOn} onChange={(event) => setThroughOn(event.target.value)} /></label>}
        <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" data-testid="waiver-conditional" checked={conditional} onChange={(event) => setConditional(event.target.checked)} /> Conditional on payment (713.20(7))</label>
        <button type="button" className={`btn-primary ${small}`} data-testid="check-waiver" disabled={Boolean(problem)} onClick={() => void dispatch({ t: "checkLienWaiver", drawId: draw.id, waiverId: waiver.id, amount: value, ...(throughOn ? { throughOn } : {}), conditional, by: viewerName })}>It&apos;s on the statutory form</button>
      </div>
      {problem && amount && <p className="text-xs text-warn">{problem}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-0 flex-1 basis-48"><span className="label">Or what&apos;s wrong with it</span><input className="desk-input" data-testid="waiver-reject-reason" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <button type="button" className={`btn-ghost ${small}`} data-testid="reject-waiver" disabled={!reason.trim()} onClick={() => void dispatch({ t: "rejectLienWaiver", drawId: draw.id, waiverId: waiver.id, reason: reason.trim(), by: viewerName })}>Send it back</button>
      </div>
    </div>
  );
}

/**
 * What Florida's lien law needs before a draw is paid (Fla. Stat. 713.20, 713.06(3)(d)): a waiver from the contractor
 * and from every lienor who served a notice to owner, final ones on the last draw with the contractor's final payment
 * affidavit. The borrower sends them; the team checks them, and sees what still holds the release and can release it
 * past the holds with an owner's reason.
 */
export function DrawLienChecklist({ deal, draw, side }: { deal: Deal; draw: DrawRequest; side: "team" | "borrower" }) {
  const { dispatch, viewerName, local } = useStore();
  const today = useServiceDay();
  const [overriding, setOverriding] = useState(false);
  const [reason, setReason] = useState("");
  if (draw.status === "funded" || draw.status === "rejected" || !today) return null;
  const final = isFinalDraw(deal, draw);
  const kind = final ? "final" : "progress";
  const parties = partiesFor(deal.lienFile, today);
  const holds = side === "team" ? drawHolds(deal, draw, today) : [];
  const open = side === "team" ? unreleasedHolds(deal, draw, today) : [];
  return (
    <div className="mt-3 space-y-2 rounded-[2px] border border-border p-3 text-sm" data-testid="draw-lien">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{final ? "Final lien waivers and affidavit" : "Lien waivers for this draw"}</p>
        {side === "team" && <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" data-testid="final-draw" checked={final} disabled={final && !draw.final} onChange={(event) => void dispatch({ t: "setFinalDraw", drawId: draw.id, final: event.target.checked })} /> The last draw</label>}
      </div>
      {side === "borrower" && <p className="text-xs text-muted-foreground">Florida law needs a {kind} lien waiver on the statutory form (Fla. Stat. 713.20) from your contractor and anyone who served a notice to owner{final ? ", and your contractor's final payment affidavit" : ""}, before we release the money.</p>}
      {!parties.length && <p className="text-xs text-warn">{side === "team" ? "Add the contractor in the loan's lien file (Closing tab)." : "Your loan officer is setting up who signs waivers."}</p>}
      <ul className="divide-y divide-border">
        {parties.map((party) => {
          const sent = (draw.waivers ?? []).filter((item) => item.partyKey === party.key && item.kind === kind);
          const latest = sent.at(-1);
          return (
            <li key={party.key} className="py-2" data-testid="lien-party">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">{party.name}<span className="text-xs text-muted-foreground"> · {party.key === "contractor" ? "contractor" : "served a notice to owner"}</span></span>
                <span className={`text-xs ${latest?.checked ? "text-good" : latest && !latest.rejected ? "text-link" : "text-warn"}`} data-testid="lien-party-status">{latest?.checked ? "Checked" : latest && !latest.rejected ? (side === "team" ? "To check" : "We're checking it") : latest?.rejected ? "Sent back" : "Needed"}</span>
              </div>
              {latest && <p className="text-xs text-muted-foreground">{fileLink(latest.fileName, latest.documentId, local)} · {shortDate(latest.sentAt)}{latest.checked ? ` · ${usd(latest.checked.amount, 2)}${latest.checked.throughOn ? ` through ${latest.checked.throughOn}` : ""}${latest.checked.conditional ? ", conditional on payment" : ""}` : ""}</p>}
              {latest?.rejected && <p className="text-xs text-warn">Sent back: {latest.rejected.reason}</p>}
              {side === "team" && latest && !latest.checked && !latest.rejected && <CheckWaiver draw={draw} waiver={latest} />}
              {(!latest || latest.rejected) && <div className="mt-1"><Upload deal={deal} draw={draw} party={{ key: party.key, kind }} label={side === "team" ? "Upload it for them" : "Upload the waiver"} /></div>}
            </li>
          );
        })}
        {final && parties.length > 0 && (
          <li className="py-2" data-testid="lien-affidavit">
            <div className="flex flex-wrap items-center justify-between gap-2"><span>Contractor&apos;s final payment affidavit <span className="text-xs text-muted-foreground">(713.06(3)(d))</span></span><span className={`text-xs ${draw.affidavit?.checked ? (draw.affidavit.checked.unpaidLienors ? "text-bad" : "text-good") : draw.affidavit ? "text-link" : "text-warn"}`}>{draw.affidavit?.checked ? (draw.affidavit.checked.unpaidLienors ? "Lists unpaid lienors" : "Checked") : draw.affidavit ? "To check" : "Needed"}</span></div>
            {draw.affidavit && <p className="text-xs text-muted-foreground">{fileLink(draw.affidavit.fileName, draw.affidavit.documentId, local)} · {shortDate(draw.affidavit.sentAt)}</p>}
            {side === "team" && draw.affidavit && !draw.affidavit.checked && (
              <div className="mt-1 flex flex-wrap gap-2">
                <button type="button" className={`btn-primary ${small}`} data-testid="affidavit-paid" onClick={() => void dispatch({ t: "checkAffidavit", drawId: draw.id, unpaidLienors: false, by: viewerName })}>Everyone&apos;s paid in full</button>
                <button type="button" className={`btn-ghost ${small}`} data-testid="affidavit-unpaid" onClick={() => void dispatch({ t: "checkAffidavit", drawId: draw.id, unpaidLienors: true, by: viewerName })}>It lists unpaid lienors</button>
              </div>
            )}
            {!draw.affidavit && <div className="mt-1"><Upload deal={deal} draw={draw} party="affidavit" label={side === "team" ? "Upload it for them" : "Upload the affidavit"} /></div>}
          </li>
        )}
      </ul>
      {side === "team" && (
        <div className="border-t border-border pt-2" data-testid="draw-holds">
          {open.length ? <ul className="space-y-0.5 text-xs text-warn">{open.map((hold) => <li key={hold}>{hold}</li>)}</ul> : <p className="text-xs text-good">Nothing under the lien law or the insurance holds this draw{draw.override ? " (an owner released it past the rest)" : ""}.</p>}
          {draw.override && <p className="mt-1 text-xs text-muted-foreground" data-testid="draw-override">Released past {draw.override.holds.length} hold{draw.override.holds.length === 1 ? "" : "s"} by {draw.override.by} on {shortDate(draw.override.at)}: {draw.override.reason}</p>}
          {holds.length > 0 && open.length > 0 && (!overriding ? <button type="button" className={`btn-ghost ${small} mt-2`} data-testid="override-holds" onClick={() => setOverriding(true)}>Release past these (owner)</button> : (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="block min-w-0 flex-1 basis-56"><span className="label">Why it should go out anyway (logged)</span><input className="desk-input" data-testid="override-reason" maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
              <button type="button" className={`btn-primary ${small}`} data-testid="confirm-override" disabled={!reason.trim()} onClick={async () => { if (await dispatch({ t: "overrideDrawHolds", drawId: draw.id, reason: reason.trim(), by: viewerName })) { setOverriding(false); setReason(""); } }}>Release past them</button>
              <button type="button" className={`btn-ghost ${small}`} onClick={() => setOverriding(false)}>Cancel</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
