import type { Metadata } from "next";
import { PageHead } from "@/components/site-chrome";
import { Calculators } from "./calculators";

export const metadata: Metadata = {
  title: "Investment Property Calculators",
  description: "Explore rental DSCR, fix-and-flip project costs, and LTC/LTV limits with transparent educational calculators.",
};

export default function CalculatorsPage() {
  return (
    <>
      <PageHead eyebrow="THE NUMBERS BEHIND THE OPPORTUNITY" title="Make your assumptions visible." description="Adjust the inputs. Compare scenarios. Build a clearer picture before your financing conversation." />
      <main className="content">
        <Calculators />
        <p className="fine">Estimates for education only. Results are not a loan quote, recommendation, approval, or guarantee of investment performance.</p>
      </main>
    </>
  );
}
