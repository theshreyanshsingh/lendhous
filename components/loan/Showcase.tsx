"use client";
import { Section, shortDate } from "@/components/ui";
import type { Deal } from "@/lib/mockData";
import { showcaseable } from "@/lib/showcase";
import { useStore } from "@/lib/store";

/**
 * The borrower's choice to show a funded loan on the website's "Recently funded" list, and the team's view of it. The
 * borrower turns it on or off; the team can only take it down.
 */
export function Showcase({ deal, side }: { deal: Deal; side: "client" | "team" }) {
  const { dispatch, viewerName } = useStore();
  const shown = Boolean(deal.showcase?.on);
  const set = (on: boolean) => void dispatch({ t: "setShowcase", dealId: deal.id, on, by: viewerName });
  if (side === "team") {
    if (!shown) return null;
    return (
      <p className="mt-1 text-sm text-muted-foreground" data-testid="showcase-team">
        On the website&apos;s recently funded list (the borrower agreed {shortDate(deal.showcase!.at)}). <button type="button" className="text-link underline underline-offset-2" data-testid="showcase-take-down" onClick={() => set(false)}>Take it down</button>
      </p>
    );
  }
  if (!showcaseable(deal) && !shown) return null;
  return (
    <Section title="Show your project on our website">
      <div className="space-y-3 text-sm" data-testid="showcase">
        <p className="text-muted-foreground">We&apos;d list it under &ldquo;Recently funded&rdquo; on LendHous.com with the city, the kind of loan, the amount and your first photo of the property. Never your name, your company or the street address. You can take it down any time.</p>
        {shown && <p className="text-good" data-testid="showcase-on">It&apos;s on the website.</p>}
        <button type="button" className={shown ? "btn-ghost" : "btn-primary"} data-testid="showcase-toggle" onClick={() => set(!shown)}>{shown ? "Take it off the website" : "Show it on the website"}</button>
      </div>
    </Section>
  );
}
