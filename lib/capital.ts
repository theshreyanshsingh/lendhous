// Where each capital source stands: what's reserved, committed, deployed and still free. Shared by the capital page,
// routing and the business reports, so they all count the same way.
import { capitalAvailable, evaluate, type Application, type Estimate } from "./engine";
import type { CapitalSource, Deal } from "./mockData";

const estCache = new WeakMap<Application, Estimate>();
export function est(app: Application) { let e = estCache.get(app); if (!e) { e = evaluate(app); estCache.set(app, e); } return e; }

export interface CapRow { source: CapitalSource; reserved: number; committed: number; deployed: number; unfunded: number; available: number }
export function capitalSummary(deals: Deal[], sources: CapitalSource[]): CapRow[] {
  return sources.map((src) => {
    let reserved = 0, committed = 0, deployed = src.baseDeployed, unfunded = src.baseUnfunded;
    for (const d of deals) {
      for (const al of d.allocations) {
        if (al.sourceId !== src.id) continue;
        const e = est(d.app); const share = e.noteAmount ? al.amount / e.noteAmount : 0;
        if (d.capitalStatus === "reserved") reserved += al.amount;
        else if (d.capitalStatus === "committed") committed += al.amount;
        else if (d.capitalStatus === "funded") {
          const drawn = d.disbursedDraws ?? 0;
          deployed += share * (e.initialAdvance + drawn);
          unfunded += share * (e.holdback - drawn + e.financedReserve);
        }
      }
    }
    const available = capitalAvailable({ commitment: src.commitment, reserved, committed, deployed, unfunded, lineUndrawn: src.lineUndrawn });
    return { source: src, reserved, committed, deployed, unfunded, available };
  });
}
export const inHouseAvailable = (deals: Deal[], sources: CapitalSource[], excludeDealId?: string) =>
  capitalSummary(deals.map((d) => (d.id === excludeDealId ? { ...d, allocations: [] } : d)), sources).find((r) => r.source.id === "gt-main")?.available ?? 0;
