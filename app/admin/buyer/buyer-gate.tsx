"use client";
import { useStore } from "@/lib/store";
import type { LoanBuyer } from "@/lib/mockData";

/** Loans stay hidden until a firm is connected and has signed, the same gate partner lenders pass. */
export function BuyerGate({ children }: { children: (me: LoanBuyer) => React.ReactNode }) {
  const { s, dispatch } = useStore();
  const me = s.buyers.find((buyer) => buyer.id === s.buyerId);
  if (!me) return (
    <div className="mx-auto max-w-xl glass p-6 text-center" data-testid="no-buyer-org">
      <h1 className="text-xl font-normal tracking-tight">Your firm isn&apos;t connected yet</h1>
      <p className="mt-2 text-sm text-muted-foreground">Once LendHous connects your firm and its buy box, loans for sale appear here.</p>
    </div>);
  if (!me.ndaSigned) return (
    <div className="mx-auto max-w-xl glass p-6 text-center" data-testid="buyer-nda-gate">
      <h1 className="text-xl font-normal tracking-tight">Sign the NDA to see loans for sale</h1>
      <p className="mt-2 text-sm text-muted-foreground">{me.name} has not signed yet.</p>
      <button className="btn-primary mt-4" onClick={() => dispatch({ t: "signBuyerNda", buyerId: me.id })}>E-sign agreement</button>
    </div>);
  return <>{children(me)}</>;
}
