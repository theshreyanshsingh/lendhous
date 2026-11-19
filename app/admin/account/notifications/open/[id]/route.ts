import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { safeLink } from "@/lib/notice-topics";
import { markRead, noticeFor } from "@/lib/notifications";

export const dynamic = "force-dynamic";

const BACK = "/admin/account/notifications";
// A relative Location, so the redirect stays on whatever host the person came in on (behind the proxy too).
const go = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });

/** A notice's Open link: marks it read and goes to the page it's about, only ever a page inside LendHous. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return go(`/login?next=${encodeURIComponent(BACK)}`);
  const notice = await noticeFor(user, id);
  if (!notice) return go(BACK);
  if (!notice.readAt) await markRead(user, [notice.id]);
  return go(safeLink(notice.link) ?? BACK);
}
