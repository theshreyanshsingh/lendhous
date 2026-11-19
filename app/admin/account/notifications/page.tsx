import Link from "next/link";
import { markGroupRead, markNoticesRead, saveNoticePreferences } from "@/actions/notifications";
import { PageIntro } from "@/components/page-intro";
import { PushToggle } from "@/components/PushToggle";
import { SubmitButton } from "@/components/submit-button";
import { requireUser } from "@/lib/auth";
import { scopedBook } from "@/lib/book-store";
import { isDemoEmail } from "@/lib/deploy";
import { CHOICES, groupNotices, inAppBody, readChoices, safeLink, topicOf, topicsFor, topicWords, TOPICS, type NoticeTopic } from "@/lib/notice-topics";
import { recentNotices } from "@/lib/notifications";
import { viewFor } from "@/lib/permissions";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

// LendHous works on Florida time.
const ZONE = "America/New_York";
const dayOf = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: ZONE });
function when(date: Date, now: Date) {
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ZONE });
  if (dayOf(date) === dayOf(now)) return time;
  if (dayOf(date) === dayOf(new Date(now.getTime() - 86_400_000))) return `Yesterday, ${time}`;
  const sameYear = date.toLocaleDateString("en-US", { year: "numeric", timeZone: ZONE }) === now.toLocaleDateString("en-US", { year: "numeric", timeZone: ZONE });
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: ZONE }) + (sameYear ? `, ${time}` : "");
}
const firstLine = (body: string) => inAppBody(body).split("\n").find((line) => line.trim())?.trim() ?? "";
/** Read notices shown at once in each group; older read ones fold under "Show older". */
const SHOWN = 4;

