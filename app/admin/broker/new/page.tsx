"use client";
import Link from "next/link";
import ApplicationWizard from "@/components/ApplicationWizard";
import { canSendDeals } from "@/lib/brokers";
import { useStore } from "@/lib/store";

export default function SubmitDeal() {
  const { s } = useStore();
  // The server refuses a deal from a brokerage that isn't approved; this says so before the form is filled in.
  if (!canSendDeals(s.brokers.find((broker) => broker.id === s.brokerId))) return (
    <div className="mx-auto max-w-xl glass p-6 text-center" data-testid="broker-not-approved">
      <h1 className="text-xl font-normal tracking-tight">Your brokerage isn&apos;t approved yet</h1>
      <p className="mt-2 text-sm text-muted-foreground">Sign the broker agreement first; you can send deals once LendHous approves it.</p>
      <Link href="/admin/broker" className="btn-primary mt-4 inline-block">Go to the broker agreement</Link>
    </div>
  );
  return <ApplicationWizard mode="broker" />;
}
