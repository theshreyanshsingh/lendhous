"use client";
import { useEffect, useState } from "react";
import { issueApprovalLetter, letterBorrowers, revokeApprovalLetter, staffLetters, type LetterInput } from "@/actions/letters";
import { Badge, Section, productLabel, usd } from "@/components/ui";
import type { Product } from "@/lib/engine";
import { shortDay } from "@/lib/format";
import { DEFAULT_CONDITIONS, LETTER_DAYS, LETTER_KIND, STAFF_LETTER_KINDS, type LetterKind } from "@/lib/letters";

type Letter = Awaited<ReturnType<typeof staffLetters>>[number];
type Borrower = Awaited<ReturnType<typeof letterBorrowers>>[number];

const blank = (): LetterInput => ({ kind: "pre_approval", borrowerId: "", name: "", email: "", entityName: "", product: "fix_flip", maxPurchasePrice: 0, maxLoan: 0, propertyAddress: "", conditions: DEFAULT_CONDITIONS, validDays: LETTER_DAYS.default });
const amount = (text: string) => Number(text.replace(/[^0-9]/g, "")) || 0;

/** The team's letters page: issue one, see each one's state and verify link, and withdraw one. */
export function LettersBoard({ demo }: { demo: boolean }) {
  const [letters, setLetters] = useState<Letter[]>([]);
  const [borrowers, setBorrowers] = useState<Borrower[]>([]);
  const [form, setForm] = useState<LetterInput>(blank);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => void staffLetters().then(setLetters).catch(() => setLetters([]));
  useEffect(() => { if (!demo) { load(); void letterBorrowers().then(setBorrowers).catch(() => setBorrowers([])); } }, [demo]);
  const put = (changes: Partial<LetterInput>) => setForm((current) => ({ ...current, ...changes }));
  const pick = (id: string) => { const account = borrowers.find((item) => item.id === id); put({ borrowerId: id, name: account?.name ?? form.name, email: account?.email ?? form.email }); };
  const issue = async () => {
    setBusy(true); setError(""); setDone("");
    const reply: { number?: string; error?: string } = await issueApprovalLetter(form).catch(() => ({ error: "That didn't go through. Check your connection and try again." }));
    setBusy(false);
    if (reply.error) return setError(reply.error);
    setDone(`Letter ${reply.number} issued${form.email ? ` and emailed to ${form.email}` : ""}.`);
    setForm(blank());
    load();
  };

  if (demo) return (
    <Section title="Sample letter">
      <div className="space-y-2 text-sm" data-testid="letters-demo">
        <p className="text-muted-foreground">Demo accounts can&apos;t issue real letters. Here&apos;s what one looks like, and the page its QR code opens.</p>
        <div className="flex flex-wrap gap-3"><a className="text-link underline max-sm:py-2.5" href="/api/letters/demo" data-testid="letter-sample-pdf">Sample letter (PDF)</a><a className="text-link underline max-sm:py-2.5" href="/verify/demo" data-testid="letter-sample-verify">Its verify page</a></div>
      </div>
    </Section>
  );

  return (
    <div className="space-y-4">
      <Section title="Issue a letter">
        <div className="grid gap-3 sm:grid-cols-2" data-testid="letter-form">
          <label className="block"><span className="label">Kind</span><select className="desk-input" data-testid="letter-kind" value={form.kind} onChange={(event) => put({ kind: event.target.value as LetterKind })}>{STAFF_LETTER_KINDS.map((kind) => <option key={kind} value={kind}>{LETTER_KIND[kind]}</option>)}</select></label>
          <label className="block"><span className="label">Borrower account (optional)</span><select className="desk-input" data-testid="letter-borrower" value={form.borrowerId} onChange={(event) => pick(event.target.value)}><option value="">Not in the portal</option>{borrowers.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.email}</option>)}</select></label>
          <label className="block"><span className="label">Borrower&apos;s name</span><input className="desk-input" data-testid="letter-name" maxLength={120} value={form.name} onChange={(event) => put({ name: event.target.value })} /></label>
          <label className="block"><span className="label">Email it to (optional)</span><input className="desk-input" type="email" data-testid="letter-email" maxLength={200} value={form.email} onChange={(event) => put({ email: event.target.value })} /></label>
          <label className="block"><span className="label">Borrowing entity (optional)</span><input className="desk-input" data-testid="letter-entity" maxLength={160} value={form.entityName} onChange={(event) => put({ entityName: event.target.value })} placeholder="Leave blank if it isn't formed yet" /></label>
          <label className="block"><span className="label">Program</span><select className="desk-input" data-testid="letter-product" value={form.product} onChange={(event) => put({ product: event.target.value as Product })}>{Object.entries(productLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="block"><span className="label">Purchase price up to</span><input className="desk-input" inputMode="numeric" data-testid="letter-price" value={form.maxPurchasePrice ? form.maxPurchasePrice.toLocaleString("en-US") : ""} onChange={(event) => put({ maxPurchasePrice: amount(event.target.value) })} /></label>
          <label className="block"><span className="label">Loan up to</span><input className="desk-input" inputMode="numeric" data-testid="letter-loan" value={form.maxLoan ? form.maxLoan.toLocaleString("en-US") : ""} onChange={(event) => put({ maxLoan: amount(event.target.value) })} /></label>
          <label className="block sm:col-span-2"><span className="label">Property (optional, for a letter about one property)</span><input className="desk-input" data-testid="letter-property" maxLength={200} value={form.propertyAddress} onChange={(event) => put({ propertyAddress: event.target.value })} /></label>
          <label className="block"><span className="label">Valid for (days)</span><input className="desk-input w-28!" type="number" min={LETTER_DAYS.min} max={LETTER_DAYS.max} data-testid="letter-days" value={form.validDays} onChange={(event) => put({ validDays: Number(event.target.value) })} /></label>
          <label className="block sm:col-span-2"><span className="label">Conditions, one a line</span><textarea className="desk-input h-auto! min-h-28 py-2" data-testid="letter-conditions" value={form.conditions.join("\n")} onChange={(event) => put({ conditions: event.target.value.split("\n") })} /></label>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Issuing takes term sheet authority for the loan amount. A written request for a pre-approval counts as a credit application under Reg B: if you won&apos;t issue one someone asked for, send them a decline notice.</p>
        {error && <p className="mt-2 text-sm text-bad" role="alert" data-testid="letter-error">{error}</p>}
        {done && <p className="mt-2 text-sm text-good" role="status" data-testid="letter-done">{done}</p>}
        <button type="button" className="btn-primary mt-3" data-testid="issue-letter" disabled={busy} onClick={() => void issue()}>{busy ? "Issuing…" : "Issue the letter"}</button>
      </Section>
      <Section title={`Letters (${letters.length})`}>
        {letters.length === 0 ? <p className="text-sm text-muted-foreground">No letters yet.</p> : (
          <ul className="divide-y divide-border text-sm" data-testid="letters">
            {letters.map((letter) => (
              <li key={letter.id} className="flex flex-wrap items-start justify-between gap-2 py-3" data-testid="letter-row">
                <div className="min-w-0">
                  <div className="font-medium">{letter.number} · {LETTER_KIND[letter.kind]} · {letter.entityName || letter.name}</div>
                  <div className="text-xs text-muted-foreground">Loan up to {usd(letter.maxLoan)} · price up to {usd(letter.maxPurchasePrice)}{letter.propertyAddress ? ` · ${letter.propertyAddress}` : ""} · issued {shortDay(letter.issuedAt)} by {letter.issuedBy} · {letter.state === "expired" ? "expired" : "good through"} {shortDay(letter.expiresOn)}</div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs"><a className="text-link underline" href={`/api/letters/${letter.id}`} data-testid="letter-pdf">PDF</a><a className="text-link underline" href={letter.verifyUrl} data-testid="letter-verify-link">Verify page</a></div>
                </div>
                <div className="flex items-center gap-2">{letter.state === "valid" ? <Badge tone="green">Valid</Badge> : letter.state === "revoked" ? <Badge tone="rose">Withdrawn</Badge> : <Badge tone="slate">Expired</Badge>}{letter.state === "valid" && <button type="button" className="btn-ghost h-8! text-xs!" data-testid="revoke-letter" onClick={() => void revokeApprovalLetter(letter.id).then(load)}>Withdraw</button>}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
