"use server";

import { audit } from "@/lib/audit";
import { bookedTimes, saveBooking } from "@/lib/call-store";
import { bookingProblem, CALL_TOPICS, slotLabel, type CallRequest } from "@/lib/calls";
import { notify, notifyTeam } from "@/lib/email";
import { consumeRateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request-meta";
import { freshSettings } from "@/lib/settings";

/** A visitor books a call from /book. Open to anyone, so it's rate limited, has a honeypot, and re-checks the time. */
export async function bookCall(raw: CallRequest, honeypot = ""): Promise<{ booked?: string; error?: string }> {
  if (honeypot) return { booked: "" };
  if ((await freshSettings()).allowCallBooking === false) return { error: "Booking a call isn't open right now. Request a quote and a loan officer will call you." };
  const input: CallRequest = { startsAt: String(raw?.startsAt ?? ""), name: String(raw?.name ?? "").slice(0, 120), email: String(raw?.email ?? "").slice(0, 200), phone: String(raw?.phone ?? "").slice(0, 40), topic: (String(raw?.topic ?? "") as CallRequest["topic"]), notes: String(raw?.notes ?? "").slice(0, 1500) };
  const meta = await requestMeta();
  const shared = /^(unknown|127\.|::1$|::ffff:127\.)/.test(meta.ipAddress);
  if (!(await consumeRateLimit(`call:${meta.ipAddress}`, shared ? 60 : 5, 60 * 60 * 1000))) return { error: "Too many bookings from this connection. Try again in an hour." };
  const now = new Date();
  const problem = bookingProblem(input, now, await bookedTimes(now));
  if (problem) return { error: problem };
  const saved = await saveBooking(input);
  if ("taken" in saved) return { error: "Someone just took that time. Pick another." };
  const when = slotLabel(input.startsAt);
  await audit({ actorId: null, action: "call.booked", entityType: "CallBooking", entityId: saved.id, after: { startsAt: input.startsAt, topic: input.topic } });
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL || "";
    await notifyTeam(`Call booked: ${when}`, `${input.name.trim()} booked a call for ${when} about ${CALL_TOPICS[input.topic].toLowerCase()}.\nPhone: ${input.phone.trim()} · Email: ${input.email.trim()}${input.notes.trim() ? `\n\n${input.notes.trim()}` : ""}\n\nUpcoming calls: ${origin}/admin/leads`, "call.booked", input.email.trim());
    await notify(input.email.trim().toLowerCase(), `Your call with LendHous: ${when}`, `Thank you, ${input.name.trim().split(/\s+/)[0]}. A LendHous loan officer will call you at ${input.phone.trim()} on ${when}.\n\nTo change the time, reply to this email.`, { eventCode: "call.confirmed" });
  } catch (error) {
    console.error("[lendhous-calls] could not send the booking emails:", error);
  }
  return { booked: when };
}
