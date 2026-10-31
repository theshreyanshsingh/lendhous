"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";

const STRATEGIES = ["Fix & flip", "DSCR rental", "Bridge financing", "Ground-up construction", "Rental portfolio", "Not sure yet"];
const EXPERIENCE = ["First investment", "1–3 completed projects", "4–10 completed projects", "11+ completed projects"];

// Prepares a text brief in the browser. Nothing here is sent anywhere.
export function DealBrief() {
  const [strategy, setStrategy] = useState(STRATEGIES[0]);
  const [experience, setExperience] = useState(EXPERIENCE[0]);
  const [brief, setBrief] = useState("");

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const details = Array.from(new FormData(event.currentTarget).entries()).map(([key, value]) => `${key}: ${value}`).join("\n");
    setBrief(`LENDHOUS: DEAL DISCUSSION BRIEF\n\nProgram: ${strategy}\nExperience: ${experience}\n${details}\n\nPrepared locally. Not submitted to LendHous; not a loan application or approval.`);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([brief], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "LendHous-Deal-Brief.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      <form className="panel" onSubmit={prepare}>
        <h3>Your project at a glance</h3>
        <div className="note">This review site prepares a brief on your device. It does not send an application or request a credit check. Do not enter sensitive financial or identity information.</div>
        <div className="fields">
          <label>Financing strategy
            <select value={strategy} onChange={(event) => setStrategy(event.target.value)}>{STRATEGIES.map((item) => <option key={item}>{item}</option>)}</select>
          </label>
          <label>Investor experience
            <select value={experience} onChange={(event) => setExperience(event.target.value)}>{EXPERIENCE.map((item) => <option key={item}>{item}</option>)}</select>
          </label>
          <label>Property city<input name="Property city" required placeholder="City" maxLength={100} /></label>
          <label>Property state<input name="Property state" required placeholder="State" maxLength={50} /></label>
          <label>Purchase price or current value ($)<input name="Property value" type="number" min="1" max="1000000000" required /></label>
          <label>Estimated renovation budget ($)<input name="Renovation budget" type="number" min="0" max="1000000000" defaultValue="0" required /></label>
          <label>Requested loan amount ($)<input name="Requested loan" type="number" min="1" max="1000000000" required /></label>
          <label>Target closing date<input name="Target closing" type="date" /></label>
        </div>
        <label style={{ marginTop: 20 }}>Exit strategy &amp; project notes
          <textarea name="Strategy" rows={4} maxLength={1500} placeholder="Planned sale, rental hold, or refinance; project timeline and questions." required />
        </label>
        <button className="button" style={{ marginTop: 25 }} type="submit">Prepare my brief</button>
      </form>
      <aside style={{ alignSelf: "start" }}>
        {brief ? (
          <div className="panel" aria-live="polite" data-testid="deal-brief">
            <div className="eyebrow">READY FOR YOUR REVIEW</div>
            <h3>Your deal brief is prepared.</h3>
            <pre className="brief">{brief}</pre>
            <button type="button" className="button" style={{ marginTop: 25 }} onClick={download}>Download deal brief</button>
            <p className="fine">Nothing has been sent. Contact and application connections will be added once LendHous confirms its intake channel.</p>
          </div>
        ) : (
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
        )}
      </aside>
    </>
  );
}
