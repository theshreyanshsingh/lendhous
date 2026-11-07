"use client";
import { DrawLienChecklist } from "./DrawLienChecklist";
import { useEffect, useRef, useState } from "react";
import { Camera, ImageIcon, MapPin, X } from "lucide-react";
import { PhotoRequests } from "@/components/loan/PhotoRequests";
import { drawRequestError } from "@/lib/draws";
import { awaitingDecision, claimedFrom, decideByText, drawableLines, lastPhotos, lineProblem } from "@/lib/draw-walk";
import type { Deal, DrawRequest } from "@/lib/mockData";
import { shrinkPhoto } from "@/lib/shrink-photo";
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

type Shot = { key: string; file: File; url: string; takenAt?: string; lat?: number; lng?: number };
type Place = { lat: number; lng: number };

/**
 * The borrower's draws: request money line by line from a phone, a photo of each line's work with the phone's location,
 * and see where each request stands and when they'll hear back.
 */
export function DrawPanel({ deal }: { deal: Deal }) {
  const { s, dispatch, viewerName, uploadPhoto, local, targets } = useStore();
  const e = est(deal.app);
  const released = deal.disbursedDraws ?? 0;
  const left = Math.max(0, e.holdback - released);
  const draws = s.draws.filter((draw) => draw.dealId === deal.id);
  const lines = drawableLines(deal);
  // "pick" chooses the lines, then one page per chosen line, then "finish".
  const [step, setStep] = useState<"closed" | "pick" | number | "finish">("closed");
  const [chosen, setChosen] = useState<string[]>([]);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [claimed, setClaimed] = useState<Record<string, string>>({});
  const [shots, setShots] = useState<Record<string, Shot[]>>({});
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");
  const [sending, setSending] = useState(false);
  const [certified, setCertified] = useState(false);
  const [locating, setLocating] = useState<"off" | "asking" | "on" | "refused" | "none">("off");
  // The clock for "we'll decide by" is the browser's, set after the first render so the server's page matches.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); }, [draws.length]);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { if (step !== "closed") top.current?.scrollIntoView({ block: "nearest" }); }, [step]);
  // Blob previews are freed when the form is done with them.
  const urls = useRef(new Set<string>());
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); }, []);

  const asked = chosen.map((scopeId) => ({ scopeId, requested: amounts[scopeId] ?? 0, claimedPct: claimedFrom(claimed[scopeId] ?? "") }));
  const total = asked.reduce((sum, line) => sum + line.requested, 0);
  const error = total > 0 ? drawRequestError(deal, asked) : null;
  const lineOf = (scopeId: string) => lines.find((line) => line.id === scopeId)!;

  // The phone's location at each photo, so the team can see it was taken at the property. Never required.
  const locate = () => new Promise<Place | null>((resolve) => {
    if (!("geolocation" in navigator)) { setLocating("none"); resolve(null); return; }
    if (locating === "refused") { resolve(null); return; }
    setLocating((state) => (state === "on" ? state : "asking"));
    navigator.geolocation.getCurrentPosition(
      (position) => { setLocating("on"); resolve({ lat: Number(position.coords.latitude.toFixed(5)), lng: Number(position.coords.longitude.toFixed(5)) }); },
      () => { setLocating("refused"); resolve(null); },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  });
  const take = (scopeId: string, files: FileList | null) => {
    const added = Array.from(files ?? []).map((file): Shot => {
      const url = URL.createObjectURL(file);
      urls.current.add(url);
      return { key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, url, ...(file.lastModified ? { takenAt: new Date(file.lastModified).toISOString() } : {}) };
    });
    if (!added.length) return;
    setShots((all) => ({ ...all, [scopeId]: [...(all[scopeId] ?? []), ...added] }));
    void locate().then((place) => {
      if (!place) return;
      const keys = new Set(added.map((shot) => shot.key));
      setShots((all) => ({ ...all, [scopeId]: (all[scopeId] ?? []).map((shot) => (keys.has(shot.key) ? { ...shot, ...place } : shot)) }));
    });
  };
  const drop = (scopeId: string, key: string) => setShots((all) => ({ ...all, [scopeId]: (all[scopeId] ?? []).filter((shot) => shot.key !== key) }));

  const reset = () => { setStep("closed"); setChosen([]); setAmounts({}); setClaimed({}); setShots({}); setNote(""); setContact(""); setCertified(false); };
  const submit = async () => {
    setSending(true);
    // Photos go up first, so the request can point at them, and one at a time, so a phone holds one big picture in memory
    // at once. If one fails, nothing is requested and its error stays up. Demo and sample data keep only the names.
    const taken = chosen.flatMap((scopeId) => (shots[scopeId] ?? []).map((shot) => ({ scopeId, shot })));
    const linePhotos = [];
    for (const { scopeId, shot } of taken) {
      const documentId = local ? undefined : await uploadPhoto(deal.id, await shrinkPhoto(shot.file));
      if (!local && !documentId) { setSending(false); return; }
      linePhotos.push({ scopeId, name: shot.file.name, ...(shot.takenAt ? { takenAt: shot.takenAt } : {}), ...(shot.lat !== undefined ? { lat: shot.lat, lng: shot.lng } : {}), ...(documentId ? { documentId } : {}) });
    }
    const photoIds = linePhotos.flatMap((photo) => (photo.documentId ? [photo.documentId] : []));
    const done = await dispatch({ t: "requestDraw", dealId: deal.id, by: viewerName, note, contact, photos: linePhotos.map((photo) => photo.name), photoIds: local ? undefined : photoIds, lines: asked, linePhotos });
    setSending(false);
    if (done) reset();
  };

  const index = typeof step === "number" ? step : -1;
  const current = index >= 0 ? lineOf(chosen[index]) : null;
  const currentLine = current ? asked[index] : null;
  const problem = current && currentLine ? lineProblem(currentLine, (shots[current.id] ?? []).length) : null;
  const earlier = current ? lastPhotos(s.draws, deal.id, current.id) : null;

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
              {awaitingDecision(draw) && now && <div className="mt-1 text-xs text-foreground" data-testid="draw-decide-by">{decideByText(draw, targets.drawDecision, now)}</div>}
              <DrawLienChecklist deal={deal} draw={draw} side="borrower" />
            </li>
          ))}
        </ul>
      )}
      {step === "closed" && left > 0 && lines.length > 0 && <button className="btn-primary mt-3 w-full" data-testid="request-draw" onClick={() => setStep("pick")}>Request a draw</button>}
      {step === "closed" && left <= 0 && <p className="mt-3 text-sm text-muted-foreground">The whole budget has been released.</p>}
      {step !== "closed" && (
        <div ref={top} className="mt-4 scroll-mt-20 space-y-3 border-t border-border pt-4" data-testid="draw-form">
          {step === "pick" && (
            <>
              <p className="text-sm text-muted-foreground">Which work is finished? You&apos;ll take a photo of each one, so be at the property.</p>
              <ul className="space-y-1">
                {lines.map((line) => (
                  <li key={line.id}>
                    <label className="flex min-h-11 items-center gap-3 rounded-[2px] border border-border px-3 text-sm">
                      <input type="checkbox" data-testid={`draw-pick-${line.id}`} checked={chosen.includes(line.id)} onChange={(event) => setChosen(event.target.checked ? [...chosen, line.id] : chosen.filter((id) => id !== line.id))} />
                      <span className="min-w-0 flex-1">{line.division}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{usd(line.budget - line.released)} left</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary flex-1" data-testid="draw-next" disabled={!chosen.length} onClick={() => { setChosen(lines.map((line) => line.id).filter((id) => chosen.includes(id))); setStep(0); }}>Next</button>
                <button className="btn-ghost" onClick={reset}>Cancel</button>
              </div>
            </>
          )}
          {current && currentLine && (
            <div data-testid="draw-line">
              <p className="text-xs text-muted-foreground">Line {index + 1} of {chosen.length}</p>
              <h3 className="mt-0.5 text-base font-medium text-foreground">{current.division}</h3>
              <p className="text-xs text-muted-foreground">{usd(current.budget - current.released)} left on this line</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="label">Amount for finished work</span><input aria-label={`Amount for ${current.division}`} data-testid={`draw-${current.id}`} className="desk-input" inputMode="numeric" placeholder="0" value={amounts[current.id] ? amounts[current.id].toLocaleString("en-US") : ""} onChange={(event) => setAmounts({ ...amounts, [current.id]: Number(event.target.value.replace(/[^0-9]/g, "")) || 0 })} /></label>
                <label className="block"><span className="label">How far along is it? (%)</span><input aria-label={`Percent finished for ${current.division}`} data-testid={`draw-pct-${current.id}`} className="desk-input" type="number" inputMode="numeric" min={0} max={100} placeholder="0 to 100" value={claimed[current.id] ?? ""} onChange={(event) => setClaimed({ ...claimed, [current.id]: event.target.value })} /></label>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <p className="label">Now</p>
                  {(shots[current.id] ?? []).length > 0 && (
                    <ul className="mb-2 grid grid-cols-3 gap-2" data-testid="draw-shots">
                      {(shots[current.id] ?? []).map((shot) => (
                        <li key={shot.key} className="relative aspect-square overflow-hidden rounded-[2px] border border-border bg-accent">
                          <Thumb src={shot.url} name={shot.file.name} alt={`New photo of ${current.division}`} />
                          <button type="button" className="absolute top-1 right-1 inline-flex size-7 items-center justify-center rounded-full bg-background/90" aria-label="Remove this photo" onClick={() => drop(current.id, shot.key)}><X className="size-3.5" /></button>
                          {shot.lat !== undefined && <MapPin className="absolute bottom-1 left-1 size-4 text-good" aria-label="Location saved" />}
                        </li>
                      ))}
                    </ul>
                  )}
                  <label className="btn-ghost inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2">
                    <Camera className="size-4" aria-hidden="true" />{(shots[current.id] ?? []).length ? "Take another" : "Take a photo"}
                    <input data-testid={`draw-photo-${current.id}`} type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(event) => { take(current.id, event.target.files); event.target.value = ""; }} />
                  </label>
                  <p className="mt-1 text-xs text-muted-foreground" data-testid="draw-locating">
                    {locating === "on" ? "Your phone's location is saved with each photo." : locating === "asking" ? "Asking your phone where you are…" : locating === "refused" ? "No location: that's fine, the team may ask for an inspection instead." : locating === "none" ? "This browser can't share a location." : "Your phone will ask to share your location, so we know the photo is from the property."}
                  </p>
                </div>
                <div className="min-w-0" data-testid="draw-last-photo">
                  <p className="label">Last time</p>
                  {earlier ? (
                    <>
                      <ul className="grid grid-cols-3 gap-2">
                        {earlier.photos.slice(0, 3).map((photo) => (
                          <li key={photo.id} className="aspect-square overflow-hidden rounded-[2px] border border-border bg-accent">
                            <Thumb src={photo.documentId ? `/api/documents/${photo.documentId}?view=thumb` : undefined} name={photo.name} alt={`Earlier photo of ${current.division}`} />
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-xs text-muted-foreground">From your draw on {shortDate(earlier.on)}. Take the new one from the same spot.</p>
                    </>
                  ) : <p className="text-xs text-muted-foreground">No earlier photos of this line.</p>}
                </div>
              </div>
              {problem && (amounts[current.id] ?? 0) > 0 && <p className="mt-3 text-xs text-warn" data-testid="draw-line-problem">{problem}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-primary flex-1" data-testid="draw-next" disabled={Boolean(problem)} onClick={() => setStep(index + 1 < chosen.length ? index + 1 : "finish")}>{index + 1 < chosen.length ? "Next line" : "Next"}</button>
                <button className="btn-ghost" data-testid="draw-back" onClick={() => setStep(index > 0 ? index - 1 : "pick")}>Back</button>
              </div>
            </div>
          )}
          {step === "finish" && (
            <>
              <ul className="divide-y divide-border text-sm" data-testid="draw-summary-lines">
                {asked.map((line) => <li key={line.scopeId} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5"><span className="min-w-0">{lineOf(line.scopeId).division} <small className="text-xs text-muted-foreground">· {Math.round((line.claimedPct ?? 0) * 100)}% done · {(shots[line.scopeId] ?? []).length} photo{(shots[line.scopeId] ?? []).length === 1 ? "" : "s"}</small></span><b className="tabular-nums">{usd(line.requested)}</b></li>)}
              </ul>
              <label className="block"><span className="label">What was finished</span><textarea data-testid="draw-note" rows={2} className="desk-input h-auto! py-2" value={note} onChange={(event) => setNote(event.target.value)} /></label>
              <label className="block"><span className="label">Who should the inspector call?</span><input data-testid="draw-contact" className="desk-input" placeholder="Name and phone" value={contact} onChange={(event) => setContact(event.target.value)} /></label>
              <label className="flex items-start gap-2 text-sm"><input data-testid="draw-certify" type="checkbox" className="mt-1" checked={certified} onChange={(event) => setCertified(event.target.checked)} /> I certify this work is finished as described and the photos are of this property. Funds go to the verified bank account on file.</label>
              {error && <p role="alert" className="text-sm text-bad">{error}</p>}
              <p className="text-xs text-muted-foreground">We aim to decide within {targets.drawDecision.hours} {targets.drawDecision.business ? "business " : ""}hours, and tell you the time once it&apos;s sent.</p>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary flex-1" data-testid="submit-draw" disabled={sending || total <= 0 || Boolean(error) || !certified || !contact.trim()} onClick={() => void submit()}>{sending ? "Sending…" : `Request ${usd(total)}`}</button>
                <button className="btn-ghost" data-testid="draw-back" onClick={() => setStep(chosen.length - 1)}>Back</button>
              </div>
            </>
          )}
        </div>
      )}
      <div className="mt-4 border-t border-border pt-4"><PhotoRequests deal={deal} asBorrower /></div>
    </Section>
  );
}

/** A photo, or its file name where there's no file (demo) or the browser can't show it (some phones' HEIC photos). */
function Thumb({ src, name, alt }: { src?: string; name: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  // eslint-disable-next-line @next/next/no-img-element
  if (src && !broken) return <img src={src} alt={alt} className="size-full object-cover" onError={() => setBroken(true)} />;
  return <span className="flex size-full flex-col items-center justify-center gap-1 p-1 text-center text-[10px] break-all text-muted-foreground"><ImageIcon className="size-4" aria-hidden="true" />{name}</span>;
}
