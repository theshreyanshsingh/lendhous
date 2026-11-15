"use client";
import { useState } from "react";
import { askTitleForUpdate } from "@/actions/title-links";
import { Reveal } from "@/components/motion";
import { shortDate, usd } from "@/components/ui";
import { shortDay } from "@/lib/format";
import type { Deal, DrawRequest } from "@/lib/mockData";
import { useStore } from "@/lib/store";
import { latestTitleUpdate, searchFrom, TITLE_UPDATE_DAYS, titleCheckRule, titleUpdateNeeded } from "@/lib/title-updates";
import { useServiceDay } from "./use-service-day";

const small = "h-9! px-3! text-xs!";
const newId = () => `tu${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * The title search a draw waits for (lib/title-updates.ts): ask the title company through a new secure link, see what it
 * found, or record an answer it gave another way. Draws under the owner's threshold in Settings skip it.
 */
export function TitleSearch({ deal, draw }: { deal: Deal; draw: DrawRequest }) {
  const { dispatch, viewerName, local, applyReply } = useStore();
  const today = useServiceDay();
  const [recording, setRecording] = useState(false);
  const [answer, setAnswer] = useState({ clean: "", through: "", found: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState({ to: "", link: "" });
  const rule = titleCheckRule();
  if (!rule.on || draw.status === "funded" || draw.status === "rejected" || !today) return null;
  if (!titleUpdateNeeded(draw)) return <p className="mt-3 text-xs text-muted-foreground" data-testid="title-search-skipped">No title search needed: Settings asks for one on draws of {usd(rule.minDraw)} or more.</p>;
  const latest = latestTitleUpdate(draw);
  const asked = draw.titleCheck?.asked;
  const since = searchFrom(deal);
  const ask = async () => {
    setBusy(true); setError("");
    if (local) { await dispatch({ t: "askTitleUpdate", drawId: draw.id, to: deal.closing?.email || "the title company", by: viewerName }); setBusy(false); return; }
    const reply = await askTitleForUpdate(draw.id).catch(() => ({ error: "That didn't go through. Try again." }));
    setBusy(false);
    if ("link" in reply && reply.link) { applyReply(reply); setSent({ to: deal.closing?.email ?? "", link: reply.link }); } else setError(reply.error ?? "That didn't go through.");
  };
  const record = async () => {
    const clean = answer.clean === "yes";
    if (await dispatch({ t: "recordTitleUpdate", drawId: draw.id, updateId: newId(), clean, through: answer.through, found: clean ? "" : answer.found.trim(), by: viewerName, via: "team" })) { setRecording(false); setAnswer({ clean: "", through: "", found: "" }); }
  };
  const stale = latest?.clean && today > new Date(Date.parse(`${latest.through}T12:00:00Z`) + TITLE_UPDATE_DAYS * 86_400_000).toISOString().slice(0, 10);
  return (
    <div className="mt-3 space-y-2 rounded-[2px] border border-border p-3 text-sm" data-testid="title-search">
      <p className="font-medium">Title search since recording</p>
      {latest ? (
        <p className={latest.clean && !stale ? "text-good" : latest.clean ? "text-warn" : "text-bad"} data-testid="title-search-result">
          {latest.clean ? `Nothing new recorded through ${shortDay(latest.through)}` : `Found through ${shortDay(latest.through)}: ${latest.found}`} ({latest.via === "title" ? latest.by : `recorded by ${latest.by}`}, {shortDate(latest.at)}){latest.documentId ? <> · {local ? latest.fileName : <a className="text-link underline underline-offset-2" href={`/api/documents/${latest.documentId}`} target="_blank" rel="noreferrer">{latest.fileName}</a>}</> : null}.{stale ? " It's too old for this release: ask again." : ""}
        </p>
      ) : asked ? (
        <p className="text-muted-foreground" data-testid="title-search-asked">Asked {asked.to} on {shortDate(asked.at)}{since ? ` for anything recorded since ${shortDay(since)}` : ""}. Waiting for the title company.</p>
      ) : (
        <p className="text-warn" data-testid="title-search-none">Not asked yet. The draw is held until the title company says nothing new is recorded against the property{since ? ` since ${shortDay(since)}` : ""}.</p>
      )}
      {sent.link && (
        <div className="space-y-1">
          <p className="text-xs text-good">Emailed {sent.to} a new secure link with the request. It replaces the closing link sent before. Copy it now if you want to send it another way: it isn&apos;t shown again.</p>
          <input readOnly className="desk-input min-w-0 font-mono text-xs" data-testid="title-search-link" value={sent.link} onFocus={(event) => event.target.select()} />
        </div>
      )}
      {local && asked && !latest && <p className="text-xs text-muted-foreground">Demo loans don&apos;t email anyone. <a className="text-link underline" href="/closing/demo-draw" target="_blank" rel="noreferrer" data-testid="title-search-preview">See what the title company sees</a>.</p>}
      {error && <p className="text-xs text-bad" role="alert">{error}</p>}
      {!recording && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${latest?.clean && !stale ? "btn-ghost" : "btn-primary"} ${small}`} data-testid="ask-title-search" disabled={busy || (!local && !deal.closing?.company)} onClick={() => void ask()}>{busy ? "Asking…" : asked ? "Ask again" : "Ask the title company"}</button>
          <button type="button" className={`btn-ghost ${small}`} data-testid="record-title-search" onClick={() => { setAnswer({ clean: "", through: today, found: "" }); setRecording(true); }}>Record an answer they gave you</button>
        </div>
      )}
      {!local && !deal.closing?.company && <p className="text-xs text-warn">Save the title company on the loan&apos;s Closing tab to ask it.</p>}
      <Reveal open={recording}>
        <div className="space-y-2 rounded-[2px] border border-border p-3" data-testid="title-search-record">
          <fieldset className="flex flex-wrap gap-4">
            <legend className="sr-only">What the title company found</legend>
            <label className="flex items-center gap-2"><input type="radio" name={`title-${draw.id}`} data-testid="title-record-clean" checked={answer.clean === "yes"} onChange={() => setAnswer({ ...answer, clean: "yes" })} /> Nothing new recorded</label>
            <label className="flex items-center gap-2"><input type="radio" name={`title-${draw.id}`} data-testid="title-record-found" checked={answer.clean === "no"} onChange={() => setAnswer({ ...answer, clean: "no" })} /> Something was recorded</label>
          </fieldset>
          <label className="block"><span className="label">Records searched through</span><input className="desk-input w-auto!" type="date" max={today} min={since} data-testid="title-record-through" value={answer.through} onChange={(event) => setAnswer({ ...answer, through: event.target.value })} /></label>
          {answer.clean === "no" && <label className="block"><span className="label">What&apos;s recorded, who for, and the book and page</span><input className="desk-input" data-testid="title-record-what" maxLength={1000} value={answer.found} onChange={(event) => setAnswer({ ...answer, found: event.target.value })} /></label>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`btn-primary ${small}`} data-testid="title-record-save" disabled={!answer.clean || !answer.through || (answer.clean === "no" && !answer.found.trim())} onClick={() => void record()}>Save</button>
            <button type="button" className={`btn-ghost ${small}`} onClick={() => setRecording(false)}>Cancel</button>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
