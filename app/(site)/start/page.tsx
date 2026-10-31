import type { Metadata } from "next";
import { PageHead } from "@/components/site-chrome";
import { DealBrief } from "./deal-brief";

export const metadata: Metadata = {
  title: "Prepare Your Deal",
  description: "Send LendHous a short brief on your property and plan to start a real estate investment financing conversation.",
};

export default function Start() {
  return (
    <>
      <PageHead eyebrow="LET’S START WITH THE OPPORTUNITY" title="Prepare your next move." description="Send the team a concise deal brief to start your financing conversation. Start with what you know; use estimates where details are still taking shape." />
      <main className="content two-col">
        <DealBrief />
      </main>
    </>
  );
}
