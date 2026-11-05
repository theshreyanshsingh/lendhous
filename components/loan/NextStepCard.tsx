"use client";
import Link from "next/link";
import { nextStepFor } from "@/lib/next-step";
import type { Deal } from "@/lib/mockData";

const URGENT = ["late", "default"];
const ASKING = ["sign", "finish", "send", "exit"];

/** The borrower's one next step on a loan, at the top of the loan page (lib/next-step.ts). */
export function NextStepCard({ deal }: { deal: Deal }) {
  const step = nextStepFor(deal);
  if (!step) return null;
  const edge = URGENT.includes(step.kind) ? "border-bad/40" : ASKING.includes(step.kind) ? "border-warn/40" : "";
  const button = step.href && step.action ? (step.href.startsWith("#") ? <a href={step.href} className="btn-primary" data-testid="next-step-action">{step.action}</a> : <Link href={step.href} className="btn-primary" data-testid="next-step-action">{step.action}</Link>) : null;
  return (
    <section className={`glass flex flex-wrap items-center justify-between gap-3 p-4 ${edge}`} data-testid="borrower-next-step" data-kind={step.kind}>
      <div className="min-w-0 flex-1 basis-64">
        <p className="eyebrow mb-1">Your next step</p>
        <h2 className={`text-base font-medium ${URGENT.includes(step.kind) ? "text-bad" : ""}`}>{step.title}</h2>
        {step.detail && <p className="text-sm text-muted-foreground">{step.detail}</p>}
      </div>
      {button}
    </section>
  );
}
