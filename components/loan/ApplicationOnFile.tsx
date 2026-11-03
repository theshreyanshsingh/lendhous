"use client";
import { useEffect, useState } from "react";
import { applicationOnFile, revealSsn } from "@/actions/application-links";
import { SendApplicationLink } from "@/components/SendApplicationLink";
import { CONSENTS, type AppDraft } from "@/lib/borrower-application";
import type { Deal } from "@/lib/mockData";
import { LOAN_TYPES } from "@/lib/quote";
import { useStore } from "@/lib/store";
import { Badge, Section, shortDate } from "@/components/ui";

type OnFile = Awaited<ReturnType<typeof applicationOnFile>>;

/**
 * The borrower's signed application on a loan: who signed, when and from where, the consents, and each guarantor's
 * private details with the Social Security number masked until someone allowed to see it asks (and is logged).
 */
export function ApplicationOnFile({ deal }: { deal: Deal }) {
  const { local } = useStore();
  const [onFile, setOnFile] = useState<OnFile | null>(null);
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  useEffect(() => { if (!local) void applicationOnFile(deal.id).then(setOnFile).catch(() => setOnFile(null)); }, [deal.id, local]);
  const reviewing = ["submitted", "initial_review", "underwriting"].includes(deal.status) && !deal.creditReview;
  if (local) return <Section title="Borrower application"><p className="text-sm text-muted-foreground">Demo loans have no application on file. <a className="text-link underline" href="/apply/demo" target="_blank" rel="noreferrer">Preview what the borrower sees</a>.</p></Section>;
  if (!onFile) return null;
  const signed = onFile.signed;
  const reveal = async (index: number) => {
    const reply = await revealSsn(deal.id, index);
    if (reply.ssn) setRevealed({ ...revealed, [index]: reply.ssn }); else setError(reply.error ?? "");
  };
  return (
    <Section title="Borrower application" right={signed ? <Badge tone="green">Signed</Badge> : onFile.open ? <Badge tone="amber">Link sent</Badge> : undefined}>
      {signed ? (
        <div className="space-y-3 text-sm" data-testid="application-on-file">
          <p>Signed by <b>{signed.signature.name}</b> on {shortDate(signed.signature.at)} from {signed.signature.ip}. Consents ({signed.signature.version}): {CONSENTS.map((item) => item.title.toLowerCase()).join("; ")}.</p>
          <p className="text-muted-foreground">{LOAN_TYPES[signed.draft.loanType]} · flood zone: {signed.draft.property.floodZone || "—"} · {signed.draft.property.beds || "—"} bd / {signed.draft.property.baths || "—"} ba / {signed.draft.property.sqft || "—"} sq ft{signed.draft.vesting.hasLlc ? ` · ${signed.draft.vesting.entityName}, EIN ${signed.draft.vesting.ein || "not given"}` : " · LLC to be formed"}</p>
          <ul className="divide-y divide-border rounded-[2px] border border-border">
            {signed.draft.guarantors.map((g: AppDraft["guarantors"][number], index: number) => (
              <li key={index} className="space-y-0.5 p-3" data-testid="application-guarantor">
                <p className="font-medium">{g.firstName} {g.lastName} <span className="text-xs font-normal text-muted-foreground">· {g.ownershipPct}% · score {g.fico} · {g.citizenship} · {g.marital}</span></p>
                <p className="text-xs text-muted-foreground">Born {g.dob} · {g.email} · {g.phone}</p>
                <p className="text-xs text-muted-foreground">Home: {[g.home.street, g.home.city, g.home.state, g.home.zip].join(", ")}{g.twoYears === false ? " (under 2 years)" : ""}</p>
                <p className="text-xs">SSN <span className="font-mono" data-testid="application-ssn">{revealed[index] ? `${revealed[index].slice(0, 3)}-${revealed[index].slice(3, 5)}-${revealed[index].slice(5)}` : g.ssn}</span>{!revealed[index] && <button type="button" className="ml-2 text-link underline" onClick={() => void reveal(index)}>Show (logged)</button>}</p>
              </li>
            ))}
          </ul>
          {error && <p className="text-xs text-bad">{error}</p>}
        </div>
      ) : onFile.open ? (
        <p className="text-sm text-muted-foreground" data-testid="application-link-status">Sent to {onFile.open.to} {shortDate(onFile.open.createdAt)}. {onFile.open.savedAt ? `On step ${onFile.open.step + 1} of 5, last saved ${shortDate(onFile.open.savedAt)}.` : "Not opened yet."} It works until {shortDate(onFile.open.expiresAt)}.</p>
      ) : <p className="text-sm text-muted-foreground">No signed application on file.</p>}
      {reviewing && !signed && <div className="mt-3"><SendApplicationLink dealId={deal.id} name={deal.borrowerName} email="" /></div>}
    </Section>
  );
}
