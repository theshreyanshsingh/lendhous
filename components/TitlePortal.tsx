"use client";
import { Check, FileUp, Lock } from "lucide-react";
import { useRef, useState } from "react";
import { titleConfirmFunds, titleEnterWire, titleRecordMortgage, titleVerifySeller } from "@/actions/title-links";
import { Logo } from "@/components/logo";
import { Arrive, Reveal } from "@/components/motion";
import { wireProblem, type TitleView } from "@/lib/closing";
import type { SellerIdMethod } from "@/lib/mockData";
import { ID_METHODS, methodWords } from "@/lib/seller-checks";
import { servicingDate } from "@/lib/servicing";
import { shortDay } from "@/lib/format";

const usd = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS: Record<string, [string, string]> = { requested: ["Needed", "bg-warn/12 text-warn"], uploaded: ["Sent, being checked", "bg-link/10 text-link"], in_review: ["Being checked", "bg-link/10 text-link"], accepted: ["Accepted", "bg-good/10 text-good"], rejected: ["Send it again", "bg-bad/10 text-bad"], waived: ["Not needed", "bg-muted text-muted-foreground"] };
const GROUPS: [string, (stage: string | null) => boolean][] = [["Before clear to close", (stage) => !stage], ["At closing", (stage) => stage === "funding"], ["After closing", (stage) => stage === "post_close"]];

/**
 * The title company's secure closing file (Spec T1–T3): what to send, its own wire instructions, and funding and
 * recording. With no token it's a preview that sends nothing.
 */
