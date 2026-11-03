"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Arrive, Reveal } from "@/components/motion";
import { longDay, MAX_GOOD_THROUGH_DAYS, publicRequestProblem, REQUESTERS, type RequesterKind } from "@/lib/payoffs";
import { addDays, servicingDate } from "@/lib/servicing";

type Draft = { loanNumber: string; zip: string; kind: RequesterKind; name: string; company: string; email: string; phone: string; fileNumber: string; goodThrough: string; note: string };
const blank: Draft = { loanNumber: "", zip: "", kind: "title", name: "", company: "", email: "", phone: "", fileNumber: "", goodThrough: "", note: "" };

/**
 * The public payoff request. It posts to /api/payoff-requests with the borrower's signed authorization when someone else
 * asks, and says when the request counts as received and when the letter is due.
 */
export function PayoffRequestForm() {
  const [draft, setDraft] = useState<Draft>(blank);
  const [file, setFile] = useState<File | null>(null);
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ receivedOn: string; dueBy: string } | null>(null);
  // Set after the first render: the server and the browser can disagree about today's date.
  const [today, setToday] = useState("");
  useEffect(() => { setToday(servicingDate(new Date())); }, []);
  const put = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));
  const third = draft.kind !== "borrower";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const checked = publicRequestProblem(draft, today || servicingDate(new Date()));
    if ("error" in checked) return setError(checked.error);
    if (third && !file) return setError("Attach the borrower's signed authorization for you to ask for the payoff.");
    const form = new FormData();
    for (const [key, value] of Object.entries(draft)) form.set(key, value);
    form.set("website", honeypot);
    if (third && file) form.set("authorization", file);
    setSending(true);
    const reply = await fetch("/api/payoff-requests", { method: "POST", body: form }).then((response) => response.json()).catch(() => ({ error: "That didn't go through. Check your connection and try again." }));
    setSending(false);
    if (reply.error) return setError(reply.error);
    setSent({ receivedOn: reply.receivedOn, dueBy: reply.dueBy });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (sent) {
    return (
      <Arrive className="panel sent-panel">
        <div aria-live="polite" data-testid="payoff-request-sent">
          <div className="eyebrow">REQUEST RECEIVED</div>
          <h3>Thanks, {draft.name.split(" ")[0]}. We have your request.</h3>
          {sent.receivedOn && <p>It counts as received <b>{longDay(sent.receivedOn)}</b>. We&apos;ll email the payoff letter to {draft.email} by <b data-testid="payoff-due-by">{longDay(sent.dueBy)}</b>, usually much sooner.</p>}
          <p className="quote-small">A confirmation is on its way to your inbox. If anything is missing, we&apos;ll email you.</p>
        </div>
      </Arrive>
    );
  }

  const text = (label: string, key: keyof Draft, extra: { type?: string; auto?: string; required?: boolean; max?: number; placeholder?: string; inputMode?: "numeric" } = {}) => (
    <label>{label}{extra.required === false ? "" : " *"}<input type={extra.type ?? "text"} data-testid={`payoff-${key}`} autoComplete={extra.auto} inputMode={extra.inputMode} required={extra.required !== false} maxLength={extra.max ?? 120} placeholder={extra.placeholder} value={draft[key]} onChange={(event) => put({ [key]: event.target.value })} /></label>
  );

  return (
    <form className="quote-form" onSubmit={submit} data-testid="payoff-request-form" noValidate>
      <section className="panel">
        <div className="quote-step-title">Who&apos;s asking?</div>
        <div className="quote-choices" role="radiogroup">
          {(Object.keys(REQUESTERS) as RequesterKind[]).map((kind) => (
            <button key={kind} type="button" role="radio" aria-checked={draft.kind === kind} data-testid={`payoff-kind-${kind}`} className={`quote-choice ${draft.kind === kind ? "on" : ""}`} onClick={() => put({ kind })}>
              <b>{REQUESTERS[kind]}</b>
              <span>{kind === "borrower" ? "Paying off my own loan or my company's." : kind === "title" ? "Closing a sale or refinance of the property." : "An attorney, agent or fiduciary acting for the borrower."}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="quote-step-title"><i>1</i> The loan</div>
        <div className="fields">
          {text("Loan number", "loanNumber", { placeholder: "LH-1001", max: 40 })}
          {text("Property ZIP code", "zip", { inputMode: "numeric", max: 5, auto: "off" })}
          <label>Payoff good through *<input type="date" data-testid="payoff-goodThrough" required min={today || undefined} max={today ? addDays(today, MAX_GOOD_THROUGH_DAYS) : undefined} value={draft.goodThrough} onChange={(event) => put({ goodThrough: event.target.value })} /><small className="quote-hint">Usually your closing date plus a few days. Up to {MAX_GOOD_THROUGH_DAYS} days ahead.</small></label>
        </div>
      </section>

      <section className="panel">
        <div className="quote-step-title"><i>2</i> {third ? "You" : "Your details"}</div>
        <div className="fields">
          {text("Your name", "name", { auto: "name" })}
          {third && text(draft.kind === "title" ? "Title company or law firm" : "Company (if any)", "company", { auto: "organization", required: draft.kind === "title", max: 160 })}
          {text("Email for the letter", "email", { type: "email", auto: "email", max: 200 })}
          {text("Phone", "phone", { type: "tel", auto: "tel", required: false, max: 40 })}
          {draft.kind === "title" && text("Your file number", "fileNumber", { required: false, max: 80 })}
        </div>
        {!third && <p className="quote-small">If this isn&apos;t the email on your LendHous account, we&apos;ll call you at the number we have on file before sending the letter.</p>}
      </section>

      <Reveal open={third}>
        <section className="panel">
          <div className="quote-step-title"><i>3</i> The borrower&apos;s authorization</div>
          <p className="quote-small">Florida law asks for the borrower&apos;s written authorization when someone else requests a payoff. Attach it signed, as a PDF or a photo, up to 10 MB. We&apos;ll also let the borrower know you asked.</p>
          <label>Signed authorization *<input type="file" data-testid="payoff-authorization" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        </section>
      </Reveal>

      <section className="panel">
        <label>Anything else we should know<textarea rows={3} maxLength={1000} data-testid="payoff-note" value={draft.note} placeholder="Closing date, a second loan to pay off at the same closing, how you'd like it sent." onChange={(event) => put({ note: event.target.value })} /></label>
      </section>
      <label className="hp" aria-hidden="true">Leave this empty<input tabIndex={-1} autoComplete="off" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} /></label>
      {error && <Arrive className="form-error"><span role="alert" data-testid="payoff-request-error">{error}</span></Arrive>}
      <p className="quote-small">Don&apos;t enter a Social Security number or bank details here.</p>
      <button className="button quote-submit" type="submit" data-testid="payoff-request-submit" disabled={sending}>{sending ? "Sending…" : "Request the payoff letter →"}</button>
    </form>
  );
}
