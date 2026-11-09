"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, Check, Loader2, MapPin, RotateCcw, X } from "lucide-react";
import { Logo } from "@/components/logo";
import { missingShots, type GuideStep } from "@/lib/photo-requests";
import { shrinkPhoto } from "@/lib/shrink-photo";
import { photoPrints } from "@/lib/photo-prints";

type Sent = { id: string; scopeId: string; shot: string; name: string };
type Tile = { key: string; scopeId: string; shot: string; state: "sending" | "sent" | "failed"; url: string; photoId?: string; file?: File; error?: string };

const TIPS = [
  "Be at the property, and take new photos rather than using old ones.",
  "Stand back to get the whole space first, then move in on the finished work.",
  "Turn the lights on and hold still, so nothing is blurry.",
  "Keep people's faces and private papers out of the shot.",
];

/** The page a contractor or borrower opens from a link: one budget line at a time, saying exactly what to photograph. */
/** What the borrower said about each line when they asked for the draw, for the inspector to check against. */
export type Claims = Record<string, { pct?: number; photos: { id: string; name: string }[] }>;

export function PhotoGuide({ token, to, sentBy, address, steps, photos, finished, finishedBy, note: sentNote, expiresAt, signsDraw = false, inspects = false, afterStorm = false, claims = {} }: { token: string | null; to: string; sentBy: string; address: string; steps: GuideStep[]; photos: Sent[]; finished: boolean; finishedBy: string; note: string; expiresAt: string; signsDraw?: boolean; inspects?: boolean; afterStorm?: boolean; claims?: Claims }) {
  const [tiles, setTiles] = useState<Tile[]>(() => photos.map((photo) => ({ key: photo.id, scopeId: photo.scopeId, shot: photo.shot, state: "sent", photoId: photo.id, url: `/api/photo-links/${token}/${photo.id}` })));
  // 0 is the welcome, then one page per guide step, then the review.
  const [page, setPage] = useState(0);
  const [done, setDone] = useState(finished);
  // Coming back to add more starts from what they sent last time, so a second send doesn't wipe the first note.
  const [name, setName] = useState(finishedBy || to);
  const [note, setNote] = useState(sentNote);
  const [confirmed, setConfirmed] = useState(false);
  // The contractor on a draw also signs off the work itself, as competitors' draw forms ask (lib/budget.ts).
  const [signed, setSigned] = useState(false);
  // An inspector also says how far along each line on the draw is (lib/photo-checks.ts), which records the inspection.
  const workLines = steps.filter((step) => step.id !== "property");
  const [observed, setObserved] = useState<Record<string, string>>({});
  const observedReady = !inspects || workLines.every((step) => observed[step.id] !== undefined && observed[step.id] !== "" && Number(observed[step.id]) >= 0 && Number(observed[step.id]) <= 100);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [locating, setLocating] = useState<"off" | "asking" | "on" | "refused">("off");
  const place = useRef<{ lat: number; lng: number } | null>(null);
  // Photos go up one at a time, so a weak signal only ever has one to carry.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const removed = useRef(new Set<string>());

  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { top.current?.scrollIntoView(); }, [page, done]);

  const reviewPage = steps.length + 1;
  const sent = tiles.filter((tile) => tile.state === "sent");
  const busy = tiles.some((tile) => tile.state === "sending");
  const failed = tiles.filter((tile) => tile.state === "failed");
  const missing = missingShots(steps, sent.map((tile) => ({ scopeId: tile.scopeId, shot: tile.shot })));
  const patch = (key: string, changes: Partial<Tile>) => setTiles((all) => all.map((tile) => (tile.key === key ? { ...tile, ...changes } : tile)));

  const upload = async (tile: Tile, file: File) => {
    if (removed.current.has(tile.key)) return;
    if (!token) { patch(tile.key, { state: "sent", photoId: tile.key }); return; }
    try {
      const small = await shrinkPhoto(file);
      const form = new FormData();
      form.set("file", small);
      // The picture's difference hash, so the team sees a photo sent before (lib/photo-checks.ts). The server hashes the file.
      const { dhash } = await photoPrints(small);
      if (dhash) form.set("dhash", dhash);
      form.set("scopeId", tile.scopeId);
      form.set("shot", tile.shot);
      if (file.lastModified) form.set("takenAt", new Date(file.lastModified).toISOString());
      if (place.current) { form.set("lat", String(place.current.lat)); form.set("lng", String(place.current.lng)); }
      // A request that hangs would hold up every photo behind it.
      const response = await fetch(`/api/photo-links/${token}`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 413 ? "This photo is too large." : body.error || "It didn't send.");
      patch(tile.key, { state: "sent", photoId: body.photo.id, file: undefined });
    } catch (problem) {
      const offline = problem instanceof TypeError || (problem instanceof DOMException && problem.name === "TimeoutError");
      patch(tile.key, { state: "failed", error: offline ? "No connection. Try again." : problem instanceof Error ? problem.message : "It didn't send." });
    }
  };
  // Marked as sending at once, so a second tap on retry can't send it twice.
  const enqueue = (tile: Tile, file: File) => {
    patch(tile.key, { state: "sending", error: undefined });
    queue.current = queue.current.then(() => upload(tile, file));
  };

  const pick = (scopeId: string, shot: string, files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      const tile: Tile = { key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, scopeId, shot, state: "sending", url: URL.createObjectURL(file), file };
      setTiles((all) => [...all, tile]);
      enqueue(tile, file);
    }
  };
  const remove = async (tile: Tile) => {
    if (token && tile.photoId) {
      const response = await fetch(`/api/photo-links/${token}?photo=${encodeURIComponent(tile.photoId)}`, { method: "DELETE" }).catch(() => null);
      if (!response?.ok) { setError("That photo couldn't be removed. Try again."); return; }
    }
    setError("");
    removed.current.add(tile.key);
    if (tile.url.startsWith("blob:")) URL.revokeObjectURL(tile.url);
    setTiles((all) => all.filter((item) => item.key !== tile.key));
  };
  const askForPlace = () => {
    setLocating("asking");
    navigator.geolocation.getCurrentPosition(
      (position) => { place.current = { lat: Number(position.coords.latitude.toFixed(5)), lng: Number(position.coords.longitude.toFixed(5)) }; setLocating("on"); },
      () => setLocating("refused"),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };
  const send = async () => {
    setSending(true);
    setError("");
    if (token) {
      const response = await fetch(`/api/photo-links/${token}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, note, confirmed, ...(inspects ? { observed: Object.fromEntries(workLines.map((step) => [step.id, Number(observed[step.id])])) } : {}), signDraw: signsDraw && signed }) }).catch(() => null);
      const body = await response?.json().catch(() => ({}));
      if (!response?.ok) { setSending(false); setError(body?.error || "That didn't go through. Check your connection and try again."); return; }
    }
    setSending(false);
    setDone(true);
  };

  const first = to.split(" ")[0];
  return (
    <div className="min-h-screen" ref={top}>
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-4"><Logo /><span className="text-xs text-muted-foreground">{done ? "Sent" : page === 0 ? "Photos" : page === reviewPage ? "Last step" : `Step ${page} of ${steps.length}`}</span></div>
        {!done && <div className="h-1 bg-accent"><div className="h-1 bg-brand transition-all" style={{ width: `${(page / reviewPage) * 100}%` }} /></div>}
      </header>
      {!token && <p className="bg-warn/12 px-4 py-2 text-center text-xs text-warn" data-testid="photo-preview">This is a preview. Nothing you add here is sent or saved.</p>}
      <main className="mx-auto max-w-xl px-4 py-6" data-testid="photo-guide">
        {done ? (
          <div data-testid="photo-done">
            <p className="eyebrow">Sent to LendHous</p>
            <h1 className="mt-2 text-3xl font-normal text-foreground">Thanks, {first}. They have your photos.</h1>
            <p className="mt-3 text-sm text-muted-foreground">You can close this page. Did you miss something? You can add more{expiresAt ? ` until ${new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/Los_Angeles" })}` : ""}.</p>
            <button className="btn-ghost mt-5" data-testid="photo-add-more" onClick={() => { setDone(false); setPage(1); setConfirmed(false); }}>Add more photos</button>
          </div>
        ) : page === 0 ? (
          <div>
            <p className="eyebrow">Photos for LendHous</p>
            <h1 className="mt-2 text-3xl font-normal text-foreground">Hi {first}. {afterStorm ? "We need photos of the property after the storm." : "We need photos of the finished work."}</h1>
            <p className="mt-3 text-sm text-muted-foreground">{afterStorm ? <>We hope everyone is safe. Only go once it&apos;s safe to. </> : null}{sentBy} asked for photos of <b className="font-medium text-foreground">{address}</b>. It takes a few minutes on your phone, and you don&apos;t need an account.</p>
            <div className="glass mt-5 p-4">
              <h2 className="eyebrow">What makes a good photo</h2>
              <ul className="mt-3 space-y-2 text-sm">{TIPS.map((tip) => <li key={tip} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-good" aria-hidden="true" /><span>{tip}</span></li>)}</ul>
            </div>
            <div className="glass mt-3 p-4">
              <h2 className="eyebrow">What we&apos;ll ask for</h2>
              <ol className="mt-3 space-y-1 text-sm" data-testid="photo-outline">{steps.map((step, index) => <li key={step.id}>{index + 1}. {step.title}</li>)}</ol>
            </div>
            <div className="glass mt-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1 basis-52"><h2 className="text-sm font-medium">Share your location?</h2><p className="mt-1 text-xs text-muted-foreground">It shows LendHous the photos were taken at the property. You can skip this.</p></div>
                {locating === "on" ? <span className="inline-flex items-center gap-1 text-sm text-good" data-testid="photo-location-on"><MapPin size={16} aria-hidden="true" />Location on</span> : <button className="btn-ghost" disabled={locating === "asking"} onClick={askForPlace}><MapPin size={16} aria-hidden="true" />{locating === "asking" ? "Asking…" : "Share location"}</button>}
              </div>
              {locating === "refused" && <p className="mt-2 text-xs text-muted-foreground">No problem. The photos will still go through.</p>}
            </div>
            <button className="btn-primary mt-5 h-12! w-full" data-testid="photo-start" onClick={() => setPage(1)}>Start</button>
            <p className="mt-3 text-center text-xs text-muted-foreground">Your photos are encrypted and only go to LendHous.</p>
          </div>
        ) : page === reviewPage ? (
          <div data-testid="photo-review">
            <p className="eyebrow">Last step</p>
            <h1 className="mt-2 text-3xl font-normal text-foreground">Check it and send.</h1>
            <ul className="glass mt-5 divide-y divide-border px-4">
              {steps.map((step, index) => {
                const count = sent.filter((tile) => tile.scopeId === step.id).length;
                const gaps = missing.filter((item) => item.step === step.title);
                return (
                  <li key={step.id} className="flex items-center justify-between gap-3 py-3">
                    <button className="min-w-0 text-left text-sm" onClick={() => setPage(index + 1)}><span className="font-medium underline-offset-2 hover:underline">{step.title}</span>{gaps.length > 0 && <span className="mt-0.5 block text-xs text-warn">No photo yet: {gaps.map((gap) => gap.shot).join(", ")}</span>}</button>
                    <span className="shrink-0 text-xs text-muted-foreground">{count} photo{count === 1 ? "" : "s"}</span>
                  </li>
                );
              })}
            </ul>
            {failed.length > 0 && <p role="alert" className="mt-3 text-sm text-bad">{failed.length} photo{failed.length === 1 ? "" : "s"} didn&apos;t send. Go back to try again or remove {failed.length === 1 ? "it" : "them"}.</p>}
            <label className="mt-5 block"><span className="label">Your name</span><input className="desk-input" data-testid="photo-name" value={name} maxLength={120} autoComplete="name" onChange={(event) => setName(event.target.value)} /></label>
            <label className="mt-3 block"><span className="label">Anything LendHous should know? (optional)</span><textarea className="desk-input h-auto! py-2" data-testid="photo-note" rows={3} maxLength={2000} value={note} placeholder="For example, what's still left to finish." onChange={(event) => setNote(event.target.value)} /></label>
            <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" data-testid="photo-confirm" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />These photos show this property as it is now.</label>
            {inspects && (
              <fieldset className="mt-4 space-y-2" data-testid="inspector-lines">
                <legend className="label">How far along is each line? (percent complete)</legend>
                {workLines.map((step) => {
                  const claim = claims[step.id];
                  return (
                    <div key={step.id} className="border-b border-border pb-2 last:border-0" data-testid="inspector-line">
                      <label className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0">{step.title}{claim?.pct !== undefined && <small className="block text-xs text-muted-foreground" data-testid="inspector-claim">The borrower says {Math.round(claim.pct * 100)}%</small>}</span><input className="desk-input w-24!" type="number" inputMode="numeric" min={0} max={100} data-testid={`inspector-pct-${step.id}`} value={observed[step.id] ?? ""} onChange={(event) => setObserved({ ...observed, [step.id]: event.target.value })} /></label>
                      {claim?.photos.length ? (
                        <ul className="mt-1 flex gap-1.5 overflow-x-auto" aria-label={`The borrower's photos of ${step.title}`}>
                          {claim.photos.map((photo) => <li key={photo.id} className="size-14 shrink-0 overflow-hidden rounded-[2px] border border-border bg-accent">{token
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={`/api/photo-links/${token}/${photo.id}`} alt={photo.name} className="size-full object-cover" loading="lazy" />
                            : <span className="flex size-full items-center justify-center p-0.5 text-center text-[9px] break-all text-muted-foreground">{photo.name}</span>}</li>)}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
              </fieldset>
            )}
            {signsDraw && <label className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" data-testid="photo-sign-draw" checked={signed} onChange={(event) => setSigned(event.target.checked)} />I&apos;m the contractor, and the work on these lines is done as these photos show. My name below is my signature.</label>}
            {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
            <div className="sticky bottom-0 mt-5 flex gap-2 bg-background py-3">
              <button className="btn-ghost h-12!" onClick={() => setPage(steps.length)}>Back</button>
              <button className="btn-primary h-12! flex-1" data-testid="photo-send" disabled={sending || busy || failed.length > 0 || !sent.length || !confirmed || !name.trim() || !observedReady} onClick={() => void send()}>{sending ? "Sending…" : busy ? "Still uploading…" : `Send ${sent.length} photo${sent.length === 1 ? "" : "s"}`}</button>
            </div>
          </div>
        ) : (
          <GuidePage step={steps[page - 1]} number={page} total={steps.length} tiles={tiles} error={error} onPick={pick} onRemove={(tile) => void remove(tile)} onRetry={(tile) => { if (tile.file) enqueue(tile, tile.file); }} onBack={() => setPage(page - 1)} onNext={() => setPage(page + 1)} />
        )}
      </main>
    </div>
  );
}

function GuidePage({ step, number, total, tiles, error, onPick, onRemove, onRetry, onBack, onNext }: { step: GuideStep; number: number; total: number; tiles: Tile[]; error: string; onPick: (scopeId: string, shot: string, files: FileList | null) => void; onRemove: (tile: Tile) => void; onRetry: (tile: Tile) => void; onBack: () => void; onNext: () => void }) {
  const added = tiles.filter((tile) => tile.scopeId === step.id).length;
  return (
    <div data-testid={`photo-step-${step.id}`}>
      <p className="eyebrow">Step {number} of {total}</p>
      <h1 className="mt-2 text-3xl font-normal text-foreground">{step.title}</h1>
      <div className="mt-5 space-y-3">
        {step.shots.map((shot) => {
          const mine = tiles.filter((tile) => tile.scopeId === step.id && tile.shot === shot.id);
          return (
            <section key={shot.id} className="glass p-4" data-testid={`shot-${step.id}-${shot.id}`}>
              <div className="flex items-start justify-between gap-2"><h2 className="text-sm font-medium">{shot.label}</h2>{mine.some((tile) => tile.state === "sent") && <Check size={18} className="shrink-0 text-good" aria-label="Added" />}</div>
              <p className="mt-1 text-sm text-muted-foreground">{shot.tip}</p>
              {mine.length > 0 && (
                <ul className="mt-3 grid grid-cols-3 gap-2">
                  {mine.map((tile) => (
                    <li key={tile.key} className="relative aspect-square overflow-hidden rounded-[2px] border border-border bg-muted" data-testid="photo-tile" data-state={tile.state}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={tile.url} alt={shot.label} className={`size-full object-cover ${tile.state === "sent" ? "" : "opacity-50"}`} />
                      {tile.state === "sending" && <span className="absolute inset-0 grid place-items-center"><Loader2 size={22} className="animate-spin text-foreground" aria-label="Sending" /></span>}
                      {tile.state === "failed" && <button className="absolute inset-0 grid place-items-center bg-bad/15 px-1 text-center text-xs font-medium text-bad" data-testid="photo-retry" onClick={() => onRetry(tile)}><span><RotateCcw size={18} className="mx-auto mb-1" aria-hidden="true" />{tile.error ?? "Try again"}</span></button>}
                      {tile.state !== "sending" && <button aria-label="Remove this photo" data-testid="photo-remove" className="absolute top-1 right-1 grid size-8 place-items-center rounded-full bg-foreground/70 text-background" onClick={() => onRemove(tile)}><X size={16} aria-hidden="true" /></button>}
                    </li>
                  ))}
                </ul>
              )}
              <label className="btn-ghost mt-3 h-12! w-full cursor-pointer"><Camera size={18} aria-hidden="true" />{mine.length ? "Add another" : "Take or choose a photo"}<input type="file" accept="image/*" multiple className="sr-only" data-testid={`shot-input-${step.id}-${shot.id}`} onChange={(event) => { onPick(step.id, shot.id, event.target.files); event.target.value = ""; }} /></label>
            </section>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
      <div className="sticky bottom-0 mt-5 flex gap-2 bg-background py-3">
        <button className="btn-ghost h-12!" onClick={onBack}>Back</button>
        <button className="btn-primary h-12! flex-1" data-testid="photo-next" onClick={onNext}>{added ? "Next" : "Skip for now"}</button>
      </div>
    </div>
  );
}
