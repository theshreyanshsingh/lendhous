"use client";
import { useEffect, useState } from "react";
import { clientLinkStatus, resendClientLink, type ClientLink } from "@/actions/broker-clients";
import { Badge, Section, usd } from "@/components/ui";
import { FEE_STATE, feeOf } from "@/lib/brokers";
import { downloadCsv } from "@/lib/csv";
import { shortDay } from "@/lib/format";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";

const STATE_WORDS: Record<ClientLink["state"], { label: string; tone: "amber" | "green" | "slate" | "rose" }> = { open: { label: "Waiting for your client", tone: "amber" }, signed: { label: "Filled in and signed", tone: "green" }, expired: { label: "Link expired", tone: "rose" }, off: { label: "Link replaced", tone: "slate" } };

/**
 * Whether the broker's client has filled in their own details on the secure link (actions/broker-clients.ts), and sending
 * it again. A deal with the details already in, from the broker or the client, just says so.
 */
export function ClientDetails({ deal }: { deal: Deal }) {
  const { local } = useStore();
  const [link, setLink] = useState<ClientLink | null | undefined>(undefined);
  const [name, setName] = useState(deal.borrowerName);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!local) void clientLinkStatus(deal.id).then((reply) => setLink(reply.link ?? null), () => setLink(null)); }, [deal.id, local]);
  // Only before review starts, or once a link has gone out; older deals kept their details on paper.
  if ((deal.sponsor || !["submitted", "initial_review", "underwriting"].includes(deal.status)) && !link) return null;
  const send = async () => {
    setBusy(true); setNote("");
    const reply = await resendClientLink(deal.id, name, email);
    setBusy(false);
    if (reply.error) { setNote(reply.error); return; }
    setNote(`Sent to ${email.trim()}. The link before it no longer works.`);
    const fresh = await clientLinkStatus(deal.id);
    setLink(fresh.link ?? null);
  };
  const words = link ? STATE_WORDS[link.state] : null;
  return (
    <Section title="Your client's details" right={deal.sponsor ? <Badge tone="green">In</Badge> : words ? <Badge tone={words.tone}>{words.label}</Badge> : undefined}>
      <div className="space-y-3 text-sm" data-testid="client-details">
        {local ? <p className="text-muted-foreground">In a real account, your client fills in their guarantors, past deals and credit questions on a secure link we email them, and you see here when they have.</p>
          : deal.sponsor ? <p className="text-muted-foreground" data-testid="client-details-in">Their guarantors, past deals and credit answers are in{link?.signedAt ? `, signed ${shortDay(link.signedAt.slice(0, 10))}` : ""}.</p>
          : link === undefined ? <p className="text-muted-foreground">Checking…</p>
          : link ? <p data-testid="client-link-state">{link.state === "open" ? `Sent to ${link.to} on ${shortDay(link.sentAt.slice(0, 10))}; it works until ${shortDay(link.expiresAt.slice(0, 10))}. They haven't signed yet.` : link.state === "signed" ? `${link.to} filled it in and signed.` : `The link to ${link.to} ${link.state === "expired" ? "expired" : "was replaced"}. Send a new one below.`}</p>
          : <p data-testid="client-link-state">LendHous still needs your client&apos;s guarantors, past deals and credit answers. Send them a secure link to fill them in themselves.</p>}
        {!local && !deal.sponsor && link?.state !== "signed" && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block min-w-0 flex-1 basis-40"><span className="label">Client&apos;s name</span><input className="desk-input" data-testid="client-link-name" value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className="block min-w-0 flex-1 basis-48"><span className="label">Their email</span><input type="email" className="desk-input" data-testid="client-link-email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <button type="button" className="btn-primary h-10! px-4! text-[13px]!" data-testid="client-link-send" disabled={busy || !name.trim() || !email.trim()} onClick={() => void send()}>{busy ? "Sending…" : link ? "Send a new link" : "Send the link"}</button>
          </div>
        )}
        {note && <p className="text-xs text-muted-foreground" role="status" data-testid="client-link-note">{note}</p>}
      </div>
    </Section>
  );
}

/**
 * The broker's fees, deal by deal (docs/competitor-gaps-2026-11-09.md, rank 13): what each will earn, what's earned and not
 * yet paid, and what's been paid, when and how, with the year's total for the 1099-NEC and a spreadsheet of it all.
 */
export function BrokerEarnings({ deals }: { deals: Deal[] }) {
  const rows = deals.map((deal) => ({ deal, fee: feeOf(deal) })).filter((row) => row.fee.state !== "none");
  if (!rows.length) return null;
  const year = new Date().getFullYear();
  const paidThisYear = rows.filter((row) => row.fee.state === "paid" && row.deal.brokerFeePaid?.on.startsWith(`${year}-`)).reduce((sum, row) => sum + row.fee.amount, 0);
  const download = () => downloadCsv(`lendhous-broker-fees-${year}.csv`, rows.map(({ deal, fee }) => ({ Loan: deal.loanNumber, Client: deal.borrowerName, Property: `${deal.address}, ${deal.city}`, Points: deal.brokerPoints ?? 0, Fee: fee.amount, Status: FEE_STATE[fee.state], "Paid on": deal.brokerFeePaid?.on ?? "", Reference: deal.brokerFeePaid?.reference ?? "" })));
  return (
    <Section title="Your fees" right={<button type="button" className="text-xs text-link underline underline-offset-2" data-testid="broker-fees-csv" onClick={download}>Download (CSV)</button>}>
      <table className="stack-table w-full text-sm" data-testid="broker-my-fees">
        <thead><tr className="border-b border-rule"><th>Loan</th><th className="text-right">Fee</th><th>Status</th><th>Paid</th></tr></thead>
        <tbody>
          {rows.map(({ deal, fee }) => (
            <tr key={deal.id} className="border-b border-border last:border-0" data-testid="broker-fee-row">
              <td>{deal.loanNumber}<small className="block text-xs text-muted-foreground">{deal.borrowerName} · {deal.city}</small></td>
              <td data-label="Fee" className="text-right tabular-nums">{usd(fee.amount, 2)}<small className="block text-xs text-muted-foreground">{deal.brokerPoints ?? 0} points</small></td>
              <td data-label="Status"><Badge tone={fee.state === "paid" ? "green" : fee.state === "unpaid" ? "amber" : "slate"}>{FEE_STATE[fee.state]}</Badge></td>
              <td data-label="Paid">{deal.brokerFeePaid ? `${shortDay(deal.brokerFeePaid.on)}${deal.brokerFeePaid.reference ? ` · ${deal.brokerFeePaid.reference}` : ""}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground" data-testid="broker-fees-year">Paid to you in {year}: {usd(paidThisYear, 2)}. LendHous sends a 1099-NEC for a year it pays you $600 or more, using the W-9 on your Tax form page.</p>
    </Section>
  );
}
