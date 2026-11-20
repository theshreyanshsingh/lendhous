import { TrackRecordGate, TrackRecordView } from "@/components/TrackRecord";
import { requireView } from "@/lib/auth";
import { trackRecordFor } from "@/lib/track-record-page";

export const metadata = { title: "Track record" };
export const dynamic = "force-dynamic";

/** Every loan LendHous has funded, in totals, for a partner under the NDA (lib/track-record.ts). */
export default async function PartnerTrackRecord() {
  const user = await requireView("partner");
  const result = await trackRecordFor(user, "partner");
  return "gate" in result ? <TrackRecordGate firm={result.gate.firm} /> : <TrackRecordView record={result.record} />;
}
