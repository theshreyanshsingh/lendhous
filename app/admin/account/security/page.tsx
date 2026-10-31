import { emailMyPasswordLink } from "@/actions/members";
import { Notice } from "@/components/notice";
import { PageIntro } from "@/components/page-intro";
import { SubmitButton } from "@/components/submit-button";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/format";

export const metadata = { title: "Security" };

export default async function SecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const params = await searchParams;
  return (
    <div className="max-w-xl">
      <PageIntro eyebrow="Security" title="Password." lede={`To change your password, we'll email a one-time link to ${user.email}.`} />
      <Notice notice={q(params, "notice")} error={q(params, "error")} />
      <form action={emailMyPasswordLink} className="mt-8"><SubmitButton variant="outline" className="h-11 text-[13px] font-medium" pendingLabel="Sending…">Email me a password link</SubmitButton></form>
    </div>
  );
}
