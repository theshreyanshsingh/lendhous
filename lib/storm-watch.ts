// Storm mode's server half (docs/next-features-prompt.md, L): reads NHC's active storms and each Atlantic storm's forecast
// cone, records which funded loans each covers (the owners are emailed, lib/book-alerts.ts), and once a storm has passed,
// sends each of its borrowers a link for photos of the property. Nightly and from the Storms page. Server only.
import { randomUUID } from "node:crypto";
import type { Viewer } from "@/lib/book-access";
import { sendAlerts } from "@/lib/book-alerts";
import { readBook, runAction } from "@/lib/book-store";
import { sendPhotoLinkMail } from "@/lib/email";
import { firstKml } from "@/lib/kmz";
import { createPhotoLink } from "@/lib/photo-links";
import { PHOTO_LINK_DAYS } from "@/lib/photo-requests";
import { prisma } from "@/lib/prisma";
import { mapMissing } from "@/lib/property-facts";
import { ACTIVE_STORMS_URL, loansInCone, parseActiveStorms, parseCone, watched, type StormCheck } from "@/lib/storms";

export const STORM_DESK: Viewer = { id: "system", name: "LendHous storm watch", roleCodes: [] };

const longDate = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" });

/** One check of every active Atlantic storm against the funded loans. What it found, in a line for the jobs log. */
export async function checkStorms(now = new Date(), fetcher: typeof fetch = fetch) {
  let storms;
  try {
    const reply = await fetcher(ACTIVE_STORMS_URL, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!reply.ok) throw new Error(String(reply.status));
    storms = parseActiveStorms(await reply.json());
  } catch {
    // Nothing is recorded: with no answer, every storm on watch would look like it had passed.
    return { error: "NHC's list of active storms didn't answer. Nothing changed; try again later." };
  }
  // Funded loans not yet on the map are placed first, so the cone can be checked against them.
  const { book: before } = await readBook();
  if (before.deals.some((deal) => watched(deal) && !deal.geo)) await mapMissing(25, fetcher);
  const { book } = await readBook();
  const checks: StormCheck[] = [];
  let unread = 0;
  for (const storm of storms) {
    let dealIds: string[] | null = null;
    if (storm.coneUrl) {
      try {
        const reply = await fetcher(storm.coneUrl, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
        const kml = reply.ok ? firstKml(Buffer.from(await reply.arrayBuffer())) : null;
        const cone = kml ? parseCone(kml) : [];
        if (cone.length) dealIds = loansInCone(book.deals, cone);
      } catch {}
    }
    // A cone that couldn't be read keeps what the last one covered, rather than looking like the storm moved off.
    if (dealIds === null) { unread++; dealIds = (book.storms ?? []).find((item) => item.id === storm.id)?.nowIn ?? []; }
    checks.push({ id: storm.id, name: storm.name, label: storm.label, advisory: storm.advisory, dealIds });
  }
  const result = await runAction(STORM_DESK, { t: "recordStormCheck", at: now.toISOString(), storms: checks }, { trusted: true });
  if ("error" in result) return { error: result.error };
  await sendAlerts(result.before, result.after, result.action);
  const asked = await followUp(now);
  const watching = checks.filter((item) => item.dealIds.length);
  return { summary: `${storms.length} active Atlantic storm${storms.length === 1 ? "" : "s"}${watching.length ? `, ${watching.map((item) => `${item.label} covering ${item.dealIds.length} loan${item.dealIds.length === 1 ? "" : "s"}`).join("; ")}` : ", none covering a LendHous property"}${unread ? `; ${unread} cone${unread === 1 ? "" : "s"} couldn't be read` : ""}${asked ? `; ${asked} borrower${asked === 1 ? "" : "s"} asked for photos after a storm` : ""}` };
}

/** After a storm passes, each of its borrowers gets a link for photos of the property, once. */
export async function followUp(now = new Date()) {
  const { book } = await readBook();
  let asked = 0;
  for (const storm of (book.storms ?? []).filter((item) => item.status === "passed")) {
    for (const dealId of storm.dealIds.filter((id) => !(storm.followedUp ?? []).includes(id))) {
      const deal = book.deals.find((item) => item.id === dealId);
      if (!deal || !watched(deal)) continue;
      const account = await prisma.user.findUnique({ where: { id: deal.borrowerId }, select: { email: true } });
      const requestId = randomUUID();
      const expiresAt = new Date(now.getTime() + PHOTO_LINK_DAYS * 86_400_000).toISOString();
      const result = await runAction(STORM_DESK, { t: "askForPhotos", requestId, dealId, stormId: storm.id, to: deal.borrowerName.replace(/\s*\(FAKE\)/, ""), email: account?.email, who: "borrower", scopeIds: [], by: "LendHous servicing", byTeam: true, expiresAt }, { trusted: true });
      if ("error" in result) continue;
      const link = await createPhotoLink(requestId, expiresAt);
      if (account?.email) await sendPhotoLinkMail(account.email, { to: deal.borrowerName.replace(/\s*\(FAKE\)/, ""), sentBy: "LendHous servicing", address: `${deal.address}, ${deal.city}`, link, expires: longDate(expiresAt), storm: storm.label });
      asked++;
    }
  }
  return asked;
}
