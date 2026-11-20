// The track record for a signed-in partner or buyer: the whole book's totals (lib/track-record.ts), once its firm has
// signed the NDA. Demo seats get the demo book's, which lives in their browser.
import { firmOf } from "./book-access";
import { demoBook, serviceDay } from "./book";
import { loadBook } from "./book-store";
import { isDemoEmail } from "./deploy";
import type { CurrentUser } from "./auth";
import { trackRecord, type TrackRecord } from "./track-record";

export async function trackRecordFor(user: CurrentUser, kind: "partner" | "buyer"): Promise<{ record: TrackRecord } | { gate: { firm?: string } }> {
  const demo = isDemoEmail(user.email);
  const book = demo ? demoBook() : (await loadBook()).book;
  if (!demo) {
    const firm = (kind === "partner" ? book.partners : book.buyers).find((item) => item.id === firmOf(user));
    if (!firm?.ndaSigned) return { gate: { firm: firm?.name } };
  }
  return { record: trackRecord(book, serviceDay(book)) };
}
