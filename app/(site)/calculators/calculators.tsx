"use client";
import Link from "next/link";
import { useState } from "react";
import { CALCULATOR_DEFAULTS, FIELD_LABELS, fieldMax, fieldMin, flipMargin, leverageCap, rentalCoverage, usd, validInputs, type CalculatorKey } from "@/lib/site-calculators";

const TABS: { key: CalculatorKey; label: string; heading: string }[] = [
  { key: "rental", label: "Rental DSCR", heading: "Rental income & financing" },
  { key: "flip", label: "Fix & flip", heading: "Project budget & exit" },
  { key: "leverage", label: "LTC / LTV", heading: "Your leverage assumptions" },
];

function Row({ label, value }: { label: string; value: string }) {
  return <div className="task-row"><span>{label}</span><strong>{value}</strong></div>;
}

export function Calculators() {
  const [tab, setTab] = useState<CalculatorKey>("rental");
  const [inputs, setInputs] = useState(CALCULATOR_DEFAULTS);
  const current: Record<string, number> = inputs[tab];
  const heading = TABS.find((item) => item.key === tab)?.heading;
  const setField = (field: string, raw: string) => setInputs((all) => ({ ...all, [tab]: { ...all[tab], [field]: raw === "" ? NaN : Number(raw) } }));
  return (
    <>
      <div className="tab-list" role="tablist" aria-label="Calculators">
        {TABS.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className="tab-trigger" data-testid={`calc-tab-${item.key}`} onClick={() => setTab(item.key)}>{item.label}</button>
        ))}
      </div>
      <div className="two-col">
        <section className="panel">
          <h3>{heading}</h3>
          <p className="subtle">Starting numbers are examples, not LendHous rates or an offer.</p>
          <div className="fields">
            {Object.keys(current).map((field) => (
              <label key={field}>
                {FIELD_LABELS[field]}
                <input type="number" data-testid={`calc-${field}`} min={fieldMin(field)} max={fieldMax(field)} step="any" value={Number.isNaN(current[field]) ? "" : current[field]} onChange={(event) => setField(field, event.target.value)} />
              </label>
            ))}
          </div>
          <button type="button" className="text-link" style={{ marginTop: 25 }} onClick={() => setInputs((all) => ({ ...all, [tab]: CALCULATOR_DEFAULTS[tab] }))}>Reset example</button>
        </section>
        <section className="panel" aria-live="polite" style={{ alignSelf: "start" }}>
          {!validInputs(current) ? (
            <div role="alert">Enter valid non-negative amounts. Percentages must be 0–100; amortization 1–50 years; hold period 1–120 months; cost and value must be greater than zero.</div>
          ) : tab === "rental" ? (
            <RentalResult />
          ) : tab === "flip" ? (
            <FlipResult />
          ) : (
            <LeverageResult />
          )}
        </section>
      </div>
    </>
  );

  function RentalResult() {
    const result = rentalCoverage(inputs.rental);
    return (
      <>
        <div className="eyebrow">ESTIMATED RENTAL COVERAGE</div>
        <div className="result" data-testid="calc-result">{result.dscr === null ? "Not defined" : `${result.dscr.toFixed(2)}×`}</div>
        <p>Monthly rent ÷ monthly PITIA</p>
        <Row label="Principal & interest" value={usd(result.pi)} />
        <Row label="Total monthly PITIA" value={usd(result.pitia)} />
        <Row label="Rent less PITIA" value={usd(result.spread)} />
        <div className="note">PITIA includes principal, interest, taxes, insurance, and HOA dues. Rent less PITIA is not net cash flow: vacancy, repairs, management, and capital reserves are excluded.</div>
        <p className="fine">Fixed-rate amortizing payment illustration. Lender qualifying rent and DSCR definitions may differ; no eligibility threshold is implied.</p>
        <Link href="/resources/dscr-explained" className="text-link">Understand the ratio ↗</Link>
      </>
    );
  }

  function FlipResult() {
    const result = flipMargin(inputs.flip);
    return (
      <>
        <div className="eyebrow">ESTIMATED PROJECT MARGIN</div>
        <div className="result" data-testid="calc-result">{usd(result.profit)}</div>
        <p>Before income taxes; all entered costs included.</p>
        <Row label="Total project costs" value={usd(result.total)} />
        <Row label="Interest during hold" value={usd(result.interest)} />
        <Row label="Origination points" value={usd(result.fees)} />
        <Row label="Loan / purchase + rehab" value={result.ltc === null ? "N/A" : `${result.ltc.toFixed(1)}%`} />
        <div className="note">Assumes the full loan balance accrues simple interest for the entire hold. Principal repayment is not an additional project expense because acquisition and renovation are already counted. This is project margin, not cash-on-cash return.</div>
        <p className="fine">Monthly non-financing holding costs should include taxes, insurance, utilities, and similar costs. Do not include interest again. Enter selling commissions and seller costs in selling costs.</p>
      </>
    );
  }

  function LeverageResult() {
    const result = leverageCap(inputs.leverage);
    return (
      <>
        <div className="eyebrow">LOWER OF THE TWO CAPS</div>
        <div className="result" data-testid="calc-result">{usd(result.loan)}</div>
        <p>Illustrative loan ceiling</p>
        <Row label="Cost-based cap" value={usd(result.costCap)} />
        <Row label="Value-based cap" value={usd(result.valueCap)} />
        <Row label="Cost less loan ceiling" value={usd(result.equity)} />
        <div className="note">Applies both entered caps to the same hypothetical transaction. Actual program maximums may not apply together. Cash needed can be higher after fees, reserves, ineligible costs, and draw timing.</div>
        <Link href="/resources/leverage" className="text-link">Understand LTC and LTV ↗</Link>
      </>
    );
  }
}
