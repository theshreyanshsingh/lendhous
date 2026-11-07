import { Logo } from "@/components/logo";
import { PhotoGuide } from "@/components/PhotoGuide";
import { openPhotoLink } from "@/lib/photo-links";
import { guideSteps, requestLines } from "@/lib/photo-requests";

export const metadata = { title: "Send photos", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// A preview for staff and demo accounts. Its page keeps everything in the browser and sends nothing.
const DEMO = { to: "Sam Sample", sentBy: "The LendHous team", address: "100 Sample Street, Hollywood", steps: guideSteps([{ id: "kitchen", division: "Kitchen" }, { id: "plumbing", division: "Plumbing" }, { id: "flooring", division: "Flooring and paint" }]), photos: [], finished: false, finishedBy: "", note: "", expiresAt: "" };

export default async function PhotoLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = token === "demo" ? null : await openPhotoLink(token);
  if (token !== "demo" && link?.state !== "open") {
    return (
      <div className="min-h-screen">
        <header className="border-b border-rule"><div className="mx-auto max-w-xl px-4 py-5"><Logo /></div></header>
        <main className="mx-auto max-w-xl px-4 py-12" data-testid="photo-link-closed">
          <p className="eyebrow">Photos for LendHous</p>
          <h1 className="mt-3 text-3xl font-normal text-foreground">This link is no longer open.</h1>
          <p className="mt-3 text-sm text-muted-foreground">It may have expired or been replaced. Ask the person who sent it for a new one. Anything you already sent is safe.</p>
        </main>
      </div>
    );
  }
  // Only what the guide needs reaches the browser: no loan number, no amounts, no borrower details.
  const shown = link
    ? { to: link.request.to, sentBy: link.request.sentBy, address: `${link.deal.address}, ${link.deal.city}`, steps: guideSteps(requestLines(link.request, link.deal)), photos: link.request.photos.map(({ id, scopeId, shot, name }) => ({ id, scopeId, shot, name })), finished: link.request.status === "received", signsDraw: link.request.who === "contractor" && Boolean(link.request.drawId), inspects: link.request.who === "inspector" && link.draw?.status === "inspecting", finishedBy: link.request.finishedBy ?? "", note: link.request.note ?? "", expiresAt: link.request.expiresAt }
    : DEMO;
  return <PhotoGuide token={link ? token : null} {...shown} />;
}
