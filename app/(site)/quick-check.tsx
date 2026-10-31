"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { leverageCap, usd } from "@/lib/site-calculators";

// The site's stated maximums (see the landing page's footnote 1 and /disclosures). Never a quote.
const MAX_LTC = 95;
const MAX_LTV = 75;

const FIELDS = [
  { key: "purchase", label: "Purchase price ($)" },
  { key: "rehab", label: "Renovation budget ($)" },
  { key: "value", label: "Property value ($)" },
] as const;

export function QuickCheck() {
  const [values, setValues] = useState<Record<string, number>>({ purchase: 250000, rehab: 50000, value: 350000 });
  const { purchase, rehab, value } = values;
  const valid = [purchase, rehab, value].every((item) => Number.isFinite(item) && item >= 0) && purchase + rehab > 0 && value > 0;
  const result = valid ? leverageCap({ cost: purchase + rehab, value, ltc: MAX_LTC, ltv: MAX_LTV }) : null;
  return (
    <div className="panel" aria-live="polite">
      <div className="tool-inputs">
        {FIELDS.map((field) => (
          <label key={field.key}>
            {field.label}
            <input type="number" min="0" step="any" data-testid={`quick-${field.key}`} value={Number.isNaN(values[field.key]) ? "" : values[field.key]} onChange={(event) => setValues((all) => ({ ...all, [field.key]: event.target.value === "" ? NaN : Number(event.target.value) }))} />
          </label>
        ))}
      </div>
      <div className="tool-result">
        {result ? (
          <>
            <div className="eyebrow">ILLUSTRATIVE LOAN CEILING</div>
            <div className="result" data-testid="quick-result">{usd(result.loan)}</div>
            <div className="task-row"><span>{MAX_LTC}% of purchase + renovation</span><strong>{usd(result.costCap)}</strong></div>
            <div className="task-row"><span>{MAX_LTV}% of property value</span><strong>{usd(result.valueCap)}</strong></div>
            <div className="note">An illustration using the site’s stated maximums. They may not apply together or to every program. Not a quote, an offer, or a commitment to lend.</div>
            <Link className="text-link" href="/start">Discuss this project <ArrowRight size={18} aria-hidden="true" /></Link>
          </>
        ) : (
          <div role="alert">Enter a purchase price and a property value above zero.</div>
        )}
      </div>
    </div>
  );
}
