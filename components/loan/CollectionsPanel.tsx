"use client";
import { useState } from "react";
import { BANKRUPTCY_ENDS, claimDueOn, CONTACT_CHANNELS, CONTACT_OUTCOMES, COLLECTIONS, DELIVERY_METHODS, nextAction, NOTICE_KINDS, openBankruptcy, promiseState, STAGE_LABEL, stageOf, type PromiseState } from "@/lib/collections";
import { shortDay } from "@/lib/format";
import type { Bankruptcy, ContactChannel, ContactOutcome, Deal, DeliveryMethod, NoticeKind } from "@/lib/mockData";
import { addDays, ledgerOf, openDefault, SERVICED } from "@/lib/servicing";
import { useStore } from "@/lib/store";
import { Badge, Section, usd } from "@/components/ui";
import { useServiceDay } from "./use-service-day";

const PROMISE_TONE: Record<PromiseState, "amber" | "green" | "rose" | "slate"> = { open: "amber", kept: "green", broken: "rose", cancelled: "slate" };
const PROMISE_WORD: Record<PromiseState, string> = { open: "Open", kept: "Kept", broken: "Broken", cancelled: "Withdrawn" };
const amount = (text: string) => Number(text.replace(/[^0-9.]/g, "")) || 0;

/**
 * The servicing team's collections file on a late or defaulted loan (lib/collections.ts): where it stands and what to do
 * next, the calls and letters, promises to pay and whether they were kept, the notices sent and the proof they arrived,
 * and a bankruptcy's automatic stay, which pauses all of it. Once the loan is closed out it's the file, with nothing to add.
 */
export function CollectionsPanel({ deal }: { deal: Deal }) {
  const today = useServiceDay();
  if (!today) return null;
  const stage = stageOf(deal, today);
  const touched = (deal.contacts?.length ?? 0) + (deal.promises?.length ?? 0) + (deal.notices?.length ?? 0) + (deal.bankruptcies?.length ?? 0) > 0;
  if (!stage && !touched) return null;
  const l = ledgerOf(deal, today);
  const live = SERVICED.includes(deal.status);
  return (
    <Section title="Collections" right={stage ? <Badge tone={stage === "late" ? "amber" : "rose"}>{STAGE_LABEL[stage]}</Badge> : <Badge tone={live ? "green" : "slate"}>{live ? "Paid as agreed" : "Closed out"}</Badge>}>
      <div className="space-y-4 text-sm" data-testid="collections">
        {live ? (
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p data-testid="collections-next"><b>Next:</b> {nextAction(deal, today)}</p>
            <p className="text-xs text-muted-foreground">{usd(l.amountDue, 2)} due{l.daysPastDue ? `, ${l.daysPastDue} days past due` : ""}</p>
          </div>
        ) : <p className="text-muted-foreground" data-testid="collections-closed">The loan is closed out. This is its collections file as it ended.</p>}
        <BankruptcyFile deal={deal} today={today} live={live} />
        <ContactLog deal={deal} today={today} live={live} />
        <Promises deal={deal} today={today} live={live} />
        <Notices deal={deal} today={today} live={live} />
      </div>
    </Section>
  );
}