export function TitlePortal({ token, initial, expiresAt }: { token: string | null; initial: TitleView; expiresAt: string }) {
  const [view, setView] = useState(initial);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [wireOpen, setWireOpen] = useState(!initial.wire);
  const [wire, setWire] = useState({ bankName: "", beneficiary: "", routing: "", account: "", confirm: "", reference: initial.fileNumber });
  const [funds, setFunds] = useState({ amount: "", on: "" });
  const [recording, setRecording] = useState({ on: "", reference: "" });
  const file = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState("");
  const today = servicingDate(new Date());
  const said = (reply: { view?: TitleView; error?: string }, done: string) => { if (reply.view) { setView(reply.view); setNotice(done); setError(""); } else setError(reply.error ?? "That didn't go through."); };

  const upload = async (docId: string, chosen: File) => {
    setBusy(docId); setError(""); setNotice("");
    if (!token) { setView({ ...view, items: view.items.map((item) => (item.id === docId ? { ...item, status: "uploaded", fileName: chosen.name } : item)) }); setBusy(""); return; }
    const form = new FormData();
    form.set("docId", docId); form.set("file", chosen);
    const response = await fetch(`/api/closing-links/${token}`, { method: "POST", body: form }).catch(() => null);
    const body = response ? ((await response.json().catch(() => ({}))) as { view?: TitleView; error?: string }) : { error: "That didn't upload. Check your connection and try again." };
    setBusy("");
    said(body, `${chosen.name} sent. LendHous will check it.`);
  };
  const cleanWire = { bankName: wire.bankName, beneficiary: wire.beneficiary, routing: wire.routing.replace(/\s/g, ""), account: wire.account.replace(/\s/g, ""), reference: wire.reference, source: "Title company's secure portal" };
  const wireRefused = wire.bankName || wire.routing || wire.account ? wireProblem(cleanWire) ?? (cleanWire.account !== wire.confirm.replace(/\s/g, "") ? "The two account numbers don't match." : null) : null;
  const sendWire = async () => {
    setBusy("wire");
    if (!token) { setView({ ...view, wire: { bankName: wire.bankName, beneficiary: wire.beneficiary, account: `•••• ${cleanWire.account.slice(-4)}`, verified: false, enteredAt: new Date().toISOString() } }); setWireOpen(false); setBusy(""); return; }
    const reply = await titleEnterWire(token, { bankName: cleanWire.bankName, beneficiary: cleanWire.beneficiary, routing: cleanWire.routing, account: cleanWire.account, reference: cleanWire.reference }).catch(() => ({ error: "That didn't go through." }));
    setBusy("");
    said(reply, "Saved. LendHous will call your office to confirm them before any money is sent.");
    if ("view" in reply && reply.view) { setWireOpen(false); setWire({ ...wire, routing: "", account: "", confirm: "" }); }
  };
  const confirmFunds = async () => {
    setBusy("funds");
    const amount = Number(funds.amount.replace(/[^0-9.]/g, ""));
    if (!token) { setView({ ...view, fundsReceived: { amount, on: funds.on, by: "You", at: new Date().toISOString() } }); setBusy(""); return; }
    said(await titleConfirmFunds(token, { amount, on: funds.on }).catch(() => ({ error: "That didn't go through." })), "Thank you. LendHous has your confirmation.");
    setBusy("");
  };
  const saveRecording = async () => {
    setBusy("recording");
    if (!token) { setView({ ...view, recording: { ...recording, by: "You", at: new Date().toISOString() } }); setBusy(""); return; }
    said(await titleRecordMortgage(token, recording).catch(() => ({ error: "That didn't go through." })), "Recording saved. Upload the recorded copy above.");
    setBusy("");
  };
  const atClosing = ["closing"].includes(view.status) || view.funded;

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-primary text-primary-foreground"><div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3"><span className="[&_*]:text-primary-foreground!"><Logo /></span><span className="flex items-center gap-1.5 text-xs opacity-80"><Lock size={12} aria-hidden="true" /> Secure closing file</span></div></header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6" data-testid="title-portal">
        <section className="glass p-5">
          <p className="eyebrow">Closing file{view.company ? ` for ${view.company}` : ""}</p>
          <h1 className="mt-2 text-2xl font-normal tracking-tight">{view.address}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{view.sentBy} opened this file. Upload what&apos;s on the checklist and give us your escrow account&apos;s wire instructions here, never by email. It works until {new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4" data-testid="title-summary">
            <div><dt className="text-xs text-muted-foreground">Loan</dt><dd className="font-medium">{view.loanNumber}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Loan amount</dt><dd className="font-medium">{usd(view.noteAmount)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Borrower (vesting)</dt><dd className="font-medium wrap-anywhere">{view.entity}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Target closing</dt><dd className="font-medium">{shortDay(view.closingDate)}</dd></div>
          </dl>
        </section>

        <Reveal open={Boolean(error || notice)}>
          <p className={`rounded-[2px] p-3 text-sm ${error ? "bg-bad/10 text-bad" : "bg-good/10 text-good"}`} role={error ? "alert" : "status"} data-testid="title-message">{error || notice}</p>
        </Reveal>

        {view.updates.length > 0 && <TitleSearches token={token} view={view} onView={setView} onSaid={(text, failed) => { setNotice(failed ? "" : text); setError(failed ? text : ""); }} />}
        {view.sellerCheck && !view.funded && <SellerIdCard token={token} view={view} onView={setView} onSaid={(text, failed) => { setNotice(failed ? "" : text); setError(failed ? text : ""); }} />}

        <section className="glass p-5">
          <h2 className="eyebrow">Closing checklist</h2>
          <input ref={file} type="file" className="hidden" data-testid="title-file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx" onChange={(event) => { const chosen = event.target.files?.[0]; if (chosen && target) void upload(target, chosen); event.target.value = ""; }} />
          {view.items.length === 0 && <p className="mt-2 text-sm text-muted-foreground">Nothing on the checklist yet.</p>}
          {GROUPS.map(([title, test]) => {
            const items = view.items.filter((item) => test(item.stage));
            if (!items.length) return null;
            return (
              <div key={title} className="mt-3">
                <p className="text-xs text-muted-foreground">{title}</p>
                <ul className="mt-1 divide-y divide-border rounded-[2px] border border-border">
                  {items.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 p-3" data-testid={`title-item-${item.id}`}>
                      <div className="min-w-0"><p className="text-sm font-medium">{item.name}</p>{item.fileName && <p className="truncate text-xs text-muted-foreground">{item.fileName}</p>}</div>
                      <span className="flex items-center gap-2">
                        <span className={`rounded-[2px] px-2 py-0.5 text-xs font-medium ${STATUS[item.status][1]}`}>{STATUS[item.status][0]}</span>
                        {item.status !== "accepted" && item.status !== "waived" && <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid={`title-upload-${item.id}`} disabled={busy === item.id} onClick={() => { setTarget(item.id); file.current?.click(); }}><FileUp size={14} aria-hidden="true" /> {busy === item.id ? "Sending…" : item.fileName ? "Replace" : "Upload"}</button>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>

        <section className="glass space-y-3 p-5">
          <h2 className="eyebrow">Your escrow account&apos;s wire instructions</h2>
          {view.wire && (
            <div className="text-sm" data-testid="title-wire">
              <p>On file: <b className="font-medium">{view.wire.beneficiary}</b> at {view.wire.bankName}, account {view.wire.account}.</p>
              <p className={`mt-1 flex items-center gap-1.5 text-xs ${view.wire.verified ? "text-good" : "text-warn"}`}>{view.wire.verified ? <><Check size={13} aria-hidden="true" /> Confirmed by LendHous by phone.</> : "Waiting for LendHous to call your office to confirm them."}</p>
            </div>
          )}
          {!wireOpen && view.wire && !view.funded && <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="title-change-wire" onClick={() => setWireOpen(true)}>Give us new instructions</button>}
          <Reveal open={wireOpen && !view.funded}>
            <div className="space-y-3" data-testid="title-wire-form">
              {view.wire && <p className="rounded-[2px] bg-warn/10 p-3 text-xs">New instructions replace the ones on file. LendHous will call your office again to confirm them, and nothing is sent until it has.</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                {([["bankName", "Bank"], ["beneficiary", "Account name"], ["routing", "Routing number"], ["reference", "Reference for the wire (your file number)"], ["account", "Account number"], ["confirm", "Account number again"]] as const).map(([key, label]) => (
                  <label key={key} className="block min-w-0"><span className="label">{label}</span><input className="desk-input" data-testid={`title-wire-${key}`} autoComplete="off" inputMode={key === "routing" || key === "account" || key === "confirm" ? "numeric" : undefined} maxLength={160} value={wire[key]} onChange={(event) => setWire({ ...wire, [key]: event.target.value })} /></label>
                ))}
              </div>
              {wireRefused && <p className="text-xs text-warn" data-testid="title-wire-blocked">{wireRefused}</p>}
              <p className="text-xs text-muted-foreground">LendHous never takes wire instructions by email, and will call your office at a number it looks up itself to confirm these.</p>
              <button type="button" className="btn-primary" data-testid="title-save-wire" disabled={Boolean(wireRefused) || !cleanWire.routing || !cleanWire.account || busy === "wire"} onClick={() => void sendWire()}>{busy === "wire" ? "Saving…" : "Save the instructions"}</button>
            </div>
          </Reveal>
        </section>

        {atClosing && (
          <Arrive className="glass space-y-3 p-5">
            <h2 className="eyebrow">Funding and recording</h2>
            {view.fundsReceived ? (
              <p className="text-sm" data-testid="title-funds-done"><Check size={14} className="mr-1 inline text-good" aria-hidden="true" />You confirmed {usd(view.fundsReceived.amount)} reached escrow on {shortDay(view.fundsReceived.on)}.</p>
            ) : (
              <div className="flex flex-wrap items-end gap-2" data-testid="title-funds-form">
                <label className="block min-w-0 flex-1 basis-40"><span className="label">Amount received in escrow</span><input className="desk-input" inputMode="decimal" data-testid="title-funds-amount" value={funds.amount} onChange={(event) => setFunds({ ...funds, amount: event.target.value })} /></label>
                <label className="block"><span className="label">Received on</span><input className="desk-input" type="date" max={today} data-testid="title-funds-on" value={funds.on} onChange={(event) => setFunds({ ...funds, on: event.target.value })} /></label>
                <button type="button" className="btn-primary h-10!" data-testid="title-confirm-funds" disabled={!funds.amount || !funds.on || busy === "funds"} onClick={() => void confirmFunds()}>We have the funds</button>
              </div>
            )}
            {view.funded && (view.recording ? (
              <p className="text-sm" data-testid="title-recorded"><Check size={14} className="mr-1 inline text-good" aria-hidden="true" />Recorded {shortDay(view.recording.on)} ({view.recording.reference}).</p>
            ) : (
              <div className="flex flex-wrap items-end gap-2" data-testid="title-recording-form">
                <label className="block"><span className="label">Mortgage recorded on</span><input className="desk-input" type="date" max={today} data-testid="title-recorded-on" value={recording.on} onChange={(event) => setRecording({ ...recording, on: event.target.value })} /></label>
                <label className="block min-w-0 flex-1 basis-48"><span className="label">Book and page, or instrument number</span><input className="desk-input" data-testid="title-recorded-reference" maxLength={200} value={recording.reference} onChange={(event) => setRecording({ ...recording, reference: event.target.value })} /></label>
                <button type="button" className="btn-primary h-10!" data-testid="title-save-recording" disabled={!recording.on || !recording.reference.trim() || busy === "recording"} onClick={() => void saveRecording()}>Save</button>
              </div>
            ))}
          </Arrive>
        )}

        <section className="glass p-5 text-sm">
          <h2 className="eyebrow">Lender&apos;s closing instructions</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Insure LendHous LLC, its successors and assigns, as lender for the full loan amount.</li>
            <li>Upload the settlement statement before closing; LendHous approves the final one.</li>
            <li>Don&apos;t disburse until LendHous confirms the loan has funded.</li>
            <li>Upload the full signed loan documents the day of closing, and the recorded mortgage once it&apos;s recorded.</li>
          </ol>
          <p className="mt-2 text-xs text-faint">Placeholder instructions until LendHous&apos;s attorney issues the final closing instructions for this loan.</p>
        </section>
      </main>
    </div>
  );
}

type Part = { token: string | null; view: TitleView; onView: (view: TitleView) => void; onSaid: (text: string, failed?: boolean) => void };
const longDay = (day: string) => new Date(`${day.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * Who's selling (lib/seller-checks.ts): on a sale of land, or by an owner who lives elsewhere and owes nothing on the
 * property, the closer confirms how it checked the seller is the owner. LendHous won't fund until it has.
 */
function SellerIdCard({ token, view, onView, onSaid }: Part) {
  const [method, setMethod] = useState<SellerIdMethod | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const done = view.sellerCheck?.done;
  const confirm = async () => {
    if (!method) return;
    setBusy(true);
    if (!token) { onView({ ...view, sellerCheck: { done: { method, at: new Date().toISOString() } } }); setBusy(false); return; }
    const reply = await titleVerifySeller(token, { method, note }).catch(() => ({ error: "That didn't go through." }));
    setBusy(false);
    if ("view" in reply && reply.view) { onView(reply.view); onSaid("Thank you. LendHous has your confirmation."); } else onSaid(reply.error ?? "That didn't go through.", true);
  };
  return (
    <section className="glass space-y-3 p-5" data-testid="title-seller">
      <h2 className="eyebrow">The seller&apos;s identity</h2>
      {done ? (
        <p className="text-sm" data-testid="title-seller-done"><Check size={14} className="mr-1 inline text-good" aria-hidden="true" />You confirmed on {longDay(done.at)}: {methodWords(done.method)}.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">This sale is the kind people posing as the owner target: vacant land, or an owner who lives elsewhere and has no mortgage. Before LendHous funds, confirm how you checked that the seller is the owner, without relying on a phone number, email or notary the seller gave you.</p>
          <fieldset className="space-y-2">
            <legend className="sr-only">How you checked</legend>
            {(Object.entries(ID_METHODS) as [SellerIdMethod, string][]).map(([key, label]) => (
              <label key={key} className="flex items-start gap-2 text-sm"><input type="radio" name="seller-id" className="mt-1" data-testid={`title-seller-${key}`} checked={method === key} onChange={() => setMethod(key)} /> {label}</label>
            ))}
          </fieldset>
          <label className="block"><span className="label">Anything we should know (optional)</span><input className="desk-input" data-testid="title-seller-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <button type="button" className="btn-primary" data-testid="title-seller-confirm" disabled={!method || busy} onClick={() => void confirm()}>{busy ? "Saving…" : "Confirm the seller's identity was checked"}</button>
        </>
      )}
    </section>
  );
}

/**
 * Searches LendHous has asked for before releasing a construction draw (lib/title-updates.ts): anything recorded against
 * the property since the mortgage, through a recent day. Sent as a form, with the search report if there is one.
 */
function TitleSearches({ token, view, onView, onSaid }: Part) {
  const today = servicingDate(new Date());
  const [open, setOpen] = useState("");
  const [answer, setAnswer] = useState({ clean: "", through: today, found: "" });
  const [chosen, setChosen] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (drawId: string) => {
    setBusy(true);
    const clean = answer.clean === "yes";
    if (!token) {
      onView({ ...view, updates: view.updates.map((item) => (item.drawId === drawId ? { ...item, answered: { clean, through: answer.through, found: clean ? "" : answer.found, at: new Date().toISOString() } } : item)) });
      setBusy(false); setOpen(""); return;
    }
    const form = new FormData();
    form.set("update", drawId); form.set("clean", clean ? "yes" : "no"); form.set("through", answer.through); form.set("found", clean ? "" : answer.found);
    if (chosen) form.set("file", chosen);
    const response = await fetch(`/api/closing-links/${token}`, { method: "POST", body: form }).catch(() => null);
    const body = response ? ((await response.json().catch(() => ({}))) as { view?: TitleView; error?: string }) : { error: "That didn't go through. Check your connection and try again." };
    setBusy(false);
    if (body.view) { onView(body.view); setOpen(""); setChosen(null); onSaid("Thank you. LendHous has your search."); } else onSaid(body.error ?? "That didn't go through.", true);
  };
  return (
    <section className="glass space-y-3 p-5" data-testid="title-searches">
      <h2 className="eyebrow">Title searches before draws</h2>
      <ul className="space-y-3">
        {view.updates.map((item) => (
          <li key={item.drawId} className="rounded-[2px] border border-border p-3 text-sm" data-testid="title-search">
            <p>LendHous asked on {longDay(item.askedAt)}, before releasing a construction draw of {usd(item.amount)}. Search the official records for anything recorded against the property since {item.since ? `the mortgage was recorded on ${longDay(item.since)}` : "the mortgage was recorded"}: liens, judgments, lis pendens, a new notice of commencement or a deed.</p>
            {item.answered && (
              <p className={`mt-2 text-xs ${item.answered.clean ? "text-good" : "text-bad"}`} data-testid="title-search-answer">{item.answered.clean ? `You searched through ${longDay(item.answered.through)}: nothing new recorded.` : `You searched through ${longDay(item.answered.through)} and found: ${item.answered.found}`}</p>
            )}
            {open !== item.drawId ? (
              <button type="button" className={`${item.answered ? "btn-ghost" : "btn-primary"} mt-2 h-9! px-3! text-xs!`} data-testid="title-search-open" onClick={() => { setOpen(item.drawId); setAnswer({ clean: "", through: today, found: "" }); setChosen(null); }}>{item.answered ? "Send a newer search" : "Send what you found"}</button>
            ) : (
              <div className="mt-2 space-y-2" data-testid="title-search-form">
                <fieldset className="flex flex-wrap gap-4">
                  <legend className="sr-only">What the search found</legend>
                  <label className="flex items-center gap-2"><input type="radio" name={`clean-${item.drawId}`} data-testid="title-search-clean" checked={answer.clean === "yes"} onChange={() => setAnswer({ ...answer, clean: "yes" })} /> Nothing new is recorded</label>
                  <label className="flex items-center gap-2"><input type="radio" name={`clean-${item.drawId}`} data-testid="title-search-found" checked={answer.clean === "no"} onChange={() => setAnswer({ ...answer, clean: "no" })} /> Something new is recorded</label>
                </fieldset>
                <label className="block"><span className="label">Records searched through</span><input className="desk-input w-auto!" type="date" max={today} min={item.since ?? undefined} data-testid="title-search-through" value={answer.through} onChange={(event) => setAnswer({ ...answer, through: event.target.value })} /></label>
                {answer.clean === "no" && <label className="block"><span className="label">What&apos;s recorded: the kind of document, who it&apos;s for and the book and page</span><textarea className="desk-input min-h-20" data-testid="title-search-what" maxLength={1000} value={answer.found} onChange={(event) => setAnswer({ ...answer, found: event.target.value })} /></label>}
                <label className="block"><span className="label">Your search or date-down (optional)</span><input type="file" className="block text-xs" data-testid="title-search-file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" onChange={(event) => setChosen(event.target.files?.[0] ?? null)} /></label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primary h-9! px-3! text-xs!" data-testid="title-search-send" disabled={busy || !answer.clean || !answer.through || (answer.clean === "no" && !answer.found.trim())} onClick={() => void send(item.drawId)}>{busy ? "Sending…" : "Send it"}</button>
                  <button type="button" className="btn-ghost h-9! px-3! text-xs!" onClick={() => setOpen("")}>Cancel</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
