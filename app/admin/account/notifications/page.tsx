import { markNoticesRead, saveNoticePreferences } from "@/actions/notifications";
import { PageIntro } from "@/components/page-intro";
import { SubmitButton } from "@/components/submit-button";
import { requireUser } from "@/lib/auth";
import { recentNotices } from "@/lib/notifications";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

const when = (date: Date) => date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });

export default async function NotificationsPage() {
  const user = await requireUser();
  const notices = await recentNotices(user);
  const unread = notices.filter((notice) => !notice.readAt).length;
  return (
    <div className="max-w-3xl space-y-4">
      <PageIntro eyebrow="Account" title="Notifications" lede="What LendHous has sent you, in one place." />
      <section className="glass min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
          <p className="text-sm text-muted-foreground">{unread ? `${unread} unread` : "All caught up"}</p>
          {unread > 0 && <form action={markNoticesRead}><SubmitButton variant="outline" className="h-9 text-xs font-medium" pendingLabel="Marking…">Mark all as read</SubmitButton></form>}
        </div>
        {notices.length === 0 && <p className="p-6 text-sm text-muted-foreground">Nothing yet.</p>}
        <ul className="divide-y divide-border" data-testid="notices">
          {notices.map((notice) => (
            <li key={notice.id} className={`p-4 ${notice.readAt ? "" : "bg-active/60"}`} data-testid="notice">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3"><strong className="min-w-0 text-sm font-medium wrap-anywhere">{notice.subject}</strong><span className="text-xs text-muted-foreground">{when(notice.createdAt)}</span></div>
              <p className="mt-1 text-sm wrap-anywhere whitespace-pre-wrap text-muted-foreground">{notice.body}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className="glass min-w-0 p-4 sm:p-5">
        <h2 className="eyebrow">How we reach you</h2>
        <form action={saveNoticePreferences} className="mt-3 space-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" name="email" data-testid="pref-email" defaultChecked={user.notifyEmail} /> Email me</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="inApp" data-testid="pref-app" defaultChecked={user.notifyInApp} /> Keep them here</label>
          <p className="text-xs text-muted-foreground">Legal notices and password links are always sent.</p>
          <SubmitButton variant="outline" className="mt-1 h-10 text-[13px] font-medium" pendingLabel="Saving…">Save</SubmitButton>
        </form>
      </section>
    </div>
  );
}
