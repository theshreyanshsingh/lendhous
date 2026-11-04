"use client";
import { useEffect, useState } from "react";
import { myLetters } from "@/actions/letters";
import { Badge, Section, usd } from "@/components/ui";
import { shortDay } from "@/lib/format";
import { LETTER_KIND } from "@/lib/letters";
import { useStore } from "@/lib/store";

type Letter = Awaited<ReturnType<typeof myLetters>>[number];

/** A borrower's pre-approval and proof-of-funds letters, to download and send with an offer. Hidden until there's one. */
export function BorrowerLetters() {
  const { local } = useStore();
  const [letters, setLetters] = useState<Letter[]>([]);
  useEffect(() => { if (!local) void myLetters().then(setLetters).catch(() => setLetters([])); }, [local]);
  if (!letters.length) return null;
  return (
    <Section title="Your letters">
      <ul className="divide-y divide-border text-sm" data-testid="my-letters">
        {letters.map((letter) => (
          <li key={letter.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="my-letter">
            <span className="min-w-0"><span className="font-medium">{LETTER_KIND[letter.kind]} {letter.number}</span> <span className="text-muted-foreground">· loan up to {usd(letter.maxLoan)} · {letter.state === "expired" ? "expired" : "good through"} {shortDay(letter.expiresOn)}</span></span>
            <span className="flex items-center gap-3">{letter.state === "valid" ? <a className="text-link underline" href={`/api/letters/${letter.id}`} data-testid="my-letter-pdf">Download</a> : <Badge tone={letter.state === "revoked" ? "rose" : "slate"}>{letter.state === "revoked" ? "Withdrawn" : "Expired"}</Badge>}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">Send it with your offer. The seller can scan its code to check it&apos;s genuine. Ask your loan officer for a new one when it runs out.</p>
    </Section>
  );
}
