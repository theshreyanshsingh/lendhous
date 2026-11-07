"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { publishPricing } from "@/actions/pricing";
import { evaluate } from "@/lib/engine";
import { isClosedApplication } from "@/lib/loan-exits";
import type { PricingConfig } from "@/lib/pricing-config";
import { BASE_VERSION } from "@/lib/pricing-versions";
import { applyDraft, draftChanges, draftOf, draftProblems, draftWarnings, type PricingDraft } from "@/lib/pricing-draft";
import { est, useStore } from "@/lib/store";
import { Badge, Section, shortDate, usd } from "@/components/ui";

type History = { version: string; note: string; publishedBy: string; publishedAt: string }[];
type Path = (string | number)[];

// Applications still being reviewed take new pricing only if someone reprices them; everything past the term sheet keeps its own.
const OPEN = ["submitted", "initial_review", "underwriting"];

function setIn<T>(value: T, path: Path, next: number | string): T {
  if (!path.length) return next as T;
  const [head, ...rest] = path;
  const copy = (Array.isArray(value) ? [...value] : { ...(value as object) }) as Record<string | number, unknown>;
  copy[head] = setIn(copy[head], rest, next);
  return copy as T;
}
const getIn = (value: unknown, path: Path) => path.reduce<unknown>((at, key) => (at as Record<string | number, unknown>)[key], value) as number;

