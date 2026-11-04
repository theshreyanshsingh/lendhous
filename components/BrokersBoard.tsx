"use client";
import { useEffect, useState } from "react";
import { brokerTaxForms, screenBroker } from "@/actions/brokers";
import { Badge, Section, usd } from "@/components/ui";
import { approveProblem, BROKER_STATUS, FEE_STATE, feeOf, referralPath } from "@/lib/brokers";
import { shortDay } from "@/lib/format";
import type { Broker } from "@/lib/mockData";
import { useStore } from "@/lib/store";

const tone = (status?: Broker["status"]) => (status === "approved" ? "green" : status === "suspended" ? "rose" : "amber");

/**
 * The owners' list of brokerages: what each signed and sent, its OFAC screening and W-9, and its loans and fees.
 * Approving one lets it send deals and gives it a referral link; suspending stops new deals.
 */
export function BrokersBoard() {
  const { s, dispatch, applyReply, local, viewerName } = useStore();
  const [taxForms, setTaxForms] = useState<Record<string, { kind: "w9" | "w8"; signedAt: string }>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  useEffect(() => { if (!local) void brokerTaxForms().then(setTaxForms).catch(() => setTaxForms({})); }, [local]);
  const waiting = s.brokers.filter((broker) => broker.status === "applied");
  const rescreen = async (id: string) => {
    setError("");
    const reply = await screenBroker(id).catch(() => ({ error: "That didn't go through." }) as { error: string; book?: undefined });
    if (reply.error) return setError(reply.error);
    applyReply({ book: reply.book });
  };
  if (!s.brokers.length) return <div className="glass p-6 text-sm text-muted-foreground" data-testid="brokers-empty">No brokerages yet. A broker you invite on the Members page signs the broker agreement from their portal, and shows up here for approval.</div>;
  return (
    <div className="space-y-4" data-testid="brokers-board">
      {waiting.length > 0 && <p className="text-sm text-warn" data-testid="brokers-waiting">{waiting.length} brokerage{waiting.length === 1 ? " is" : "s are"} waiting for approval.</p>}
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      {s.brokers.map((broker) => {
        const loans = s.deals.filter((deal) => deal.brokerId === broker.id);
        const fees = loans.map((deal) => ({ deal, ...feeOf(deal) })).filter((fee) => fee.state !== "none");
        const tax = taxForms[broker.id];
        const reason = reasons[broker.id] ?? "";
        const blocked = approveProblem(broker, reason);
        const application = broker.application;
        return (
          <div key={broker.id} data-testid="broker-row"><Section title={broker.name} right={<Badge tone={tone(broker.status)}>{broker.status ? BROKER_STATUS[broker.status] : "Not signed"}</Badge>}>
            <div className="space-y-3 text-sm">
              {application ? (
                <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <dt className="text-muted-foreground">Formed in</dt><dd>{application.entityState}</dd>
                  <dt className="text-muted-foreground">Owners and officers</dt><dd>{application.principals.join(", ")}</dd>
                  <dt className="text-muted-foreground">Licensing</dt><dd>{[application.nmls && `NMLS ${application.nmls}`, application.license].filter(Boolean).join(" · ") || "None given (business-purpose brokering needs no Florida license; check their home state)"}</dd>
                  <dt className="text-muted-foreground">Agreement</dt><dd>Signed by {application.signedName} on {shortDay(application.signedAt)}, version {application.agreementVersion}</dd>
                  <dt className="text-muted-foreground">Papers</dt><dd>{(broker.docs ?? []).length ? (broker.docs ?? []).map((doc) => <a key={doc.documentId} className="mr-3 text-link underline underline-offset-2" href={local ? undefined : `/api/documents/${doc.documentId}`} data-testid="broker-doc">{doc.kind === "articles" ? "Articles" : "Good standing"}</a>) : <span className="text-warn">None</span>}</dd>
                  <dt className="text-muted-foreground">W-9</dt><dd data-testid="broker-w9">{local ? "Demo" : tax ? `${tax.kind === "w9" ? "W-9" : "W-8"} signed ${shortDay(tax.signedAt)}` : <span className="text-warn">Not on file: 24% backup withholding on its fees until it is</span>}</dd>
                  <dt className="text-muted-foreground">OFAC</dt>
                  <dd data-testid="broker-ofac">{!broker.screening ? <span className="text-warn">Not screened</span> : broker.screening.status === "clear" ? <span className="text-good">Clear ({shortDay(broker.screening.at)})</span> : broker.screening.status === "cleared" ? <span className="text-good">Possible match cleared: {broker.screening.decided?.reason}</span> : (
                    <span className="text-bad">Possible match: {broker.screening.subjects.flatMap((subject) => subject.hits.map((hit) => `${subject.name} ~ ${hit.name} (${hit.program})`)).join("; ")}</span>
                  )}{!local && <button type="button" className="ml-2 text-link underline underline-offset-2" data-testid="broker-rescreen" onClick={() => void rescreen(broker.id)}>screen again</button>}</dd>
                </dl>
              ) : <p className="text-muted-foreground">Hasn&apos;t signed the broker agreement yet.</p>}
              {broker.status === "approved" && broker.referralCode && <p className="text-xs text-muted-foreground">Referral link: <span className="font-mono">{referralPath(broker.referralCode)}</span>{broker.approved ? ` · approved by ${broker.approved.by} on ${shortDay(broker.approved.at)}` : ""}</p>}
              {broker.status === "suspended" && <p className="text-xs text-bad">Suspended by {broker.suspended?.by} on {broker.suspended ? shortDay(broker.suspended.at) : ""}: {broker.suspended?.reason}</p>}
              {fees.length > 0 && (
                <table className="stack-table w-full text-sm" data-testid="broker-fees">
                  <thead><tr><th>Loan</th><th>Borrower</th><th className="text-right">Fee</th><th>Status</th></tr></thead>
                  <tbody className="divide-y divide-border">{fees.map((fee) => (
                    <tr key={fee.deal.id}><td><a className="text-link underline underline-offset-2" href={`/admin/deals/${fee.deal.id}`}>{fee.deal.loanNumber}</a></td><td data-label="Borrower">{fee.deal.borrowerName}</td><td data-label="Fee" className="text-right tabular-nums">{usd(fee.amount, 2)}</td><td data-label="Status">{FEE_STATE[fee.state]}{fee.deal.brokerFeePaid ? ` ${shortDay(fee.deal.brokerFeePaid.on)}` : ""}</td></tr>
                  ))}</tbody>
                </table>
              )}
              {application && broker.status !== "approved" && (
                <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                  {broker.screening?.status === "review" && <label className="block min-w-0 flex-1 basis-56"><span className="label">Why the possible match isn&apos;t them</span><input className="desk-input" data-testid="broker-clear-reason" value={reason} onChange={(event) => setReasons({ ...reasons, [broker.id]: event.target.value })} /></label>}
                  <button type="button" className="btn-primary" data-testid="broker-approve" disabled={Boolean(blocked)} title={blocked ?? undefined} onClick={() => void dispatch({ t: "approveBroker", brokerId: broker.id, reason, by: viewerName })}>Approve</button>
                  {blocked && <p className="w-full text-xs text-muted-foreground">{blocked}</p>}
                </div>
              )}
              {broker.status === "approved" && (
                <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                  <label className="block min-w-0 flex-1 basis-56"><span className="label">Reason to suspend</span><input className="desk-input" data-testid="broker-suspend-reason" value={reason} onChange={(event) => setReasons({ ...reasons, [broker.id]: event.target.value })} /></label>
                  <button type="button" className="btn-ghost" data-testid="broker-suspend" disabled={!reason.trim()} onClick={() => void dispatch({ t: "suspendBroker", brokerId: broker.id, reason, by: viewerName })}>Suspend</button>
                </div>
              )}
            </div>
          </Section></div>
        );
      })}
    </div>
  );
}
