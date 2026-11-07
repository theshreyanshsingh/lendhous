"use client";
import { useState } from "react";
import { bookCall } from "@/actions/calls";
import { CALL_TOPICS, type CallTopic } from "@/lib/calls";

const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const timeLabel = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(iso)).toLowerCase();

/** The open times by day, then who to call and what about (lib/calls.ts). */
export function BookCall({ days }: { days: { day: string; slots: string[] }[] }) {
  const [day, setDay] = useState(days[0].day);
  const [startsAt, setStartsAt] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "", topic: "new_loan" as CallTopic, notes: "" });
  const [honeypot, setHoneypot] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [booked, setBooked] = useState("");
  const slots = days.find((item) => item.day === day)?.slots ?? [];
  if (booked) return (
    <div className="panel" data-testid="call-booked" role="status">
      <div className="eyebrow">BOOKED</div>
      <h2 className="quote-step-title">You&apos;re booked for {booked}.</h2>
      <p className="quote-small">We&apos;ve sent the details to {form.email}. A loan officer will call {form.phone}. To change the time, reply to that email.</p>
    </div>
  );
  const send = async () => {
    setSending(true); setError("");
    const reply: { booked?: string; error?: string } = await bookCall({ startsAt, ...form }, honeypot).catch(() => ({ error: "We couldn't book that just now. Please try again in a few minutes." }));
    setSending(false);
    if (reply.error) return setError(reply.error);
    setBooked(reply.booked ?? "");
  };
  return (
    <form className="quote-form" data-testid="book-call" onSubmit={(event) => { event.preventDefault(); void send(); }} noValidate>
      <section className="panel">
        <div className="quote-step-title"><i>1</i> A day</div>
        <div className="quote-chips" role="radiogroup" aria-label="Day">
          {days.map((item) => <button key={item.day} type="button" role="radio" aria-checked={day === item.day} data-testid="call-day" className={`quote-chip ${day === item.day ? "on" : ""}`} onClick={() => { setDay(item.day); setStartsAt(""); }}>{dayLabel(item.day)}</button>)}
        </div>
        <div className="quote-step-title" style={{ marginTop: 18 }}><i>2</i> A time (Eastern)</div>
        <div className="quote-chips" role="radiogroup" aria-label="Time">
          {slots.map((slot) => <button key={slot} type="button" role="radio" aria-checked={startsAt === slot} data-testid="call-time" className={`quote-chip ${startsAt === slot ? "on" : ""}`} onClick={() => setStartsAt(slot)}>{timeLabel(slot)}</button>)}
        </div>
      </section>
      <section className="panel">
        <div className="quote-step-title"><i>3</i> Who we call</div>
        <div className="fields">
          <label>Your name *<input data-testid="call-name" autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Phone *<input data-testid="call-phone" type="tel" autoComplete="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
          <label>Email, for the confirmation *<input data-testid="call-email" type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          <label>What it&apos;s about *<select data-testid="call-topic" value={form.topic} onChange={(event) => setForm({ ...form, topic: event.target.value as CallTopic })}>{(Object.entries(CALL_TOPICS) as [CallTopic, string][]).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        </div>
        <label style={{ marginTop: 20 }}>Anything we should know first (optional)<textarea data-testid="call-notes" rows={3} maxLength={1500} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        <label className="hp" aria-hidden="true">Leave this empty<input tabIndex={-1} autoComplete="off" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} /></label>
        {error && <p className="form-error"><span role="alert" data-testid="call-error">{error}</span></p>}
        <button className="button quote-submit" type="submit" data-testid="call-submit" disabled={sending || !startsAt}>{sending ? "Booking…" : startsAt ? "Book this call" : "Pick a time first"}</button>
      </section>
    </form>
  );
}