/** The owner's pricing editor (Spec A22): change the numbers, see what they do to open applications, then publish a new version. */
export function PricingEditor({ current, history, canPublish }: { current: PricingConfig; history: History; canPublish: boolean }) {
  const router = useRouter();
  const { s } = useStore();
  const [draft, setDraft] = useState<PricingDraft>(() => draftOf(current));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const changes = draftChanges(draftOf(current), draft);
  const problems = draftProblems(draft);
  const warnings = draftWarnings(draft);
  const preview = applyDraft(current, draft, "draft");

  const num = (label: string, path: Path, options: { pct?: boolean; step?: number; testid?: string } = {}) => {
    const raw = getIn(draft, path);
    const shown = options.pct ? Math.round(raw * 100_000) / 1000 : raw;
    const changed = raw !== getIn(draftOf(current), path);
    return (
      <label className="block min-w-0">
        <span className={`label ${changed ? "text-link" : ""}`}>{label}{options.pct ? " (%)" : ""}</span>
        <input className="desk-input" type="number" inputMode="decimal" step={options.step ?? (options.pct ? 0.5 : 0.125)} data-testid={options.testid} value={Number.isFinite(shown) ? shown : 0} onChange={(event) => { const value = Number(event.target.value); setDraft(setIn(draft, path, options.pct ? value / 100 : value)); }} />
      </label>
    );
  };
  const ranges = (path: Path, what: "rate" | "points") => (
    <>{num(`${what === "rate" ? "Rate" : "Points"} from`, [...path, what, 0])}{num(`${what === "rate" ? "Rate" : "Points"} to`, [...path, what, 1])}</>
  );
  const tierLabel = (tier: number) => { const tiers = current.experienceTiers; const at = tiers.findIndex((item) => item.tier === tier); const next = tiers[at + 1]; return `Tier ${tier}: ${tiers[at].min}${next ? `–${next.min - 1}` : "+"} verified deals`; };

  const open = s.deals.filter((deal) => OPEN.includes(deal.status));
  const kept = s.deals.filter((deal) => !OPEN.includes(deal.status) && !isClosedApplication(deal.status)).length;
  const whatIf = open.map((deal) => {
    const now = est(deal.app);
    const next = evaluate(deal.app, preview);
    return { deal, now, next, differs: now.rate !== next.rate || now.pointsPct !== next.pointsPct || now.noteAmount !== next.noteAmount || now.eligible !== next.eligible };
  });

  const publish = async () => {
    setSaving(true);
    setError("");
    const result = await publishPricing({ draft, note });
    setSaving(false);
    if (result.error) return setError(result.error);
    setNote("");
    router.refresh();
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]" data-testid="pricing-editor">
      <div className="min-w-0 space-y-4">
        <Section title="Fix & flip">
          <div className="max-w-40">{num("Term (months)", ["fixFlip", "termMonths"], { step: 1 })}</div>
          {([1, 2, 3, 4] as const).map((tier) => (
            <fieldset key={tier} className="mt-4 border-t border-border pt-3">
              <legend className="text-sm font-medium">{tierLabel(tier)}</legend>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {ranges(["fixFlip", "tiers", tier], "rate")}{ranges(["fixFlip", "tiers", tier], "points")}
                {num("Max LTC", ["fixFlip", "tiers", tier, "maxLTC"], { pct: true, testid: tier === 2 ? "flip-2-ltc" : undefined })}{num("Max LTARV", ["fixFlip", "tiers", tier, "maxLTARV"], { pct: true })}
                {num("Max initial LTV", ["fixFlip", "tiers", tier, "maxInitialLTV"], { pct: true })}{num("Min FICO", ["fixFlip", "tiers", tier, "minFico"], { step: 10 })}
              </div>
            </fieldset>
          ))}
        </Section>
        <Section title="Bridge">
          <div className="max-w-40">{num("Term (months)", ["bridge", "termMonths"], { step: 1 })}</div>
          {([1, 2, 3, 4] as const).map((tier) => (
            <fieldset key={tier} className="mt-4 border-t border-border pt-3">
              <legend className="text-sm font-medium">{tierLabel(tier)}</legend>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {ranges(["bridge", "tiers", tier], "rate")}{ranges(["bridge", "tiers", tier], "points")}
                {num("Max LTV", ["bridge", "tiers", tier, "maxLTV"], { pct: true })}{num("Min FICO", ["bridge", "tiers", tier, "minFico"], { step: 10 })}
              </div>
            </fieldset>
          ))}
        </Section>
        <Section title="Ground-up construction">
          <div className="max-w-40">{num("Term (months)", ["groundUp", "termMonths"], { step: 1 })}</div>
          {([["none", "No builds yet"], ["1to3", "1 to 3 builds"], ["4plus", "4 or more builds"]] as const).map(([key, label]) => (
            <fieldset key={key} className="mt-4 border-t border-border pt-3">
              <legend className="text-sm font-medium">{label}</legend>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {ranges(["groundUp", "tiers", key], "rate")}{ranges(["groundUp", "tiers", key], "points")}
                {num("Max LTC", ["groundUp", "tiers", key, "maxLTC"], { pct: true })}{num("Max LTARV", ["groundUp", "tiers", key, "maxLTARV"], { pct: true })}
                {num("Max land LTV", ["groundUp", "tiers", key, "maxLandLTV"], { pct: true })}{num("Min FICO", ["groundUp", "tiers", key, "minFico"], { step: 10 })}
              </div>
            </fieldset>
          ))}
        </Section>
        <Section title="DSCR rentals">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{ranges(["dscr"], "points")}{num("Base rate from", ["dscr", "baseRate", 0])}{num("Base rate to", ["dscr", "baseRate", 1])}</div>
          <p className="mt-2 text-xs text-muted-foreground">The grid of LTV limits and rate adds by FICO and DSCR is unchanged here; the developer edits it.</p>
          <h3 className="mt-4 text-sm font-medium">Short-term rentals (Airbnb, VRBO)</h3>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="pricing-short-term">{num("Income counted from 12 months of payouts (%)", ["dscr", "shortTerm", "historyFactor"], { pct: true, step: 5, testid: "str-history" })}{num("Income counted from a projection (%)", ["dscr", "shortTerm", "projectionFactor"], { pct: true, step: 5 })}{num("Less on a cash-out (%)", ["dscr", "shortTerm", "cashOutFactorCut"], { pct: true, step: 5 })}{num("Rate add (%)", ["dscr", "shortTerm", "rateAdd"])}{num("Leverage cut (%)", ["dscr", "shortTerm", "leverageCut"], { pct: true, step: 5 })}</div>
          <p className="mt-2 text-xs text-muted-foreground">Rent for the DSCR is the yearly income at the share counted, over 12. The rate add and leverage cut are on top of the grid.</p>
        </Section>
        <Section title="Loan sizes and fees">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {num("Smallest loan ($)", ["loanSize", "min"], { step: 5000 })}{num("Largest in-house ($)", ["loanSize", "maxInHouse"], { step: 50000 })}
            {num("Largest overall ($)", ["loanSize", "maxOverall"], { step: 50000 })}{num("Lender fees ($)", ["lenderFees"], { step: 100 })}
            <label className="block min-w-0"><span className="label">Quotes use the range&apos;s</span><select className="desk-input" value={draft.estimatePricePoint} onChange={(event) => setDraft({ ...draft, estimatePricePoint: event.target.value as PricingDraft["estimatePricePoint"] })}><option value="low">Low end</option><option value="mid">Middle</option><option value="high">High end</option></select></label>
          </div>
        </Section>
        <Section title="Buying the rate down">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{num("Rate a point buys on a rental (%)", ["buyDownRatePerPoint"], { testid: "buy-down-rate" })}{num("On a flip, bridge or build (%)", ["buyDownShortRatePerPoint"], { testid: "buy-down-short-rate" })}</div>
          <p className="mt-2 text-xs text-muted-foreground">Each extra point at closing takes this much off the rate, and each point less adds it, in quarter-point steps. Borrowers choose on the quote and on their term sheet, only inside the loan&apos;s matrix and Florida&apos;s usury cap.</p>
        </Section>
        <Section title="Repeat borrowers">
          <div className="space-y-2" data-testid="repeat-tiers">{draft.repeatTiers.map((_, at) => (
            <div key={at} className="grid grid-cols-3 items-end gap-3">{num(`Tier ${at + 1}: loans paid as agreed`, ["repeatTiers", at, "loans"], { step: 1 })}{num("Rate cut (%)", ["repeatTiers", at, "rateCut"])}<div className="flex items-end gap-2">{num("Points cut", ["repeatTiers", at, "pointsCut"])}{draft.repeatTiers.length > 1 && <button type="button" className="btn-ghost mb-0.5 px-2! text-xs" aria-label={`Remove tier ${at + 1}`} onClick={() => setDraft({ ...draft, repeatTiers: draft.repeatTiers.filter((_tier, index) => index !== at) })}>✕</button>}</div></div>
          ))}</div>
          {draft.repeatTiers.length < 6 && <button type="button" className="mt-2 text-sm text-link underline underline-offset-2 max-sm:py-2.5" data-testid="add-repeat-tier" onClick={() => { const last = draft.repeatTiers[draft.repeatTiers.length - 1]; setDraft({ ...draft, repeatTiers: [...draft.repeatTiers, { loans: (last?.loans ?? 0) + 3, rateCut: last?.rateCut ?? 0.25, pointsCut: last?.pointsCut ?? 0 }] }); }}>Add a tier</button>}
          <p className="mt-2 text-xs text-muted-foreground">Counts the borrower&apos;s LendHous loans funded in the last 24 months and paid as agreed; a late payment or default in that time pauses the cut. The highest tier reached applies. PLACEHOLDER numbers until GT sets them.</p>
        </Section>
        <Section title="In the note: late payments and extensions">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {num("Grace days", ["servicing", "graceDays"], { step: 1 })}{num("Late fee", ["servicing", "lateFeePct"], { pct: true })}
            {num("Delinquent after (days)", ["servicing", "delinquentDays"], { step: 1 })}{num("Default margin (+%)", ["servicing", "defaultRateAdd"])}
            {num("Default rate cap (%)", ["servicing", "defaultRateMax"])}{num("Extensions allowed", ["extensions", "maxCount"], { step: 1 })}
            {num("Months each", ["extensions", "monthsEach"], { step: 1 })}{num("Extension fee (points)", ["extensions", "feePoints"])}
            {num("Ask from (days before maturity)", ["extensions", "requestWindowDays"], { step: 5 })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">These go into each loan&apos;s note, so a loan keeps the ones it was priced on. The attorney sets them against the note.</p>
        </Section>
      </div>

      <div className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start">
        <Section title="Publish" right={<Badge tone="green">Now: {current.version}</Badge>}>
          {changes.length ? (
            <ul className="max-h-48 space-y-0.5 overflow-y-auto text-xs" data-testid="pricing-changes">{changes.map((change) => <li key={change} className="wrap-anywhere">{change}</li>)}</ul>
          ) : <p className="text-sm text-muted-foreground">Change a number to see what it does.</p>}
          {problems.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-bad" data-testid="pricing-problems">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
          {warnings.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-warn" data-testid="pricing-warnings">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          <p className="mt-3 text-xs text-muted-foreground">{kept} loan{kept === 1 ? "" : "s"} past the term sheet keep their terms. New quotes use the new numbers; an application in review moves onto them only if someone reprices it.</p>
          <label className="mt-3 block"><span className="label">What changed and why</span><input className="desk-input" data-testid="pricing-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Tier 2 flips +0.25% after rate review" /></label>
          {error && <p className="mt-2 text-xs text-bad" data-testid="pricing-error">{error}</p>}
          <button type="button" className="btn-primary mt-3 w-full" data-testid="publish-pricing" disabled={!canPublish || saving || !changes.length || problems.length > 0 || !note.trim()} onClick={publish}>{saving ? "Publishing…" : "Publish new pricing"}</button>
          {!canPublish && <p className="mt-2 text-xs text-muted-foreground">Demo seats can try changes here but can&apos;t publish them.</p>}
          {changes.length > 0 && <button type="button" className="btn-ghost mt-2 w-full" onClick={() => setDraft(draftOf(current))}>Start over</button>}
        </Section>
        <Section title={`Applications in review (${open.length})`}>
          {open.length === 0 ? <p className="text-sm text-muted-foreground">None open right now.</p> : (
            <ul className="divide-y divide-border text-sm" data-testid="pricing-what-if">
              {whatIf.map(({ deal, now, next, differs }) => (
                <li key={deal.id} className="py-2" data-testid="what-if-row">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{deal.loanNumber}</span>{differs ? <Badge tone="amber">Would change</Badge> : <Badge>Same</Badge>}</div>
                  {differs && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {now.rate !== next.rate && `Rate ${now.rate.toFixed(3)}% → ${next.rate.toFixed(3)}%. `}
                      {now.pointsPct !== next.pointsPct && `Points ${now.pointsPct} → ${next.pointsPct}. `}
                      {now.noteAmount !== next.noteAmount && `Loan ${usd(now.noteAmount)} → ${usd(next.noteAmount)}. `}
                      {now.eligible !== next.eligible && (next.eligible ? "Becomes eligible." : `No longer eligible: ${next.hardStops[0]}`)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={`Versions (${history.length + 1})`}>
          <ul className="space-y-2 text-xs" data-testid="pricing-history">
            {history.map((row) => <li key={row.version}><b className="font-medium">{row.version}</b> · {row.publishedBy}, {shortDate(row.publishedAt)}<span className="block text-muted-foreground">{row.note}</span></li>)}
            <li><b className="font-medium">{BASE_VERSION}</b> · the numbers the platform started with, in lib/pricing-config.ts</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
