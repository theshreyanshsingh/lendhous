"use client";
import Link from "next/link";
import { startTransition, useActionState, useState, type FormEvent } from "react";
import { sendLead } from "@/actions/leads";
import { EXPERIENCE, leadSummary, MAX_LEAD_DOLLARS, parseLead, STRATEGIES } from "@/lib/leads";

// Sends the brief to the LendHous team and keeps a copy the visitor can download.
export function DealBrief() {
  const [state, send, sending] = useActionState(sendLead, { sent: false, error: "" });
  const [brief, setBrief] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = parseLead(Object.fromEntries(data));
    if (parsed.ok) setBrief(`LENDHOUS: DEAL DISCUSSION BRIEF\n\n${leadSummary(parsed.lead)}\n\nNot a loan application or approval.`);
    startTransition(() => send(data));
  }

  function download() {
    const url = URL.createObjectURL(new Blob([brief], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "LendHous-Deal-Brief.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (state.sent) {
    return (
      <div className="panel sent-panel" aria-live="polite" data-testid="deal-brief">
        <div className="eyebrow">SENT TO LENDHOUS</div>
        <h3>The team has your project.</h3>
        <p>They will review it and get back to you. Sending this is not an application, and it doesn’t commit you or LendHous to a loan.</p>
        <pre className="brief">{brief}</pre>
        <button type="button" className="button" style={{ marginTop: 25 }} onClick={download}>Download a copy</button>
      </div>
    );
  }

  return (
    <>
      <form className="panel" onSubmit={submit}>
        <h3>Your project at a glance</h3>
        <div className="note">This goes to the LendHous team so they can follow up. It is not an application and does not request a credit check. Do not enter sensitive financial or identity information.</div>
        <div className="fields">
          <label>Your name<input name="name" required maxLength={120} autoComplete="name" /></label>
          <label>Email<input name="email" type="email" required maxLength={200} autoComplete="email" /></label>
          <label>Phone (optional)<input name="phone" type="tel" maxLength={40} autoComplete="tel" /></label>
          <label>Financing strategy
            <select name="strategy" defaultValue={STRATEGIES[0]}>{STRATEGIES.map((item) => <option key={item}>{item}</option>)}</select>
          </label>
          <label>Investor experience
            <select name="experience" defaultValue={EXPERIENCE[0]}>{EXPERIENCE.map((item) => <option key={item}>{item}</option>)}</select>
          </label>
          <label>Property city<input name="city" required placeholder="City" maxLength={100} /></label>
          <label>Property state<input name="state" required placeholder="State" maxLength={50} /></label>
          <label>Purchase price or current value ($)<input name="propertyValue" type="number" min="1" max={MAX_LEAD_DOLLARS} required /></label>
          <label>Estimated renovation budget ($)<input name="renovation" type="number" min="0" max={MAX_LEAD_DOLLARS} defaultValue="0" required /></label>
          <label>Requested loan amount ($)<input name="requestedLoan" type="number" min="1" max={MAX_LEAD_DOLLARS} required /></label>
          <label>Target closing date<input name="targetClosing" type="date" /></label>
        </div>
        <label style={{ marginTop: 20 }}>Exit strategy &amp; project notes
          <textarea name="notes" rows={4} maxLength={1500} placeholder="Planned sale, rental hold, or refinance; project timeline and questions." required />
        </label>
        {/* Hidden from people; bots that fill it are ignored. */}
        <label className="hp" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
        {state.error && <div className="form-error" role="alert">{state.error}</div>}
        <button className="button" style={{ marginTop: 25 }} type="submit" disabled={sending}>{sending ? "Sending…" : "Send to LendHous"}</button>
      </form>
      <aside style={{ alignSelf: "start" }}>
        <div className="panel">
          <div className="eyebrow">COME PREPARED</div>
          <h3>A useful first conversation covers:</h3>
          <ul>
            <li>The property and intended use</li>
            <li>Purchase, renovation, and contingency budget</li>
            <li>Your experience and project team</li>
            <li>Timing, liquidity, and an exit strategy</li>
          </ul>
          <p>No exact rate or approval is promised before review. Lending location and program eligibility must be confirmed.</p>
          <Link href="/calculators" className="text-link">Work through the numbers first ↗</Link>
        </div>
      </aside>
    </>
  );
}
