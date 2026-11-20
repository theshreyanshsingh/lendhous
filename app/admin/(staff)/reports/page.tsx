import { PageIntro } from "@/components/page-intro";
import { ReportsBoard } from "@/components/ReportsBoard";
import { Notice } from "@/components/notice";
import { ScheduledReports } from "@/components/ScheduledReports";
import { TrackRecordView } from "@/components/TrackRecord";
import { readSchedules, recipients } from "@/lib/report-schedule-store";
import { requirePermission } from "@/lib/auth";
import { demoBook, serviceDay } from "@/lib/book";
import { loadBook } from "@/lib/book-store";
import { isDemoEmail } from "@/lib/deploy";
import { trackRecord } from "@/lib/track-record";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const user = await requirePermission("view_reports");
  const params = await searchParams;
  const demo = isDemoEmail(user.email);
  // The same totals partners and buyers see under the NDA (lib/track-record.ts).
  const book = demo ? demoBook() : (await loadBook()).book;
  // Demo seats share the database with no one, but never see real accounts' names.
  const [schedules, people] = demo ? [[], []] : await Promise.all([readSchedules(), recipients()]);
  const record = trackRecord(book, serviceDay(book));
  return (
    <div className="space-y-4">
      <PageIntro eyebrow="Business" title="Reports" lede="How the business is doing: the pipeline over the dates you pick, and capital and the funded portfolio as of today. Owners get the same numbers by email each morning." />
      <Notice notice={params.notice} error={params.error} />
      <ReportsBoard />
      <ScheduledReports schedules={schedules} people={people} demo={demo} />
      <section className="space-y-3 pt-2" data-testid="staff-track-record">
        <h2 className="eyebrow">Track record · what partners and buyers see under the NDA</h2>
        <TrackRecordView record={record} intro={false} />
      </section>
    </div>
  );
}
