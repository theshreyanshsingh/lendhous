"use client";
import { useState } from "react";
import { checkFloodMap } from "@/actions/property-facts";
import { shortDate } from "@/components/ui";
import { COUNTIES } from "@/lib/counties";
import { floodDisagrees, floodMapWords } from "@/lib/flood-zones";
import type { Deal } from "@/lib/mockData";
import { useStore } from "@/lib/store";

/** A demo seat never reaches FEMA: coastal counties get a zone AE answer and the rest zone X, marked as samples. */
const demoAnswer = (deal: Deal) => (COUNTIES.find((county) => county.name === deal.app.county)?.coastal ? { mapped: true, zone: "AE", sfha: true } : { mapped: true, zone: "X", sfha: false });

/** What FEMA's flood map says at the property, when it was checked, and a button to check it again. */
export function FloodMapLine({ deal }: { deal: Deal }) {
  const { applyReply, dispatch, local } = useStore();
  const [busy, setBusy] = useState(false);
  const map = deal.floodMap;
  const check = async () => {
    setBusy(true);
    if (local) await dispatch({ t: "recordFloodMap", dealId: deal.id, map: { ...demoAnswer(deal), at: new Date().toISOString() } });
    else applyReply(await checkFloodMap(deal.id));
    setBusy(false);
  };
  return (
    <div className="text-xs" data-testid="flood-map">
      <p className={map && (map.sfha || !map.mapped) ? "text-warn" : "text-muted-foreground"}>
        {map ? <>FEMA&apos;s flood map{map.at ? `, checked ${shortDate(map.at)}` : ""}: {floodMapWords(map)}</> : "Not looked up on FEMA's flood map yet. It's checked on its own once the address is on the map."}
        {local && map ? " (Demo: a sample answer, not FEMA's.)" : null}
      </p>
      {floodDisagrees(deal) && <p className="mt-1 text-bad" data-testid="flood-disagrees">The zone recorded on the loan says {deal.insurance!.flood!.sfha ? "it is" : "it isn't"} in a special flood hazard area, and FEMA&apos;s map says the opposite. Check the flood zone determination.</p>}
      <button type="button" className="btn-ghost mt-1 h-9! px-3! text-xs!" data-testid="check-flood-map" disabled={busy} onClick={() => void check()}>{busy ? "Checking…" : map ? "Check FEMA's map again" : "Check FEMA's map"}</button>
    </div>
  );
}
