"use client";
import { useState } from "react";
import { askForPhotos, renewPhotoLink, turnOffPhotoLink, type PhotoLinkReply } from "@/actions/photo-links";
import { Badge, shortDate } from "@/components/ui";
import type { Deal, DrawRequest, PhotoRequest, RequestPhoto } from "@/lib/mockData";
import { guideSteps, looksOld, missingShots, PHOTO_LINK_DAYS, photoRequestState, requestLines, type LinkState } from "@/lib/photo-requests";
import { useStore } from "@/lib/store";
import { photosSummary } from "@/lib/photo-checks";
import { phonePill } from "@/lib/ui-classes";

const STATE: Record<LinkState, { label: string; tone: "blue" | "amber" | "slate" }> = {
  open: { label: "Waiting for photos", tone: "blue" },
  expired: { label: "Link expired", tone: "amber" },
  off: { label: "Link turned off", tone: "slate" },
  closed: { label: "Closed", tone: "slate" },
};

const clock = (at: string) => new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
const DEMO_LINK = "/photos/demo";

type Issued = { requestId: string; link: string; mail: PhotoLinkReply["mail"]; to: string; email?: string };

/** Ask a contractor or borrower for photos by link, and see what came back, by budget line. */
export function PhotoRequests({ deal, draw, asBorrower = false }: { deal: Deal; draw?: DrawRequest; asBorrower?: boolean }) {
  const { s, local, dispatch, applyReply, viewerName } = useStore();
  const requests = s.photoRequests.filter((request) => request.dealId === deal.id && (!draw || !request.drawId || request.drawId === draw.id));
  const lastContractor = s.photoRequests.find((request) => request.dealId === deal.id && request.who === "contractor");
  const lines = deal.scope ?? [];
  const startLines = () => (draw ? draw.lines.map((line) => line.scopeId) : lines.filter((line) => line.budget > line.released).map((line) => line.id));
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<PhotoRequest["who"]>("contractor");
  const [to, setTo] = useState(lastContractor?.to ?? "");
  const [email, setEmail] = useState(lastContractor?.email ?? "");
  const [picked, setPicked] = useState<string[]>(startLines);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<Issued | null>(null);
  if (!lines.length) return null;

  const choose = (next: PhotoRequest["who"]) => {
    setWho(next);
    if (next === "borrower") { setTo(deal.borrowerName); setEmail(""); }
    else { setTo(lastContractor?.to ?? ""); setEmail(lastContractor?.email ?? ""); }
  };
  const settle = (reply: PhotoLinkReply, name: string) => {
    if (reply.error) { setError(reply.error); return false; }
    applyReply(reply);
    if (reply.link && reply.requestId) setIssued({ requestId: reply.requestId, link: reply.link, mail: reply.mail, to: name, email: reply.sentTo });
    return true;
  };
  const send = async () => {
    setBusy(true);
    setError("");
    if (local) {
      const requestId = `photos-${Date.now().toString(36)}`;
      await dispatch({ t: "askForPhotos", requestId, dealId: deal.id, drawId: draw?.id, to: to.trim(), email: email.trim() || undefined, who, scopeIds: picked, by: viewerName, byTeam: !asBorrower, expiresAt: new Date(Date.now() + PHOTO_LINK_DAYS * 86_400_000).toISOString() });
      setIssued({ requestId, link: DEMO_LINK, mail: "none", to: to.trim() });
      setOpen(false);
    } else {
      const reply = await askForPhotos({ dealId: deal.id, drawId: draw?.id, who, to, email, scopeIds: picked }).catch(() => ({ error: "That didn't go through. Check your connection and try again." }));
      if (settle(reply, to.trim())) setOpen(false);
    }
    setBusy(false);
  };
  const renew = async (request: PhotoRequest) => {
    setBusy(true);
    setError("");
    if (local) {
      await dispatch({ t: "renewPhotoRequest", requestId: request.id, expiresAt: new Date(Date.now() + PHOTO_LINK_DAYS * 86_400_000).toISOString() });
      setIssued({ requestId: request.id, link: DEMO_LINK, mail: "none", to: request.to });
    } else {
      settle(await renewPhotoLink(request.id).catch(() => ({ error: "That didn't go through. Check your connection and try again." })), request.to);
    }
    setBusy(false);
  };
  const turnOff = async (request: PhotoRequest) => {
    setBusy(true);
    setError("");
    const done = local ? await dispatch({ t: "turnOffPhotoRequest", requestId: request.id }) : settle(await turnOffPhotoLink(request.id).catch(() => ({ error: "That didn't go through. Check your connection and try again." })), request.to);
    // The link on screen is gone only if it was this request's.
    if (done && issued?.requestId === request.id) setIssued(null);
    setBusy(false);
  };

  return (
    <div data-testid="photo-requests">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1 basis-56">
          {!draw && asBorrower && <h3 className="text-sm font-medium">Photos from your contractor</h3>}
          {draw && <h3 className="text-sm font-medium">Photos of the work</h3>}
          {!draw && !asBorrower && <h3 className="sr-only">Photos from the contractor or borrower</h3>}
          <p className="text-xs text-muted-foreground">{asBorrower ? "Send your contractor a link." : "Send the contractor or borrower a link."} They don&apos;t need an account, and the page walks them through what to photograph.</p>
        </div>
        {!open && <button className="btn-ghost" data-testid="ask-photos" onClick={() => { setOpen(true); setIssued(null); setPicked(startLines()); }}>Ask for photos</button>}
      </div>

      {open && (
        <div className="mt-3 space-y-3 rounded-[2px] border border-border p-3" data-testid="ask-photos-form">
          {!asBorrower && (
            <div className="flex gap-2" role="group" aria-label="Who is this for">
              {(draw?.status === "inspecting" && !asBorrower ? (["contractor", "borrower", "inspector"] as const) : (["contractor", "borrower"] as const)).map((option) => <button key={option} type="button" aria-pressed={who === option} data-testid={`photo-who-${option}`} className={`${who === option ? "btn-primary" : "btn-ghost"} flex-1 capitalize`} onClick={() => choose(option)}>{option}</button>)}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">Name</span><input className="desk-input" data-testid="photo-to" maxLength={120} value={to} onChange={(event) => setTo(event.target.value)} /></label>
            <label className="block"><span className="label">Email (optional)</span><input className="desk-input" data-testid="photo-email" type="email" maxLength={200} value={email} placeholder={who === "borrower" ? "Their account's email" : "Or copy the link and text it"} onChange={(event) => setEmail(event.target.value)} /></label>
          </div>
          <fieldset>
            <legend className="label">Work to photograph</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {lines.map((line) => <label key={line.id} className="flex items-center gap-2 text-sm"><input type="checkbox" data-testid={`photo-line-${line.id}`} checked={picked.includes(line.id)} onChange={(event) => setPicked(event.target.checked ? [...picked, line.id] : picked.filter((id) => id !== line.id))} />{line.division}</label>)}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary" data-testid="photo-send-link" disabled={busy || !to.trim() || !picked.length} onClick={() => void send()}>{busy ? "Sending…" : email.trim() ? "Email the link" : "Make the link"}</button>
            <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <a className="text-xs text-link underline underline-offset-2" href={DEMO_LINK} target="_blank" rel="noreferrer" data-testid="photo-preview-link">See what they&apos;ll see</a>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-bad" data-testid="photo-error">{error}</p>}
      {issued && <IssuedLink key={issued.link} issued={issued} demo={local} onClose={() => setIssued(null)} />}

      {requests.length > 0 && (
        <ul className="mt-3 space-y-3">
          {requests.map((request) => <RequestRow key={request.id} request={request} deal={deal} draw={s.draws.find((item) => item.id === request.drawId)} local={local} busy={busy} asBorrowerView={asBorrower} canChange={!asBorrower || !request.byTeam} onRenew={() => void renew(request)} onTurnOff={() => void turnOff(request)} />)}
        </ul>
      )}
    </div>
  );
}

function IssuedLink({ issued, demo, onClose }: { issued: Issued; demo: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(issued.link.startsWith("/") ? window.location.origin + issued.link : issued.link); setCopied(true); };
  const said = demo ? "Demo accounts don't send anything. This link opens a preview of the page." : issued.mail === "sent" ? `Emailed to ${issued.email || issued.to}. You can also copy the link and text it.` : issued.mail === "failed" ? "The email didn't go through. Copy the link and send it yourself." : `Copy the link and send it to ${issued.to}.`;
  return (
    <div className="mt-3 rounded-[2px] border border-good/40 bg-good/5 p-3" data-testid="photo-issued">
      <p className="text-sm">{said}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input readOnly aria-label="Photo link" className="desk-input min-w-0 flex-1 basis-48" data-testid="photo-link" value={issued.link} onFocus={(event) => event.target.select()} />
        <button className="btn-ghost" data-testid="photo-copy" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
        <button className="btn-ghost" onClick={onClose}>Done</button>
      </div>
      {!demo && <p className="mt-2 text-xs text-muted-foreground">This is the only time the link is shown. If it gets lost, make a new one. It works for {PHOTO_LINK_DAYS} days.</p>}
    </div>
  );
}

function RequestRow({ request, deal, draw, local, busy, canChange, asBorrowerView = false, onRenew, onTurnOff }: { request: PhotoRequest; deal: Deal; draw?: DrawRequest; local: boolean; busy: boolean; canChange: boolean; asBorrowerView?: boolean; onRenew: () => void; onTurnOff: () => void }) {
  const state = photoRequestState(request, deal, draw);
  const steps = guideSteps(requestLines(request, deal));
  const missing = missingShots(steps, request.photos);
  const received = Boolean(request.finishedAt);
  return (
    <li className="rounded-[2px] border border-border p-3" data-testid="photo-request">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 text-sm"><b className="font-medium">{request.to}</b> <span className="text-xs text-muted-foreground capitalize">· {request.who}</span><div className="text-xs text-muted-foreground">Sent {shortDate(request.sentAt)} by {request.sentBy}{state === "open" ? ` · works until ${shortDate(request.expiresAt)}` : ""}</div></div>
        {received ? <Badge tone="green">{request.photos.length} photo{request.photos.length === 1 ? "" : "s"} received{state === "off" || state === "expired" ? ` · ${STATE[state].label.toLowerCase()}` : ""}</Badge> : <Badge tone={STATE[state].tone}>{request.photos.length ? `${request.photos.length} so far · ` : ""}{STATE[state].label}</Badge>}
      </div>
      {request.note && <p className="mt-2 text-sm" data-testid="photo-request-note">&ldquo;{request.note}&rdquo;{request.finishedBy ? <span className="text-xs text-muted-foreground"> {request.finishedBy}</span> : null}</p>}
      {steps.filter((step) => request.photos.some((photo) => photo.scopeId === step.id)).map((step) => (
        <div key={step.id} className="mt-3" data-testid="photo-group">
          <h4 className="text-xs font-medium text-muted-foreground">{step.title}</h4>
          <ul className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(112px,1fr))]">
            {request.photos.filter((photo) => photo.scopeId === step.id).map((photo) => <PhotoTile key={photo.id} photo={photo} label={step.shots.find((shot) => shot.id === photo.shot)?.label ?? step.title} placeholder={local} />)}
          </ul>
        </div>
      ))}
      {(() => { const summary = !asBorrowerView ? photosSummary(request.photos, deal.geo) : null; return summary ? <p className={`mt-2 text-xs ${summary.flagged ? "text-warn" : "text-muted-foreground"}`} data-testid="photo-checks">Where and when: {summary.text}.</p> : null; })()}
      {request.who === "inspector" && draw?.inspection?.requestId === request.id && <p className="mt-2 text-xs text-good" data-testid="inspector-recorded">{draw.inspection.by} recorded the inspection{draw.inspection.notes ? `: ${draw.inspection.notes}` : "."}</p>}
      {received && missing.length > 0 && <p className="mt-2 text-xs text-warn" data-testid="photo-missing">Not sent: {missing.map((item) => `${item.step}, ${item.shot.toLowerCase()}`).join("; ")}</p>}
      {state !== "closed" && canChange && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <button className={`py-1 text-link underline underline-offset-2 disabled:opacity-40 ${phonePill}`} data-testid="photo-renew" disabled={busy} onClick={onRenew}>Make a new link</button>
          {state === "open" && <button className={`py-1 text-link underline underline-offset-2 disabled:opacity-40 ${phonePill}`} data-testid="photo-off" disabled={busy} onClick={onTurnOff}>Turn the link off</button>}
        </div>
      )}
    </li>
  );
}

function PhotoTile({ photo, label, placeholder }: { photo: RequestPhoto; label: string; placeholder: boolean }) {
  // HEIC photos a browser couldn't convert still open as a download.
  const [broken, setBroken] = useState(false);
  const old = looksOld(photo.takenAt, photo.at);
  return (
    <li className="min-w-0" data-testid="photo-received">
      {placeholder || broken ? (
        <a className="grid aspect-square place-items-center overflow-hidden rounded-[2px] border border-border bg-muted p-1 text-center text-[11px] wrap-anywhere text-muted-foreground" href={placeholder ? undefined : `/api/documents/${photo.id}`}>{placeholder ? "Sample photo" : photo.name}</a>
      ) : (
        <a href={`/api/documents/${photo.id}?view=inline`} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-[2px] border border-border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/documents/${photo.id}?view=thumb`} alt={label} loading="lazy" className="size-full object-cover" onError={() => setBroken(true)} />
        </a>
      )}
      <p className="mt-1 text-[11px] leading-tight wrap-anywhere text-muted-foreground">{label}</p>
      <p className="text-[11px] leading-tight text-muted-foreground">{clock(photo.at)}</p>
      {old && <p className="text-[11px] leading-tight text-warn" data-testid="photo-old">File dated {shortDate(photo.takenAt!)}</p>}
      {photo.lat !== undefined && photo.lng !== undefined && <a className="block text-[11px] leading-tight text-link underline underline-offset-2" target="_blank" rel="noreferrer" data-testid="photo-place" href={`https://www.google.com/maps/search/?api=1&query=${photo.lat},${photo.lng}`}>Sent from here</a>}
    </li>
  );
}