type Search = { show?: string; topic?: string };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  const params = await searchParams;
  const now = new Date();
  const all = (await recentNotices(user)).map((notice) => ({ ...notice, topic: topicOf(notice.eventCode) }));
  const unread = all.filter((notice) => !notice.readAt).length;
  const show = params.show === "all" || (params.show !== "unread" && unread === 0) ? "all" : "unread";
  const topic = params.topic && params.topic in TOPICS ? (params.topic as NoticeTopic) : undefined;
  const inView = all.filter((notice) => show === "all" || !notice.readAt);
  const notices = inView.filter((notice) => !topic || notice.topic === topic);
  const groups = groupNotices(notices);
  // A loan's address names its group better than its number, where the person can see the loan.
  const deals = isDemoEmail(user.email) ? [] : (await scopedBook(user)).deals;
  const placeOf = new Map(deals.map((deal) => [deal.loanNumber, `${deal.address}, ${deal.city}`]));
  const kinds = (Object.keys(TOPICS) as NoticeTopic[]).map((key) => [key, inView.filter((notice) => notice.topic === key).length] as const).filter(([, count]) => count > 0);
  const href = (change: Search) => {
    const next = { show, topic, ...change };
    const query = new URLSearchParams(Object.entries(next).filter((entry): entry is [string, string] => Boolean(entry[1])));
    return `/admin/account/notifications${query.size ? `?${query}` : ""}`;
  };
  const view = viewFor(user.roleCodes);
  const choices = readChoices(user.noticeTopics);
  const tab = (active: boolean) => `inline-flex h-9 items-center rounded-[2px] px-3 text-xs font-medium ${active ? "bg-foreground text-background" : "border border-border text-muted-foreground hover:text-foreground"}`;
  const chip = (active: boolean) => `inline-flex h-8 items-center gap-1 rounded-[2px] px-2.5 text-xs ${active ? "bg-active font-medium text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground"}`;

  return (
    <div className="max-w-3xl space-y-4">
      <PageIntro eyebrow="Account" title="Notifications" lede="Updates about your loans, grouped by loan. Below, choose what reaches you by email and when." />
      <section className="glass min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
          <nav className="flex gap-1.5" aria-label="Which notifications">
            <Link className={tab(show === "unread")} href={href({ show: "unread" })} data-testid="notices-unread-tab">Unread{unread ? ` (${unread})` : ""}</Link>
            <Link className={tab(show === "all")} href={href({ show: "all" })} data-testid="notices-all-tab">All</Link>
          </nav>
          {unread > 0 && <form action={markNoticesRead}><SubmitButton variant="outline" className="h-9 text-xs font-medium" pendingLabel="Marking…">Mark all as read</SubmitButton></form>}
        </div>
        {kinds.length > 1 && (
          <nav className="flex flex-wrap gap-1 border-b border-border px-3 py-2" aria-label="Kind of update" data-testid="notice-topics">
            <Link className={chip(!topic)} href={href({ topic: undefined })}>Every kind</Link>
            {kinds.map(([key, count]) => <Link key={key} className={chip(topic === key)} href={href({ topic: key })} data-testid={`notice-topic-${key}`}>{topicWords(key, view).label} <span className="tabular-nums text-muted-foreground">{count}</span></Link>)}
          </nav>
        )}
        {notices.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground" data-testid="notices-empty">
            {show === "unread" ? <>All caught up. <Link className="text-link underline" href={href({ show: "all" })}>See everything</Link>.</> : all.length ? "Nothing of this kind yet." : "Nothing yet. Updates about your loans will show here."}
          </p>
        )}
        <div className="divide-y divide-border" data-testid="notices">
          {groups.map((group) => {
            const place = group.loan ? placeOf.get(group.loan) : undefined;
            const unreadIds = group.notices.filter((notice) => !notice.readAt).map((notice) => notice.id);
            // Unread notices never fold away; read ones past the first few do.
            const shown = group.notices.filter((notice, index) => !notice.readAt || index < SHOWN);
            const folded = group.notices.filter((notice, index) => notice.readAt && index >= SHOWN);
            const row = (notice: (typeof group.notices)[number]) => {
              const link = safeLink(notice.link);
              const preview = firstLine(notice.body);
              return (
                <li key={notice.id} className={notice.readAt ? "" : "bg-active/60"} data-testid="notice">
                  <details className="group/notice">
                    <summary className="flex cursor-pointer list-none items-start gap-2.5 px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${notice.readAt ? "bg-transparent" : "bg-link"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className={`min-w-0 text-sm wrap-anywhere ${notice.readAt ? "" : "font-medium"}`}>{notice.subject}{!notice.readAt && <span className="sr-only"> (unread)</span>}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{when(notice.createdAt, now)}</span>
                        </span>
                        {preview && <span className="mt-0.5 block truncate text-xs text-muted-foreground group-open/notice:hidden">{preview}</span>}
                      </span>
                    </summary>
                    <div className="space-y-2 px-4 pb-3 pl-[2.1rem]">
                      <p className="text-sm wrap-anywhere whitespace-pre-wrap text-muted-foreground" data-testid="notice-body">{inAppBody(notice.body)}</p>
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        {/* A plain link, never prefetched: opening it marks the notice read. */}
                        {link && <a className="font-medium text-link underline" href={`/admin/account/notifications/open/${notice.id}`} data-testid="notice-open">Open {group.loan ?? "it"}</a>}
                        {!notice.readAt && <form action={markGroupRead}><input type="hidden" name="ids" value={notice.id} /><button type="submit" className="text-muted-foreground underline hover:text-foreground">Mark as read</button></form>}
                        <span className="text-muted-foreground">{topicWords(notice.topic, view).label}</span>
                      </div>
                    </div>
                  </details>
                </li>
              );
            };
            return (
              <div key={group.key || "other"} data-testid="notice-group">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/40 px-4 py-2">
                  <p className="min-w-0 text-xs wrap-anywhere">
                    <span className="font-medium text-foreground">{group.loan ? (place ?? group.loan) : "Other updates"}</span>
                    {place && <span className="text-muted-foreground"> · {group.loan}</span>}
                    <span className="text-muted-foreground"> · {group.unread ? `${group.unread} unread` : `${group.notices.length} update${group.notices.length === 1 ? "" : "s"}`}</span>
                  </p>
                  {unreadIds.length > 1 && <form action={markGroupRead}><input type="hidden" name="ids" value={unreadIds.join(",")} /><button type="submit" className="text-xs text-muted-foreground underline hover:text-foreground" data-testid="notice-group-read">Mark these read</button></form>}
                </div>
                <ul className="divide-y divide-border">{shown.map(row)}</ul>
                {folded.length > 0 && (
                  <details className="border-t border-border">
                    <summary className="cursor-pointer px-4 py-2 text-xs text-link" data-testid="notice-group-more">Show {folded.length} older</summary>
                    <ul className="divide-y divide-border border-t border-border">{folded.map(row)}</ul>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      </section>
      <section className="glass min-w-0 p-4 sm:p-5">
        <h2 className="eyebrow">On this phone or computer</h2>
        <div className="mt-3"><PushToggle /></div>
      </section>
      <section className="glass min-w-0 p-4 sm:p-5">
        <h2 className="eyebrow">How we reach you</h2>
        <form action={saveNoticePreferences} className="mt-3 space-y-3 text-sm" data-testid="notice-preferences">
          <label className="flex items-center gap-2"><input type="checkbox" name="email" data-testid="pref-email" defaultChecked={user.notifyEmail} /> Email me</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="inApp" data-testid="pref-app" defaultChecked={user.notifyInApp} /> Keep them here</label>
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">For each kind of update, by email:</p>
            {topicsFor(view).map((key) => (
              <label key={key} className="grid items-center gap-1 sm:grid-cols-[1fr_15rem] sm:gap-3">
                <span className="min-w-0"><span className="block font-medium">{topicWords(key, view).label}</span><span className="block text-xs text-muted-foreground">{topicWords(key, view).hint}</span></span>
                <select className="desk-input" name={`topic.${key}`} data-testid={`pref-topic-${key}`} defaultValue={choices[key] ?? "now"}>
                  {(Object.entries(CHOICES) as [keyof typeof CHOICES, string][]).map(([choice, label]) => <option key={choice} value={choice}>{label}</option>)}
                </select>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">The once-a-day email comes each morning with everything held since the last one. Phone notifications come only for what&apos;s emailed right away. Legal notices and password links are always emailed at once.</p>
          <SubmitButton variant="outline" className="mt-1 h-10 text-[13px] font-medium" pendingLabel="Saving…">Save</SubmitButton>
        </form>
      </section>
    </div>
  );
}
