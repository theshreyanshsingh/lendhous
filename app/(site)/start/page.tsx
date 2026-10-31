import type { Metadata } from "next";
import { PageHead } from "@/components/site-chrome";
import { DealBrief } from "./deal-brief";

export const metadata: Metadata = {
  title: "Prepare Your Deal",
  description: "Prepare a local deal brief for a real estate investment financing conversation.",
};

export default function Start() {
  return (
    <>
      <PageHead eyebrow="LET’S START WITH THE OPPORTUNITY" title="Prepare your next move." description="Create a concise deal brief for your financing conversation. Start with what you know; use estimates where details are still taking shape." />
      <main className="content two-col">
        <DealBrief />
      </main>
    </>
  );
}
