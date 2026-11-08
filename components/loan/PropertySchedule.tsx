"use client";
import { useState } from "react";
import { Badge, Section, usd } from "@/components/ui";
import type { Deal, PortfolioProperty } from "@/lib/mockData";
import { heldProperties, isPortfolio, limitsOf, newPropertyId, portfolioNow, PORTFOLIO, propertyLines, releaseQuote, scheduleProblem } from "@/lib/portfolio";
import { SERVICED } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { useServiceDay } from "./use-service-day";

type Row = Omit<PortfolioProperty, "geo" | "floodMap" | "released">;
const TYPES: Record<PortfolioProperty["propertyType"], string> = { sfr: "Single-family", "2_4": "2–4 units", condo: "Condo", townhome: "Townhome" };
const COUNTIES = ["Miami-Dade", "Broward", "Palm Beach", "Hillsborough", "Orange", "Duval", "Pinellas", "Lee", "Other FL"];
const blank = (index: number): Row => ({ id: newPropertyId(index), address: "", city: "", zip: "", county: "Broward", propertyType: "sfr", value: 0, monthlyRent: 0, taxesAnnual: 0, insuranceAnnual: 0 });
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const ratio = (value: number) => value.toFixed(2);

/**
 * A rental loan's properties (lib/portfolio.ts): each one's value, rent, share of the loan, its coverage of that share and
 * its release price, with the portfolio's leverage and coverage. The team turns a rental loan into a portfolio, or edits
 * it, until it clears to close; the borrower sees what it takes to sell each one.
 */
