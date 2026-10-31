"use client";
import { useState } from "react";
import { drawRequestError } from "@/lib/draws";
import type { Deal, DrawRequest } from "@/lib/mockData";
import { est, useStore } from "@/lib/store";
import { Badge, Section, shortDate, usd } from "@/components/ui";

export const DRAW_STATUS: Record<DrawRequest["status"], { label: string; tone: "blue" | "amber" | "green" | "rose" | "violet" }> = {
  submitted: { label: "Received", tone: "blue" },
  inspecting: { label: "Inspection ordered", tone: "amber" },
  inspected: { label: "Inspected, in review", tone: "violet" },
  approved: { label: "Approved", tone: "green" },
  funded: { label: "Funds released", tone: "green" },
  rejected: { label: "Not approved", tone: "rose" },
};

export const drawTotal = (draw: DrawRequest) => draw.lines.reduce((sum, line) => sum + line.requested, 0);

/** The borrower's draws: request money against the budget, and see where each request stands. */
export function DrawPanel({ deal }: { deal: Deal }) {
  const { s, dispatch, viewerName, uploadPhoto } = useStore();
  const e = est(deal.app);
  const released = deal.disbursedDraws ?? 0;
  const left = Math.max(0, e.holdback - released);
  const draws = s.draws.filter((draw) => draw.dealId === deal.id);
  const [open, setOpen] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [certified, setCertified] = useState(false);
  const lines = (deal.scope ?? []).map((line) => ({ scopeId: line.id, requested: amounts[line.id] ?? 0 }));
  const total = lines.reduce((sum, line) => sum + line.requested, 0);
  const error = total > 0 ? drawRequestError(deal, lines) : null;
  const submit = async () => {
    setSending(true);
    // Photos go up first, so the request can point at them. Demo and sample data keep only the names.
    const photoIds = (await Promise.all(photos.map((photo) => uploadPhoto(deal.id, photo)))).filter((id): id is string => Boolean(id));
    const done = await dispatch({ t: "requestDraw", dealId: deal.id, by: viewerName, note, contact, photos: photos.map((photo) => photo.name), photoIds, lines });
    setSending(false);
    if (!done) return;
    setOpen(false); setAmounts({}); setNote(""); setContact(""); setPhotos([]); setCertified(false);
  };
  return (
    <Section title="Draws">
      <div className="text-sm text-muted-foreground">Budget {usd(e.holdback)} · released {usd(released)} · {usd(left)} left</div>
      <div className="mt-2 h-2 rounded-full bg-accent"><div className="h-2 rounded-full bg-good" style={{ width: `${(released / Math.max(1, e.holdback)) * 100}%` }} /></div>
      {draws.length > 0 && (
        <ul className="mt-3 divide-y divide-border" data-testid="my-draws">
          {draws.map((draw) => (
            <li key={draw.id} className="py-2 text-sm" data-testid="my-draw">
              <div className="flex flex-wrap items-center justify-between gap-2"><b>{usd(draw.status === "funded" || draw.status === "approved" ? draw.approved ?? 0 : drawTotal(draw))}</b><Badge tone={DRAW_STATUS[draw.status].tone}>{DRAW_STATUS[draw.status].label}</Badge></div>
              <div className="text-xs text-muted-foreground">Requested {usd(drawTotal(draw))} on {shortDate(draw.requestedAt)}{draw.reason ? ` · ${draw.reason}` : ""}</div>
            </li>
          ))}
        </ul>
      )}
      {!open && left > 0 && <button className="btn-primary mt-3 w-full" data-testid="request-draw" onClick={() => setOpen(true)}>Request a draw</button>}
      {!open && left <= 0 && <p className="mt-3 text-sm text-muted-foreground">The whole budget has been released.</p>}
      {open && (
        <div className="mt-4 space-y-3 border-t border-border pt-4" data-testid="draw-form">
          <p className="text-sm text-muted-foreground">Enter how much you need for work that&apos;s finished, by budget line.</p>
          <ul className="space-y-2">
            {(deal.scope ?? []).filter((line) => line.budget > line.released).map((line) => (
              <li key={line.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1 basis-32 text-sm">{line.division}<small className="block text-xs text-muted-foreground">{usd(line.budget - line.released)} left</small></span>
                <input aria-label={`Amount for ${line.division}`} data-testid={`draw-${line.id}`} className="desk-input w-28!" inputMode="numeric" placeholder="0" value={amounts[line.id] ? amounts[line.id].toLocaleString("en-US") : ""} onChange={(event) => setAmounts({ ...amounts, [line.id]: Number(event.target.value.replace(/[^0-9]/g, "")) || 0 })} />
              </li>
            ))}
          </ul>
          <label className="block"><span className="label">What was finished</span><textarea data-testid="draw-note" rows={2} className="desk-input h-auto! py-2" value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <label className="block"><span className="label">Who should the inspector call?</span><input data-testid="draw-contact" className="desk-input" placeholder="Name and phone" value={contact} onChange={(event) => setContact(event.target.value)} /></label>
          <label className="block"><span className="label">Photos of the finished work</span><input data-testid="draw-photos" type="file" accept="image/*" multiple className="block w-full text-sm" onChange={(event) => setPhotos(Array.from(event.target.files ?? []))} /></label>
          {photos.length > 0 && <p className="text-xs text-muted-foreground">{photos.length} photo{photos.length > 1 ? "s" : ""} added</p>}
          <label className="flex items-start gap-2 text-sm"><input data-testid="draw-certify" type="checkbox" className="mt-1" checked={certified} onChange={(event) => setCertified(event.target.checked)} /> I certify this work is finished and ready for inspection. Funds go to the verified bank account on file.</label>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary flex-1" data-testid="submit-draw" disabled={sending || total <= 0 || Boolean(error) || !certified || !contact.trim()} onClick={() => void submit()}>{sending ? "Sending…" : `Request ${usd(total)}`}</button>
            <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </Section>
  );
}
