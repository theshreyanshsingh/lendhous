import { TrackRecordGate, TrackRecordView } from "@/components/TrackRecord";
import { requireView } from "@/lib/auth";
import { trackRecordFor } from "@/lib/track-record-page";

export const metadata = { title: "Track record" };
export const dynamic = "force-dynamic";

/** Every loan LendHous has funded, in totals, for a buyer under the NDA (lib/track-record.ts). */
export default async function BuyerTrackRecord() {
  const user = await requireView("buyer");
  const result = await trackRecordFor(user, "buyer");
  return "gate" in result ? <TrackRecordGate firm={result.gate.firm} /> : <TrackRecordView record={result.record} />;
}