export function PropertySchedule({ deal, side }: { deal: Deal; side: "team" | "borrower" }) {
  const { dispatch, viewerName } = useStore();
  const today = useServiceDay();
  const [rows, setRows] = useState<Row[] | null>(null);
  const editable = side === "team" && deal.app.product === "dscr" && ["submitted", "initial_review", "underwriting", "term_sheet_issued", "term_sheet_accepted", "conditions"].includes(deal.status);
  if (!isPortfolio(deal) && !editable) return null;
  const funded = SERVICED.includes(deal.status);
  const lines = propertyLines(deal);
  const now = isPortfolio(deal) ? portfolioNow(deal) : null;
  const limits = limitsOf(deal);
  const start = () => setRows(isPortfolio(deal) ? deal.properties!.map(({ geo: _geo, floodMap: _flood, released: _released, ...row }) => row) : [{ ...blank(0), address: deal.address, city: deal.city, zip: deal.zip, county: deal.app.county, value: deal.app.purchasePrice, monthlyRent: deal.app.monthlyRent ?? 0, taxesAnnual: deal.app.taxesAnnual ?? 0, insuranceAnnual: deal.app.insuranceAnnual ?? 0, hoaMonthly: deal.app.hoaMonthly }, blank(1)]);
  const problem = rows ? scheduleProblem(rows) : null;
  const put = (index: number, change: Partial<Row>) => setRows((all) => all!.map((row, at) => (at === index ? { ...row, ...change } : row)));
  const save = async () => { if (rows && (await dispatch({ t: "saveProperties", dealId: deal.id, properties: rows, by: viewerName }))) setRows(null); };
  const money = (index: number, key: "value" | "monthlyRent" | "taxesAnnual" | "insuranceAnnual" | "hoaMonthly", label: string) => (
    <label className="block"><span className="label">{label}</span><input className="desk-input" inputMode="numeric" data-testid={`property-${key}-${index}`} value={rows![index][key] ? rows![index][key]!.toLocaleString("en-US") : ""} onChange={(event) => put(index, { [key]: Number(event.target.value.replace(/[^0-9]/g, "")) || 0 })} /></label>
  );

  return (
    <Section title={isPortfolio(deal) ? `Properties (${heldProperties(deal).length}${now?.released ? ` held, ${now.released} released` : ""})` : "Properties"} right={isPortfolio(deal) ? <Badge tone="violet">Portfolio loan</Badge> : undefined}>
      <div className="space-y-3 text-sm" data-testid="property-schedule">
        {!isPortfolio(deal) && !rows && <p className="text-muted-foreground">One property. A rental loan can hold {PORTFOLIO.minProperties} to {PORTFOLIO.maxProperties}: it&apos;s sized on their values and rents added up, and each one can be released when it&apos;s sold.</p>}
        {now && !rows && (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="portfolio-totals">
            <div><dt className="text-xs text-muted-foreground">{funded ? "Owed" : "Loan"}</dt><dd className="font-semibold tabular-nums">{usd(now.balance)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Value held</dt><dd className="font-semibold tabular-nums">{usd(now.value)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Loan to value</dt><dd className={`font-semibold tabular-nums ${now.ltv > limits.maxLtv ? "text-bad" : ""}`} data-testid="portfolio-ltv">{percent(now.ltv)}</dd><dd className="text-[11px] text-muted-foreground">limit {percent(limits.maxLtv)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Rent coverage (DSCR)</dt><dd className={`font-semibold tabular-nums ${now.dscr < limits.minDscr ? "text-bad" : ""}`} data-testid="portfolio-dscr">{ratio(now.dscr)}</dd><dd className="text-[11px] text-muted-foreground">at least {ratio(limits.minDscr)}</dd></div>
          </dl>
        )}
        {isPortfolio(deal) && !rows && (
          <table className="stack-table w-full">
            <thead><tr className="border-b border-rule"><th>Property</th><th className="text-right">Value</th><th className="text-right">Rent</th><th className="text-right">Share of loan</th><th className="text-right">Coverage</th><th className="text-right">{funded ? "To release it" : "Release price"}</th></tr></thead>
            <tbody>
              {lines.map((line) => {
                const quote = funded && today && !line.property.released ? releaseQuote(deal, line.property.id, today) : null;
                const price = quote && !("problem" in quote) ? quote.price : line.releasePrice;
                return (
                  <tr key={line.property.id} className={`border-b border-border last:border-0 ${line.property.released ? "text-muted-foreground" : ""}`} data-testid="property-row">
                    <td><span className="font-medium">{line.property.address}</span><small className="block text-xs text-muted-foreground">{line.property.city} {line.property.zip} · {TYPES[line.property.propertyType]}{line.property.floodMap?.mapped ? ` · zone ${line.property.floodMap.zone}` : ""}{line.property.released ? ` · released ${line.property.released.on}` : ""}</small></td>
                    <td data-label="Value" className="text-right tabular-nums">{usd(line.property.value)}</td>
                    <td data-label="Rent" className="text-right tabular-nums">{usd(line.property.monthlyRent)}/mo</td>
                    <td data-label="Share of loan" className="text-right tabular-nums">{usd(line.allocated)}<small className="block text-[11px] text-muted-foreground">{percent(line.share)}</small></td>
                    <td data-label="Coverage" className={`text-right tabular-nums ${line.dscr < limits.minDscr ? "text-warn" : ""}`}>{ratio(line.dscr)}</td>
                    <td data-label={funded ? "To release it" : "Release price"} className="text-right font-medium tabular-nums" data-testid="property-release-price">{line.property.released ? "Released" : quote && "problem" in quote ? <span className="text-xs font-normal text-muted-foreground">{quote.problem}</span> : usd(price)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {isPortfolio(deal) && !rows && <p className="text-xs text-muted-foreground">{side === "borrower" ? `To sell one, it's released from the loan by paying its release price to principal: at least its share of the loan times ${PORTFOLIO.releasePremium.toFixed(2)}, and more if the rest of the loan would otherwise go past its limits. Interest on that amount to the day is added, and your payment is worked out again on what's left. Ask us for the exact figure before you close the sale.` : `Release price: the share of the loan times ${PORTFOLIO.releasePremium.toFixed(2)} (PLACEHOLDER), or more if the rest wouldn't stay within ${percent(limits.maxLtv)} loan to value and ${ratio(limits.minDscr)} coverage.`}</p>}

        {rows && (
          <div className="space-y-3" data-testid="property-form">
            {rows.map((row, index) => (
              <fieldset key={row.id} className="space-y-2 rounded-[2px] border border-border p-3">
                <legend className="px-1 text-xs text-muted-foreground">Property {index + 1}</legend>
                <div className="grid gap-2 sm:grid-cols-4">
                  <label className="block sm:col-span-2"><span className="label">Street</span><input className="desk-input" data-testid={`property-address-${index}`} value={row.address} onChange={(event) => put(index, { address: event.target.value })} /></label>
                  <label className="block"><span className="label">City</span><input className="desk-input" data-testid={`property-city-${index}`} value={row.city} onChange={(event) => put(index, { city: event.target.value })} /></label>
                  <label className="block"><span className="label">ZIP</span><input className="desk-input" inputMode="numeric" maxLength={5} data-testid={`property-zip-${index}`} value={row.zip} onChange={(event) => put(index, { zip: event.target.value.replace(/[^0-9]/g, "") })} /></label>
                  <label className="block"><span className="label">County</span><select className="desk-input" value={COUNTIES.includes(row.county) ? row.county : "Other FL"} onChange={(event) => put(index, { county: event.target.value })}>{COUNTIES.map((county) => <option key={county}>{county}</option>)}</select></label>
                  <label className="block"><span className="label">Type</span><select className="desk-input" value={row.propertyType} onChange={(event) => put(index, { propertyType: event.target.value as Row["propertyType"] })}>{Object.entries(TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                  {money(index, "value", deal.app.purpose === "purchase" ? "Price or value" : "Value (as-is)")}
                  {money(index, "monthlyRent", "Monthly rent")}
                  {money(index, "taxesAnnual", "Taxes / year")}
                  {money(index, "insuranceAnnual", "Insurance / year")}
                  {money(index, "hoaMonthly", "HOA / month")}
                </div>
                {rows.length > 1 && <button type="button" className="text-xs text-link underline underline-offset-2" onClick={() => setRows(rows.filter((_, at) => at !== index))}>Remove this property</button>}
              </fieldset>
            ))}
            {rows.length < PORTFOLIO.maxProperties && <button type="button" className="btn-ghost" data-testid="add-property" onClick={() => setRows([...rows, blank(rows.length)])}>Add a property</button>}
            {problem && <p className="text-xs text-warn" data-testid="property-problem">{problem}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" data-testid="save-properties" disabled={Boolean(problem)} onClick={() => void save()}>Save the properties</button>
              {isPortfolio(deal) && <button type="button" className="btn-ghost" onClick={() => void dispatch({ t: "saveProperties", dealId: deal.id, properties: [], by: viewerName }).then((done) => { if (done) setRows(null); })}>Make it one property again</button>}
              <button type="button" className="btn-ghost" onClick={() => setRows(null)}>Cancel</button>
            </div>
            <p className="text-xs text-muted-foreground">Saving sizes the loan on these values, rents and costs added up. The first property&apos;s address stands for the loan on lists.</p>
          </div>
        )}
        {editable && !rows && <button type="button" className="btn-ghost" data-testid="edit-properties" onClick={start}>{isPortfolio(deal) ? "Edit the properties" : "Make it a portfolio loan"}</button>}
      </div>
    </Section>
  );
}
