"use client";
import { useState } from "react";
import { Section, shortDate } from "@/components/ui";
import { PRE_FUNDING } from "@/lib/loan-exits";
import type { Deal, SellerIdMethod } from "@/lib/mockData";
import { ID_METHODS, sellerCheckNeeded, vacantLand } from "@/lib/seller-checks";
import { useStore } from "@/lib/store";

/**
 * The Closing tab's word on who's selling (lib/seller-checks.ts): on a sale of land, or by an owner who lives elsewhere
 * with no mortgage, the title company confirms it checked the seller's identity independently, through its link. A
 * closer who doesn't use the link tells the team, and the team records that here, saying who told them.
 */
export function SellerIdentity({ deal }: { deal: Deal }) {
  const { dispatch, viewerName } = useStore();
  const [method, setMethod] = useState<SellerIdMethod | "">("");
  const [note, setNote] = useState("");
  if (!sellerCheckNeeded(deal)) return null;
  const done = deal.closing?.sellerVerified;
  const open = PRE_FUNDING.includes(deal.status);
  return (
    <Section title="The seller's identity">
      <div className="space-y-2 text-sm" data-testid="seller-identity">
        {done ? (
          <p className="text-good" data-testid="seller-identity-done">{ID_METHODS[done.method]}. Confirmed by {done.by} on {shortDate(done.at)}{done.note ? `: ${done.note}` : "."}</p>
        ) : (
          <>
            <p className="text-warn">{vacantLand(deal) ? "This loan buys vacant land" : "The owner lives elsewhere and has no mortgage"}, the sale people posing as owners target most. It can&apos;t fund until the title company confirms it checked the seller&apos;s identity without relying on contact details the seller gave. The title company confirms it through its secure link.</p>
            {open && deal.closing?.company && (
              <div className="space-y-2 rounded-[2px] border border-border p-3">
                <p className="text-xs text-muted-foreground">If the closer told you instead, record what they did and who told you.</p>
                <label className="block"><span className="label">How the seller was checked</span><select className="desk-input" data-testid="seller-identity-method" value={method} onChange={(event) => setMethod(event.target.value as SellerIdMethod)}><option value="">Choose</option>{(Object.entries(ID_METHODS) as [SellerIdMethod, string][]).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                <label className="block"><span className="label">Who at the title company told you, and when</span><input className="desk-input" data-testid="seller-identity-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label>
                <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="seller-identity-save" disabled={!method || !note.trim()} onClick={async () => { if (method && (await dispatch({ t: "verifySeller", dealId: deal.id, method, note: note.trim(), by: viewerName }))) { setMethod(""); setNote(""); } }}>Record it</button>
              </div>
            )}
          </>
        )}
      </div>
    </Section>
  );
}