function BankruptcyFile({ deal, today, live }: { deal: Deal; today: string; live: boolean }) {
  const { dispatch, viewerName } = useStore();
  const open = openBankruptcy(deal);
  const [adding, setAdding] = useState(false);
  const [debtor, setDebtor] = useState(deal.entityName || deal.borrowerName);
  const [chapter, setChapter] = useState<Bankruptcy["chapter"]>(7);
  const [caseNumber, setCaseNumber] = useState("");
  const [court, setCourt] = useState("U.S. Bankruptcy Court, Southern District of Florida");
  const [filedOn, setFiledOn] = useState(today);
  const [ending, setEnding] = useState<NonNullable<Bankruptcy["ended"]>["how"] | "">("");
  const [on, setOn] = useState(today);
  const save = async () => { if (await dispatch({ t: "recordBankruptcy", dealId: deal.id, debtor: debtor.trim(), chapter, caseNumber: caseNumber.trim(), court: court.trim(), filedOn, by: viewerName })) setAdding(false); };
  if (open) return (
    <div className="space-y-2 rounded-[2px] border border-bad/40 bg-bad/10 p-3" role="status" data-testid="bankruptcy-open">
      <p className="font-semibold text-bad">Automatic stay: chapter {open.chapter} bankruptcy since {shortDay(open.filedOn)}</p>
      <p>{open.debtor}, case {open.caseNumber}, {open.court}. Don&apos;t call or write asking for payment, send notices or take foreclosure steps: talk to the debtor&apos;s attorney and counsel. Late and maturity emails to the borrower are paused.</p>
      <p className="text-xs" data-testid="bankruptcy-claim">{open.claimFiledOn ? `Proof of claim filed ${shortDay(open.claimFiledOn)}.` : `File the proof of claim by ${shortDay(claimDueOn(open))} (${COLLECTIONS.claimDays} days after the filing; PLACEHOLDER until counsel confirms the court's bar date).`}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block"><span className="label">On</span><input type="date" className="desk-input" data-testid="bankruptcy-on" min={open.filedOn} max={today} value={on} onChange={(event) => setOn(event.target.value)} /></label>
        {!open.claimFiledOn && <button type="button" className="btn-ghost h-10! px-3! text-xs!" data-testid="claim-filed" onClick={() => void dispatch({ t: "bankruptcyClaimFiled", dealId: deal.id, bankruptcyId: open.id, on, by: viewerName })}>Proof of claim filed</button>}
        <label className="block"><span className="label">The case ended</span><select className="desk-input" data-testid="bankruptcy-end" value={ending} onChange={(event) => setEnding(event.target.value as typeof ending)}><option value="">Still open</option>{Object.entries(BANKRUPTCY_ENDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {ending && <button type="button" className="btn-primary h-10! px-3! text-xs!" data-testid="end-bankruptcy" onClick={async () => { if (await dispatch({ t: "endBankruptcy", dealId: deal.id, bankruptcyId: open.id, on, how: ending, by: viewerName })) setEnding(""); }}>Record it</button>}
      </div>
    </div>
  );
  const past = (deal.bankruptcies ?? []).filter((item) => item.ended);
  return (
    <div className="space-y-2">
      {past.map((item) => <p key={item.id} className="text-xs text-muted-foreground">Chapter {item.chapter} case {item.caseNumber}, filed {shortDay(item.filedOn)}: {BANKRUPTCY_ENDS[item.ended!.how].toLowerCase()} {shortDay(item.ended!.on)}.</p>)}
      {!live ? null : !adding ? <button type="button" className="text-xs text-link underline underline-offset-2" data-testid="add-bankruptcy" onClick={() => setAdding(true)}>The borrower or a guarantor filed for bankruptcy</button> : (
        <div className="space-y-2 rounded-[2px] border border-border p-3" data-testid="bankruptcy-form">
          <div className="grid gap-2 sm:grid-cols-4">
            <label className="block sm:col-span-2"><span className="label">Who filed</span><input className="desk-input" data-testid="bankruptcy-debtor" maxLength={160} value={debtor} onChange={(event) => setDebtor(event.target.value)} /></label>
            <label className="block"><span className="label">Chapter</span><select className="desk-input" data-testid="bankruptcy-chapter" value={chapter} onChange={(event) => setChapter(Number(event.target.value) as Bankruptcy["chapter"])}>{[7, 11, 13].map((item) => <option key={item} value={item}>Chapter {item}</option>)}</select></label>
            <label className="block"><span className="label">Filed on</span><input type="date" className="desk-input" data-testid="bankruptcy-filed" max={today} value={filedOn} onChange={(event) => setFiledOn(event.target.value)} /></label>
            <label className="block"><span className="label">Case number</span><input className="desk-input" data-testid="bankruptcy-case" maxLength={60} value={caseNumber} onChange={(event) => setCaseNumber(event.target.value)} /></label>
            <label className="block sm:col-span-3"><span className="label">Court</span><input className="desk-input" data-testid="bankruptcy-court" maxLength={120} value={court} onChange={(event) => setCourt(event.target.value)} /></label>
          </div>
          <p className="text-xs text-muted-foreground">Recording it pauses collection on this loan and tells the team and any partner or buyer holding it.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" data-testid="save-bankruptcy" disabled={!debtor.trim() || !caseNumber.trim() || !court.trim()} onClick={() => void save()}>Record the filing</button>
            <button type="button" className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ContactLog({ deal, today, live }: { deal: Deal; today: string; live: boolean }) {
  const { dispatch, viewerName } = useStore();
  const [on, setOn] = useState(today);
  const [channel, setChannel] = useState<ContactChannel>("call");
  const [who, setWho] = useState(deal.borrowerName);
  const [outcome, setOutcome] = useState<ContactOutcome>("reached");
  const [note, setNote] = useState("");
  const [all, setAll] = useState(false);
  const contacts = [...(deal.contacts ?? [])].reverse();
  const save = async () => { if (await dispatch({ t: "logContact", dealId: deal.id, on, channel, with: who.trim(), outcome, note: note.trim(), by: viewerName })) setNote(""); };
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Calls and letters</h3>
      {live && <><div className="grid gap-2 sm:grid-cols-5" data-testid="contact-form">
        <label className="block"><span className="label">Date</span><input type="date" className="desk-input" data-testid="contact-on" min={deal.closingDate} max={today} value={on} onChange={(event) => setOn(event.target.value)} /></label>
        <label className="block"><span className="label">How</span><select className="desk-input" data-testid="contact-channel" value={channel} onChange={(event) => setChannel(event.target.value as ContactChannel)}>{Object.entries(CONTACT_CHANNELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="block"><span className="label">With</span><input className="desk-input" data-testid="contact-with" maxLength={120} value={who} onChange={(event) => setWho(event.target.value)} /></label>
        <label className="block"><span className="label">Outcome</span><select className="desk-input" data-testid="contact-outcome" value={outcome} onChange={(event) => setOutcome(event.target.value as ContactOutcome)}>{Object.entries(CONTACT_OUTCOMES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="block sm:col-span-5"><span className="label">What was said</span><input className="desk-input" data-testid="contact-note" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      </div>
      <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="save-contact" disabled={!who.trim()} onClick={() => void save()}>Log it</button></>}
      {!live && !contacts.length && <p className="text-xs text-muted-foreground">None.</p>}
      {contacts.length > 0 && (
        <ul className="divide-y divide-border" data-testid="contact-list">
          {(all ? contacts : contacts.slice(0, 4)).map((item) => <li key={item.id} className="py-1.5" data-testid="contact-row"><span className="font-medium">{shortDay(item.on)}</span> · {CONTACT_CHANNELS[item.channel]} with {item.with}: {CONTACT_OUTCOMES[item.outcome].toLowerCase()}{item.note ? `. ${item.note}` : ""}<span className="text-xs text-muted-foreground"> ({item.by})</span></li>)}
        </ul>
      )}
      {contacts.length > 4 && <button type="button" className="text-xs text-link underline underline-offset-2" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${contacts.length}`}</button>}
    </div>
  );
}

function Promises({ deal, today, live }: { deal: Deal; today: string; live: boolean }) {
  const { dispatch, viewerName } = useStore();
  const l = ledgerOf(deal, today);
  const [promised, setPromised] = useState("");
  const [dueBy, setDueBy] = useState(addDays(today, 7));
  const [note, setNote] = useState("");
  const stayed = Boolean(openBankruptcy(deal));
  const promises = [...(deal.promises ?? [])].reverse();
  const save = async () => { if (await dispatch({ t: "recordPromise", dealId: deal.id, amount: amount(promised), dueBy, note: note.trim(), by: viewerName })) { setPromised(""); setNote(""); } };
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Promises to pay</h3>
      {live && !stayed && l.amountDue > 0 && (
        <div className="flex flex-wrap items-end gap-2" data-testid="promise-form">
          <label className="block"><span className="label">Amount</span><input className="desk-input w-36!" inputMode="decimal" data-testid="promise-amount" placeholder={l.amountDue.toFixed(2)} value={promised} onChange={(event) => setPromised(event.target.value)} /></label>
          <label className="block"><span className="label">By</span><input type="date" className="desk-input" data-testid="promise-by" min={today} max={addDays(today, COLLECTIONS.promiseDays)} value={dueBy} onChange={(event) => setDueBy(event.target.value)} /></label>
          <label className="block min-w-0 flex-1 basis-40"><span className="label">Note</span><input className="desk-input" data-testid="promise-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <button type="button" className="btn-ghost h-10! px-3! text-xs!" data-testid="save-promise" disabled={!(amount(promised) > 0)} onClick={() => void save()}>Record the promise</button>
        </div>
      )}
      {promises.length > 0 ? (
        <ul className="divide-y divide-border" data-testid="promise-list">
          {promises.slice(0, 4).map((item) => {
            const { state, received } = promiseState(deal, item, today);
            return (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5" data-testid="promise-row">
                <span>{usd(item.amount, 2)} by {shortDay(item.dueBy)}, promised {shortDay(item.madeOn)}{item.note ? `: ${item.note}` : ""}{received > 0 && state !== "kept" ? ` (${usd(received, 2)} in so far)` : ""}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={PROMISE_TONE[state]}>{PROMISE_WORD[state]}</Badge>
                  {state === "open" && <button type="button" className="text-xs text-link underline underline-offset-2" onClick={() => void dispatch({ t: "cancelPromise", dealId: deal.id, promiseId: item.id, reason: "Withdrawn by the team", by: viewerName })}>Withdraw</button>}
                </span>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-xs text-muted-foreground">None yet. A promise is kept once that much arrives by the day.</p>}
    </div>
  );
}

function Notices({ deal, today, live }: { deal: Deal; today: string; live: boolean }) {
  const { dispatch, viewerName } = useStore();
  const l = ledgerOf(deal, today);
  const likely: NoticeKind = openDefault(deal) ? ((deal.notices ?? []).some((item) => item.kind === "default") ? "acceleration" : "default") : l.matured ? "maturity_demand" : "late";
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<NoticeKind>(likely);
  const [sentOn, setSentOn] = useState(today);
  const [method, setMethod] = useState<DeliveryMethod>("certified_mail");
  const [to, setTo] = useState(`${deal.entityName || deal.borrowerName}, ${deal.address}, ${deal.city} ${deal.zip}`);
  const [tracking, setTracking] = useState("");
  const [stated, setStated] = useState("");
  const [proving, setProving] = useState<{ id: string; outcome: "delivered" | "returned" } | null>(null);
  const [on, setOn] = useState(today);
  const [detail, setDetail] = useState("");
  const stayed = Boolean(openBankruptcy(deal));
  const notices = [...(deal.notices ?? [])].reverse();
  const save = async () => { if (await dispatch({ t: "logNotice", dealId: deal.id, kind, sentOn, method, to: to.trim(), tracking: tracking.trim(), amount: stated ? amount(stated) : l.amountDue, by: viewerName })) { setAdding(false); setTracking(""); setStated(""); } };
  const prove = async () => { if (proving && (await dispatch({ t: "noticeOutcome", dealId: deal.id, noticeId: proving.id, outcome: proving.outcome, on, detail: detail.trim(), by: viewerName }))) { setProving(null); setDetail(""); } };
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notices</h3>
      {live && !stayed && (!adding ? <button type="button" className="btn-ghost h-9! px-3! text-xs!" data-testid="add-notice" onClick={() => { setKind(likely); setAdding(true); }}>Record a notice sent</button> : (
        <div className="space-y-2 rounded-[2px] border border-border p-3" data-testid="notice-form">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block sm:col-span-2"><span className="label">Notice</span><select className="desk-input" data-testid="notice-kind" value={kind} onChange={(event) => setKind(event.target.value as NoticeKind)}>{Object.entries(NOTICE_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="block"><span className="label">Sent on</span><input type="date" className="desk-input" data-testid="notice-sent" max={today} value={sentOn} onChange={(event) => setSentOn(event.target.value)} /></label>
            <label className="block"><span className="label">How</span><select className="desk-input" data-testid="notice-method" value={method} onChange={(event) => setMethod(event.target.value as DeliveryMethod)}>{Object.entries(DELIVERY_METHODS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="block"><span className="label">Tracking number</span><input className="desk-input" data-testid="notice-tracking" maxLength={80} value={tracking} onChange={(event) => setTracking(event.target.value)} /></label>
            <label className="block"><span className="label">Amount it states</span><input className="desk-input" inputMode="decimal" data-testid="notice-amount" placeholder={l.amountDue.toFixed(2)} value={stated} onChange={(event) => setStated(event.target.value)} /></label>
            <label className="block sm:col-span-3"><span className="label">Sent to</span><input className="desk-input" data-testid="notice-to" maxLength={300} value={to} onChange={(event) => setTo(event.target.value)} /></label>
          </div>
          <p className="text-xs text-muted-foreground">{kind === "default" ? `The borrower has until ${shortDay(addDays(sentOn, COLLECTIONS.cureDays))} to cure (${COLLECTIONS.cureDays} days, PLACEHOLDER until the attorney sets it from the loan documents). ` : ""}The letter is the attorney&apos;s template; send copies to every guarantor too.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" data-testid="save-notice" disabled={!to.trim()} onClick={() => void save()}>Record it</button>
            <button type="button" className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ))}
      {notices.length > 0 && (
        <ul className="divide-y divide-border" data-testid="notice-list">
          {notices.map((item) => (
            <li key={item.id} className="space-y-1 py-2" data-testid="notice-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><b>{NOTICE_KINDS[item.kind]}</b>, {usd(item.amount, 2)}, sent {shortDay(item.sentOn)} by {DELIVERY_METHODS[item.method].toLowerCase()}{item.tracking ? ` (${item.tracking})` : ""}</span>
                <Badge tone={item.delivered ? "green" : item.returned ? "rose" : "amber"}>{item.delivered ? `Delivered ${shortDay(item.delivered.on)}` : item.returned ? "Came back" : "In transit"}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">To {item.to}.{item.cureBy ? ` Cure by ${shortDay(item.cureBy)}.` : ""}{item.delivered ? ` Proof: ${item.delivered.proof}.` : ""}{item.returned ? ` Returned ${shortDay(item.returned.on)}: ${item.returned.reason}.` : ""}</p>
              {live && !item.delivered && !item.returned && (proving?.id !== item.id ? (
                <span className="flex gap-3 text-xs"><button type="button" className="text-link underline underline-offset-2" data-testid="notice-delivered" onClick={() => { setProving({ id: item.id, outcome: "delivered" }); setOn(today); }}>It arrived</button><button type="button" className="text-link underline underline-offset-2" data-testid="notice-returned" onClick={() => { setProving({ id: item.id, outcome: "returned" }); setOn(today); }}>It came back</button></span>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block"><span className="label">On</span><input type="date" className="desk-input" data-testid="notice-outcome-on" min={item.sentOn} max={today} value={on} onChange={(event) => setOn(event.target.value)} /></label>
                  <label className="block min-w-0 flex-1 basis-48"><span className="label">{proving.outcome === "delivered" ? "Proof (signed receipt, tracking, who took it)" : "Why it came back"}</span><input className="desk-input" data-testid="notice-outcome-detail" maxLength={300} value={detail} onChange={(event) => setDetail(event.target.value)} /></label>
                  <button type="button" className="btn-primary h-10! px-3! text-xs!" data-testid="save-notice-outcome" disabled={!detail.trim()} onClick={() => void prove()}>Save</button>
                  <button type="button" className="btn-ghost h-10! px-3! text-xs!" onClick={() => setProving(null)}>Cancel</button>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
