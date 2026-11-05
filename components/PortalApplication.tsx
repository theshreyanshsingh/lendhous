"use client";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { savePortalApplication, signPortalApplication } from "@/actions/portal-application";
import { BorrowerApplication, type PortalMode } from "@/components/BorrowerApplication";
import { serviceDay } from "@/lib/book";
import { draftFromLoan, refinanceDraft, toLoan, type AppDraft } from "@/lib/borrower-application";
import { earlierLoans, repeatHistory } from "@/lib/repeat-borrower";
import { useStore } from "@/lib/store";

/**
 * A signed-in borrower's application: the same form and signature the secure link uses. A demo account, or one using
 * sample data, puts the loan in the browser's own book instead. A repeat borrower's starts from their earlier loan, and
 * the estimate takes off what their loans paid as agreed earn.
 */
export function PortalApplication({ initial, startStep, savedAt, startedFrom, from, fromQuote, refinancing }: { initial: AppDraft; startStep: number; savedAt: string | null; startedFrom?: { loanNumber: string; address: string }; from?: string; fromQuote?: string; refinancing?: boolean }) {
  const { s, dispatch, applyReply, local, viewerName, viewer } = useStore();
  const router = useRouter();
  // The browser's own book has no signed applications, so a demo account starts from the loan itself.
  const start = useMemo(() => {
    if (!local || startStep > 0) return { draft: initial, from: startedFrom };
    const mine = earlierLoans(s.deals, s.borrowerId).sort((a, b) => b.closingDate.localeCompare(a.closingDate));
    const source = mine.find((deal) => deal.id === from) ?? mine[0];
    if (source && refinancing && source.id === from) return { draft: refinanceDraft(source, { name: viewerName, email: viewer.email }, serviceDay(s)), from: { loanNumber: source.loanNumber, address: source.address } };
    return source ? { draft: draftFromLoan(source, { name: viewerName, email: viewer.email }), from: { loanNumber: source.loanNumber, address: source.address } } : { draft: initial, from: startedFrom };
    // Only when the form opens: the draft is the form's from then on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const repeat = useMemo(() => {
    const history = repeatHistory(s.deals, s.borrowerId, serviceDay(s));
    return history.loans || history.pausedBy ? history : undefined;
  }, [s]);
  const submit: PortalMode["submit"] = async (draft, consents, signature) => {
    if (local) {
      const loan = toLoan(draft);
      const done = await dispatch({ t: "submitApp", app: loan.app, address: loan.address, city: loan.city, zip: loan.zip, entityName: loan.entityName, exitStrategy: loan.exitStrategy, closingDate: loan.closingDate, sponsor: loan.sponsor, refinances: loan.refinances });
      return done ? {} : { error: "That didn't go through." };
    }
    const reply = await signPortalApplication(draft, consents, signature);
    if (reply.error) return { error: reply.error };
    applyReply({ book: reply.book });
    return { dealId: reply.dealId };
  };
  return (
    <div className="space-y-3">
      {start.from && (refinancing || start.draft.refinanceOf) ? (
        <p className="glass p-3 text-sm" data-testid="app-refinance">
          Refinancing <b>{start.from.loanNumber}</b>{start.from.address ? ` at ${start.from.address}` : ""} into a rental loan: the property, your entity, guarantors and past deals are filled in, and the finished rehab counts as a project. Add the rent and each guarantor&apos;s Social Security number, birth date and credit score. The new loan pays off {start.from.loanNumber} when it funds.
        </p>
      ) : start.from && (
        <p className="glass p-3 text-sm" data-testid="app-started-from">
          Started from your loan <b>{start.from.loanNumber}</b>{start.from.address ? ` at ${start.from.address}` : ""}: the same entity, guarantors and past deals. Add the new property, and enter each guarantor&apos;s Social Security number, birth date and credit score again.
        </p>
      )}
      {!start.from && fromQuote && <p className="glass p-3 text-sm" data-testid="app-from-quote">Started from your quote for <b>{fromQuote}</b>: the property and the numbers are filled in. Check them, then add the rest.</p>}
      <BorrowerApplication token={null} initial={start.draft} startStep={startStep} savedAt={savedAt} officer="" expiresAt=""
        portal={{ save: local ? undefined : savePortalApplication, submit, repeat, onDone: (dealId) => router.push(dealId ? `/admin/borrower/${dealId}` : "/admin/borrower") }} />
    </div>
  );
}
