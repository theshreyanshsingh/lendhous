"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendCampaignNow, type CampaignReply } from "@/actions/campaigns";
import { AUDIENCES, campaignProblem, type Audience, type CampaignInput } from "@/lib/campaigns";

/** Writing a campaign: who it goes to and how many, the message, a test to yourself, then the send. */
export function CampaignComposer({ counts, mailingAddress, draft, demo }: { counts: Record<Audience, number>; mailingAddress: string; draft: CampaignInput; demo: boolean }) {
  const router = useRouter();
  const [input, setInput] = useState<CampaignInput>(draft);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<CampaignReply | null>(null);
  const problem = campaignProblem(input, mailingAddress);
  const go = async (mode: "test" | "send") => {
    setBusy(true);
    const result = await sendCampaignNow(input, mode);
    setBusy(false);
    setReply(result);
    if (!("error" in result) && !result.test) { setChecked(false); router.refresh(); }
  };
  return (
    <div className="space-y-3 text-sm" data-testid="campaign-composer">
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Who it goes to">
        {(Object.entries(AUDIENCES) as [Audience, (typeof AUDIENCES)[Audience]][]).map(([key, info]) => (
          <label key={key} className={`cursor-pointer rounded-[2px] border p-3 ${input.audience === key ? "border-foreground" : "border-border"}`}>
            <input type="radio" name="audience" className="sr-only" data-testid={`campaign-audience-${key}`} checked={input.audience === key} onChange={() => setInput({ ...input, audience: key })} />
            <span className="block font-medium">{info.label} <span className="tabular-nums text-muted-foreground" data-testid={`campaign-count-${key}`}>· {counts[key].toLocaleString("en-US")}</span></span>
            <span className="block text-xs text-muted-foreground">{info.hint}</span>
          </label>
        ))}
      </div>
      <label className="block"><span className="label">Subject</span><input className="desk-input" data-testid="campaign-subject" maxLength={120} value={input.subject} onChange={(event) => setInput({ ...input, subject: event.target.value })} /></label>
      <label className="block"><span className="label">Message</span><textarea className="desk-input min-h-56 py-2" data-testid="campaign-body" maxLength={5000} value={input.body} onChange={(event) => setInput({ ...input, body: event.target.value })} /></label>
      <p className="text-xs text-muted-foreground" data-testid="campaign-footer-note">{mailingAddress.trim() ? `Every email ends with LendHous's mailing address (${mailingAddress.replace(/\s*\n\s*/g, ", ")}) and a one-click unsubscribe link. Anyone who unsubscribed isn't counted above or sent it.` : "Add LendHous's mailing address in Settings first: marketing email has to carry it."}</p>
      {problem && input.subject && input.body && <p className="text-xs text-warn">{problem}</p>}
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" data-testid="campaign-checked" checked={checked} onChange={(event) => setChecked(event.target.checked)} />I sent myself a test and checked it: the subject says honestly what&apos;s inside.</label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost" data-testid="campaign-test" disabled={busy || Boolean(problem) || demo} onClick={() => void go("test")}>Send me a test</button>
        <button type="button" className="btn-primary" data-testid="campaign-send" disabled={busy || Boolean(problem) || !checked || demo || counts[input.audience] === 0} onClick={() => void go("send")}>{busy ? "Sending…" : `Send to ${counts[input.audience].toLocaleString("en-US")} ${counts[input.audience] === 1 ? "person" : "people"}`}</button>
      </div>
      {demo && <p className="text-xs text-muted-foreground" data-testid="campaign-demo">Demo seats can write a campaign but don&apos;t send one.</p>}
      {reply && ("error" in reply ? <p role="alert" className="text-sm text-bad">{reply.error}</p> : <p role="status" className="text-sm text-good" data-testid="campaign-result">{reply.test ? "Test sent to you." : `Sent to ${reply.sent} ${reply.sent === 1 ? "person" : "people"}${reply.failed ? `; ${reply.failed} couldn't be sent` : ""}.`}</p>)}
    </div>
  );
}
