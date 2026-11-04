"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { applyAsBroker } from "@/actions/brokers";
import { Section } from "@/components/ui";
import { AGREEMENT_TERMS, AGREEMENT_VERSION, BROKER_STATUS } from "@/lib/brokers";
import { shortDay } from "@/lib/format";
import type { Broker } from "@/lib/mockData";
import { useStore } from "@/lib/store";

/**
 * A brokerage's way in: the broker agreement, what LendHous needs to know about the firm, and its papers. Until an owner
 * approves it, it can't send deals. Once it's signed, this shows where it stands.
 */
export function BrokerOnboarding({ firm }: { firm: Broker }) {
  const { applyReply, local } = useStore();
  const signed = firm.application;
  const [editing, setEditing] = useState(!signed);
  const [form, setForm] = useState({ legalName: signed?.legalName ?? firm.name, entityState: signed?.entityState ?? "FL", principals: signed?.principals.join("\n") ?? "", nmls: signed?.nmls ?? "", license: signed?.license ?? "", signedName: "" });
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const articles = useRef<HTMLInputElement>(null);
  const standing = useRef<HTMLInputElement>(null);
  const put = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });
  const send = async () => {
    setBusy(true); setError("");
    const data = new FormData();
    for (const [key, value] of Object.entries(form)) data.set(key, value);
    data.set("agreed", agreed ? "1" : "");
    if (articles.current?.files?.[0]) data.set("articles", articles.current.files[0]);
    if (standing.current?.files?.[0]) data.set("good_standing", standing.current.files[0]);
    const reply = await applyAsBroker(data).catch(() => ({ error: "That didn't go through. Check your connection and try again." }) as { error: string; book?: undefined });
    setBusy(false);
    if (reply.error) return setError(reply.error);
    applyReply({ book: reply.book });
    setEditing(false);
  };
  const field = (label: string, key: keyof typeof form, extra: { testid: string; max?: number; placeholder?: string; wide?: boolean } ) => (
    <label className={`block min-w-0 ${extra.wide ? "sm:col-span-2" : ""}`}><span className="label">{label}</span><input className="desk-input" data-testid={extra.testid} maxLength={extra.max ?? 160} placeholder={extra.placeholder} value={form[key]} onChange={put(key)} /></label>
  );

  return (
    <div className="space-y-4" data-testid="broker-onboarding">
      {signed && (
        <Section title="Your broker agreement">
          <div className="space-y-2 text-sm" data-testid="broker-status">
            <p><b>{firm.status ? BROKER_STATUS[firm.status] : "Not signed"}</b>{firm.status === "applied" ? ": LendHous checks the firm and its papers, then you'll hear by email. You can send deals once it's approved." : firm.status === "suspended" ? `: ${firm.suspended?.reason ?? "talk to LendHous about sending deals again."}` : "."}</p>
            <p className="text-muted-foreground">{signed.legalName} ({signed.entityState}){signed.nmls ? `, NMLS ${signed.nmls}` : ""}. Signed by {signed.signedName} on {shortDay(signed.signedAt)}, version {signed.agreementVersion}.</p>
            {(firm.docs ?? []).map((doc) => <p key={doc.documentId} className="text-xs"><a className="text-link underline underline-offset-2" href={`/api/documents/${doc.documentId}`}>{doc.kind === "articles" ? "Articles" : "Good standing"}: {doc.fileName}</a></p>)}
            <p className="text-xs text-muted-foreground">LendHous also needs your W-9 before it pays a fee: <Link className="text-link underline underline-offset-2" href="/admin/account/tax">Tax form</Link>.</p>
            {!editing && firm.status !== "suspended" && <button type="button" className="text-link underline underline-offset-2" data-testid="broker-resign" onClick={() => setEditing(true)}>Something changed? Update it and sign again</button>}
          </div>
        </Section>
      )}
      {editing && (
        <Section title="Become a LendHous broker">
          {local ? <p className="text-sm text-muted-foreground" data-testid="broker-demo">The demo brokerage is already approved. A real brokerage signs the agreement here.</p> : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">LendHous works with brokers on business-purpose loans to real estate investors. Tell us about your firm, attach its papers, and sign the agreement below; an owner approves it, usually within a business day.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {field("Brokerage's legal name", "legalName", { testid: "broker-legal-name" })}
                {field("State it was formed in", "entityState", { testid: "broker-state", max: 2, placeholder: "FL" })}
                <label className="block min-w-0 sm:col-span-2"><span className="label">Owners and officers, one per line</span><textarea className="desk-input min-h-20" data-testid="broker-principals" maxLength={1000} value={form.principals} onChange={put("principals")} /></label>
                {field("NMLS ID, if you have one (optional)", "nmls", { testid: "broker-nmls", max: 12 })}
                {field("State license, if your state requires one (optional)", "license", { testid: "broker-license", max: 80, placeholder: "e.g. FL MBR1234" })}
                <label className="block min-w-0"><span className="label">Articles of organization or incorporation</span><input ref={articles} type="file" accept=".pdf,.png,.jpg,.jpeg" className="desk-input" data-testid="broker-articles" /></label>
                <label className="block min-w-0"><span className="label">Certificate of good standing (last 90 days)</span><input ref={standing} type="file" accept=".pdf,.png,.jpg,.jpeg" className="desk-input" data-testid="broker-good-standing" /></label>
              </div>
              <div className="rounded-[2px] border border-border bg-muted/40 p-3 font-serif text-[13px] leading-relaxed" data-testid="broker-agreement">
                <p className="mb-2 font-sans text-xs text-muted-foreground">Broker agreement, version {AGREEMENT_VERSION} (PLACEHOLDER until LendHous&apos;s attorney finalizes it)</p>
                <ol className="list-decimal space-y-1.5 pl-5">{AGREEMENT_TERMS.map((term) => <li key={term}>{term}</li>)}</ol>
              </div>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" data-testid="broker-agree" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} /> I&apos;m an owner or officer of this brokerage, and I agree to the broker agreement for it.</label>
              <label className="block"><span className="label">Type your full name to sign</span><input className="w-full border-0 border-b border-rule bg-transparent py-2 font-serif text-xl italic text-foreground outline-none" data-testid="broker-signature" value={form.signedName} onChange={put("signedName")} /></label>
              {error && <p className="text-sm text-bad" role="alert" data-testid="broker-error">{error}</p>}
              <button type="button" className="btn-primary" data-testid="broker-apply" disabled={busy} onClick={() => void send()}>{busy ? "Sending…" : "Sign and send"}</button>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
